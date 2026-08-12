package io.homedash.kiosk

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences("homedash", Context.MODE_PRIVATE) }
    private var webView: WebView? = null
    private var volumeDownCount = 0
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startPresenceService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        enterImmersiveMode()
        val serverUrl = preferences.getString("serverUrl", null)
        if (serverUrl.isNullOrBlank()) showSetup() else showDashboard(serverUrl)
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
        val manager = getSystemService(DevicePolicyManager::class.java)
        if (manager.isDeviceOwnerApp(packageName)) {
            manager.setLockTaskPackages(ComponentName(this, KioskDeviceAdminReceiver::class.java), arrayOf(packageName))
            if (!isInLockTaskMode()) startLockTask()
        }
    }

    private fun isInLockTaskMode() = getSystemService(android.app.ActivityManager::class.java).lockTaskModeState != android.app.ActivityManager.LOCK_TASK_MODE_NONE

    private fun enterImmersiveMode() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
            window.insetsController?.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    private fun showDashboard(serverUrl: String) {
        val view = WebView(this)
        webView = view
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.databaseEnabled = true
        view.settings.mediaPlaybackRequiresUserGesture = true
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = false
        view.settings.setSupportZoom(false)
        view.webChromeClient = WebChromeClient()
        view.webViewClient = object : WebViewClient() {
            override fun onReceivedError(v: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) Toast.makeText(this@MainActivity, "HomeDash hors ligne — reconnexion automatique", Toast.LENGTH_LONG).show()
            }
        }
        setContentView(view)
        view.loadUrl(serverUrl)
        requestCameraAndStart()
    }

    private fun showSetup() {
        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(padding, padding, padding, padding) }
        val title = TextView(this).apply { text = "Configurer HomeDash"; textSize = 26f; gravity = Gravity.CENTER }
        val url = EditText(this).apply { hint = "Adresse, ex. https://homedash.home.arpa"; setText(preferences.getString("serverUrl", "http://192.168.1.50")); isSingleLine = true }
        val code = EditText(this).apply { hint = "Code d’association à 6 chiffres"; inputType = 2; isSingleLine = true }
        val name = EditText(this).apply { hint = "Nom de la tablette"; setText("Tablette murale"); isSingleLine = true }
        val button = Button(this).apply { text = "Associer et ouvrir" }
        val help = TextView(this).apply { text = "Créez le code dans HomeDash > Paramètres > Tablettes. Appuyez cinq fois sur Volume bas pour revenir ici."; gravity = Gravity.CENTER }
        listOf(title, url, code, name, button, help).forEach { layout.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 8, 0, 8) }) }
        setContentView(layout)
        button.setOnClickListener {
            val normalized = url.text.toString().trim().trimEnd('/')
            if (normalized.isBlank()) return@setOnClickListener
            button.isEnabled = false
            lifecycleScope.launch {
                try {
                    if (code.text.isNotBlank()) pair(normalized, code.text.toString(), name.text.toString().ifBlank { "Tablette HomeDash" })
                    preferences.edit().putString("serverUrl", normalized).apply()
                    showDashboard(normalized)
                } catch (error: Exception) {
                    Toast.makeText(this@MainActivity, error.message ?: "Association impossible", Toast.LENGTH_LONG).show()
                    button.isEnabled = true
                }
            }
        }
    }

    private suspend fun pair(serverUrl: String, code: String, name: String) = withContext(Dispatchers.IO) {
        val connection = URL("$serverUrl/api/v1/devices/pair").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.setRequestProperty("Content-Type", "application/json"); connection.doOutput = true
        connection.outputStream.use { it.write(JSONObject().put("code", code).put("name", name).toString().toByteArray()) }
        if (connection.responseCode !in 200..299) throw IllegalStateException("Code refusé (${connection.responseCode})")
        val response = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        preferences.edit().putString("deviceId", response.getString("deviceId")).putString("deviceToken", response.getString("token")).apply()
        connection.disconnect()
    }

    private fun requestCameraAndStart() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startPresenceService()
        else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun startPresenceService() {
        ContextCompat.startForegroundService(this, Intent(this, PresenceService::class.java))
    }

    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            volumeDownCount += 1
            if (volumeDownCount >= 5) { volumeDownCount = 0; showSetup(); return true }
        } else volumeDownCount = 0
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() { webView?.destroy(); super.onDestroy() }
}
