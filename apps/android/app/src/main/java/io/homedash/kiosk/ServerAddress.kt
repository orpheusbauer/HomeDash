package io.homedash.kiosk

import java.net.Inet4Address
import java.net.InetAddress
import java.net.URI
import java.util.Locale

internal fun normalizeServerAddress(input: String, allowHttp: Boolean = false): String {
    val trimmed = input.trim()
    require(trimmed.isNotEmpty()) { "Saisissez le nom ou l’adresse IP du Raspberry Pi." }
    val value = if (trimmed.contains("://")) trimmed else "https://$trimmed"
    val uri = runCatching { URI(value) }.getOrElse {
        throw IllegalArgumentException("Adresse du serveur invalide.", it)
    }
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    require(scheme == "https" || allowHttp && scheme == "http") { "Utilisez une adresse HTTPS." }
    require(!uri.host.isNullOrBlank() && uri.rawUserInfo == null &&
        uri.rawQuery == null && uri.rawFragment == null &&
        (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") &&
        (uri.port == -1 || uri.port in 1..65535)) { "Saisissez uniquement le nom ou l’IP du serveur, avec son port si nécessaire." }
    return URI(scheme, null, uri.host.lowercase(Locale.ROOT).trimEnd('.'), uri.port, null, null, null).toString()
}

/** Resolve .local ourselves on Android versions whose WebView does not support mDNS. */
internal fun resolveServerAddress(
    address: String,
    systemLookup: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() },
    multicastLookup: (String) -> String? = ::resolveMdnsHost,
): String {
    val uri = URI(address)
    val host = uri.host
    if (!host.endsWith(".local", ignoreCase = true)) return address
    val ip = runCatching { systemLookup(host).filterIsInstance<Inet4Address>().firstOrNull()?.hostAddress }
        .getOrNull() ?: multicastLookup(host)
        ?: throw IllegalStateException(
            "Le nom $host est introuvable sur ce Wi-Fi. Vérifiez le nom exact du Pi ou saisissez son adresse IP dans « Adresse du serveur ».",
        )
    // The installer includes the Pi's reserved IP in its TLS certificate. TLS stays enforced.
    return URI(uri.scheme, null, ip, uri.port, null, null, null).toString()
}

