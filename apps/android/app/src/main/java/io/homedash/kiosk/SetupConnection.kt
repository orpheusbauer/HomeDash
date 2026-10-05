package io.homedash.kiosk

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * DNS and HttpURLConnection can ignore coroutine cancellation while blocking.
 * Await their result without making the UI wait for that worker to finish.
 * The operation must only return data: save preferences after this call succeeds.
 */
internal suspend fun <T> runSetupIo(
    timeoutMs: Long,
    ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    operation: () -> T,
): T = withTimeout(timeoutMs) {
    suspendCancellableCoroutine { continuation ->
        ioDispatcher.dispatch(continuation.context, Runnable {
            if (continuation.isActive) {
                val result = runCatching(operation)
                if (continuation.isActive) continuation.resumeWith(result)
            }
        })
    }
}

internal class PairingRejectedException(val statusCode: Int) :
    IllegalStateException("Association refusée (HTTP $statusCode).")

internal fun requestTabletPairing(
    serverUrl: String,
    requestBody: ByteArray,
    openConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
): String {
    val connection = openConnection(URL("$serverUrl/api/v1/devices/pair"))
    try {
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        connection.requestMethod = "POST"
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.doOutput = true
        connection.setFixedLengthStreamingMode(requestBody.size)
        connection.outputStream.use { it.write(requestBody) }
        val statusCode = connection.responseCode
        if (statusCode !in 200..299) throw PairingRejectedException(statusCode)
        return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    } finally {
        connection.disconnect()
    }
}

internal fun setupErrorMessage(error: Exception): String = when (error) {
    is TimeoutCancellationException, is SocketTimeoutException ->
        "Le Raspberry Pi n’a pas répondu à temps. Vérifiez le Wi-Fi et l’adresse HTTPS, puis réessayez."
    is UnknownHostException ->
        "Le nom du Raspberry Pi est introuvable sur ce Wi-Fi. Saisissez son adresse IP."
    is SSLException ->
        "La connexion HTTPS n’a pas pu être vérifiée. Vérifiez le certificat d’autorité du Pi installé " +
            "dans Android, la date de la tablette et l’adresse couverte par le certificat."
    is ConnectException ->
        "Connexion au Raspberry Pi impossible. Vérifiez son adresse HTTPS et que la tablette est sur le même réseau."
    is PairingRejectedException -> when (error.statusCode) {
        401 -> "Le code d’association est invalide, expiré ou déjà utilisé. Générez un nouveau code depuis les paramètres du PC."
        400 -> "Le code ou le nom de la tablette est invalide. Vérifiez les six chiffres et le nom saisi."
        429 -> "Trop de tentatives d’association. Patientez une minute, puis réessayez."
        502, 503, 504 -> "Le serveur HomeDash est momentanément indisponible (HTTP ${error.statusCode}). Patientez, puis réessayez."
        else -> "Association refusée par le serveur HomeDash (HTTP ${error.statusCode})."
    }
    is IOException ->
        "La connexion au Raspberry Pi a été interrompue. Vérifiez le Wi-Fi, puis réessayez."
    else -> error.message ?: "Association impossible. Vérifiez l’adresse du serveur et le code, puis réessayez."
}
