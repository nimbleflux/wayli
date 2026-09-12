package io.github.nimbleflux.wayli.gps

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Handles the tracking notification's quick-toggle actions (Start / Pause /
 * Resume / Stop) so tracking can be controlled straight from the notification
 * drawer, without opening the app.
 *
 * Surfaces, OwnTracks-style:
 * - Tracking off  → persistent low-priority "tracking off" notification with
 *   a **Start tracking** action (posted on app start and boot, cancelled
 *   while tracking; controlled by the "Persistent status notification"
 *   setting).
 * - Tracking on   → the foreground service notification carries Pause/Stop.
 * - Paused        → a "Tracking paused" notification with Resume/Stop.
 * - Stopped       → back to the idle notification.
 */
class TrackingActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val store = TrackingConfigStore(context)
        when (intent.action) {
            ACTION_START -> {
                if (hasFineLocation(context)) {
                    store.isTracking = true
                    store.trackingDesired = true
                    cancelIdleNotification(context)
                    TrackingService.start(context)
                } else {
                    // Permission revoked while idle — the receiver can't show
                    // a dialog, so route through the app where the permission
                    // chain runs before the service starts.
                    launchApp(context)
                }
            }
            ACTION_PAUSE -> {
                store.isTracking = false
                store.trackingDesired = false
                TrackingService.stop(context)
                postPausedNotification(context)
            }
            ACTION_RESUME -> {
                if (hasFineLocation(context)) {
                    store.isTracking = true
                    store.trackingDesired = true
                    cancelPausedNotification(context)
                    TrackingService.start(context)
                } else {
                    launchApp(context)
                }
            }
            ACTION_STOP -> {
                store.isTracking = false
                store.trackingDesired = false
                TrackingService.stop(context)
                cancelPausedNotification(context)
                postIdleNotification(context)
            }
        }
    }

    private fun hasFineLocation(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun launchApp(context: Context) {
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(it)
        }
    }

    companion object {
        const val ACTION_START = "io.github.nimbleflux.wayli.gps.action.START"
        const val ACTION_PAUSE = "io.github.nimbleflux.wayli.gps.action.PAUSE"
        const val ACTION_RESUME = "io.github.nimbleflux.wayli.gps.action.RESUME"
        const val ACTION_STOP = "io.github.nimbleflux.wayli.gps.action.STOP"
        const val PAUSED_NOTIFICATION_ID = 2
        const val IDLE_NOTIFICATION_ID = 3
        private const val CHANNEL_ID = "wayli-tracking"
        private const val STATUS_CHANNEL_ID = "wayli-status"

        /** Broadcast PendingIntent for one of the toggle actions. */
        fun pendingIntent(context: Context, action: String): PendingIntent =
            PendingIntent.getBroadcast(
                context,
                action.hashCode(),
                Intent(context, TrackingActionReceiver::class.java).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        private fun canPostNotifications(context: Context): Boolean =
            Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED

        private fun launchContentIntent(context: Context): PendingIntent? {
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            return launchIntent?.let {
                PendingIntent.getActivity(
                    context,
                    0,
                    it,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }
        }

        private fun ensureChannel(manager: NotificationManager, id: String, name: String, description: String) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Channels persist once created; re-create defensively in case
                // the service never ran in this process.
                manager.createNotificationChannel(
                    NotificationChannel(id, name, NotificationManager.IMPORTANCE_LOW).apply {
                        this.description = description
                        setShowBadge(false)
                    },
                )
            }
        }

        /**
         * "Tracking paused" notification with Resume/Stop. Posted when the
         * service is stopped but the session is only paused, not ended.
         */
        fun postPausedNotification(context: Context) {
            if (!canPostNotifications(context)) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            ensureChannel(manager, CHANNEL_ID, "Wayli Tracking", "Location tracking is active")
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle("Wayli")
                .setContentText("Tracking paused")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(launchContentIntent(context))
                .addAction(0, "Resume", pendingIntent(context, ACTION_RESUME))
                .addAction(0, "Stop", pendingIntent(context, ACTION_STOP))
                .build()
            manager.notify(PAUSED_NOTIFICATION_ID, notification)
        }

        fun cancelPausedNotification(context: Context) {
            context.getSystemService(NotificationManager::class.java)?.cancel(PAUSED_NOTIFICATION_ID)
        }

        /**
         * Persistent "tracking off" notification with a Start action — the
         * always-available drawer toggle. No-op without POST_NOTIFICATIONS or
         * when the user disabled the persistent notification.
         */
        fun postIdleNotification(context: Context) {
            val store = TrackingConfigStore(context)
            if (!store.statusNotificationEnabled) return
            // Stale-true after a silent death must not mute the idle toggle.
            if (store.isTracking && TrackingService.running) return
            if (!canPostNotifications(context)) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            ensureChannel(manager, STATUS_CHANNEL_ID, "Wayli Status", "Tracking status and quick toggle")
            val notification = NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
                .setContentTitle("Wayli")
                .setContentText("Tracking is off — tap Start to record")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(launchContentIntent(context))
                .addAction(0, "Start tracking", pendingIntent(context, ACTION_START))
                .build()
            manager.notify(IDLE_NOTIFICATION_ID, notification)
        }

        fun cancelIdleNotification(context: Context) {
            context.getSystemService(NotificationManager::class.java)?.cancel(IDLE_NOTIFICATION_ID)
        }

        /**
         * Reconcile the drawer with the *actual* tracking state: clears a
         * stale "paused" notification left by a process death and re-posts the
         * idle toggle when tracking isn't active. Call on app start and boot.
         *
         * Liveness-aware on purpose: after a silent service death (crash or
         * kill skips onDestroy) [TrackingConfigStore.isTracking] stays
         * stale-true, and gating on it alone posted neither the foreground
         * notification (service dead) nor the idle toggle — the drawer went
         * mute about tracking entirely.
         */
        fun syncNotifications(context: Context) {
            val store = TrackingConfigStore(context)
            if (!store.isTracking || !TrackingService.running) {
                cancelPausedNotification(context)
                postIdleNotification(context)
            }
        }
    }
}
