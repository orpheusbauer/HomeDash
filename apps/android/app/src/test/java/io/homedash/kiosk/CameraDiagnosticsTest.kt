package io.homedash.kiosk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraDiagnosticsTest {
    @Test
    fun `permission or running service does not prove frames arrive`() {
        CameraDiagnostics.serviceRunning = true
        CameraDiagnostics.lastFrameAt = 0L
        assertFalse(CameraDiagnostics.receivingFrames(20_000L))
    }

    @Test
    fun `stalled camera is detected even when service is running`() {
        CameraDiagnostics.serviceRunning = true
        CameraDiagnostics.lastFrameAt = 1_000L
        assertTrue(CameraDiagnostics.receivingFrames(2_000L))
        assertFalse(CameraDiagnostics.receivingFrames(16_000L))
        CameraDiagnostics.serviceRunning = false
        assertFalse(CameraDiagnostics.receivingFrames(2_000L))
    }
}
