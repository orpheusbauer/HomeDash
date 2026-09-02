package io.homedash.kiosk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameMotionDetectorTest {
    private val detector = FrameMotionDetector()

    @Test
    fun `first and identical frames do not report movement`() {
        val frame = ByteArray(100) { 80 }

        assertFalse(detector.hasMotion(frame))
        assertFalse(detector.hasMotion(frame))
    }

    @Test
    fun `uniform exposure change is ignored`() {
        assertFalse(detector.hasMotion(ByteArray(100) { 60 }))
        assertFalse(detector.hasMotion(ByteArray(100) { 105 }))
    }

    @Test
    fun `movement across a meaningful part of the image is detected`() {
        assertFalse(detector.hasMotion(ByteArray(100) { 70 }))
        val moved = ByteArray(100) { index -> if (index < 20) 145.toByte() else 70.toByte() }

        assertTrue(detector.hasMotion(moved))
    }

    @Test
    fun `isolated sensor noise does not report movement`() {
        assertFalse(detector.hasMotion(ByteArray(100) { 70 }))
        val noisy = ByteArray(100) { index -> if (index < 3) 145.toByte() else 70.toByte() }

        assertFalse(detector.hasMotion(noisy))
    }
}
