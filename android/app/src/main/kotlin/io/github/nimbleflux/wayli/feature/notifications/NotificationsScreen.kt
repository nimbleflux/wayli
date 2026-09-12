package io.github.nimbleflux.wayli.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Luggage
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.demo.DemoData
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.models.Notification
import io.github.nimbleflux.wayli.repo.NotificationRepository
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val demoManager: DemoManager,
    private val client: FluxbaseClient,
    private val repo: NotificationRepository,
) : ViewModel() {

    private val _notifications = MutableStateFlow<List<Notification>>(emptyList())
    val notifications: StateFlow<List<Notification>> = _notifications.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    val isDemoMode: Boolean = demoManager.isDemoMode

    init {
        if (isDemoMode) {
            _notifications.value = DemoData.notifications
            _loading.value = false
        } else {
            load()
        }
    }

    fun load() {
        if (isDemoMode) return
        val userId = client.auth.currentSession?.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            _loading.value = true
            _notifications.value = repo.list(userId).getOrDefault(emptyList())
            _loading.value = false
        }
    }

    fun markRead(notification: Notification) {
        if (isDemoMode) {
            _notifications.value = _notifications.value.map {
                if (it.id == notification.id) it.copy(readAt = "now") else it
            }
            return
        }
        val userId = client.auth.currentSession?.user?.id ?: return
        val now = java.time.Instant.now().toString()
        _notifications.value = _notifications.value.map {
            if (it.id == notification.id) it.copy(readAt = now) else it
        }
        viewModelScope.launch(Dispatchers.IO) {
            repo.markRead(userId, notification.id).onFailure {
                // The write didn't land (cancelled on back, offline, auth) —
                // revert so the list doesn't lie about the server state.
                _notifications.value = _notifications.value.map {
                    if (it.id == notification.id) it.copy(readAt = null) else it
                }
            }
        }
    }

    fun markAllRead() {
        if (isDemoMode) {
            _notifications.value = _notifications.value.map { it.copy(readAt = "now") }
            return
        }
        val userId = client.auth.currentSession?.user?.id ?: return
        val now = java.time.Instant.now().toString()
        _notifications.value = _notifications.value.map { it.copy(readAt = now) }
        viewModelScope.launch(Dispatchers.IO) {
            repo.markAllRead(userId).onFailure {
                _notifications.value = _notifications.value.map { it.copy(readAt = null) }
            }
        }
    }
}

/** Notification center: unread items highlighted, tap to read, bulk mark-read. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    onBack: () -> Unit = {},
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val notifications by viewModel.notifications.collectAsState()
    val unreadCount = notifications.count { it.readAt == null }

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Notifications") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (unreadCount > 0) {
                        IconButton(onClick = { viewModel.markAllRead() }) {
                            Icon(Icons.Filled.DoneAll, contentDescription = "Mark all read")
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (notifications.isEmpty() && !viewModel.isDemoMode) {
            io.github.nimbleflux.wayli.designsystem.EmptyState(
                emoji = "🔔",
                title = "No notifications",
                subtitle = "Job results and friend activity will show up here",
                modifier = Modifier.padding(padding),
            )
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(notifications, key = { it.id }) { notification ->
                NotificationCard(
                    notification = notification,
                    onClick = { viewModel.markRead(notification) },
                )
            }
            item {
                Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
            }
        }
    }
}

@Composable
private fun NotificationCard(notification: Notification, onClick: () -> Unit) {
    val unread = notification.readAt == null
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = MaterialTheme.shapes.medium,
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (unread) {
                MaterialTheme.colorScheme.primary.copy(alpha = 0.06f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
            ) {
                Icon(
                    iconForNotification(notification.type),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(8.dp).size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    notification.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium,
                )
                notification.body?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                    )
                }
                Text(
                    notification.createdAt.take(10),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (unread) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
                )
            }
        }
    }
}

private fun iconForNotification(type: String): ImageVector = when (type) {
    "friend_request", "friend_accept" -> Icons.Filled.Group
    "comment" -> Icons.AutoMirrored.Filled.Chat
    "trip_suggestion", "trip_detected" -> Icons.Filled.Luggage
    else -> Icons.Filled.Notifications
}
