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
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE) }
    private var webView: WebView? = null
    private var deviceAdminRequestPending = false
    private var pendingUpdateVersion: String? = null
    private var androidUpdateRunning = false
    private var exitingToAndroid = false
    private var activityResumed = false
    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                startMonitoringIfAuthorized()
                requestNotificationPermissionIfNeeded()
                Toast.makeText(
                    this,
                    "Caméra autorisée — les images restent analysées localement",
                    Toast.LENGTH_LONG,
                ).show()
            } else {
                preferences
                    .edit()
                    .putBoolean(KEY_MOTION_WAKE_ENABLED, false)
                    .putBoolean(KEY_AUTO_SCREEN_OFF, false)
                    .apply()
                Toast.makeText(
                    this,
                    "Caméra refusée — fonctions de présence désactivées",
                    Toast.LENGTH_LONG,
                ).show()
            }
            dispatchMotionWakeStatusChanged()
        }
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            dispatchMotionWakeStatusChanged()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySavedOrientation()
        leaveLegacyKioskMode()
        hideSystemBars()
        onBackPressedDispatcher.addCallback(this) { exitToAndroid() }
        pendingUpdateVersion =
            preferences
                .getString(KEY_PENDING_UPDATE_VERSION, null)
                ?.takeIf(VERSION_PATTERN::matches)

        val serverUrl = preferences.getString(KEY_SERVER_URL, null)
        if (serverUrl.isNullOrBlank()) showSetup() else showDashboard(serverUrl)
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
        exitingToAndroid = false
        leaveLegacyKioskMode()
        hideSystemBars()
        if (shouldRunPresenceService()) {
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
            if (enabled) requestCameraAndStart()
            if (webView == null) showSetup()
        }
        pendingUpdateVersion?.let { version ->
            if (packageManager.canRequestPackageInstalls()) {
                val cachedApk = updateDestination(version)
                if (cachedApk.isFile) {
                    clearPendingUpdate()
                    launchUpdateInstaller(cachedApk)
                } else {
                    prepareAndroidUpdate(version)
                }
            }
        }
    }

    override fun onPause() {
        activityResumed = false
        super.onPause()
    }

    override fun onStop() {
        super.onStop()
        if (!isMotionWakeEnabled()) {
            stopService(Intent(this, PresenceService::class.java))
        }
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
        startMonitoringIfAuthorized()
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
                requestCameraAndStart()
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
            requestNotificationPermissionIfNeeded()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startMonitoringIfAuthorized() {
        if (shouldRunPresenceService()) startPresenceService()
    }

    private fun shouldRunPresenceService(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED &&
            (isMotionWakeEnabled() || isAutoScreenOffEnabled())

    private fun requestNotificationPermissionIfNeeded() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun startPresenceService() {
        // Android's while-in-use camera permission requires a visible activity
        // when the foreground service is first started. onResume retries for us.
        if (!activityResumed || !shouldRunPresenceService()) return
        try {
            ContextCompat.startForegroundService(this, Intent(this, PresenceService::class.java))
        } catch (error: RuntimeException) {
            CameraDiagnostics.error = "Android refuse le démarrage caméra : rouvrez HomeDash et vérifiez les autorisations"
            android.util.Log.w("HomeDashCamera", CameraDiagnostics.error, error)
            dispatchMotionWakeStatusChanged()
        }
    }

    private fun isDeviceAdminActive(): Boolean =
        getSystemService(DevicePolicyManager::class.java).isAdminActive(
            ComponentName(this, KioskDeviceAdminReceiver::class.java),
        )

    private fun isAutoScreenOffEnabled(): Boolean =
        preferences.getBoolean(KEY_AUTO_SCREEN_OFF, false) && isDeviceAdminActive()

    private fun isMotionWakeEnabled(): Boolean =
        preferences.getBoolean(KEY_MOTION_WAKE_ENABLED, false) && hasFrontCamera()

    private fun hasFrontCamera(): Boolean =
        packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT)

    private fun setMotionWakeEnabled(enabled: Boolean) {
        if (enabled && !hasFrontCamera()) {
            preferences.edit().putBoolean(KEY_MOTION_WAKE_ENABLED, false).apply()
            Toast.makeText(this, "Aucune caméra frontale disponible", Toast.LENGTH_LONG).show()
            dispatchMotionWakeStatusChanged()
            return
        }

        preferences.edit().putBoolean(KEY_MOTION_WAKE_ENABLED, enabled).apply()
        if (enabled) {
            requestCameraAndStart()
        } else if (isAutoScreenOffEnabled()) {
            startMonitoringIfAuthorized()
        } else {
            stopService(Intent(this, PresenceService::class.java))
        }
        dispatchMotionWakeStatusChanged()
    }

    private fun motionWakeStatus(): String {
        val power = getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("supported", hasFrontCamera())
            .put("enabled", isMotionWakeEnabled())
            .put(
                "cameraGranted",
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED,
            ).put(
                "notificationGranted",
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED,
            ).put("batteryOptimizationsIgnored", power.isIgnoringBatteryOptimizations(packageName))
            .put("serviceRunning", CameraDiagnostics.serviceRunning)
            .put("receivingFrames", CameraDiagnostics.receivingFrames(SystemClock.elapsedRealtime()))
            .put("cameraError", CameraDiagnostics.error ?: JSONObject.NULL)
            .put("lastFrameAgeSeconds", if (CameraDiagnostics.lastFrameAt > 0L) {
                (SystemClock.elapsedRealtime() - CameraDiagnostics.lastFrameAt) / 1_000
            } else JSONObject.NULL)
            .put("lastMotionAgeSeconds", if (CameraDiagnostics.lastMotionAt > 0L) {
                (SystemClock.elapsedRealtime() - CameraDiagnostics.lastMotionAt) / 1_000
            } else JSONObject.NULL)
            .toString()
    }

    private fun dispatchMotionWakeStatusChanged() {
        webView?.post {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new Event('homedash:motion-wake-status'))",
                null,
            )
        }
    }

    private fun openBatteryOptimizationSettings() {
        val directRequest =
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:$packageName"))
        runCatching { startActivity(directRequest) }
            .onFailure {
                runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
            }
    }

    private fun openAppPermissionSettings() {
        startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:$packageName")),
        )
    }

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
        prepareAndroidUpdate(version)
    }

    private fun prepareAndroidUpdate(version: String) {
        if (androidUpdateRunning) return
        androidUpdateRunning = true
        setPendingUpdate(version)
        dispatchAndroidUpdateStatus("downloading")
        Toast.makeText(this, "Téléchargement de HomeDash $version…", Toast.LENGTH_LONG).show()
        lifecycleScope.launch {
            try {
                val apk = downloadUpdateWithRetry(version)
                if (packageManager.canRequestPackageInstalls()) {
                    clearPendingUpdate()
                    launchUpdateInstaller(apk)
                } else {
                    dispatchAndroidUpdateStatus(
                        "permission-required",
                        "APK vérifiée. Autorisez HomeDash à installer cette source, puis revenez à l’application.",
                    )
                    Toast.makeText(
                        this@MainActivity,
                        "APK vérifiée — autorisez maintenant HomeDash à l’installer.",
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
                        clearPendingUpdate()
                        throw IllegalStateException("Réglage Android indisponible", it)
                    }
                }
            } catch (error: Exception) {
                clearPendingUpdate()
                val message =
                    error.message
                        ?: "Mise à jour impossible. Vérifiez la connexion Wi-Fi puis réessayez."
                dispatchAndroidUpdateStatus("failed", message)
                Toast.makeText(
                    this@MainActivity,
                    message,
                    Toast.LENGTH_LONG,
                ).show()
            } finally {
                androidUpdateRunning = false
            }
        }
    }

    private fun launchUpdateInstaller(apk: File) {
        val uri =
            FileProvider.getUriForFile(
                this,
                "$packageName.updates",
                apk,
            )
        val intent =
            Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
                .putExtra(Intent.EXTRA_RETURN_RESULT, false)
        dispatchAndroidUpdateStatus(
            "installer-opened",
            "APK vérifiée. Confirmez maintenant la mise à jour dans l’écran Android.",
        )
        startActivity(intent)
    }

    private suspend fun downloadUpdateWithRetry(version: String): File {
        var lastNetworkError: IOException? = null
        repeat(UPDATE_DOWNLOAD_ATTEMPTS) { attempt ->
            try {
                return withContext(Dispatchers.IO) { downloadUpdate(version) }
            } catch (error: IOException) {
                lastNetworkError = error
                if (attempt + 1 < UPDATE_DOWNLOAD_ATTEMPTS) {
                    delay(UPDATE_RETRY_DELAYS_MS[attempt])
                }
            }
        }
        throw IllegalStateException(
            "Connexion au Raspberry Pi impossible après $UPDATE_DOWNLOAD_ATTEMPTS tentatives. " +
                "Vérifiez le Wi-Fi et l’adresse du serveur, puis réessayez.",
            lastNetworkError,
        )
    }

    private fun downloadUpdate(version: String): File {
        val serverUrl = activeServerOrigin()
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

            val directory = updateDirectory().apply { mkdirs() }
            directory.listFiles()?.forEach { if (it.isFile) it.delete() }
            val temporary = File(directory, ".homedash-kiosk-$version.apk.tmp")
            val destination = updateDestination(version)
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

    private fun activeServerOrigin(): String {
        val candidates =
            listOfNotNull(
                webView?.url,
                preferences.getString(KEY_SERVER_URL, null),
            )
        for (candidate in candidates) {
            runCatching {
                val url = URL(candidate)
                require(url.protocol == "https" || BuildConfig.DEBUG && url.protocol == "http")
                return URI(url.protocol, null, url.host, url.port, null, null, null).toString()
            }
        }
        error("Serveur non configuré")
    }

    private fun updateDirectory(): File = File(cacheDir, "updates")

    private fun updateDestination(version: String): File =
        File(updateDirectory(), "homedash-kiosk-$version.apk")

    private fun setPendingUpdate(version: String) {
        pendingUpdateVersion = version
        preferences.edit().putString(KEY_PENDING_UPDATE_VERSION, version).apply()
    }

    private fun clearPendingUpdate() {
        pendingUpdateVersion = null
        preferences.edit().remove(KEY_PENDING_UPDATE_VERSION).apply()
    }

    private fun dispatchAndroidUpdateStatus(
        state: String,
        message: String? = null,
    ) {
        val detail = JSONObject().put("state", state)
        if (message != null) detail.put("message", message)
        webView?.post {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('homedash:android-update-status', { detail: $detail }))",
                null,
            )
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
        fun getMotionWakeStatus(): String = motionWakeStatus()

        @JavascriptInterface
        fun setMotionWakeEnabled(enabled: Boolean) {
            runOnUiThread { this@MainActivity.setMotionWakeEnabled(enabled) }
        }

        @JavascriptInterface
        fun requestMotionWakePermission() {
            runOnUiThread { requestCameraAndStart() }
        }

        @JavascriptInterface
        fun openBatteryOptimizationSettings() {
            runOnUiThread { this@MainActivity.openBatteryOptimizationSettings() }
        }

        @JavascriptInterface
        fun openAppPermissionSettings() {
            runOnUiThread { this@MainActivity.openAppPermissionSettings() }
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
        private const val KEY_MOTION_WAKE_ENABLED = "motionWakeEnabled"
        private const val KEY_DEVICE_ID = "deviceId"
        private const val KEY_DEVICE_TOKEN = "deviceToken"
        private const val KEY_PENDING_UPDATE_VERSION = "pendingUpdateVersion"
        private const val ORIENTATION_LANDSCAPE = "landscape"
        private const val ORIENTATION_PORTRAIT = "portrait"
        private const val ANDROID_BRIDGE_NAME = "HomeDashAndroid"
        private const val MAX_APK_BYTES = 100L * 1024L * 1024L
        private const val UPDATE_DOWNLOAD_ATTEMPTS = 3
        private val UPDATE_RETRY_DELAYS_MS = longArrayOf(1_000L, 3_000L)
        private val VERSION_PATTERN = Regex("^\\d+\\.\\d+\\.\\d+$")
        private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
    }
}
