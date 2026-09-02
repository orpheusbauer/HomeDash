package io.homedash.kiosk

/** In-memory diagnostics only; never stores camera frames or writes them to disk. */
internal object CameraDiagnostics {
    @Volatile var serviceRunning = false
    @Volatile var lastFrameAt = 0L
    @Volatile var lastMotionAt = 0L
    @Volatile var error: String? = null

    fun receivingFrames(now: Long): Boolean =
        serviceRunning && lastFrameAt > 0L && now - lastFrameAt < 15_000L
}
