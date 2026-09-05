package io.github.nimbleflux.wayli.session

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The gate turns a 429 from the refresh endpoint into a short, app-wide
 * cooldown so the client stops feeding the server's per-token limiter.
 */
class RefreshGateTest {

    @Test
    fun `not cooling down by default and after reset`() {
        val gate = RefreshGate()
        assertFalse(gate.isCoolingDown())
        gate.onRateLimited()
        assertTrue(gate.isCoolingDown())
        gate.reset()
        assertFalse(gate.isCoolingDown())
    }

    @Test
    fun `cooldown expires and clamps retry-after`() {
        val gate = RefreshGate()
        val t0 = 1_000_000L

        gate.onRateLimited(retryAfterSec = 2, nowMs = t0)
        assertTrue(gate.isCoolingDown(t0 + 1000))
        assertFalse(gate.isCoolingDown(t0 + 3000))

        // A Retry-After larger than the cap is clamped (server bug guard).
        gate.onRateLimited(retryAfterSec = 10_000, nowMs = t0)
        val remaining = gate.remainingMs(t0 + 1)
        assertEquals(RefreshGate.MAX_COOLDOWN_SEC * 1000 - 1, remaining)
    }

    @Test
    fun `default cooldown matches the server limiter window`() {
        val gate = RefreshGate()
        val t0 = 1_000_000L
        gate.onRateLimited(nowMs = t0)
        assertEquals(RefreshGate.DEFAULT_COOLDOWN_SEC * 1000, gate.remainingMs(t0))
    }
}
