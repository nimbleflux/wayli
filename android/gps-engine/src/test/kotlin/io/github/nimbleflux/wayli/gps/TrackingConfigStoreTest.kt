package io.github.nimbleflux.wayli.gps

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Roundtrip tests for the SharedPreferences-backed tracking config. */
@RunWith(RobolectricTestRunner::class)
class TrackingConfigStoreTest {

    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val store = TrackingConfigStore(context)

    @org.junit.Before
    fun setUp() {
        // Robolectric shares the application (and prefs file) across tests in
        // a class — reset to a clean slate so order doesn't matter.
        context.getSharedPreferences("wayli-tracking", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun `defaults match the config data class`() {
        val config = store.get()
        assertEquals(TrackingConfig(), config)
        // Recording intent is ON by default (see RecordingViewModel).
        assertTrue(store.isTracking)
        // The durable intent defaults on with the toggle, so a fresh install
        // self-heals a service death instead of silently staying off.
        assertTrue(store.trackingDesired)
    }

    @Test
    fun `set persists all fields`() {
        val config = TrackingConfig(
            mode = TrackingMode.SIGNIFICANT,
            minIntervalSec = 120,
            minDistanceM = 250f,
            accuracy = AccuracyProfile.POWER,
            stationaryPauseMin = 15,
            stationaryResumeRadiusM = 500f,
            batteryStopThreshold = 25,
            onlyWhileCharging = true,
            payloadAltitude = false,
            payloadHeading = false,
            payloadSpeed = false,
            payloadBattery = false,
            locatorDisplacementM = 75f,
            locatorIntervalSec = 600,
            ignoreInaccurate = true,
            deviceId = "pixel-8",
            startOnBoot = true,
        )
        store.set(config)
        assertEquals(config, store.get())
    }

    @Test
    fun `invalid enum falls back to default instead of crashing`() {
        val prefs = context.getSharedPreferences("wayli-tracking", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("mode", "NOT_A_MODE")
            .putString("accuracy", "ALSO_NOT")
            .apply()
        val config = store.get()
        assertEquals(TrackingMode.MOVE, config.mode)
        assertEquals(AccuracyProfile.BALANCED, config.accuracy)
    }

    @Test
    fun isTrackingPersists() {
        store.isTracking = true
        assertTrue(store.isTracking)
        store.isTracking = false
        assertFalse(store.isTracking)
    }

    @Test
    fun trackingDesiredSurvivesIndependentlyOfIsTracking() {
        // The service-death path: liveness flips off, the intent stays on so
        // the app-open auto-restart can fire.
        store.isTracking = false
        store.trackingDesired = true
        assertFalse(TrackingConfigStore(context).isTracking)
        assertTrue(TrackingConfigStore(context).trackingDesired)

        // The explicit pause/stop path: the user's intent is withdrawn.
        store.trackingDesired = false
        assertFalse(TrackingConfigStore(context).trackingDesired)
        assertTrue(TrackingConfigStore(context).isTracking == false)
    }
}
