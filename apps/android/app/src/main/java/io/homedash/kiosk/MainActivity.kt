package io.homedash.kiosk

import android.Manifest
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE) }
    private var webView: WebView? = null
    private var deviceAdminRequestPending = false
    private var pendingUpdateVersion: String? = null
    private var exitingToAndroid = false
    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startPresenceService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySavedOrientation()
        leaveLegacyKioskMode()
        hideSystemBars()
        onBackPressedDispatcher.addCallback(this) { exitToAndroid() }

        val serverUrl = preferences.getString(KEY_SERVER_URL, null)
        if (serverUrl.isNullOrBlank()) showSetup() else showDashboard(serverUrl)
    }

    override fun onResume() {
        super.onResume()
        exitingToAndroid = false
        leaveLegacyKioskMode()
        hideSystemBars()
        if (
            webView != null &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        ) {
            startPresenceService()
        }
        if (deviceAdminRequestPending) {
            deviceAdminRequestPending = false
            val enabled = isDeviceAdminActive()
            preferences.edit().putBoolean(KEY_AUTO_SCREEN_OFF, enabled).apply()
            Toast.makeText(
                this,
                if (enabled) {
                    "Extinction après absence activée"
                } else {
                    "Autorisation non accordée — extinction automatique désactivée"
                },
                Toast.LENGTH_LONG,
            ).show()
            if (webView == null) showSetup()
        }
        pendingUpdateVersion?.let { version ->
            if (packageManager.canRequestPackageInstalls()) {
                pendingUpdateVersion = null
                downloadAndInstallUpdate(version)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        stopService(Intent(this, PresenceService::class.java))
    }

    private fun leaveLegacyKioskMode() {
        val manager = getSystemService(ActivityManager::class.java)
        if (manager.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) {
            runCatching { stopLockTask() }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !exitingToAndroid) hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun showSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            show(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
        }
    }

    private fun applySavedOrientation() {
        requestedOrientation =
            when (preferences.getString(KEY_ORIENTATION, ORIENTATION_LANDSCAPE)) {
                ORIENTATION_PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                else -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            }
    }

    private fun setOrientation(value: String) {
        val normalized =
            if (value == ORIENTATION_PORTRAIT) ORIENTATION_PORTRAIT else ORIENTATION_LANDSCAPE
        preferences.edit().putString(KEY_ORIENTATION, normalized).apply()
        applySavedOrientation()
    }

    private fun showDashboard(serverUrl: String) {
        val allowedOrigin = Uri.parse(serverUrl)
        val view = WebView(this)
        webView?.destroy()
        webView = view
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.databaseEnabled = true
        view.settings.mediaPlaybackRequiresUserGesture = true
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = false
        view.settings.setSupportZoom(false)
        view.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        view.addJavascriptInterface(HomeDashBridge(), ANDROID_BRIDGE_NAME)
        view.webChromeClient = WebChromeClient()
        view.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    webView: WebView?,
                    request: WebResourceRequest?,
                ): Boolean {
                    val target = request?.url ?: return false
                    val isHomeDash =
                        target.scheme == allowedOrigin.scheme &&
                            target.host == allowedOrigin.host &&
                            effectivePort(target) == effectivePort(allowedOrigin)
                    if (isHomeDash) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
                    return true
                }

                override fun onReceivedError(
                    webView: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?,
                ) {
                    if (request?.isForMainFrame == true) {
                        Toast.makeText(
                            this@MainActivity,
                            "HomeDash hors ligne — reconnexion automatique",
                            Toast.LENGTH_LONG,
                        ).show()
                        webView?.postDelayed(
                            {
                                if (!isFinishing && !isDestroyed) webView?.reload()
                            },
                            5_000,
                        )
                    }
                }
            }
        setContentView(view)
        hideSystemBars()
        view.loadUrl(serverUrl)
        requestCameraAndStart()
    }

    private fun effectivePort(uri: Uri): Int =
        if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80

    private fun showSetup() {
        stopService(Intent(this, PresenceService::class.java))
        webView?.destroy()
        webView = null
        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(padding, padding, padding, padding)
            }
        val title =
            TextView(this).apply {
                text = "Configurer HomeDash"
                textSize = 26f
                gravity = Gravity.CENTER
            }
        val url =
            EditText(this).apply {
                hint = "Adresse, ex. https://homedash.local"
                setText(preferences.getString(KEY_SERVER_URL, "https://homedash.local"))
                isSingleLine = true
            }
        val code =
            EditText(this).apply {
                hint = "Code d’association à 6 chiffres (première installation)"
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
                isSingleLine = true
            }
        val name =
            EditText(this).apply {
                hint = "Nom de la tablette"
                setText("Tablette murale")
                isSingleLine = true
            }
        val orientationTitle = TextView(this).apply { text = "Orientation du dashboard" }
        val orientationGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        val landscape = RadioButton(this).apply { text = "Paysage"; id = View.generateViewId() }
        val portrait = RadioButton(this).apply { text = "Portrait"; id = View.generateViewId() }
        orientationGroup.addView(landscape)
        orientationGroup.addView(portrait)
        orientationGroup.check(
            if (preferences.getString(KEY_ORIENTATION, ORIENTATION_LANDSCAPE) == ORIENTATION_PORTRAIT) {
                portrait.id
            } else {
                landscape.id
            },
        )
        val button = Button(this).apply { text = "Enregistrer et ouvrir HomeDash" }
        val autoScreenOffButton =
            Button(this).apply {
                text =
                    if (isAutoScreenOffEnabled()) {
                        "Désactiver l’extinction après 90 secondes"
                    } else {
                        "Activer l’extinction après 90 secondes"
                    }
            }
        val exitButton = Button(this).apply { text = "Retour à Android" }
        val help =
            TextView(this).apply {
                text =
                    "Le code d’association n’est nécessaire qu’une fois. " +
                    "L’orientation reste ensuite modifiable dans Paramètres > Affichage tablette. " +
                    "Le délai de veille Android reste toujours prioritaire. L’extinction après absence " +
                    "est facultative et peut verrouiller l’écran plus tôt."
                gravity = Gravity.CENTER
            }
        listOf(
            title,
            url,
            code,
            name,
            orientationTitle,
            orientationGroup,
            button,
            autoScreenOffButton,
            exitButton,
            help,
        ).forEach {
            layout.addView(
                it,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { setMargins(0, 8, 0, 8) },
            )
        }
        setContentView(layout)
        hideSystemBars()
        exitButton.setOnClickListener { exitToAndroid() }
        autoScreenOffButton.setOnClickListener {
            if (isAutoScreenOffEnabled()) {
                preferences.edit().putBoolean(KEY_AUTO_SCREEN_OFF, false).apply()
                runCatching {
                    getSystemService(DevicePolicyManager::class.java).removeActiveAdmin(
                        ComponentName(this, KioskDeviceAdminReceiver::class.java),
                    )
                }
                showSetup()
            } else if (isDeviceAdminActive()) {
                preferences.edit().putBoolean(KEY_AUTO_SCREEN_OFF, true).apply()
                showSetup()
            } else {
                deviceAdminRequestPending = true
                startActivity(
                    Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(
                            DevicePolicyManager.EXTRA_DEVICE_ADMIN,
                            ComponentName(this, KioskDeviceAdminReceiver::class.java),
                        ).putExtra(
                            DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                            "HomeDash utilise cette autorisation uniquement pour éteindre l’écran après 90 secondes sans présence.",
                        ),
                )
            }
        }
        button.setOnClickListener {
            val normalized = url.text.toString().trim().trimEnd('/')
            if (normalized.isBlank()) return@setOnClickListener
            val selectedOrientation =
                if (orientationGroup.checkedRadioButtonId == portrait.id) {
                    ORIENTATION_PORTRAIT
                } else {
                    ORIENTATION_LANDSCAPE
                }
            button.isEnabled = false
            lifecycleScope.launch {
                try {
                    if (code.text.isNotBlank()) {
                        pair(
                            normalized,
                            code.text.toString(),
                            name.text.toString().ifBlank { "Tablette HomeDash" },
                        )
                    }
                    preferences.edit().putString(KEY_SERVER_URL, normalized).apply()
                    setOrientation(selectedOrientation)
                    showDashboard(normalized)
                } catch (error: Exception) {
                    Toast.makeText(
                        this@MainActivity,
                        error.message ?: "Association impossible",
                        Toast.LENGTH_LONG,
                    ).show()
                    button.isEnabled = true
                }
            }
        }
    }

    private suspend fun pair(
        serverUrl: String,
        code: String,
        name: String,
    ) = withContext(Dispatchers.IO) {
        val connection = URL("$serverUrl/api/v1/devices/pair").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doOutput = true
        connection.outputStream.use {
            it.write(JSONObject().put("code", code).put("name", name).toString().toByteArray())
        }
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("Code refusé (${connection.responseCode})")
        }
        val response = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        preferences
            .edit()
            .putString("deviceId", response.getString("deviceId"))
            .putString("deviceToken", response.getString("token"))
            .apply()
        connection.disconnect()
    }

    private fun requestCameraAndStart() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startPresenceService()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startPresenceService() {
        ContextCompat.startForegroundService(this, Intent(this, PresenceService::class.java))
    }

    private fun isDeviceAdminActive(): Boolean =
        getSystemService(DevicePolicyManager::class.java).isAdminActive(
            ComponentName(this, KioskDeviceAdminReceiver::class.java),
        )

    private fun isAutoScreenOffEnabled(): Boolean =
        preferences.getBoolean(KEY_AUTO_SCREEN_OFF, false) && isDeviceAdminActive()

    private fun exitToAndroid() {
        exitingToAndroid = true
        stopService(Intent(this, PresenceService::class.java))
        leaveLegacyKioskMode()
        showSystemBars()
        moveTaskToBack(true)
    }

    private fun requestAndroidUpdate(version: String) {
        if (!VERSION_PATTERN.matches(version)) {
            Toast.makeText(this, "Version de mise à jour invalide", Toast.LENGTH_LONG).show()
            return
        }
        if (
            preferences.getString(KEY_DEVICE_ID, null).isNullOrBlank() ||
                preferences.getString(KEY_DEVICE_TOKEN, null).isNullOrBlank()
        ) {
            Toast.makeText(
                this,
                "Associez d’abord cette tablette dans les paramètres HomeDash.",
                Toast.LENGTH_LONG,
            ).show()
            return
        }
        if (!packageManager.canRequestPackageInstalls()) {
            pendingUpdateVersion = version
            Toast.makeText(
                this,
                "Autorisez HomeDash à installer sa mise à jour, puis revenez à l’application.",
                Toast.LENGTH_LONG,
            ).show()
            runCatching {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName"),
                    ),
                )
            }.onFailure {
                pendingUpdateVersion = null
                Toast.makeText(this, "Réglage Android indisponible", Toast.LENGTH_LONG).show()
            }
            return
        }
        downloadAndInstallUpdate(version)
    }

    private fun downloadAndInstallUpdate(version: String) {
        Toast.makeText(this, "Téléchargement de HomeDash $version…", Toast.LENGTH_LONG).show()
        lifecycleScope.launch {
            try {
                val apk = withContext(Dispatchers.IO) { downloadUpdate(version) }
                val uri =
                    FileProvider.getUriForFile(
                        this@MainActivity,
                        "$packageName.updates",
                        apk,
                    )
                val intent =
                    Intent(Intent.ACTION_INSTALL_PACKAGE)
                        .setData(uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
                        .putExtra(Intent.EXTRA_RETURN_RESULT, false)
                startActivity(intent)
            } catch (error: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    error.message ?: "Mise à jour impossible",
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }

    private fun downloadUpdate(version: String): File {
        val serverUrl = preferences.getString(KEY_SERVER_URL, null) ?: error("Serveur non configuré")
        val deviceId = preferences.getString(KEY_DEVICE_ID, null) ?: error("Tablette non associée")
        val token = preferences.getString(KEY_DEVICE_TOKEN, null) ?: error("Tablette non associée")
        val connection =
            URL("$serverUrl/api/v1/devices/$deviceId/updates/android/$version/apk")
                .openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 15_000
        connection.readTimeout = 120_000
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
        connection.setRequestProperty("Authorization", "Bearer $token")
        try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("Téléchargement refusé (${connection.responseCode})")
            }
            val expectedDigest = connection.getHeaderField("X-HomeDash-SHA256")?.lowercase()
            if (expectedDigest == null || !SHA256_PATTERN.matches(expectedDigest)) {
                throw IllegalStateException("Somme SHA-256 absente ou invalide")
            }
            if (connection.contentLengthLong > MAX_APK_BYTES) {
                throw IllegalStateException("APK trop volumineuse")
            }

            val directory = File(cacheDir, "updates").apply { mkdirs() }
            directory.listFiles()?.forEach { if (it.isFile) it.delete() }
            val temporary = File(directory, ".homedash-kiosk-$version.apk.tmp")
            val destination = File(directory, "homedash-kiosk-$version.apk")
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            connection.inputStream.use { input ->
                temporary.outputStream().buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        received += count
                        if (received > MAX_APK_BYTES) throw IllegalStateException("APK trop volumineuse")
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
            val actualDigest = digest.digest().joinToString("") { "%02x".format(it) }
            if (actualDigest != expectedDigest) {
                temporary.delete()
                throw IllegalStateException("Échec de la vérification SHA-256")
            }
            if (!temporary.renameTo(destination)) {
                temporary.delete()
                throw IllegalStateException("Impossible de préparer l’APK")
            }
            return destination
        } finally {
            connection.disconnect()
        }
    }

    private inner class HomeDashBridge {
        @JavascriptInterface
        fun getOrientation(): String =
            preferences.getString(KEY_ORIENTATION, ORIENTATION_LANDSCAPE) ?: ORIENTATION_LANDSCAPE

        @JavascriptInterface
        fun setOrientation(value: String) {
            runOnUiThread { this@MainActivity.setOrientation(value) }
        }

        @JavascriptInterface
        fun getAppVersion(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun installAndroidUpdate(version: String) {
            runOnUiThread { requestAndroidUpdate(version) }
        }

        @JavascriptInterface
        fun openAppSettings() {
            runOnUiThread { showSetup() }
        }

        @JavascriptInterface
        fun exitToAndroid() {
            runOnUiThread { this@MainActivity.exitToAndroid() }
        }
    }

    override fun onDestroy() {
        webView?.removeJavascriptInterface(ANDROID_BRIDGE_NAME)
        webView?.destroy()
        super.onDestroy()
    }

    companion object {
        private const val PREFERENCES_NAME = "homedash"
        private const val KEY_SERVER_URL = "serverUrl"
        private const val KEY_ORIENTATION = "orientation"
        private const val KEY_AUTO_SCREEN_OFF = "autoScreenOff"
        private const val KEY_DEVICE_ID = "deviceId"
        private const val KEY_DEVICE_TOKEN = "deviceToken"
        private const val ORIENTATION_LANDSCAPE = "landscape"
        private const val ORIENTATION_PORTRAIT = "portrait"
        private const val ANDROID_BRIDGE_NAME = "HomeDashAndroid"
        private const val MAX_APK_BYTES = 100L * 1024L * 1024L
        private val VERSION_PATTERN = Regex("^\\d+\\.\\d+\\.\\d+$")
        private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
    }
}
