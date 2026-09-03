package io.homedash.kiosk

import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Detect a missing React mount even when Android reports a successful HTML load.
 * Recovery removes downloadable resources only, never cookies, DOM storage or pairing.
 */
internal class DashboardLoader(
    private val view: WebView,
    private val serverUrl: String,
    private val isCurrent: () -> Boolean,
    retry: () -> Unit,
    settings: () -> Unit,
    exit: () -> Unit,
    private val ready: () -> Unit,
) {
    private val message = TextView(view.context).apply {
        textSize = 20f
        gravity = Gravity.CENTER
    }
    val overlay = LinearLayout(view.context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(24, 24, 24, 24)
        setBackgroundColor(Color.rgb(247, 248, 245))
        addView(message)
        addView(Button(context).apply { text = "Réessayer"; setOnClickListener { retry() } })
        addView(Button(context).apply { text = "Adresse du serveur"; setOnClickListener { settings() } })
        addView(Button(context).apply { text = "Retour à Android"; setOnClickListener { exit() } })
        layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    private var generation = 0
    private var attempts = 0
    private var repaired = false
    private var pending: Runnable? = null
    private var repairDeadline: Runnable? = null

    fun started() {
        cancel()
        generation += 1
        message.text = "Connexion à HomeDash…"
        overlay.visibility = View.VISIBLE
        schedule(20_000) { failed("L’interface HomeDash ne démarre pas.") }
    }

    fun finished() {
        val load = generation
        checkReady(load, 0)
    }

    private fun checkReady(load: Int, poll: Int) {
        if (!isCurrent() || load != generation) return
        view.evaluateJavascript(
            "(function(){var root=document.getElementById('root');return !!(root && root.childElementCount);})()",
        ) { result ->
            if (!isCurrent() || load != generation) return@evaluateJavascript
            if (result == "true") {
                cancel()
                attempts = 0
                overlay.visibility = View.GONE
                ready()
            } else if (poll < 18) {
                // React can mount after onPageFinished, especially on older tablets.
                view.postDelayed({ checkReady(load, poll + 1) }, 1_000)
            }
        }
    }

    fun failed(reason: String) {
        if (!isCurrent()) return
        cancel()
        generation += 1
        overlay.visibility = View.VISIBLE
        attempts += 1
        if (attempts > 3) {
            message.text = "$reason\nVérifiez le Wi-Fi et le Raspberry Pi, puis réessayez. Vos réglages sont conservés."
            return
        }
        message.text = "$reason\nReconnexion en cours…"
        schedule(5_000) {
            if (!repaired && sameOrigin(view.url, serverUrl)) {
                repaired = true
                view.stopLoading()
                view.clearCache(true)
                view.evaluateJavascript(WEB_CACHE_RECOVERY_SCRIPT, null)
                val load = generation
                repairDeadline = Runnable {
                    if (isCurrent() && load == generation) view.loadUrl(serverUrl)
                }.also { view.postDelayed(it, 5_000) }
                waitForCacheRepair(generation, 0)
            } else {
                view.loadUrl(serverUrl)
            }
        }
    }

    private fun waitForCacheRepair(load: Int, poll: Int) {
        if (!isCurrent() || load != generation) return
        view.evaluateJavascript("window.__homedashCacheRepairDone === true") { result ->
            if (!isCurrent() || load != generation) return@evaluateJavascript
            if (result == "true" || poll >= 10) {
                cancel()
                view.loadUrl(serverUrl)
            } else {
                schedule(500) { waitForCacheRepair(load, poll + 1) }
            }
        }
    }

    private fun schedule(delay: Long, action: () -> Unit) {
        pending?.let(view::removeCallbacks)
        pending = Runnable { if (isCurrent()) action() }.also { view.postDelayed(it, delay) }
    }

    fun cancel() {
        pending?.let(view::removeCallbacks)
        pending = null
        repairDeadline?.let(view::removeCallbacks)
        repairDeadline = null
    }

    fun dispose() {
        generation += 1
        cancel()
    }
}

internal fun sameOrigin(candidate: String?, expected: String): Boolean =
    runCatching {
        val left = java.net.URI(candidate ?: return false)
        val right = java.net.URI(expected)
        fun port(uri: java.net.URI) = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80
        left.scheme == right.scheme && left.host == right.host && port(left) == port(right)
    }.getOrDefault(false)

internal val WEB_CACHE_RECOVERY_SCRIPT = """
    (function() {
        window.__homedashCacheRepairDone = false;
        var tasks = [];
        if ('serviceWorker' in navigator) {
            tasks.push(navigator.serviceWorker.getRegistrations().then(function(registrations) {
                return Promise.all(registrations.filter(function(registration) {
                    var worker = registration.active || registration.waiting || registration.installing;
                    return worker && new URL(worker.scriptURL).origin === location.origin
                        && new URL(worker.scriptURL).pathname === '/sw.js';
                }).map(function(registration) { return registration.unregister(); }));
            }));
        }
        if ('caches' in window) {
            tasks.push(caches.keys().then(function(keys) {
                return Promise.all(keys.filter(function(key) {
                    return key.indexOf('homedash-shell-') === 0;
                }).map(function(key) { return caches.delete(key); }));
            }));
        }
        Promise.all(tasks).then(function() {
            window.__homedashCacheRepairDone = true;
        }, function() {
            window.__homedashCacheRepairDone = true;
        });
    })();
""".trimIndent()
