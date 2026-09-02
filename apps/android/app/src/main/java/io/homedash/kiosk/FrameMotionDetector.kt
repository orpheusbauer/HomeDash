package io.homedash.kiosk

import kotlin.math.abs
import kotlin.math.ceil

/**
 * Detects local movement from a tiny grayscale frame. A uniform brightness change is removed
 * before comparison so that camera exposure adjustments do not wake the screen by themselves.
 */
internal class FrameMotionDetector(
    private val changedPixelThreshold: Int = 18,
    private val changedPixelRatio: Double = 0.08,
    private val averageDifferenceThreshold: Double = 5.0,
) {
    private var previousFrame: ByteArray? = null

    fun reset() {
        previousFrame = null
    }

    fun hasMotion(frame: ByteArray): Boolean {
        val previous = previousFrame
        previousFrame = frame.copyOf()
        if (previous == null || previous.size != frame.size || frame.isEmpty()) return false

        var signedDifferenceSum = 0L
        for (index in frame.indices) {
            signedDifferenceSum += unsigned(frame[index]) - unsigned(previous[index])
        }
        val exposureShift = signedDifferenceSum.toDouble() / frame.size

        var changedPixels = 0
        var correctedDifferenceSum = 0.0
        for (index in frame.indices) {
            val difference =
                abs((unsigned(frame[index]) - unsigned(previous[index])) - exposureShift)
            correctedDifferenceSum += difference
            if (difference >= changedPixelThreshold) changedPixels += 1
        }

        val requiredChangedPixels = ceil(frame.size * changedPixelRatio).toInt()
        val averageDifference = correctedDifferenceSum / frame.size
        return changedPixels >= requiredChangedPixels &&
            averageDifference >= averageDifferenceThreshold
    }

    private fun unsigned(value: Byte): Int = value.toInt() and 0xff
}
