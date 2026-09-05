package io.github.nimbleflux.wayli.gps

/**
 * Owns the location-capture pipeline while the foreground service runs:
 * collect [CapturedPoint]s from a [LocationProvider], apply battery rules
 * from [TrackingConfig], queue points locally, and schedule the upload
 * worker.
 *
 * Implemented in the `:app` module (where Room + WorkManager live) and
 * injected into [TrackingService]; the service itself is only the
 * foreground-notification shell that keeps the process alive.
 */
interface TrackingController {
    /** Begin collecting points. Idempotent — safe to call on every service start. */
    fun onServiceStarted()

    /** Stop collecting. Called from the service's onDestroy. */
    fun onServiceStopped()

    /** Force an upload attempt now (ignores the network backoff schedule). */
    fun syncNow()

    /**
     * Capture one fresh GPS fix and queue it for upload (bypasses battery
     * gating — the request is explicit). Fails when no fix could be obtained.
     */
    suspend fun submitManualLocation(): Result<CapturedPoint>
}
