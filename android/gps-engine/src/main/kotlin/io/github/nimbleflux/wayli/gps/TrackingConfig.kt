package io.github.nimbleflux.wayli.gps

import android.content.Context
import androidx.core.content.edit
import kotlinx.serialization.Serializable

/**
 * OwnTracks-grade tracking configuration. Stored in SharedPreferences so the
 * foreground service reads it without needing a database lookup.
 *
 * Covers both GPS sampling (interval, distance, accuracy, battery) and the
 * transport/identity layer (HTTP endpoint, auth, topic, locator) — mirroring
 * OwnTracks' configuration surface.
 */
@Serializable
data class TrackingConfig(
    // ---- GPS sampling ----
    val mode: TrackingMode = TrackingMode.MOVE,
    val minIntervalSec: Long = 30,
    val minDistanceM: Float = 50f,
    val accuracy: AccuracyProfile = AccuracyProfile.BALANCED,
    val stationaryPauseMin: Long = 5,
    val stationaryResumeRadiusM: Float = 100f,
    val batteryStopThreshold: Int = 15,
    val onlyWhileCharging: Boolean = false,

    // ---- Data payload ----
    val payloadAltitude: Boolean = true,
    val payloadHeading: Boolean = true,
    val payloadSpeed: Boolean = true,
    val payloadBattery: Boolean = true,

    // ---- Transport / server endpoint (OwnTracks HTTP mode) ----
    val locatorDisplacementM: Float = 0f,
    val locatorIntervalSec: Long = 0L,
    val ignoreInaccurate: Boolean = false,

    // ---- Identity / system ----
    val deviceId: String = "android",
    val startOnBoot: Boolean = false,
)

enum class TrackingMode { MOVE, SIGNIFICANT, MANUAL }

enum class AccuracyProfile(val label: String) {
    HIGH("High (GPS + WiFi)"),
    BALANCED("Balanced (WiFi + GPS)"),
    LOW("Low (Cell + WiFi)"),
    POWER("Power saving (Cell only)"),
}

/**
 * Persists [TrackingConfig] in SharedPreferences. The tracking service reads
 * this on each location update cycle so users can change settings on the fly.
 */
class TrackingConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("wayli-tracking", Context.MODE_PRIVATE)

    fun get(): TrackingConfig = TrackingConfig(
        mode = prefs.getString(KEY_MODE, null)?.let { runCatching { TrackingMode.valueOf(it) }.getOrNull() } ?: TrackingMode.MOVE,
        minIntervalSec = prefs.getLong(KEY_MIN_INTERVAL, 30),
        minDistanceM = prefs.getFloat(KEY_MIN_DISTANCE, 50f),
        accuracy = prefs.getString(KEY_ACCURACY, null)?.let { runCatching { AccuracyProfile.valueOf(it) }.getOrNull() } ?: AccuracyProfile.BALANCED,
        stationaryPauseMin = prefs.getLong(KEY_STATIONARY_PAUSE, 5),
        stationaryResumeRadiusM = prefs.getFloat(KEY_STATIONARY_RESUME, 100f),
        batteryStopThreshold = prefs.getInt(KEY_BATTERY_THRESHOLD, 15),
        onlyWhileCharging = prefs.getBoolean(KEY_CHARGING_ONLY, false),
        payloadAltitude = prefs.getBoolean(KEY_PAYLOAD_ALT, true),
        payloadHeading = prefs.getBoolean(KEY_PAYLOAD_HEADING, true),
        payloadSpeed = prefs.getBoolean(KEY_PAYLOAD_SPEED, true),
        payloadBattery = prefs.getBoolean(KEY_PAYLOAD_BATTERY, true),
        locatorDisplacementM = prefs.getFloat(KEY_LOCATOR_DISPLACEMENT, 0f),
        locatorIntervalSec = prefs.getLong(KEY_LOCATOR_INTERVAL, 0L),
        ignoreInaccurate = prefs.getBoolean(KEY_IGNORE_INACCURATE, false),
        deviceId = prefs.getString(KEY_DEVICE_ID, "android") ?: "android",
        startOnBoot = prefs.getBoolean(KEY_START_ON_BOOT, false),
    )

    fun set(config: TrackingConfig) {
        prefs.edit {
            putString(KEY_MODE, config.mode.name)
            putLong(KEY_MIN_INTERVAL, config.minIntervalSec)
            putFloat(KEY_MIN_DISTANCE, config.minDistanceM)
            putString(KEY_ACCURACY, config.accuracy.name)
            putLong(KEY_STATIONARY_PAUSE, config.stationaryPauseMin)
            putFloat(KEY_STATIONARY_RESUME, config.stationaryResumeRadiusM)
            putInt(KEY_BATTERY_THRESHOLD, config.batteryStopThreshold)
            putBoolean(KEY_CHARGING_ONLY, config.onlyWhileCharging)
            putBoolean(KEY_PAYLOAD_ALT, config.payloadAltitude)
            putBoolean(KEY_PAYLOAD_HEADING, config.payloadHeading)
            putBoolean(KEY_PAYLOAD_SPEED, config.payloadSpeed)
            putBoolean(KEY_PAYLOAD_BATTERY, config.payloadBattery)
            putFloat(KEY_LOCATOR_DISPLACEMENT, config.locatorDisplacementM)
            putLong(KEY_LOCATOR_INTERVAL, config.locatorIntervalSec)
            putBoolean(KEY_IGNORE_INACCURATE, config.ignoreInaccurate)
            putString(KEY_DEVICE_ID, config.deviceId)
            putBoolean(KEY_START_ON_BOOT, config.startOnBoot)
        }
    }

    var isTracking: Boolean
        get() = prefs.getBoolean(KEY_IS_TRACKING, true)
        set(value) = prefs.edit { putBoolean(KEY_IS_TRACKING, value) }

    /**
     * The user's tracking on/off *intent*, as opposed to [isTracking]'s
     * service-liveness. The service flips isTracking off when it dies —
     * battery-optimizer kill, crash, reboot, app update — which used to
     * permanently end tracking until the user noticed and restarted it by
     * hand. The intent survives those deaths so the app can auto-restart
     * tracking on the next open; only explicit Pause/Stop clear it.
     */
    var trackingDesired: Boolean
        get() = prefs.getBoolean(KEY_TRACKING_DESIRED, true)
        set(value) = prefs.edit { putBoolean(KEY_TRACKING_DESIRED, value) }

    /** Whether the persistent "tracking off" status notification stays posted. */
    var statusNotificationEnabled: Boolean
        get() = prefs.getBoolean(KEY_STATUS_NOTIFICATION, true)
        set(value) = prefs.edit { putBoolean(KEY_STATUS_NOTIFICATION, value) }

    companion object {
        private const val KEY_MODE = "mode"
        private const val KEY_MIN_INTERVAL = "min_interval"
        private const val KEY_MIN_DISTANCE = "min_distance"
        private const val KEY_ACCURACY = "accuracy"
        private const val KEY_STATIONARY_PAUSE = "stationary_pause"
        private const val KEY_STATIONARY_RESUME = "stationary_resume"
        private const val KEY_BATTERY_THRESHOLD = "battery_threshold"
        private const val KEY_CHARGING_ONLY = "charging_only"
        private const val KEY_PAYLOAD_ALT = "payload_alt"
        private const val KEY_PAYLOAD_HEADING = "payload_heading"
        private const val KEY_PAYLOAD_SPEED = "payload_speed"
        private const val KEY_PAYLOAD_BATTERY = "payload_battery"
        private const val KEY_LOCATOR_DISPLACEMENT = "locator_displacement"
        private const val KEY_LOCATOR_INTERVAL = "locator_interval"
        private const val KEY_IGNORE_INACCURATE = "ignore_inaccurate"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_START_ON_BOOT = "start_on_boot"
        private const val KEY_IS_TRACKING = "is_tracking"
        private const val KEY_TRACKING_DESIRED = "tracking_desired"
        private const val KEY_STATUS_NOTIFICATION = "status_notification"
    }
}
