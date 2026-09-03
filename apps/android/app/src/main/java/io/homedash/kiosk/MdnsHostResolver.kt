package io.homedash.kiosk

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.Locale

/** Legacy unicast mDNS query: Avahi replies to our ephemeral source port (RFC 6762 §6.7). */
internal fun resolveMdnsHost(host: String): String? {
    val query = mdnsQuery(host)
    DatagramSocket().use { socket ->
        val destination = InetAddress.getByName("224.0.0.251")
        val buffer = ByteArray(9_000)
        repeat(3) {
            socket.send(DatagramPacket(query, query.size, destination, 5353))
            val deadline = System.nanoTime() + 1_000_000_000L
            while (System.nanoTime() < deadline) {
                socket.soTimeout = ((deadline - System.nanoTime()) / 1_000_000L).toInt().coerceAtLeast(1)
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    break
                }
                if (packet.port == 5353) {
                    mdnsAnswer(packet.data.copyOf(packet.length), host)?.let { return it }
                }
            }
        }
    }
    return null
}

internal fun mdnsQuery(host: String): ByteArray {
    val output = ByteArrayOutputStream()
    DataOutputStream(output).use { data ->
        data.writeShort(0) // id
        data.writeShort(0) // standard query
        data.writeShort(1) // question
        repeat(3) { data.writeShort(0) }
        for (label in host.trimEnd('.').split('.')) {
            val bytes = label.toByteArray(Charsets.US_ASCII)
            require(bytes.size in 1..63)
            data.writeByte(bytes.size)
            data.write(bytes)
        }
        data.writeByte(0)
        data.writeShort(1) // A
        data.writeShort(1) // IN; an ephemeral source port requests a unicast reply
    }
    return output.toByteArray()
}

internal fun mdnsAnswer(packet: ByteArray, host: String): String? = runCatching {
    fun u16(offset: Int): Int =
        ((packet[offset].toInt() and 255) shl 8) or (packet[offset + 1].toInt() and 255)
    var cursor = 12
    fun readName(): String {
        var at = cursor
        var jumped = false
        val labels = mutableListOf<String>()
        repeat(128) {
            val length = packet[at].toInt() and 255
            if (length == 0) {
                if (!jumped) cursor = at + 1
                return labels.joinToString(".").lowercase(Locale.ROOT)
            }
            if (length and 0xc0 == 0xc0) {
                if (!jumped) cursor = at + 2
                at = u16(at) and 0x3fff
                jumped = true
            } else {
                require(length in 1..63 && at + 1 + length <= packet.size)
                labels.add(String(packet, at + 1, length, Charsets.US_ASCII))
                at += length + 1
            }
        }
        error("DNS compression loop")
    }
    require(packet.size >= 12 && u16(2) and 0xfa0f == 0x8000)
    repeat(u16(4)) { readName(); cursor += 4; require(cursor <= packet.size) }
    val count = u16(6) + u16(8) + u16(10)
    require(count <= packet.size / 11)
    repeat(count) {
        val name = readName()
        val type = u16(cursor)
        val dnsClass = u16(cursor + 2) and 0x7fff
        val ttlIsPositive = packet.copyOfRange(cursor + 4, cursor + 8).any { it != 0.toByte() }
        val length = u16(cursor + 8)
        cursor += 10
        require(cursor + length <= packet.size)
        if (name == host.trimEnd('.').lowercase(Locale.ROOT) && type == 1 &&
            dnsClass == 1 && ttlIsPositive && length == 4) {
            val address = InetAddress.getByAddress(packet.copyOfRange(cursor, cursor + 4))
            if (!address.isAnyLocalAddress && !address.isLoopbackAddress && !address.isMulticastAddress) {
                return address.hostAddress
            }
        }
        cursor += length
    }
    null
}.getOrNull()

