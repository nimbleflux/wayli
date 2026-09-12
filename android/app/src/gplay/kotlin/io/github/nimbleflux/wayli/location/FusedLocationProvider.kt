package io.github.nimbleflux.wayli.location

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.gps.AccuracyProfile
import io.github.nimbleflux.wayli.gps.ActivityKind
import io.github.nimbleflux.wayli.gps.ActivityStateHolder
import io.github.nimbleflux.wayli.gps.AdaptiveTrackingPolicy
import io.github.nimbleflux.wayli.gps.CapturedPoint
import io.github.nimbleflux.wayli.gps.LocationProvider
import io.github.nimbleflux.wayli.gps.TrackingConfig
import io.github.nimbleflux.wayli.gps.TrackingMode
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch

/**
 * Google Play Services location provider (gplay flavor).
 *
 * Beyond plain interval/distance polling:
 * - Points carry the activity-recognition hint from [ActivityStateHolder]
 *   (`act` field → tracker_data.activity_type server-side).
 * - Adaptive intervals: when the holder reports STILL, the request drops to
 *   passive priority at 4× the interval; movement restores the config.
 * - SIGNIFICANT mode ("Places"): no periodic polling — an
 *   [ActivityTransitionRequest] wakes us on still→motion transitions and a
 *   one-shot fix is captured then.
 */
@Singleton
class FusedLocationProvider @Inject constructor(
    @ApplicationContext private val context: Context,
    private val activityHolder: ActivityStateHolder,
) : LocationProvider {

    private val client = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    override val requiresGooglePlayServices: Boolean = true

    @SuppressLint("MissingPermission") // caller checks permission before starting
    override fun startUpdates(config: TrackingConfig): Flow<CapturedPoint> = callbackFlow {
        if (config.mode == TrackingMode.SIGNIFICANT) {
            // ---- Transition-driven "Places" mode ----
            val arClient = ActivityRecognition.getClient(context)
            // Package-scoped: U+ rejects PendingIntents with implicit intents.
            val intent = Intent(TRANSITION_ACTION).setPackage(context.packageName)
            val pi = PendingIntent.getBroadcast(
                context,
                TRANSITION_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            val transitions = ActivityTransitionRequest(
                listOf(
                    transition(DetectedActivity.STILL, ActivityTransition.ACTIVITY_TRANSITION_EXIT),
                    transition(DetectedActivity.WALKING, ActivityTransition.ACTIVITY_TRANSITION_ENTER),
                    transition(DetectedActivity.IN_VEHICLE, ActivityTransition.ACTIVITY_TRANSITION_ENTER),
                    transition(DetectedActivity.ON_BICYCLE, ActivityTransition.ACTIVITY_TRANSITION_ENTER),
                ),
            )
            val br = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, received: Intent) {
                    // Motion started — grab a one-shot fix immediately.
                    val cts = CancellationTokenSource()
                    client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token)
                        .addOnSuccessListener { location ->
                            if (location != null) trySend(location.toCapturedPoint(config))
                        }
                }
            }
            ContextCompat.registerReceiver(context, br, IntentFilter(TRANSITION_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
            arClient.requestActivityTransitionUpdates(transitions, pi)

            awaitClose {
                arClient.removeActivityTransitionUpdates(pi)
                runCatching { context.unregisterReceiver(br) }
            }
        } else {
            // ---- Regular mode with activity-adaptive parameters ----
            val cb = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.locations.forEach { location ->
                        trySend(location.toCapturedPoint(config))
                    }
                }
            }
            callback = cb
            client.requestLocationUpdates(
                buildRequest(config, activityHolder.kind.value),
                cb,
                Looper.getMainLooper(),
            )

            // Re-subscribe with adapted parameters whenever the activity changes.
            val resubscribe = launch {
                activityHolder.kindChanges.collect { kind ->
                    client.removeLocationUpdates(cb)
                    client.requestLocationUpdates(buildRequest(config, kind), cb, Looper.getMainLooper())
                }
            }

            awaitClose {
                resubscribe.cancel()
                client.removeLocationUpdates(cb)
                callback = null
            }
        }
    }

    private fun transition(type: Int, event: Int): ActivityTransition =
        ActivityTransition.Builder()
            .setActivityType(type)
            .setActivityTransition(event)
            .build()

    private fun buildRequest(config: TrackingConfig, kind: ActivityKind): LocationRequest {
        // Never passive by activity — only an explicit POWER profile opts in
        // (passive delivers nothing on a quiet device; see AdaptiveTrackingPolicy).
        val priority = when (config.accuracy) {
            AccuracyProfile.HIGH -> Priority.PRIORITY_HIGH_ACCURACY
            AccuracyProfile.BALANCED -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
            AccuracyProfile.LOW -> Priority.PRIORITY_LOW_POWER
            AccuracyProfile.POWER -> Priority.PRIORITY_PASSIVE
        }
        val intervalMs = AdaptiveTrackingPolicy.intervalMs(config, kind)
        return LocationRequest.Builder(priority, intervalMs)
            .setMinUpdateDistanceMeters(config.minDistanceM)
            .setMaxUpdateDelayMillis(intervalMs * 2)
            .build()
    }

    private fun Location.toCapturedPoint(config: TrackingConfig): CapturedPoint {
        val kind = activityHolder.kind.value
        return CapturedPoint(
            lat = latitude,
            lon = longitude,
            timestamp = time / 1000L,
            altitude = if (hasAltitude()) altitude else null,
            accuracy = if (hasAccuracy()) accuracy else null,
            speed = if (hasSpeed() && speed > 0f) speed else null,
            heading = if (hasBearing()) bearing else null,
            deviceId = config.deviceId,
            activityType = kind.takeIf { it != ActivityKind.UNKNOWN }?.name?.lowercase(),
        )
    }

    override fun stopUpdates() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }

    /** One-shot fix via getCurrentLocation — independent of [startUpdates]. */
    @SuppressLint("MissingPermission") // caller checks permission before starting
    override suspend fun getCurrentPoint(config: TrackingConfig): CapturedPoint? {
        // getCurrentLocation can hang indefinitely when no fix is obtainable
        // (emulator without an injected location, radios off) — bound it and
        // fall back to the best last-known position.
        val fresh = kotlinx.coroutines.withTimeoutOrNull(FIX_TIMEOUT_MS) {
            kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
                val cts = CancellationTokenSource()
                continuation.invokeOnCancellation { cts.cancel() }
                client.getCurrentLocation(priorityOf(config), cts.token)
                    .addOnSuccessListener { location ->
                        if (continuation.isActive) {
                            continuation.resume(location?.toCapturedPoint(config))
                        }
                    }
                    .addOnFailureListener {
                        if (continuation.isActive) continuation.resume(null)
                    }
            }
        }
        if (fresh != null) return fresh
        return lastKnownPoint(config)
    }

    private fun lastKnownPoint(config: TrackingConfig): CapturedPoint? {
        // Synchronous last-known read across providers (framework API — no
        // Play task involved, never hangs).
        val location = try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            listOf(
                android.location.LocationManager.GPS_PROVIDER,
                android.location.LocationManager.NETWORK_PROVIDER,
                android.location.LocationManager.PASSIVE_PROVIDER,
            )
                .filter { lm.allProviders.contains(it) }
                .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
                .maxByOrNull { it.time }
        } catch (_: Exception) {
            null
        }
        return location?.toCapturedPoint(config)
    }

    private fun priorityOf(config: TrackingConfig): Int = when (config.accuracy) {
        AccuracyProfile.HIGH -> Priority.PRIORITY_HIGH_ACCURACY
        AccuracyProfile.BALANCED -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
        AccuracyProfile.LOW -> Priority.PRIORITY_LOW_POWER
        // Passive delivers nothing on demand — a manual fix wants real GPS.
        AccuracyProfile.POWER -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
    }

    companion object {
        private const val TRANSITION_ACTION = "io.github.nimbleflux.wayli.ACTIVITY_TRANSITION"
        private const val TRANSITION_REQUEST_CODE = 4203
        private const val FIX_TIMEOUT_MS = 10_000L
    }
}
