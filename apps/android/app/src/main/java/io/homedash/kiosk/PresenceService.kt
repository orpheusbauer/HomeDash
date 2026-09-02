package io.homedash.kiosk

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
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
    // A stalled Pi/Wi-Fi request must never occupy the CameraX analysis thread.
    private val telemetryExecutor = Executors.newSingleThreadExecutor()
    private val analyzing = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private val motionDetector = FrameMotionDetector()
    private val detector =
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .build(),
        )
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraStarting = false
    private var cameraGeneration = 0
    private var destroyed = false
    private var foregroundReady = false
    private var nextCameraRetryAt = 0L
    private var retryDelayMs = 5_000L
    private var monitoringWakeLock: PowerManager.WakeLock? = null
    private var screenWakeLock: PowerManager.WakeLock? = null
    @Volatile private var lastPresenceAt = SystemClock.elapsedRealtime()
    @Volatile private var lastFaceAnalysisAt = 0L
    private var lastAnalysisAt = 0L
    private var lastTelemetryAt = 0L
    private var screenOffAt = 0L
    private var lastWakeAt = 0L
    private var lastScreenInteractive = true
    @Volatile private var present = false
    @Volatile private var lockedForAbsence = false
    private val maintenanceTask =
        object : Runnable {
            override fun run() {
                val now = SystemClock.elapsedRealtime()
                if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
                    lastTelemetryAt = now
                    sendTelemetry()
                }
                lockIfAbsent()
                syncMonitoringWakeLock()
                if (!CameraDiagnostics.receivingFrames(now) && now >= nextCameraRetryAt) {
                    if (!cameraStarting) {
                        CameraDiagnostics.error = "Aucune image reçue : reprise de la caméra en cours"
                        startCamera()
                    }
                } else if (CameraDiagnostics.receivingFrames(now)) {
                    retryDelayMs = 5_000L
                }
                getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
                handler.postDelayed(this, SCREEN_CHECK_INTERVAL_MS)
            }
        }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        CameraDiagnostics.lastFrameAt = 0L
        CameraDiagnostics.lastMotionAt = 0L
        CameraDiagnostics.error = null
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA,
            )
            foregroundReady = true
            CameraDiagnostics.serviceRunning = true
        } catch (error: RuntimeException) {
            reportCameraError("Android refuse le service caméra : rouvrez HomeDash et vérifiez les autorisations", error)
            stopSelf()
            return
        }
        lastScreenInteractive = getSystemService(PowerManager::class.java).isInteractive
        if (!lastScreenInteractive) screenOffAt = SystemClock.elapsedRealtime()
        syncMonitoringWakeLock()
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        super.onStartCommand(intent, flags, startId)
        if (!foregroundReady) return Service.START_NOT_STICKY
        syncMonitoringWakeLock()
        if (!cameraStarting && !CameraDiagnostics.receivingFrames(SystemClock.elapsedRealtime())) startCamera()
        handler.removeCallbacks(maintenanceTask)
        handler.postDelayed(maintenanceTask, SCREEN_CHECK_INTERVAL_MS)
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
        return if (isMotionWakeEnabled()) Service.START_STICKY else Service.START_NOT_STICKY
    }

    private fun startCamera() {
        if (destroyed || cameraStarting) return
        if (
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            reportCameraError("Permission caméra manquante : autorisez HomeDash dans Android")
            stopSelf()
            return
        }
        cameraStarting = true
        val generation = ++cameraGeneration
        nextCameraRetryAt = SystemClock.elapsedRealtime() + CAMERA_STALL_TIMEOUT_MS
        val future = try {
            ProcessCameraProvider.getInstance(this)
        } catch (error: Exception) {
            cameraStarting = false
            reportCameraError("Impossible d’initialiser la caméra", error)
            return
        }
        handler.postDelayed({
            if (!destroyed && cameraStarting && generation == cameraGeneration) {
                cameraGeneration += 1
                cameraStarting = false
                reportCameraError("Initialisation caméra trop longue : nouvelle tentative automatique")
            }
        }, CAMERA_STALL_TIMEOUT_MS)
        future.addListener(
            {
                if (destroyed || generation != cameraGeneration) return@addListener
                try {
                    val provider = future.get()
                    cameraProvider = provider
                    val analysis =
                        ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .setTargetResolution(android.util.Size(320, 240))
                            .build()
                    analysis.setAnalyzer(executor) { image -> analyze(image) }
                    provider.unbindAll()
                    if (!provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                        throw IllegalStateException("Aucune caméra frontale disponible")
                    }
                    provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
                } catch (error: Exception) {
                    reportCameraError("Caméra indisponible : vérifiez le bouton Android Accès caméra et les autres applications", error)
                    nextCameraRetryAt = SystemClock.elapsedRealtime() + retryDelayMs
                    retryDelayMs = (retryDelayMs * 2).coerceAtMost(60_000L)
                } finally {
                    cameraStarting = false
                }
            },
            ContextCompat.getMainExecutor(this),
        )
    }

    private fun analyze(image: ImageProxy) {
        val now = SystemClock.elapsedRealtime()
        CameraDiagnostics.lastFrameAt = now
        CameraDiagnostics.error = null
        if (now - lastAnalysisAt < ANALYSIS_INTERVAL_MS) {
            image.close()
            return
        }
        lastAnalysisAt = now

        try {
            sampleLuma(image)?.let { handleMotionFrame(it, now) }
        } catch (error: Exception) {
            image.close()
            reportCameraError("Erreur d’analyse du mouvement", error)
            return
        }
        if (!getSystemService(PowerManager::class.java).isInteractive) {
            image.close()
            return
        }

        if (!analyzing.compareAndSet(false, true)) {
            image.close()
            return
        }

        // ML Kit owns a small copy, never a CameraX buffer: slow face detection
        // cannot hold ImageProxy open and starve motion detection or sleep/wake.
        try {
            val input = try {
                InputImage.fromByteArray(
                    copyNv21(image), image.width, image.height,
                    image.imageInfo.rotationDegrees, InputImage.IMAGE_FORMAT_NV21,
                )
            } finally {
                image.close()
            }
            detector.process(input)
                .addOnSuccessListener { faces ->
                    lastFaceAnalysisAt = SystemClock.elapsedRealtime()
                    present = faces.isNotEmpty()
                    if (present) {
                        lastPresenceAt = SystemClock.elapsedRealtime()
                        lockedForAbsence = false
                    }
                }.addOnFailureListener { error -> reportCameraError("Détection de visage indisponible", error) }
                .addOnCompleteListener {
                    analyzing.set(false)
                }
        } catch (error: Exception) {
            analyzing.set(false)
            reportCameraError("Impossible d’analyser l’image caméra", error)
        }
    }

    private fun copyNv21(image: ImageProxy): ByteArray {
        val width = image.width
        val height = image.height
        require(image.planes.size == 3 && width % 2 == 0 && height % 2 == 0)
        val bytes = ByteArray(width * height * 3 / 2)
        for (planeIndex in 0..2) {
            val plane = image.planes[planeIndex]
            val buffer = plane.buffer.duplicate()
            val offset = buffer.position()
            val planeWidth = if (planeIndex == 0) width else width / 2
            val planeHeight = if (planeIndex == 0) height else height / 2
            for (row in 0 until planeHeight) {
                for (column in 0 until planeWidth) {
                    val destination =
                        if (planeIndex == 0) row * width + column else
                            width * height + row * width + column * 2 + if (planeIndex == 1) 1 else 0
                    bytes[destination] = buffer.get(offset + row * plane.rowStride + column * plane.pixelStride)
                }
            }
        }
        return bytes
    }

    private fun sampleLuma(image: ImageProxy): ByteArray? {
        val plane = image.planes.firstOrNull() ?: return null
        if (image.width <= 0 || image.height <= 0) return null
        val buffer = plane.buffer.duplicate()
        val samples = ByteArray(MOTION_SAMPLE_COLUMNS * MOTION_SAMPLE_ROWS)
        var sampleIndex = 0
        for (row in 0 until MOTION_SAMPLE_ROWS) {
            val y = ((row + 0.5) * image.height / MOTION_SAMPLE_ROWS).toInt().coerceAtMost(image.height - 1)
            for (column in 0 until MOTION_SAMPLE_COLUMNS) {
                val x =
                    ((column + 0.5) * image.width / MOTION_SAMPLE_COLUMNS)
                        .toInt()
                        .coerceAtMost(image.width - 1)
                val bufferIndex = buffer.position() + y * plane.rowStride + x * plane.pixelStride
                if (bufferIndex >= buffer.limit()) return null
                samples[sampleIndex++] = buffer.get(bufferIndex)
            }
        }
        return samples
    }

    private fun handleMotionFrame(
        frame: ByteArray,
        now: Long,
    ) {
        val interactive = getSystemService(PowerManager::class.java).isInteractive
        if (interactive != lastScreenInteractive) {
            lastScreenInteractive = interactive
            motionDetector.reset()
            if (interactive) {
                screenOffAt = 0L
            } else {
                screenOffAt = now
                present = false
            }
        }

        val movementDetected = motionDetector.hasMotion(frame)
        if (movementDetected) CameraDiagnostics.lastMotionAt = now
        if (
            !interactive &&
                isMotionWakeEnabled() &&
                screenOffAt > 0L &&
                now - screenOffAt >= MOTION_ARMING_DELAY_MS &&
                now - lastWakeAt >= MOTION_WAKE_COOLDOWN_MS &&
                movementDetected
        ) {
            lastWakeAt = now
            lastPresenceAt = now
            lockedForAbsence = false
            wakeScreen()
        }
    }

    @Suppress("DEPRECATION")
    private fun wakeScreen() {
        val power = getSystemService(PowerManager::class.java)
        screenWakeLock?.let { if (it.isHeld) it.release() }
        screenWakeLock =
            power
                .newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                        PowerManager.ACQUIRE_CAUSES_WAKEUP or
                        PowerManager.ON_AFTER_RELEASE,
                    "$packageName:motion-wake",
                ).apply {
                    setReferenceCounted(false)
                    acquire(SCREEN_WAKE_DURATION_MS)
                }
    }

    private fun syncMonitoringWakeLock() {
        if (isMotionWakeEnabled()) {
            if (monitoringWakeLock?.isHeld == true) return
            monitoringWakeLock =
                getSystemService(PowerManager::class.java)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:motion-monitoring")
                    .apply {
                        setReferenceCounted(false)
                        acquire()
                    }
        } else {
            monitoringWakeLock?.let { if (it.isHeld) it.release() }
            monitoringWakeLock = null
        }
    }

    private fun isMotionWakeEnabled(): Boolean =
        getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_MOTION_WAKE_ENABLED, false)

    private fun lockIfAbsent() {
        // Camera failure is not evidence of absence.
        if (!CameraDiagnostics.receivingFrames(SystemClock.elapsedRealtime()) || CameraDiagnostics.error != null) return
        if (lastFaceAnalysisAt == 0L || SystemClock.elapsedRealtime() - lastFaceAnalysisAt >= 15_000L) return
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
        val preferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val serverUrl = preferences.getString("serverUrl", null) ?: return
        val deviceId = preferences.getString("deviceId", null) ?: return
        val token = preferences.getString("deviceToken", null) ?: return
        val battery = getSystemService(BatteryManager::class.java)
        val payload =
            JSONObject()
                .put("batteryPercent", battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                .put("charging", battery.isCharging)
                .put("screenOn", getSystemService(PowerManager::class.java).isInteractive)
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("presenceState", when {
                    !CameraDiagnostics.receivingFrames(SystemClock.elapsedRealtime()) -> "unknown"
                    present -> "present"
                    else -> "absent"
                })
        telemetryExecutor.execute {
            var connection: HttpURLConnection? = null
            try {
                connection =
                    URL("$serverUrl/api/v1/devices/$deviceId/telemetry").openConnection() as
                        HttpURLConnection
                connection.connectTimeout = 5_000
                connection.readTimeout = 5_000
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.doOutput = true
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
                connection.responseCode
            } catch (_: Exception) {
                // Réseau indisponible : la prochaine télémétrie réessaiera.
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun buildNotification(): Notification {
        val launch =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val message =
            if (!CameraDiagnostics.receivingFrames(SystemClock.elapsedRealtime())) {
                CameraDiagnostics.error ?: "Démarrage de la caméra…"
            } else if (isMotionWakeEnabled()) {
                "Caméra active · réveil de l’écran par mouvement"
            } else {
                "Détection de présence locale"
            }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("HomeDash actif")
            .setContentText(message)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(launch)
            .build()
    }

    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Caméra et présence HomeDash",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
    }

    override fun onDestroy() {
        destroyed = true
        cameraGeneration += 1
        CameraDiagnostics.serviceRunning = false
        handler.removeCallbacksAndMessages(null)
        cameraProvider?.unbindAll()
        detector.close()
        monitoringWakeLock?.let { if (it.isHeld) it.release() }
        screenWakeLock?.let { if (it.isHeld) it.release() }
        executor.shutdownNow()
        telemetryExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun reportCameraError(message: String, error: Exception? = null) {
        present = false
        CameraDiagnostics.error = message
        Log.w("HomeDashCamera", message, error)
    }

    override fun onBind(intent: Intent): IBinder? = super.onBind(intent)

    companion object {
        private const val CHANNEL_ID = "homedash-presence"
        private const val NOTIFICATION_ID = 4100
        private const val PREFERENCES_NAME = "homedash"
        private const val KEY_AUTO_SCREEN_OFF = "autoScreenOff"
        private const val KEY_MOTION_WAKE_ENABLED = "motionWakeEnabled"
        private const val MOTION_SAMPLE_COLUMNS = 32
        private const val MOTION_SAMPLE_ROWS = 24
        private const val ANALYSIS_INTERVAL_MS = 500L
        private const val MOTION_ARMING_DELAY_MS = 2_000L
        private const val MOTION_WAKE_COOLDOWN_MS = 15_000L
        private const val SCREEN_WAKE_DURATION_MS = 5_000L
        private const val SCREEN_CHECK_INTERVAL_MS = 10_000L
        private const val CAMERA_STALL_TIMEOUT_MS = 30_000L
        private const val TELEMETRY_INTERVAL_MS = 60_000L
        private const val ABSENCE_TIMEOUT_MS = 90_000L
    }
}
