package io.github.nimbleflux.wayli.session

import android.util.Log
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.demo.DemoManager
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.delay

/**
 * Keeps the user signed in by refreshing the access token BEFORE it expires.
 *
 * Belt-and-braces alongside the SDK's own `autoRefresh` scheduler (enabled in
 * [io.github.nimbleflux.wayli.di.FluxbaseModule]): both funnel into the SDK's
 * single-flight `refreshSession` mutex, so they can never issue concurrent
 * refresh calls. This loop doubles as the authoritative periodic dead-session
 * re-check: a refresh error is classified by the same rules as
 * [SessionArbiter] — only a definitive rejection by the refresh endpoint
 * (HTTP 401 / "invalid or expired refresh token") signs the user out;
 * transport-level failures (no status) are retried on the next tick.
 *
 * The loop retries on a short backoff after failures (15s doubling to the
 * normal 5-min cadence) so a cold start into a not-yet-ready network
 * recovers in seconds instead of minutes. A 429 from the server's refresh
 * rate limiter arms the shared [RefreshGate] and is waited out.
 */
@Singleton
class SessionRefresher @Inject constructor(
    private val client: FluxbaseClient,
    private val demoManager: DemoManager,
    private val arbiter: SessionArbiter,
    private val refreshGate: RefreshGate,
) {
    private var refreshInFlight = false

    /**
     * Refresh when the access token expires within [REFRESH_AHEAD_MS] (or has
     * no known expiry). Returns true when no refresh was needed, it wasn't
     * attempted (cooldown), or it succeeded. A confirmed-dead refresh token
     * fires [SessionExpiryBus]; transient failures are retried on the next
     * (shortened) tick.
     */
    suspend fun refreshIfDue(nowMs: Long = System.currentTimeMillis()): Boolean {
        if (demoManager.isDemoMode || refreshInFlight) return true
        if (refreshGate.isCoolingDown(nowMs)) return false
        val session = client.auth.currentSession ?: return true
        val expiresAt = session.expiresAt
        if (expiresAt != null && expiresAt - nowMs > REFRESH_AHEAD_MS) return true

        refreshInFlight = true
        try {
            // refreshSession() RETURNS errors (it never throws), so inspect
            // the response — the previous runCatching/exceptionOrNull() here
            // could never observe a failure.
            val result = client.auth.refreshSession()
            val error = result.error
            if (error == null) return true
            if (io.github.nimbleflux.wayli.session.isRateLimitedError(error)) {
                refreshGate.onRateLimited()
                Log.w(TAG, "refresh rate-limited — cooldown ${refreshGate.remainingMs() / 1000}s")
                return false
            }
            when (SessionArbiter.classify(error)) {
                // Rejected once — delegate to the arbiter's double-confirm
                // (the server maps ALL refresh failures to 401, including
                // transient ones) before anything destroys the session.
                SessionArbiter.Verdict.DEAD -> {
                    Log.w(TAG, "periodic refresh rejected (dead session?): ${error.message?.take(120)} — confirming")
                    return arbiter.adjudicate("periodic-confirm") == SessionArbiter.Verdict.RECOVERED
                }
                SessionArbiter.Verdict.TRANSIENT -> {
                    Log.i(TAG, "periodic refresh failed transiently: ${error.message?.take(120)} — retrying")
                    return false
                }
                SessionArbiter.Verdict.RECOVERED -> return true
            }
        } finally {
            refreshInFlight = false
        }
    }

    /**
     * Periodic check while the app is alive; launched from
     * [io.github.nimbleflux.wayli.nav.WayliNavHost]. Healthy cadence is
     * [CHECK_INTERVAL_MS]; after a failed/skipped refresh the tick backs off
     * exponentially ([FIRST_RETRY_MS] doubling) so recovery from a
     * just-unfrozen, not-yet-connected state happens in seconds.
     */
    suspend fun runLoop() {
        var failureStreak = 0
        while (true) {
            val ok = runCatching { refreshIfDue() }.getOrDefault(true)
            failureStreak = if (ok) 0 else failureStreak + 1
            delay(if (ok) CHECK_INTERVAL_MS else backoffMs(failureStreak))
        }
    }

    private fun backoffMs(failureStreak: Int): Long =
        (FIRST_RETRY_MS shl (failureStreak - 1).coerceAtMost(5)).coerceAtMost(CHECK_INTERVAL_MS)

    private companion object {
        const val TAG = "WayliSession"
        /** Refresh this far before actual expiry (access tokens live ~1h). */
        const val REFRESH_AHEAD_MS = 5 * 60 * 1000L
        const val CHECK_INTERVAL_MS = 5 * 60 * 1000L
        const val FIRST_RETRY_MS = 15 * 1000L
    }
}
