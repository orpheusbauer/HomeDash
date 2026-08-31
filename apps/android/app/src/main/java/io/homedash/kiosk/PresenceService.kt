package io.homedash.kiosk

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class PresenceService : LifecycleService() {
    private val executor = Executors.newSingleThreadExecutor()
    private val analyzing = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private var lastPresenceAt = SystemClock.elapsedRealtime()
    private var lastAnalysisAt = 0L
    private var lastTelemetryAt = 0L
    private var present = false
    private var lockedForAbsence = false
    private val detector = FaceDetection.getClient(FaceDetectorOptions.Builder().setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST).build())
    private val maintenanceTask = object : Runnable {
        override fun run() {
            val now = SystemClock.elapsedRealtime()
            if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
                lastTelemetryAt = now
                sendTelemetry()
            }
            lockIfAbsent()
            handler.postDelayed(this, SCREEN_CHECK_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val launch = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("HomeDash actif")
            .setContentText("Détection de présence locale").setOngoing(true).setContentIntent(launch).build()
        startForeground(NOTIFICATION_ID, notification)
        startCamera()
        maintenanceTask.run()
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).setTargetResolution(android.util.Size(320, 240)).build()
                analysis.setAnalyzer(executor) { image -> analyze(image) }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            } catch (_: Exception) {
                present = false
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyze(image: ImageProxy) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastAnalysisAt < ANALYSIS_INTERVAL_MS) { image.close(); return }
        if (!analyzing.compareAndSet(false, true)) { image.close(); return }
        lastAnalysisAt = now
        val mediaImage = image.image
        if (mediaImage == null) { analyzing.set(false); image.close(); return }
        detector.process(InputImage.fromMediaImage(mediaImage, image.imageInfo.rotationDegrees))
            .addOnSuccessListener { faces ->
                present = faces.isNotEmpty()
                if (present) {
                    lastPresenceAt = SystemClock.elapsedRealtime()
                    lockedForAbsence = false
                    wakeScreen()
                }
            }
            .addOnFailureListener { present = false }
            .addOnCompleteListener { analyzing.set(false); image.close() }
    }

    @Suppress("DEPRECATION")
    private fun wakeScreen() {
        val power = getSystemService(PowerManager::class.java)
        if (!power.isInteractive) {
            power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "HomeDash:presence").apply { acquire(10_000) }
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
    }

    private fun lockIfAbsent() {
        val preferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        if (!preferences.getBoolean(KEY_AUTO_SCREEN_OFF, false)) return
        if (present || lockedForAbsence || SystemClock.elapsedRealtime() - lastPresenceAt < ABSENCE_TIMEOUT_MS) return
        val policy = getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(this, KioskDeviceAdminReceiver::class.java)
        if (policy.isAdminActive(admin)) {
            policy.lockNow()
            lockedForAbsence = true
        }
    }

    private fun sendTelemetry() {
        val preferences = getSharedPreferences("homedash", Context.MODE_PRIVATE)
        val serverUrl = preferences.getString("serverUrl", null) ?: return
        val deviceId = preferences.getString("deviceId", null) ?: return
        val token = preferences.getString("deviceToken", null) ?: return
        val battery = getSystemService(BatteryManager::class.java)
        val payload = JSONObject()
            .put("batteryPercent", battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            .put("charging", battery.isCharging)
            .put("screenOn", getSystemService(PowerManager::class.java).isInteractive)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("presenceState", if (present) "present" else "absent")
        executor.execute {
            try {
                val connection = URL("$serverUrl/api/v1/devices/$deviceId/telemetry").openConnection() as HttpURLConnection
                connection.requestMethod = "POST"; connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Authorization", "Bearer $token"); connection.doOutput = true
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
                connection.responseCode
                connection.disconnect()
            } catch (_: Exception) { /* Réseau indisponible : la prochaine télémétrie réessaiera. */ }
        }
    }

    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID, "Présence HomeDash", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onDestroy() {
        handler.removeCallbacks(maintenanceTask); detector.close(); executor.shutdownNow(); super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? = super.onBind(intent)

    companion object {
        private const val CHANNEL_ID = "homedash-presence"
        private const val NOTIFICATION_ID = 4100
        private const val PREFERENCES_NAME = "homedash"
        private const val KEY_AUTO_SCREEN_OFF = "autoScreenOff"
        private const val ANALYSIS_INTERVAL_MS = 750L
        private const val SCREEN_CHECK_INTERVAL_MS = 10_000L
        private const val TELEMETRY_INTERVAL_MS = 60_000L
        private const val ABSENCE_TIMEOUT_MS = 90_000L
    }
}
