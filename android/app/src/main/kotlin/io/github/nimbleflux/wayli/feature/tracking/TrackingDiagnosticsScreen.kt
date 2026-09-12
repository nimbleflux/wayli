package io.github.nimbleflux.wayli.feature.tracking

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.designsystem.WayliSectionCard
import io.github.nimbleflux.wayli.repo.EventLogEntry
import io.github.nimbleflux.wayli.repo.TrackingDiagnosticsRepository
import io.github.nimbleflux.wayli.repo.UploadLogEntry
import io.github.nimbleflux.wayli.repo.DeviceTokenRepository
import io.github.nimbleflux.wayli.session.DeviceTokenStore
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The full tracking-diagnostics log: lifecycle events (why tracking stopped
 * or restarted) and every upload attempt with full timestamps and detail.
 * The Tracking Settings page keeps only the summary; this is the deep dive.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackingDiagnosticsScreen(
    onBack: () -> Unit,
    viewModel: TrackingDiagnosticsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Tracking diagnostics") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        if (state.log.isEmpty() && state.events.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "No diagnostics yet — they appear once tracking\nhas captured and uploaded points.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                horizontal = 16.dp,
                vertical = 12.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                WayliSectionCard(title = "Status") {
                    DiagDetailRow("Queued for upload", "%,d".format(state.queued))
                    state.oldestQueuedAtMs?.takeIf { state.queued > 0 }?.let {
                        DiagDetailRow("Oldest queued", formatLogDateTime(it))
                    }
                    DiagDetailRow("Captured today / total", "%,d / %,d".format(state.capturedToday, state.capturedTotal))
                    if (state.droppedTotal > 0) {
                        DiagDetailRow("Dropped (failed uploads)", "%,d".format(state.droppedTotal))
                    }
                    DiagDetailRow("Points on server", state.serverPoints?.let { "%,d".format(it) } ?: "—")
                    DiagDetailRow("Last accepted by server", state.lastAcceptedAt?.let { formatLogDateTimeIso(it) } ?: "—")
                }
            }
            if (state.events.isNotEmpty()) {
                item { SectionHeader("Lifecycle events") }
                items(state.events.asReversed()) { entry ->
                    EventRow(entry)
                }
            }
            if (state.log.isNotEmpty()) {
                item { SectionHeader("Upload log") }
                items(state.log.asReversed()) { entry ->
                    UploadRow(entry)
                }
            }
            item { Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance())) }
        }
    }
}

@Composable
private fun DiagDetailRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun EventRow(entry: EventLogEntry) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(eventLabel(entry.kind), style = MaterialTheme.typography.bodyMedium)
            Text(
                formatLogDateTime(entry.atMs),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        entry.detail?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun UploadRow(entry: UploadLogEntry) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "${entry.outcome} · ${entry.batch} pts" + (entry.httpCode?.let { " · HTTP $it" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                formatLogDateTime(entry.atMs),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            buildString {
                append("via ${entry.trigger ?: "capture"}")
                entry.durationMs?.let { append(" · ${formatDuration(it)}") }
                append(" · queue ${entry.queuedAfter ?: "?"}")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val first = entry.firstPointAtMs
        val last = entry.lastPointAtMs
        if (first != null && last != null) {
            Text(
                "points ${formatLogDateTime(first)} → ${formatLogTime(last)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun eventLabel(kind: String): String = when (kind) {
    "auto_restart" -> "Tracking auto-restarted"
    "stationary_pause" -> "Paused on stationary"
    "stationary_resume" -> "Resumed after movement"
    "points_dropped" -> "Points dropped"
    "token_provisioned" -> "Upload credential provisioned"
    else -> kind
}

/** Full date + time — the point of this screen is to show *when*, exactly. */
private fun formatLogDateTime(atMs: Long): String =
    java.time.format.DateTimeFormatter.ofPattern("EEE d MMM, HH:mm:ss")
        .withZone(java.time.ZoneId.systemDefault())
        .format(java.time.Instant.ofEpochMilli(atMs))

private fun formatLogTime(atMs: Long): String =
    java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")
        .withZone(java.time.ZoneId.systemDefault())
        .format(java.time.Instant.ofEpochMilli(atMs))

private fun formatLogDateTimeIso(iso: String): String = runCatching {
    formatLogDateTime(java.time.Instant.parse(iso).toEpochMilli())
}.getOrDefault(iso)

private fun formatDuration(ms: Long): String =
    if (ms < 1000) "${ms} ms" else "%.1f s".format(ms / 1000.0)

@HiltViewModel
class TrackingDiagnosticsViewModel @Inject constructor(
    private val diagnosticsRepo: TrackingDiagnosticsRepository,
    private val deviceTokenRepo: DeviceTokenRepository,
    private val deviceTokenStore: DeviceTokenStore,
    private val client: FluxbaseClient,
) : ViewModel() {

    data class DiagnosticsDetail(
        val queued: Int = 0,
        val oldestQueuedAtMs: Long? = null,
        val capturedToday: Int = 0,
        val capturedTotal: Int = 0,
        val droppedTotal: Int = 0,
        val serverPoints: Long? = null,
        val lastAcceptedAt: String? = null,
        val log: List<UploadLogEntry> = emptyList(),
        val events: List<EventLogEntry> = emptyList(),
    )

    private val _state = MutableStateFlow(DiagnosticsDetail())
    val state: StateFlow<DiagnosticsDetail> = _state.asStateFlow()

    init {
        viewModelScope.launch(Dispatchers.IO) {
            diagnosticsRepo.observeQueueCount().collect { queued ->
                _state.value = _state.value.copy(queued = queued)
            }
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            _state.value = _state.value.copy(
                oldestQueuedAtMs = diagnosticsRepo.oldestQueuedAtMs(),
                capturedToday = diagnosticsRepo.capturedToday(),
                capturedTotal = diagnosticsRepo.capturedTotal(),
                droppedTotal = diagnosticsRepo.droppedTotal(),
                log = diagnosticsRepo.uploadLog(),
                events = diagnosticsRepo.eventLog(),
            )
            val userId = client.auth.currentSession?.user?.id ?: return@launch
            _state.value = _state.value.copy(
                serverPoints = diagnosticsRepo.serverPointCount(userId).getOrNull(),
                lastAcceptedAt = deviceTokenRepo.list().getOrNull()
                    ?.firstOrNull { it.id == deviceTokenStore.tokenId }?.lastUsedAt,
            )
        }
    }
}
