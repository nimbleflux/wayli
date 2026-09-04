package io.github.nimbleflux.wayli.tracking

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.db.PendingPointDao
import io.github.nimbleflux.wayli.db.PendingPointEntity
import io.github.nimbleflux.wayli.gps.ActivityRecognitionDriver
import io.github.nimbleflux.wayli.gps.CapturedPoint
import io.github.nimbleflux.wayli.gps.LocationProvider
import io.github.nimbleflux.wayli.gps.StationaryResumeTrigger
import io.github.nimbleflux.wayli.gps.StationaryTracker
import io.github.nimbleflux.wayli.gps.TrackingConfig
import io.github.nimbleflux.wayli.gps.TrackingConfigStore
import io.github.nimbleflux.wayli.gps.TrackingController
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The location-capture pipeline: collect fixes from the flavor's
 * [LocationProvider], apply the battery rules from the tracking config,
 * queue points in Room, and schedule [GpsUploadWorker] to drain the queue.
 *
 * Enhancers (flavor-bound): the [ActivityRecognitionDriver] feeds activity
 * hints (stamped onto points, adaptive intervals in the gplay provider);
 * after a stationary stretch the [StationaryTracker] pauses active updates
 * and the [StationaryResumeTrigger] (geofence on gplay) wakes tracking when
 * the user moves again.
 */
@Singleton
class TrackingControllerImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val provider: LocationProvider,
    private val dao: PendingPointDao,
    private val configStore: TrackingConfigStore,
    private val activityDriver: ActivityRecognitionDriver,
    private val resumeTrigger: StationaryResumeTrigger,
    private val diagnostics: io.github.nimbleflux.wayli.repo.TrackingDiagnosticsRepository,
) : TrackingController {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private val stationaryTracker = StationaryTracker()

    override fun onServiceStarted() {
        activityDriver.start()
        if (job?.isActive == true) return // already collecting (service restart)
        stationaryTracker.reset()
        val config = configStore.get()
        job = scope.launch {
            provider.startUpdates(config).collect { point ->
                if (passesBatteryRules(config)) {
                    dao.insert(point.toEntity(config))
                    diagnostics.onPointsCaptured(1)
                    scheduleUpload()
                    maybePauseWhenStationary(point, config)
                }
            }
        }
    }

    override fun syncNow() {
        scheduleUpload()
    }

    override fun onServiceStopped() {
        job?.cancel()
        job = null
        provider.stopUpdates()
        resumeTrigger.disarm()
        activityDriver.stop()
    }

    /**
     * After [TrackingConfig.stationaryPauseMin] within the resume radius:
     * stop active collection and arm the resume trigger (geofence on gplay).
     */
    private fun maybePauseWhenStationary(point: CapturedPoint, config: TrackingConfig) {
        val decision = stationaryTracker.onPoint(point, config)
        if (decision == StationaryTracker.Decision.PAUSE) {
            job?.cancel()
            job = null
            provider.stopUpdates()
            resumeTrigger.arm(point, config.stationaryResumeRadiusM) {
                // Movement detected — resume the full pipeline.
                onServiceStarted()
            }
        }
    }

    /** True when the current battery state allows recording. */
    private fun passesBatteryRules(config: TrackingConfig): Boolean {
        val (level, charging) = batteryState()
        if (config.onlyWhileCharging && !charging) return false
        if (level != null && level <= config.batteryStopThreshold) return false
        return true
    }

    /** Applies the payload toggles (altitude/speed/heading/battery) from the config. */
    private fun CapturedPoint.toEntity(config: TrackingConfig): PendingPointEntity {
        val (level, _) = batteryState()
        return PendingPointEntity(
            lat = lat,
            lon = lon,
            recordedAtSec = timestamp,
            altitude = altitude.takeIf { config.payloadAltitude },
            accuracy = accuracy,
            speed = speed.takeIf { config.payloadSpeed },
            heading = heading.takeIf { config.payloadHeading },
            battery = (battery ?: level).takeIf { config.payloadBattery },
            deviceId = deviceId,
            activityType = activityType,
        )
    }

    /** (level %, charging) from the sticky battery intent; (null, true) when unavailable. */
    private fun batteryState(): Pair<Int?, Boolean> = try {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_FULL ||
            status == BatteryManager.BATTERY_STATUS_CHARGING
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else null
        pct to charging
    } catch (_: Exception) {
        null to true // unavailable → don't block recording
    }

    private fun scheduleUpload() {
        val request = OneTimeWorkRequestBuilder<GpsUploadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            GpsUploadWorker.UNIQUE_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
