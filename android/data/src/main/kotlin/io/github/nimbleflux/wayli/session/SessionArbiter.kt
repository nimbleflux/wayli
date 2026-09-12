package io.github.nimbleflux.wayli.session

import android.util.Log
import io.github.nimbleflux.fluxbase.FluxbaseClient
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The single authority for "is the session dead".
 *
 * A 401 surfacing from a data request does NOT prove the session is dead: the
 * SDK refreshes exactly once per request and, when that refresh fails for a
 * transient reason (Doze network reassociation, captive portal, 5xx, a
 * connection reset), it retries the request with the SAME stale token and the
 * 401 propagates. Wiping the persisted session on such a 401 logs the user
 * out even though the refresh token is perfectly valid — the SDK's retry loop
 * would have recovered within seconds.
 *
 * The only trustworthy death certificate is the refresh endpoint itself
 * rejecting the token (HTTP 401 / "invalid or expired refresh token"). The
 * SDK's [io.github.nimbleflux.fluxbase.FluxbaseError] carries `status == 401`
 * for a server rejection and `status == null` for transport-level failures,
 * so the two are distinguishable without an SDK change.
 */
@Singleton
class SessionArbiter @Inject constructor(
    private val client: FluxbaseClient,
    private val refreshGate: io.github.nimbleflux.wayli.session.RefreshGate,
) {

    private val mutex = Mutex()

    /** Outcome of adjudicating a suspected-dead session. */
    enum class Verdict {
        /** A refresh just succeeded — the session is alive; callers may retry. */
        RECOVERED,
        /** The refresh endpoint definitively rejected the token — sign out. */
        DEAD,
        /** The refresh attempt failed transiently — do NOT sign out. */
        TRANSIENT,
    }

    /**
     * Classifies an error from the refresh endpoint (or any auth-shaped
     * error): only a definitive server rejection (401 / the refresh
     * wording) counts as [Verdict.DEAD]; network-level failures carry no
     * status and are [Verdict.TRANSIENT]. Static so non-injected callers
     * (e.g. [SessionRefresher]) can reuse the same rules.
     */
    companion object {
        fun classify(error: Throwable?): Verdict =
            if (isSessionDeadError(error)) Verdict.DEAD else Verdict.TRANSIENT

        private const val TAG = "WayliSession"

        /** Re-check delay before a DEAD verdict destroys the session. */
        private const val CONFIRM_DELAY_MS = 2_000L
    }

    /**
     * Runs one explicit refresh and adjudicates the session. Single-flight:
     * concurrent callers serialize on a mutex (the SDK additionally dedupes
     * inside `refreshSession`), so a cold start's burst of failed requests
     * triggers exactly one verification refresh.
     *
     * Fires [SessionExpiryBus] on — and only on — a **double-confirmed**
     * [Verdict.DEAD]: the server's refresh handler maps *every* internal
     * error (including transient database hiccups) to HTTP 401, so one
     * rejection is not proof. A DEAD verdict is re-checked once after
     * [CONFIRM_DELAY_MS]; only a second rejection destroys the session. A
     * recovery during confirmation returns [Verdict.RECOVERED] untouched.
     */
    suspend fun adjudicate(site: String, cause: Throwable? = null): Verdict = mutex.withLock {
        // Mid-cooldown a refresh attempt would just 429 again — no verdict is
        // possible, and 429s must never be double-confirmed into a DEAD.
        if (refreshGate.isCoolingDown()) {
            Log.w(
                TAG,
                "refresh rate-limited recently at $site (cause: ${describe(cause)}); " +
                    "cooldown ${refreshGate.remainingMs() / 1000}s — keeping the session",
            )
            return@withLock Verdict.TRANSIENT
        }
        val first = client.auth.refreshSession()
        val verdict = refreshVerdict(first)

        if (verdict == Verdict.DEAD) {
            delay(CONFIRM_DELAY_MS)
            val confirm = client.auth.refreshSession()
            val confirmed = refreshVerdict(confirm)
            if (confirmed != Verdict.DEAD) {
                Log.w(
                    TAG,
                    "refresh rejected once at $site (cause: ${describe(cause)}) but recovered on " +
                        "confirmation (${describe(confirm.error)}) — keeping the session",
                )
                return@withLock confirmed
            }
            Log.w(
                TAG,
                "session DEAD at $site (cause: ${describe(cause)}); refresh rejected twice " +
                    "(${describe(first.error)} / ${describe(confirm.error)}) — signing out",
            )
            SessionExpiryBus.fire()
            return@withLock Verdict.DEAD
        }

        when (verdict) {
            Verdict.RECOVERED ->
                Log.i(TAG, "session RECOVERED at $site (cause: ${describe(cause)}); token refreshed")
            Verdict.TRANSIENT ->
                Log.w(
                    TAG,
                    "transient auth trouble at $site (cause: ${describe(cause)}); refresh error: " +
                        "${describe(first.error)} — keeping the session, SDK will retry",
                )
            Verdict.DEAD -> Unit // handled above
        }
        verdict
    }

    private fun refreshVerdict(result: io.github.nimbleflux.fluxbase.FluxbaseResponse<*>): Verdict {
        val error = result.error
        // Rate-limited: enter the shared cooldown so every other refresh
        // entry point backs off too; a 429 carries no death information.
        if (io.github.nimbleflux.wayli.session.isRateLimitedError(error)) {
            refreshGate.onRateLimited()
            return Verdict.TRANSIENT
        }
        return error?.let { classify(it) } ?: Verdict.RECOVERED
    }

    private fun describe(error: Throwable?): String =
        error?.let { "${it.javaClass.simpleName}(status=${statusOf(it)}): ${it.message?.take(120)}" } ?: "none"

    private fun statusOf(error: Throwable): Any? =
        (error as? io.github.nimbleflux.fluxbase.FluxbaseError)?.status
            ?: (error as? io.github.nimbleflux.fluxbase.core.FluxbaseException)?.status
}
