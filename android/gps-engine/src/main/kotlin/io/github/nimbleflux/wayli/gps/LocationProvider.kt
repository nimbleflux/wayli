package io.github.nimbleflux.wayli.gps

import kotlinx.coroutines.flow.Flow

/**
 * A captured GPS point ready for upload to the Wayli ingestion endpoint.
 * Mirrors the OwnTracks location object format.
 */
data class CapturedPoint(
    val lat: Double,
    val lon: Double,
    val timestamp: Long, // Unix epoch seconds (OwnTracks tst)
    val altitude: Double? = null,
    val accuracy: Float? = null,
    val speed: Float? = null, // m/s
    val heading: Float? = null, // degrees 0-359
    val battery: Int? = null, // 0-100
    val deviceId: String = "android",
    val activityType: String? = null, // AR hint (vehicle/on_foot/on_bike/still)
)

/**
 * SPI for platform location providers. The `gplay` flavor uses
 * FusedLocationProviderClient; the `foss` flavor uses the framework
 * LocationManager. Both produce a [Flow] of [CapturedPoint]s.
 */
interface LocationProvider {
    /**
     * Start receiving location updates according to [config].
     * Returns a Flow that emits captured points.
     */
    fun startUpdates(config: TrackingConfig): Flow<CapturedPoint>

    /**
     * Stop location updates.
     */
    fun stopUpdates()

    /**
     * One-shot fix, independent of [startUpdates] (which must not be touched
     * while the live pipeline is running). Suspends until a fresh location is
     * available (bounded by the caller's timeout) or returns null when no fix
     * can be obtained. Requires foreground location permission.
     */
    suspend fun getCurrentPoint(config: TrackingConfig): CapturedPoint?

    /**
     * Whether this provider requires Google Play Services.
     */
    val requiresGooglePlayServices: Boolean
}
