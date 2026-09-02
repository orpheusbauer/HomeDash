package io.homedash.kiosk

import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.util.concurrent.Executors

class UpdateDownloadTest {
    @Test
    fun `reads WebView state on main and downloads on IO even when called from a worker`() {
        Executors.newSingleThreadExecutor { Thread(it, "test-ui") }.asCoroutineDispatcher().use { main ->
            Executors.newSingleThreadExecutor { Thread(it, "test-network") }.asCoroutineDispatcher().use { io ->
                runBlocking(io) {
                    val mainThread = withContext(main) { Thread.currentThread() }
                    val ioThread = Thread.currentThread()
                    val result = downloadUpdateWithRetry(
                        serverOrigin = {
                            assertSame(mainThread, Thread.currentThread())
                            "https://homedash.local"
                        },
                        download = { origin ->
                            assertSame(ioThread, Thread.currentThread())
                            assertEquals("https://homedash.local", origin)
                            "verified-apk"
                        },
                        mainDispatcher = main,
                        ioDispatcher = io,
                    )
                    assertEquals("verified-apk", result)
                }
            }
        }
    }

    @Test
    fun `network retries reuse one main-thread snapshot`() {
        Executors.newSingleThreadExecutor { Thread(it, "test-ui") }.asCoroutineDispatcher().use { main ->
            Executors.newSingleThreadExecutor { Thread(it, "test-network") }.asCoroutineDispatcher().use { io ->
                runBlocking {
                    val mainThread = withContext(main) { Thread.currentThread() }
                    val ioThread = withContext(io) { Thread.currentThread() }
                    var reads = 0
                    var attempts = 0
                    val result = downloadUpdateWithRetry(
                        serverOrigin = {
                            assertSame(mainThread, Thread.currentThread())
                            reads += 1
                            "https://homedash.local"
                        },
                        download = { origin ->
                            assertSame(ioThread, Thread.currentThread())
                            assertEquals("https://homedash.local", origin)
                            attempts += 1
                            if (attempts < 3) throw IOException("Temporary outage")
                            "verified-apk"
                        },
                        mainDispatcher = main,
                        ioDispatcher = io,
                        retryDelaysMs = listOf(0L, 0L),
                    )
                    assertEquals("verified-apk", result)
                    assertEquals(1, reads)
                    assertEquals(3, attempts)
                }
            }
        }
    }

    @Test
    fun `does not retry programming or checksum failures as network errors`() {
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
            runBlocking {
                val failure = IllegalStateException("Checksum mismatch")
                var attempts = 0
                try {
                    downloadUpdateWithRetry<Unit>(
                        serverOrigin = { "https://homedash.local" },
                        download = { attempts += 1; throw failure },
                        mainDispatcher = dispatcher,
                        ioDispatcher = dispatcher,
                        retryDelaysMs = listOf(0L, 0L),
                    )
                    fail("Expected the original failure")
                } catch (error: IllegalStateException) {
                    // Coroutine stack-trace recovery can copy the exception.
                    assertEquals(failure.javaClass, error.javaClass)
                    assertEquals(failure.message, error.message)
                }
                assertEquals(1, attempts)
            }
        }
    }
}
