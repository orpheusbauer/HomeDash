package io.homedash.kiosk

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.UnknownHostException

class ServerAddressTest {
    @Test
    fun `accepts a bare hostname or IP and preserves the exact hostname and port`() {
        assertEquals("https://homedash.local", normalizeServerAddress(" HomeDash.local. "))
        assertEquals("https://192.0.2.10", normalizeServerAddress("192.0.2.10/"))
        assertEquals("https://homedash.local:8443", normalizeServerAddress("homedash.local:8443"))
        assertEquals("http://192.0.2.10:4100", normalizeServerAddress("http://192.0.2.10:4100", true))
    }

    @Test
    fun `rejects credentials invalid origins and insecure production URLs`() {
        listOf("", "home dash.local", "https://user:pass@homedash.local", "http://192.0.2.10",
            "javascript:alert(1)", "https://homedash.local/path", "https://homedash.local?token=123",
            "https://homedash.local:99999").forEach {
            assertThrows(IllegalArgumentException::class.java) { normalizeServerAddress(it) }
        }
    }

    @Test
    fun `resolves local hostnames when Android DNS does not support mDNS`() {
        var queried = ""
        val resolved = resolveServerAddress("https://homedash.local:8443",
            systemLookup = { throw UnknownHostException(it) },
            multicastLookup = { queried = it; "192.0.2.10" })
        assertEquals("homedash.local", queried)
        assertEquals("https://192.0.2.10:8443", resolved)
    }

    @Test
    fun `uses a resolved address for both the WebView and native requests`() {
        assertEquals("https://192.0.2.10", resolveServerAddress("https://homedash.local",
            systemLookup = { listOf(InetAddress.getByName("192.0.2.10")) },
            multicastLookup = { error("Should not query twice") }))
        assertEquals("https://192.0.2.10", resolveServerAddress("https://192.0.2.10",
            systemLookup = { error("No lookup for an IP") },
            multicastLookup = { error("No multicast for an IP") }))
    }

    @Test
    fun `reports an unresolved name without guessing a different Pi`() {
        val error = assertThrows(IllegalStateException::class.java) {
            resolveServerAddress("https://homedash.local", systemLookup = { emptyList() }, multicastLookup = { null })
        }
        assertTrue(error.message!!.contains("homedash.local"))
        assertTrue(error.message!!.contains("adresse IP"))
    }
}

