package io.github.nimbleflux.wayli

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.lifecycleScope
import dagger.hilt.android.AndroidEntryPoint
import io.github.nimbleflux.wayli.auth.OAuthDeepLinkBus
import io.github.nimbleflux.wayli.designsystem.ThemeManager
import io.github.nimbleflux.wayli.designsystem.WayliTheme
import io.github.nimbleflux.wayli.nav.WayliNavHost
import io.github.nimbleflux.wayli.gps.TrackingActionReceiver
import io.github.nimbleflux.wayli.util.QuickActionBus
import io.github.nimbleflux.wayli.util.copySharedImage
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var themeManager: ThemeManager

    @Inject
    lateinit var sessionRefresher: io.github.nimbleflux.wayli.session.SessionRefresher

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        OAuthDeepLinkBus.deliver(intent.data)
        handleQuickAction(intent)
    }

    override fun onStart() {
        super.onStart()
        // Reconcile the notification drawer with persisted tracking state:
        // clears a stale "paused" notification after a process death and
        // keeps the persistent tracking toggle posted while off.
        TrackingActionReceiver.syncNotifications(applicationContext)
        // Foreground revalidation: the in-process refresh timers don't tick
        // while the process is frozen/killed, so on return the access token
        // is usually expired — refresh now, before data requests race it.
        // No-op when the token is still fresh.
        lifecycleScope.launch(Dispatchers.IO) { sessionRefresher.refreshIfDue() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        OAuthDeepLinkBus.deliver(intent?.data)
        handleQuickAction(intent)
        setContent {
            // themeModeState is a MutableState — recomposes on theme change
            WayliTheme(themeMode = themeManager.themeModeState.value) {
                WayliNavHost()
            }
        }
    }

    /** Launcher shortcuts + share-target (text/images from other apps). */
    private fun handleQuickAction(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            ACTION_RECORD -> QuickActionBus.deliver(QuickActionBus.QuickAction.Record)
            ACTION_NEW_TRIP -> QuickActionBus.deliver(QuickActionBus.QuickAction.NewTrip)
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> handleSend(intent)
        }
    }

    private fun handleSend(intent: Intent) {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        val streams: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(extraStream(intent))
            else -> extraStreams(intent)
        }
        if (streams.isEmpty() && text.isNullOrBlank()) return
        if (streams.isEmpty()) {
            QuickActionBus.deliver(QuickActionBus.QuickAction.Shared(text, emptyList()))
            return
        }
        // Copy images right away — the share grant only covers this moment.
        lifecycleScope.launch(Dispatchers.IO) {
            val paths = streams.mapNotNull { copySharedImage(this@MainActivity, it) }
            QuickActionBus.deliver(QuickActionBus.QuickAction.Shared(text, paths))
        }
    }

    @Suppress("DEPRECATION")
    private fun extraStream(intent: Intent): Uri? =
        runCatching { intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) }.getOrNull()

    @Suppress("DEPRECATION")
    private fun extraStreams(intent: Intent): List<Uri> =
        runCatching {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty().filterNotNull()
        }.getOrDefault(emptyList())

    companion object {
        const val ACTION_RECORD = "io.github.nimbleflux.wayli.RECORD"
        const val ACTION_NEW_TRIP = "io.github.nimbleflux.wayli.NEW_TRIP"
    }
}
