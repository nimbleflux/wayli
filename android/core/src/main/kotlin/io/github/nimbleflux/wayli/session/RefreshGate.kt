package io.github.nimbleflux.wayli.session

import java.util.concurrent.atomic.AtomicLong

/**
 * App-wide cooldown after an HTTP 429 from the refresh endpoint.
 *
 * The server rate-limits /auth/refresh per refresh-token with a small
 * window (5-10 requests/min). Once limited, every further attempt deepens
 * the hole — and the 429 masks the real 401 that would otherwise cleanly
 * sign a dead session out, leaving the app a zombie: stale content, never
 * signed out. During cooldown, refresh attempts are skipped entirely so
 * requests fail through with their normal errors and the limiter bucket
 * can drain.
 *
 * Provided as a singleton via FluxbaseModule (core has no DI runtime).
 */
class RefreshGate {
    private val cooldownUntilMs = AtomicLong(0)

    /** Enter cooldown after a 429; [retryAfterSec] honors Retry-After when present. */
    fun onRateLimited(retryAfterSec: Long? = null, nowMs: Long = System.currentTimeMillis()) {
        val seconds = (retryAfterSec ?: DEFAULT_COOLDOWN_SEC).coerceIn(1, MAX_COOLDOWN_SEC)
        cooldownUntilMs.set(nowMs + seconds * 1000)
    }

    fun isCoolingDown(nowMs: Long = System.currentTimeMillis()): Boolean =
        nowMs < cooldownUntilMs.get()

    fun remainingMs(nowMs: Long = System.currentTimeMillis()): Long =
        (cooldownUntilMs.get() - nowMs).coerceAtLeast(0)

    fun reset() {
        cooldownUntilMs.set(0)
    }

    companion object {
        /** The server's auth_refresh limiter window (and its Retry-After value). */
        const val DEFAULT_COOLDOWN_SEC = 60L
        const val MAX_COOLDOWN_SEC = 300L
    }
}
