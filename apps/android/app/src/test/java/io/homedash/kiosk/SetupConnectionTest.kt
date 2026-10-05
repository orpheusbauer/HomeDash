package io.homedash.kiosk

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException

class SetupConnectionTest {
    private class PairingConnection : HttpURLConnection(URL("https://192.0.2.10/api/v1/devices/pair")) {
        val sent = ByteArrayOutputStream()
        var status = 201
        var response = "paired"
        var outputFailure: IOException? = null
        var readFailure: IOException? = null
        var disconnected = false

        override fun connect() = Unit
        override fun usingProxy() = false
        override fun disconnect() { disconnected = true }
        override fun getResponseCode() = status
        override fun getOutputStream(): OutputStream {
            outputFailure?.let { throw it }
            return sent
        }
        override fun getInputStream(): InputStream {
            readFailure?.let { throw it }
            return ByteArrayInputStream(response.toByteArray(Charsets.UTF_8))
        }
    }

    @Test
    fun `pairing sends one bounded POST to the selected Pi and closes the connection`() {
        val connection = PairingConnection()
        val payload = "{\"code\":\"012345\",\"name\":\"Entrée\"}".toByteArray(Charsets.UTF_8)
        var requests = 0
        val result = requestTabletPairing("https://192.0.2.10:8443", payload) { url ->
            requests += 1
            assertEquals("https://192.0.2.10:8443/api/v1/devices/pair", url.toString())
            connection
        }
        assertEquals("paired", result)
        assertEquals(1, requests)
        assertEquals("POST", connection.requestMethod)
        assertArrayEquals(payload, connection.sent.toByteArray())
        assertEquals("application/json; charset=utf-8", connection.getRequestProperty("Content-Type"))
        assertTrue(connection.connectTimeout in 1..10_000)
        assertTrue(connection.readTimeout in 1..10_000)
        assertFalse(connection.instanceFollowRedirects)
        assertTrue(connection.disconnected)
    }

    @Test
    fun `a rejected code closes the connection and tells the user to generate a new code`() {
        val connection = PairingConnection().apply { status = 401 }
        val error = assertThrows(PairingRejectedException::class.java) {
            requestTabletPairing("https://192.0.2.10", byteArrayOf()) { connection }
        }
        assertEquals(401, error.statusCode)
        assertTrue(connection.disconnected)
        assertTrue(setupErrorMessage(error).contains("nouveau code"))
    }

    @Test
    fun `TLS and response timeouts always close the connection and give actionable errors`() {
        val certificateFailure = SSLHandshakeException("Trust anchor not found")
        val handshake = PairingConnection().apply { outputFailure = certificateFailure }
        val error = assertThrows(SSLHandshakeException::class.java) {
            requestTabletPairing("https://192.0.2.10", byteArrayOf()) { handshake }
        }
        assertSame(certificateFailure, error)
        assertTrue(handshake.disconnected)
        assertTrue(setupErrorMessage(error).contains("certificat d’autorité"))

        val timeout = PairingConnection().apply { readFailure = SocketTimeoutException("Read timed out") }
        val readError = assertThrows(SocketTimeoutException::class.java) {
            requestTabletPairing("https://192.0.2.10", byteArrayOf()) { timeout }
        }
        assertTrue(timeout.disconnected)
        assertTrue(setupErrorMessage(readError).contains("réessayez"))
    }

    @Test
    fun `server downtime is distinguished from an invalid pairing code`() {
        val connection = PairingConnection().apply { status = 502 }
        val error = assertThrows(PairingRejectedException::class.java) {
            requestTabletPairing("https://192.0.2.10", byteArrayOf()) { connection }
        }
        assertTrue(setupErrorMessage(error).contains("serveur HomeDash"))
        assertTrue(setupErrorMessage(error).contains("502"))
        assertFalse(setupErrorMessage(error).contains("code d’association"))
        assertTrue(connection.disconnected)
        assertTrue(setupErrorMessage(UnknownHostException("homedash.local")).contains("adresse IP"))
    }

    @Test
    fun `network operations run off the caller thread and resume with their result`() {
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
            runBlocking {
                val caller = Thread.currentThread()
                val result = runSetupIo(5_000, dispatcher) {
                    assertNotSame(caller, Thread.currentThread())
                    "credentials"
                }
                assertSame(caller, Thread.currentThread())
                assertEquals("credentials", result)
            }
        }
    }

    @Test
    fun `a stuck network operation times out without waiting or saving a late result`() {
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            val finished = CountDownLatch(1)
            var saved = false
            try {
                runBlocking {
                    val attempt = async {
                        runSetupIo(1_000, dispatcher) {
                            started.countDown()
                            try {
                                check(release.await(5, TimeUnit.SECONDS))
                                "late credentials"
                            } finally {
                                finished.countDown()
                            }
                        }.also { saved = true }
                    }
                    assertTrue(withContext(kotlinx.coroutines.Dispatchers.IO) { started.await(2, TimeUnit.SECONDS) })
                    try {
                        attempt.await()
                        fail("Expected setup to time out")
                    } catch (error: TimeoutCancellationException) {
                        assertTrue(setupErrorMessage(error).contains("réessayez"))
                    }
                    assertEquals(1L, finished.count)
                    assertFalse(saved)
                }
            } finally {
                release.countDown()
                assertTrue(finished.await(2, TimeUnit.SECONDS))
            }
            assertFalse(saved)
        }
    }

    @Test
    fun `leaving setup cancels the wait and discards late credentials`() {
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            val finished = CountDownLatch(1)
            var saved = false
            try {
                runBlocking {
                    val attempt = async {
                        runSetupIo(5_000, dispatcher) {
                            started.countDown()
                            try {
                                check(release.await(5, TimeUnit.SECONDS))
                                "late credentials"
                            } finally {
                                finished.countDown()
                            }
                        }.also { saved = true }
                    }
                    assertTrue(withContext(kotlinx.coroutines.Dispatchers.IO) { started.await(2, TimeUnit.SECONDS) })
                    attempt.cancel()
                    try {
                        attempt.await()
                        fail("Expected setup to be cancelled")
                    } catch (_: CancellationException) {
                        assertFalse(saved)
                    }
                    assertEquals(1L, finished.count)
                }
            } finally {
                release.countDown()
                assertTrue(finished.await(2, TimeUnit.SECONDS))
            }
            assertFalse(saved)
        }
    }
}
