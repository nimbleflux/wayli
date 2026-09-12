package io.github.nimbleflux.wayli.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.gps.AccuracyProfile
import io.github.nimbleflux.wayli.gps.CapturedPoint
import io.github.nimbleflux.wayli.gps.LocationProvider
import io.github.nimbleflux.wayli.gps.TrackingConfig
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Framework LocationManager provider (foss flavor) — zero Google
 * dependencies, F-Droid eligible. Subscribes to both GPS and network
 * providers; each fix is deduped against the last emitted point using the
 * configured min distance.
 */
@Singleton
class SystemLocationProvider @Inject constructor(
    @ApplicationContext private val context: Context,
) : LocationProvider {

    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var listener: LocationListener? = null
    private var lastEmitted: Location? = null

    override val requiresGooglePlayServices: Boolean = false

    @SuppressLint("MissingPermission") // caller checks permission before starting
    override fun startUpdates(config: TrackingConfig): Flow<CapturedPoint> = callbackFlow {
        // FOSS has no fused provider — pick providers by accuracy profile.
        val providers = when (config.accuracy) {
            AccuracyProfile.HIGH, AccuracyProfile.BALANCED ->
                listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            AccuracyProfile.LOW, AccuracyProfile.POWER ->
                listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
        }.filter { locationManager.allProviders.contains(it) }

        val minDistance = if (config.accuracy == AccuracyProfile.HIGH || config.accuracy == AccuracyProfile.BALANCED) {
            config.minDistanceM
        } else {
            // Passive/low-power: let the system decide; only filter by interval.
            0f
        }

        val intervalMs = when (config.accuracy) {
            AccuracyProfile.POWER -> (config.minIntervalSec * 1000L).coerceAtLeast(FIFTEEN_MINUTES_MS)
            else -> config.minIntervalSec * 1000L
        }

        val cb = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val last = lastEmitted
                if (last != null && location.distanceTo(last) < minDistance && config.minDistanceM > 0f) {
                    return // below the configured displacement
                }
                if (location.time / 1000L == (last?.time ?: 0L) / 1000L) {
                    return // same-second duplicate from the second provider
                }
                lastEmitted = location
                trySend(
                    CapturedPoint(
                        lat = location.latitude,
                        lon = location.longitude,
                        timestamp = location.time / 1000L,
                        altitude = if (location.hasAltitude()) location.altitude else null,
                        accuracy = if (location.hasAccuracy()) location.accuracy else null,
                        speed = if (location.hasSpeed() && location.speed > 0f) location.speed else null,
                        heading = if (location.hasBearing()) location.bearing else null,
                        deviceId = config.deviceId,
                    ),
                )
            }

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }

        listener = cb
        providers.forEach { provider ->
            locationManager.requestLocationUpdates(provider, intervalMs, minDistance, cb, Looper.getMainLooper())
        }

        awaitClose {
            listener?.let { locationManager.removeUpdates(it) }
            listener = null
            lastEmitted = null
        }
    }

    override fun stopUpdates() {
        listener?.let { locationManager.removeUpdates(it) }
        listener = null
        lastEmitted = null
    }

    /** One-shot fix — API 30+ getCurrentLocation on GPS, else best-known position. */
    @SuppressLint("MissingPermission") // caller checks permission before starting
    override suspend fun getCurrentPoint(config: TrackingConfig): CapturedPoint? {
        val preferred = when (config.accuracy) {
            AccuracyProfile.HIGH, AccuracyProfile.BALANCED ->
                listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            AccuracyProfile.LOW, AccuracyProfile.POWER ->
                listOf(LocationManager.NETWORK_PROVIDER)
        }.firstOrNull { locationManager.allProviders.contains(it) }

        if (preferred != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            val fix = kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
                val signal = android.os.CancellationSignal()
                continuation.invokeOnCancellation { signal.cancel() }
                val consumer = java.util.function.Consumer<Location?> { location ->
                    if (continuation.isActive) continuation.resume(location)
                }
                runCatching {
                    locationManager.getCurrentLocation(
                        preferred,
                        null,
                        androidx.core.content.ContextCompat.getMainExecutor(context),
                        consumer,
                    )
                }.onFailure {
                    if (continuation.isActive) continuation.resume(null)
                }
            }
            if (fix != null) return fix.toCapturedPoint(config)
        }
        // API < 30 or the fresh-fix request failed: fall back to the best
        // last-known position across providers.
        val last = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER,
        ).filter { locationManager.allProviders.contains(it) }
            .mapNotNull { runCatching { locationManager.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
            ?: return null
        return last.toCapturedPoint(config)
    }

    private fun Location.toCapturedPoint(config: TrackingConfig) = CapturedPoint(
        lat = latitude,
        lon = longitude,
        timestamp = time / 1000L,
        altitude = if (hasAltitude()) altitude else null,
        accuracy = if (hasAccuracy()) accuracy else null,
        speed = if (hasSpeed() && speed > 0f) speed else null,
        heading = if (hasBearing()) bearing else null,
        deviceId = config.deviceId,
    )

    companion object {
        private const val FIFTEEN_MINUTES_MS = 15 * 60 * 1000L
    }
}
