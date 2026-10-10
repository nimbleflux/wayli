package io.github.nimbleflux.wayli.gps

/**
 * Pure policy: how the configured tracking request adapts to the current
 * activity kind. Unit-testable without Android.
 *
 * - STILL: a 4× interval — we're parked; keep a slow ACTIVE heartbeat so
 *   stationary-pause detection still sees points. Never passive priority:
 *   passive delivers nothing unless other apps request location, so a
 *   quiet device would silently miss the start of a trip (verified on the
 *   emulator, where walking is misclassified as still and passive capture
 *   dropped to one point per ~2 minutes).
 * - Moving (foot/vehicle/bike): the configured accuracy profile and interval.
 * - UNKNOWN: the configured values (no signal → no change).
 *
 * Passive priority is reserved for an explicit `POWER` accuracy profile.
 */
object AdaptiveTrackingPolicy {

    data class Effective(
        val intervalMultiplier: Long,
    )

    fun effectiveFor(kind: ActivityKind): Effective = when (kind) {
        ActivityKind.STILL -> Effective(intervalMultiplier = 4)
        ActivityKind.ON_FOOT, ActivityKind.RUNNING, ActivityKind.IN_VEHICLE, ActivityKind.ON_BIKE ->
            Effective(intervalMultiplier = 1)
        ActivityKind.UNKNOWN -> Effective(intervalMultiplier = 1)
    }

    /** The interval to request right now, given the config and activity. */
    fun intervalMs(config: TrackingConfig, kind: ActivityKind): Long {
        val base = config.minIntervalSec * 1000L
        return base * effectiveFor(kind).intervalMultiplier
    }
}
