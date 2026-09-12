package io.github.nimbleflux.wayli.feature.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.gps.TrackingActionReceiver
import io.github.nimbleflux.wayli.gps.TrackingConfigStore
import io.github.nimbleflux.wayli.gps.TrackingService
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Recording control layer. Holds the user's recording on/off intent (on by
 * default) and persists it via [TrackingConfigStore.isTracking] and
 * [TrackingConfigStore.trackingDesired].
 *
 * In demo mode the toggle only flips UI state — no service runs. In real
 * mode, [resume] starts the [TrackingService] foreground service (the
 * caller must hold ACCESS_FINE_LOCATION) and [pause] stops it.
 *
 * Self-healing: the service can die without the user asking for it (battery
 * optimizer, crash, reboot, app update), and when that happens Android also
 * kills this process — so on the next open, init restarts the service when
 * the intent is still on but the service isn't running. Without this, one
 * silent death ended tracking until the user happened to notice the toggle.
 */
@HiltViewModel
class RecordingViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val store: TrackingConfigStore,
    private val demoManager: DemoManager,
    private val deviceTokenStore: io.github.nimbleflux.wayli.session.DeviceTokenStore,
    private val deviceTokenRepo: io.github.nimbleflux.wayli.repo.DeviceTokenRepository,
) : ViewModel() {
    private val _isRecording = MutableStateFlow(store.isTracking)
    val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()

    val isDemo: Boolean get() = demoManager.isDemoMode

    init {
        if (!demoManager.isDemoMode &&
            store.trackingDesired &&
            !TrackingService.running
        ) {
            // Deliberately not gated on store.isTracking: a crash can leave it
            // stale-true while the service is gone; TrackingService.running is
            // the process-liveness truth.
            _isRecording.value = true
            if (hasFineLocation(appContext)) {
                TrackingService.start(appContext)
            }
            ensureTrackingToken()
        }
    }

    private fun hasFineLocation(context: Context): Boolean =
        androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.ACCESS_FINE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

    fun pause() {
        _isRecording.value = false
        store.isTracking = false
        store.trackingDesired = false
        if (!demoManager.isDemoMode) {
            TrackingService.stop(appContext)
            // Keep the drawer toggle alive: paused ≠ stopped.
            TrackingActionReceiver.postPausedNotification(appContext)
        }
    }

    fun resume() {
        _isRecording.value = true
        store.isTracking = true
        store.trackingDesired = true
        if (!demoManager.isDemoMode) {
            TrackingActionReceiver.cancelPausedNotification(appContext)
            TrackingService.start(appContext)
            ensureTrackingToken()
        }
    }

    /**
     * Tracking uploads authenticate with an auto-provisioned device token
     * (created at sign-in). If it's somehow missing, create it now — the
     * upload worker retries until it lands.
     */
    private fun ensureTrackingToken() {
        if (deviceTokenStore.isActive) return
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { deviceTokenRepo.create(label = android.os.Build.MODEL) }
        }
    }
}
