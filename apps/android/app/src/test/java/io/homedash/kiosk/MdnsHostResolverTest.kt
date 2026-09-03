package io.homedash.kiosk

import org.junit.Assert.*
import org.junit.Test

class MdnsHostResolverTest {
    private fun answer(name: String = "homedash.local", ip: List<Int> = listOf(192, 0, 2, 10)): ByteArray {
        val question = mdnsQuery(name)
        question[2] = 0x84.toByte() // response, authoritative
        question[7] = 1 // one answer, compressed owner name points at the question
        return question + byteArrayOf(0xc0.toByte(), 12, 0, 1, 0x80.toByte(), 1, 0, 0, 0, 120, 0, 4) +
            ip.map(Int::toByte).toByteArray()
    }

    @Test
    fun `reads an Avahi IPv4 answer with compressed name and cache flush flag`() {
        assertEquals("192.0.2.10", mdnsAnswer(answer(), "HOMEDASH.LOCAL."))
        assertNull(mdnsAnswer(answer(), "autre-pi.local"))
    }

    @Test
    fun `ignores queries truncated packets loops and invalid addresses`() {
        assertNull(mdnsAnswer(mdnsQuery("homedash.local"), "homedash.local"))
        val packet = answer()
        for (length in 0 until packet.size) {
            assertNull("length=$length", mdnsAnswer(packet.copyOf(length), "homedash.local"))
        }
        val loop = answer()
        loop[12] = 0xc0.toByte()
        loop[13] = 12
        assertNull(mdnsAnswer(loop, "homedash.local"))
        assertNull(mdnsAnswer(answer(ip = listOf(127, 0, 0, 1)), "homedash.local"))
        assertNull(mdnsAnswer(answer(ip = listOf(224, 0, 0, 251)), "homedash.local"))
    }

    @Test
    fun `ignores goodbye and truncated responses`() {
        val goodbye = answer()
        goodbye[goodbye.size - 7] = 0
        assertNull(mdnsAnswer(goodbye, "homedash.local"))
        val truncated = answer()
        truncated[2] = 0x86.toByte()
        assertNull(mdnsAnswer(truncated, "homedash.local"))
    }
}

