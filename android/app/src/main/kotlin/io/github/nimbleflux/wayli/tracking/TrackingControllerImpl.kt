package io.github.nimbleflux.wayli.tracking

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.db.PendingPointDao
import io.github.nimbleflux.wayli.db.PendingPointEntity
import io.github.nimbleflux.wayli.di.FlavorCapabilities
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
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
 * the user moves again. On foss there is no wake-up, so stationary pause is
 * disabled entirely ([FlavorCapabilities.supportsStationaryResume]).
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

    // An unhandled pipeline error (provider flow dying, Room I/O) used to
    // kill the process — and START_STICKY would restart straight into the
    // same crash. Surface the failure and end in a consistent stopped state
    // instead; the user (or the boot/app-open restart paths) starts again.
    private val scope = CoroutineScope(
        SupervisorJob() +
            Dispatchers.IO +
            CoroutineExceptionHandler { _, throwable ->
                job?.cancel()
                job = null
                provider.stopUpdates()
                // One-off scope: the failure path is rare and terminal.
                CoroutineScope(Dispatchers.IO).launch {
                    diagnostics.logEvent(
                        "capture_error",
                        "pipeline failed — tracking stopped: " +
                            (throwable.message ?: throwable.javaClass.simpleName).take(200),
                    )
                }
            },
    )
    private var job: Job? = null
    private val stationaryTracker = StationaryTracker()

    /** Guards the once-per-episode battery-gate event (see [maybeStopForBattery]). */
    private var batteryGateLogged = false

    override fun onServiceStarted() {
        maybeStartActivityDriver()
        if (job?.isActive == true) return // already collecting (service restart)
        startCollection()
    }

    /**
     * The activity driver only feeds hints, so without ACTIVITY_RECOGNITION
     * (runtime-revoked, or never granted) it stays inert with a log line
     * instead of failing the Play Services request.
     */
    private fun maybeStartActivityDriver() {
        val granted = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.ACTIVITY_RECOGNITION,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            android.util.Log.i(TAG, "ACTIVITY_RECOGNITION not granted — activity hints disabled")
            return
        }
        activityDriver.start()
    }

    /**
     * Settings persist instantly, but the pipeline snapshots the config at
     * start — apply a changed config by rebuilding the collection (fresh GPS
     * request: accuracy profile, battery rules, stationary thresholds).
     */
    override fun onConfigChanged() {
        if (job?.isActive != true) return // not collecting (paused) — resume re-reads config
        job?.cancel()
        provider.stopUpdates()
        startCollection()
    }

    private fun startCollection() {
        stationaryTracker.reset()
        batteryGateLogged = false
        val config = configStore.get()
        job = scope.launch {
            provider.startUpdates(config).collect { point ->
                // One bad fix (Room I/O, mapping failure) must not tear down
                // the whole collection — skip it and keep capturing.
                runCatching {
                    if (passesBatteryRules(config)) {
                        // A passing fix ends the gating episode; a later
                        // failing one logs again.
                        batteryGateLogged = false
                        if (!ignoresAccuracy(config, point)) {
                            dao.insert(point.toEntity(config))
                            diagnostics.onPointsCaptured(1)
                            scheduleUpload(GpsUploadWorker.TRIGGER_CAPTURE)
                            maybePauseWhenStationary(point, config)
                        }
                    } else {
                        maybeStopForBattery(config)
                    }
                }.onFailure { e ->
                    if (e is CancellationException) throw e
                    android.util.Log.w(TAG, "capture pipeline error: ${e.message?.take(120)}")
                }
            }
        }
    }

    /**
     * The "Ignore inaccurate readings (>100 m)" setting: coarse fixes are
     * dropped entirely — not stored, not uploaded, and not fed to stationary
     * detection (a 500 m fix would both fake movement and mask stillness).
     */
    private fun ignoresAccuracy(config: TrackingConfig, point: CapturedPoint): Boolean =
        config.ignoreInaccurate && (point.accuracy ?: 0f) > IGNORE_INACCURATE_M

    override fun syncNow() {
        scheduleUpload(GpsUploadWorker.TRIGGER_MANUAL)
    }

    override suspend fun submitManualLocation(): Result<CapturedPoint> =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            runCatching {
                val config = configStore.get()
                // A manual submission is explicit — battery gating does not
                // apply; payload toggles still shape the stored point.
                val point = kotlinx.coroutines.withTimeout(MANUAL_FIX_TIMEOUT_MS) {
                    provider.getCurrentPoint(config)
                } ?: error("No GPS fix available — try again outside with a clear sky view")
                dao.insert(point.toEntity(config))
                diagnostics.onPointsCaptured(1)
                scheduleUpload(GpsUploadWorker.TRIGGER_MANUAL)
                point
            }
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
     *
     * Skipped when the flavor has no resume mechanism (foss — the noop
     * trigger can't fire): a pause there would never end, silently freezing
     * a session whose notification still claims to be active. Foss instead
     * keeps recording through stationary stretches.
     */
    private fun maybePauseWhenStationary(point: CapturedPoint, config: TrackingConfig) {
        if (!FlavorCapabilities.supportsStationaryResume) return
        val decision = stationaryTracker.onPoint(point, config)
        if (decision == StationaryTracker.Decision.PAUSE) {
            scope.launch {
                diagnostics.logEvent(
                    "stationary_pause",
                    "paused after ${config.stationaryPauseMin} min within ${config.stationaryResumeRadiusM.toInt()} m",
                )
            }
            job?.cancel()
            job = null
            provider.stopUpdates()
            resumeTrigger.arm(point, config.stationaryResumeRadiusM) {
                // Movement detected — resume the full pipeline.
                scope.launch { diagnostics.logEvent("stationary_resume", "movement detected — tracking resumed") }
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

    /**
     * Battery gating used to keep the foreground service requesting at full
     * rate while silently discarding every fix — GPS hot, notification
     * claiming an active session, nothing recorded. Now the first drop of a
     * gating episode is logged and updates stop (notification unchanged).
     * Deliberately no auto-resume: the user restarts via the drawer toggle
     * or the app; a resumed session re-reads the config.
     */
    private fun maybeStopForBattery(config: TrackingConfig) {
        if (batteryGateLogged) return
        batteryGateLogged = true
        scope.launch {
            diagnostics.logEvent(
                "battery_gate",
                "battery rules failed (threshold ${config.batteryStopThreshold}%, " +
                    "charging-only=${config.onlyWhileCharging}) — capture paused",
            )
        }
        job?.cancel()
        job = null
        provider.stopUpdates()
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

    private fun scheduleUpload(trigger: String) {
        // The periodic schedule is the safety net for stranded batches: the
        // one-shot's retry cycle gives up after ~30 minutes, which an outage
        // (phone-side network loss overnight) outlives. KEEP policy makes
        // re-enqueueing free; an empty queue makes each run a no-op.
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            GpsUploadWorker.PERIODIC_UNIQUE_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<GpsUploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setInputData(androidx.work.workDataOf(GpsUploadWorker.KEY_TRIGGER to GpsUploadWorker.TRIGGER_PERIODIC))
                .build(),
        )
        val request = OneTimeWorkRequestBuilder<GpsUploadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(androidx.work.workDataOf(GpsUploadWorker.KEY_TRIGGER to trigger))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            GpsUploadWorker.UNIQUE_NAME,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    private companion object {
        const val TAG = "WayliTracking"
        const val MANUAL_FIX_TIMEOUT_MS = 30_000L
        const val IGNORE_INACCURATE_M = 100f
    }
}
