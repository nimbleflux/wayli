package io.github.nimbleflux.wayli.location

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.gps.CapturedPoint
import io.github.nimbleflux.wayli.gps.StationaryResumeTrigger
import io.github.nimbleflux.wayli.repo.TrackingDiagnosticsRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * gplay stationary resume: when tracking pauses after a stationary stretch,
 * a geofence (radius = resume radius) is armed around the last fix. EXIT
 * fires [GeofenceBroadcastReceiver], which resumes active tracking.
 *
 * The transition must survive process death, so the target is a
 * manifest-declared receiver rather than a runtime-registered one — the
 * [onResume] callback from [StationaryResumeTrigger.arm] cannot, and is
 * unused here.
 */
@Singleton
class GmsGeofenceResumeTrigger @Inject constructor(
    @ApplicationContext private val context: Context,
    private val diagnostics: TrackingDiagnosticsRepository,
) : StationaryResumeTrigger {

    private val client: GeofencingClient = LocationServices.getGeofencingClient(context)
    private var pendingIntent: PendingIntent? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @SuppressLint("MissingPermission") // location permission is a precondition of tracking itself
    override fun arm(point: CapturedPoint, radiusM: Float, @Suppress("UNUSED_PARAMETER") onResume: () -> Unit) {
        disarm()

        val geofence = Geofence.Builder()
            .setRequestId(GEOFENCE_ID)
            .setCircularRegion(point.lat, point.lon, radiusM)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_EXIT)
            .addGeofence(geofence)
            .build()

        // The system adds the transition extras, so the PendingIntent must
        // stay mutable; targeting the receiver class keeps it package-scoped
        // (U+ rejects implicit PendingIntents).
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        pendingIntent = pi

        client.addGeofences(request, pi).addOnFailureListener { e ->
            Log.w(TAG, "geofence arm failed: ${e.message?.take(120)}")
            // The geofence is the ONLY wake-up from a stationary pause — a
            // log-only failure would hide a pause that can never resume.
            scope.launch {
                diagnostics.logEvent("geofence_arm_failed", e.message?.take(120))
            }
        }
    }

    override fun disarm() {
        pendingIntent?.let { runCatching { client.removeGeofences(it) } }
        pendingIntent = null
    }

    companion object {
        private const val TAG = "WayliGeofence"
        private const val REQUEST_CODE = 4202
        private const val GEOFENCE_ID = "wayli-stationary-resume"
    }
}
