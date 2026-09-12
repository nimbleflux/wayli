package io.github.nimbleflux.wayli.gps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Foreground service that keeps the process alive while the tracking
 * pipeline captures GPS points. The actual capture/queue/upload work lives
 * in [TrackingController] (implemented in the `:app` module); this service
 * is the foreground shell Android requires for background location.
 *
 * Usage:
 * ```
 * TrackingService.start(context) // begin tracking
 * TrackingService.stop(context)  // stop
 * ```
 */
@AndroidEntryPoint
class TrackingService : Service() {

    @Inject lateinit var controller: TrackingController

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var configStore: TrackingConfigStore

    override fun onCreate() {
        super.onCreate()
        running = true
        configStore = TrackingConfigStore(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Wayli tracking active")
        // A START_STICKY restart can land while the app is backgrounded, where
        // Android 12+/15 denies the foreground promotion (while-in-use rules).
        // Crashing there loop-kills the app — stop gracefully instead; the
        // user (or boot receiver / notification toggle) restarts tracking.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {
            stopSelf()
            return START_NOT_STICKY
        }
        configStore.isTracking = true
        // The persistent "tracking off" toggle is replaced by this FGS
        // notification; a stale paused notification is equally obsolete.
        TrackingActionReceiver.cancelIdleNotification(this)
        TrackingActionReceiver.cancelPausedNotification(this)
        controller.onServiceStarted()
        return START_STICKY // Restart if killed
    }

    override fun onDestroy() {
        controller.onServiceStopped()
        configStore.isTracking = false
        running = false
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Wayli Tracking",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Location tracking is active"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Wayli")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(contentIntent)
            // Quick toggles straight from the notification drawer.
            .addAction(0, "Pause", TrackingActionReceiver.pendingIntent(this, TrackingActionReceiver.ACTION_PAUSE))
            .addAction(0, "Stop", TrackingActionReceiver.pendingIntent(this, TrackingActionReceiver.ACTION_STOP))
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "wayli-tracking"
        private const val NOTIFICATION_ID = 1

        /**
         * Process-liveness of the foreground service. Deliberately not
         * persisted: [TrackingConfigStore.isTracking] can go stale (a crash
         * skips onDestroy), while this dies with the process and tells the
         * app-open auto-restart whether the service genuinely isn't running.
         */
        var running: Boolean = false
            private set

        fun start(context: Context) {
            val intent = Intent(context, TrackingService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, TrackingService::class.java)
            context.stopService(intent)
        }
    }
}
