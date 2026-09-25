package io.github.nimbleflux.wayli.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import io.github.nimbleflux.wayli.gps.TrackingConfigStore
import io.github.nimbleflux.wayli.gps.TrackingActionReceiver
import io.github.nimbleflux.wayli.gps.TrackingService

/**
 * Restarts tracking after a reboot or an app update when the user enabled
 * "Start on boot" and their tracking intent is on. The intent (not the
 * service-liveness flag) is checked because a clean shutdown runs onDestroy,
 * which flips [TrackingConfigStore.isTracking] off — only a hard crash leaves
 * it true. When tracking isn't being restarted, the persistent status
 * notification (tracking toggle) is re-posted instead.
 *
 * ACCESS_FINE_LOCATION is checked before starting the service: a revoked
 * permission would make the foreground promotion throw SecurityException, and
 * START_STICKY would restart straight into the same crash loop.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        val store = TrackingConfigStore(context)
        if (store.get().startOnBoot && store.trackingDesired && hasFineLocation(context)) {
            TrackingService.start(context)
        } else {
            TrackingActionReceiver.syncNotifications(context)
        }
    }

    private fun hasFineLocation(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
}
