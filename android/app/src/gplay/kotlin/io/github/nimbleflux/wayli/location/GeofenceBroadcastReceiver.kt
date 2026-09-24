package io.github.nimbleflux.wayli.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import dagger.hilt.android.AndroidEntryPoint
import io.github.nimbleflux.wayli.gps.TrackingController
import io.github.nimbleflux.wayli.gps.TrackingService
import javax.inject.Inject

/**
 * Receives stationary-resume geofence transitions. Manifest-declared so an
 * EXIT transition wakes a dead process: a runtime-registered receiver dies
 * with it, and since the OS kills background apps routinely overnight, the
 * resume would silently never fire and tracking would stay paused until the
 * user noticed and restarted it by hand.
 *
 * When the process (and with it the foreground service) died, the controller
 * is driven through [TrackingService.start] — resuming collection without a
 * foreground service would run background location unprotected (and crash on
 * Android 12+). Only a live service resumes directly.
 */
@AndroidEntryPoint
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    @Inject lateinit var controller: TrackingController

    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_EXIT) return
        if (TrackingService.running) {
            controller.onServiceStarted()
        } else {
            TrackingService.start(context) // onStartCommand drives the controller
        }
    }
}
