package io.homedash.kiosk

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.IOException

/** Snapshot UI-owned state on Main; only network/file work may run on IO. */
internal suspend fun <T> downloadUpdateWithRetry(
    serverOrigin: () -> String,
    download: (String) -> T,
    mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    retryDelaysMs: List<Long> = listOf(1_000L, 3_000L),
): T {
    // WebView.getUrl() is a UI method too, even though it only reads a property.
    // Resolve once so retries cannot switch servers while an update is pending.
    val origin = withContext(mainDispatcher) { serverOrigin() }
    var lastNetworkError: IOException? = null
    val attempts = retryDelaysMs.size + 1
    repeat(attempts) { attempt ->
        try {
            return withContext(ioDispatcher) { download(origin) }
        } catch (error: IOException) {
            lastNetworkError = error
            if (attempt < retryDelaysMs.size) delay(retryDelaysMs[attempt])
        }
    }
    throw IllegalStateException(
        "Connexion au Raspberry Pi impossible après $attempts tentatives. " +
            "Vérifiez le Wi-Fi et l’adresse du serveur, puis réessayez.",
        lastNetworkError,
    )
}
