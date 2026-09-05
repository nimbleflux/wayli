package io.github.nimbleflux.wayli.feature.tracking

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.designsystem.SliderRow
import io.github.nimbleflux.wayli.designsystem.SwitchRow
import io.github.nimbleflux.wayli.designsystem.WayliSectionCard
import io.github.nimbleflux.wayli.gps.AccuracyProfile
import io.github.nimbleflux.wayli.gps.TrackingConfig
import io.github.nimbleflux.wayli.gps.TrackingConfigStore
import io.github.nimbleflux.wayli.gps.TrackingMode
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Tracking settings — mobile-native design with segmented buttons, sliders,
 * switches, and text fields. All values persist to [TrackingConfigStore]
 * immediately on change.
 *
 * Organized into cards:
 * - Mode (Move/Places/Manual)
 * - Update Frequency (interval + distance sliders)
 * - Accuracy (radio buttons)
 * - Battery Optimization (threshold, stationary pause/resume, charging)
 * - Locator (displacement, interval, ignore inaccurate — OwnTracks locator)
 * - Data Payload (altitude, heading, speed, battery)
 * - Identity (device ID)
 * - System (start on boot)
 * - Data & sync (credential/queue diagnostics, manual submit, sync now)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackingSettingsScreen(
    onBack: () -> Unit,
    viewModel: TrackingSettingsViewModel = hiltViewModel(),
) {
    val config = viewModel.config

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Tracking Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(8.dp))

            // Tracking mode
            WayliSectionCard(title = "Mode") {
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    TrackingMode.entries.forEachIndexed { index, m ->
                        SegmentedButton(
                            selected = config.mode == m,
                            onClick = { viewModel.update(config.copy(mode = m)) },
                            shape = SegmentedButtonDefaults.itemShape(index, TrackingMode.entries.size),
                        ) {
                            Text(when (m) {
                                TrackingMode.MOVE -> "Move"
                                TrackingMode.SIGNIFICANT -> "Places"
                                TrackingMode.MANUAL -> "Manual"
                            })
                        }
                    }
                }
            }

            // Frequency settings
            WayliSectionCard(title = "Update Frequency") {
                SliderRow(
                    label = "Min interval",
                    value = config.minIntervalSec.toFloat(),
                    range = 1f..3600f,
                    valueText = formatInterval(config.minIntervalSec),
                ) { viewModel.update(config.copy(minIntervalSec = it.toLong())) }

                Spacer(Modifier.height(8.dp))

                SliderRow(
                    label = "Min distance",
                    value = config.minDistanceM,
                    range = 0f..5000f,
                    valueText = "${config.minDistanceM.toInt()} m",
                ) { viewModel.update(config.copy(minDistanceM = it)) }
            }

            // Accuracy
            WayliSectionCard(title = "Accuracy") {
                AccuracyProfile.entries.forEach { profile ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.material3.RadioButton(
                            selected = config.accuracy == profile,
                            onClick = { viewModel.update(config.copy(accuracy = profile)) },
                        )
                        Text(profile.label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            // Battery optimization
            WayliSectionCard(title = "Battery Optimization") {
                SliderRow(
                    label = "Pause below battery",
                    value = config.batteryStopThreshold.toFloat(),
                    range = 0f..50f,
                    valueText = "${config.batteryStopThreshold}%",
                ) { viewModel.update(config.copy(batteryStopThreshold = it.toInt())) }

                Spacer(Modifier.height(8.dp))

                SliderRow(
                    label = "Stationary pause",
                    value = config.stationaryPauseMin.toFloat(),
                    range = 0f..60f,
                    valueText = if (config.stationaryPauseMin == 0L) "Off" else "${config.stationaryPauseMin} min",
                ) { viewModel.update(config.copy(stationaryPauseMin = it.toLong())) }

                Spacer(Modifier.height(8.dp))

                SliderRow(
                    label = "Resume radius",
                    value = config.stationaryResumeRadiusM,
                    range = 10f..1000f,
                    valueText = "${config.stationaryResumeRadiusM.toInt()} m",
                ) { viewModel.update(config.copy(stationaryResumeRadiusM = it)) }

                SwitchRow(
                    label = "Only while charging",
                    checked = config.onlyWhileCharging,
                ) { viewModel.update(config.copy(onlyWhileCharging = it)) }
            }

            // Locator (OwnTracks locator settings)
            WayliSectionCard(title = "Locator") {
                SliderRow(
                    label = "Locator displacement",
                    value = config.locatorDisplacementM,
                    range = 0f..5000f,
                    valueText = if (config.locatorDisplacementM == 0f) "Off" else "${config.locatorDisplacementM.toInt()} m",
                ) { viewModel.update(config.copy(locatorDisplacementM = it)) }

                Spacer(Modifier.height(8.dp))

                SliderRow(
                    label = "Locator interval",
                    value = config.locatorIntervalSec.toFloat(),
                    range = 0f..3600f,
                    valueText = if (config.locatorIntervalSec == 0L) "Off" else formatInterval(config.locatorIntervalSec),
                ) { viewModel.update(config.copy(locatorIntervalSec = it.toLong())) }

                SwitchRow(
                    label = "Ignore inaccurate readings (>100m)",
                    checked = config.ignoreInaccurate,
                ) { viewModel.update(config.copy(ignoreInaccurate = it)) }
            }

            // Data payload
            WayliSectionCard(title = "Data Payload") {
                SwitchRow(label = "Altitude", checked = config.payloadAltitude) { viewModel.update(config.copy(payloadAltitude = it)) }
                SwitchRow(label = "Heading", checked = config.payloadHeading) { viewModel.update(config.copy(payloadHeading = it)) }
                SwitchRow(label = "Speed", checked = config.payloadSpeed) { viewModel.update(config.copy(payloadSpeed = it)) }
                SwitchRow(label = "Battery level", checked = config.payloadBattery) { viewModel.update(config.copy(payloadBattery = it)) }
            }

            // Identity
            WayliSectionCard(title = "Identity") {
                OutlinedTextField(
                    value = config.deviceId,
                    onValueChange = { viewModel.update(config.copy(deviceId = it)) },
                    label = { Text("Device ID") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                )
            }

            // System
            val context = androidx.compose.ui.platform.LocalContext.current
            WayliSectionCard(title = "System") {
                SwitchRow(label = "Start on boot", checked = config.startOnBoot) { viewModel.update(config.copy(startOnBoot = it)) }
                SwitchRow(
                    label = "Persistent status notification",
                    checked = viewModel.statusNotification,
                ) { enabled ->
                    viewModel.updateStatusNotification(enabled)
                    if (enabled) {
                        io.github.nimbleflux.wayli.gps.TrackingActionReceiver.syncNotifications(context)
                    } else {
                        io.github.nimbleflux.wayli.gps.TrackingActionReceiver.cancelIdleNotification(context)
                    }
                }
            }

            // Data & sync — is tracking data flowing, and where is it stuck?
            DataSyncCard(
                diag = viewModel.diagnostics,
                manualSubmit = viewModel.manualSubmit,
                onManualSubmit = { viewModel.submitManualLocation() },
                onClearManualMessage = { viewModel.clearManualSubmitMessage() },
                onSyncNow = { viewModel.syncNow() },
            )

            Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
        }
    }
}

@Composable
private fun DataSyncCard(
    diag: TrackingSettingsViewModel.Diagnostics,
    manualSubmit: TrackingSettingsViewModel.ManualSubmit,
    onManualSubmit: () -> Unit,
    onClearManualMessage: () -> Unit,
    onSyncNow: () -> Unit,
) {
    WayliSectionCard(title = "Data & sync") {
        DiagRow("Points on server", diag.serverPoints?.let { "%,d".format(it) } ?: "—")
        DiagRow(
            "Queued for upload",
            buildString {
                append("%,d".format(diag.queued))
                diag.oldestQueuedAtMs?.takeIf { diag.queued > 0 }?.let { append(" · oldest ${ageLabel(it)}") }
            },
        )
        DiagRow("Captured today", "%,d".format(diag.capturedToday))
        DiagRow("Captured (total)", "%,d".format(diag.capturedTotal))
        if (diag.droppedTotal > 0) {
            DiagRow("Dropped (failed uploads)", "%,d".format(diag.droppedTotal))
        }
        DiagRow("Upload credential", diag.credential)
        DiagRow("Upload", diag.uploadState)
        DiagRow(
            "Last accepted by server",
            diag.lastAcceptedAt?.let { formatTimestamp(it) } ?: "—",
        )
        // Log is stored oldest→newest — "Last upload" is the newest entry.
        diag.log.lastOrNull()?.let { last ->
            DiagRow(
                "Last upload",
                "${last.outcome} · ${last.batch} pts" + (last.httpCode?.let { " · HTTP $it" } ?: ""),
            )
        }

        Spacer(Modifier.height(8.dp))

        ManualSubmitButton(
            inProgress = manualSubmit.inProgress,
            message = manualSubmit.message,
            onSubmit = onManualSubmit,
            onDismissMessage = onClearManualMessage,
        )

        Spacer(Modifier.height(8.dp))

        androidx.compose.material3.OutlinedButton(
            onClick = onSyncNow,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Sync now") }

        RecentUploads(diag.log)
    }
}

@Composable
private fun ManualSubmitButton(
    inProgress: Boolean,
    message: String?,
    onSubmit: () -> Unit,
    onDismissMessage: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var requestPermission by remember { mutableStateOf(false) }
    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) onSubmit()
    }
    androidx.compose.material3.Button(
        onClick = {
            val fine = androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.ACCESS_FINE_LOCATION,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            val coarse = androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            if (fine || coarse) onSubmit() else requestPermission = true
        },
        enabled = !inProgress,
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (inProgress) "Locating…" else "Submit current location") }

    if (inProgress) {
        Spacer(Modifier.height(6.dp))
        androidx.compose.material3.LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }

    androidx.compose.runtime.LaunchedEffect(requestPermission) {
        if (requestPermission) {
            permissionLauncher.launch(android.Manifest.permission.ACCESS_FINE_LOCATION)
            requestPermission = false
        }
    }

    // Status auto-dismisses — a lingering "queued for upload" line is noise.
    androidx.compose.runtime.LaunchedEffect(message) {
        if (message != null) {
            kotlinx.coroutines.delay(6_000)
            onDismissMessage()
        }
    }
    message?.let { text ->
        Spacer(Modifier.height(6.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RecentUploads(log: List<io.github.nimbleflux.wayli.repo.UploadLogEntry>) {
    if (log.size <= 1) return
    Spacer(Modifier.height(12.dp))
    Text(
        "Recent uploads",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    // Newest first — matches "Last upload".
    log.takeLast(5).reversed().forEach { entry ->
        Text(
            "${formatLogTime(entry.atMs)} · ${entry.outcome}" +
                (entry.httpCode?.let { " · HTTP $it" } ?: "") +
                " · ${entry.batch} pts",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun DiagRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun ageLabel(fromMs: Long): String {
    val minutes = (System.currentTimeMillis() - fromMs) / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "${minutes}min ago"
        minutes < 1440 -> "${minutes / 60}h ago"
        else -> "${minutes / 1440}d ago"
    }
}

private fun formatLogTime(atMs: Long): String =
    java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date(atMs))

private fun formatTimestamp(iso: String): String = runCatching {
    java.time.format.DateTimeFormatter.ofPattern("MMM d, HH:mm", java.util.Locale.getDefault())
        .withZone(java.time.ZoneId.systemDefault())
        .format(java.time.Instant.parse(iso))
}.getOrDefault(iso)

@HiltViewModel
class TrackingSettingsViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val appContext: android.content.Context,
    private val store: TrackingConfigStore,
    private val controller: io.github.nimbleflux.wayli.gps.TrackingController,
    private val diagnosticsRepo: io.github.nimbleflux.wayli.repo.TrackingDiagnosticsRepository,
    private val deviceTokenRepo: io.github.nimbleflux.wayli.repo.DeviceTokenRepository,
    private val deviceTokenStore: io.github.nimbleflux.wayli.session.DeviceTokenStore,
    private val client: FluxbaseClient,
) : ViewModel() {
    var config by mutableStateOf(store.get())
        private set

    var statusNotification by mutableStateOf(store.statusNotificationEnabled)
        private set

    /** Tracking data diagnostics for the "Data & sync" card. */
    data class Diagnostics(
        val queued: Int = 0,
        val oldestQueuedAtMs: Long? = null,
        val capturedToday: Int = 0,
        val capturedTotal: Int = 0,
        val droppedTotal: Int = 0,
        val serverPoints: Long? = null,
        val lastAcceptedAt: String? = null,
        val credential: String = "checking…",
        val uploadState: String = "idle",
        val log: List<io.github.nimbleflux.wayli.repo.UploadLogEntry> = emptyList(),
    )

    var diagnostics by mutableStateOf(Diagnostics())
        private set

    init {
        viewModelScope.launch(Dispatchers.IO) {
            // Live queue depth — updates on screen as points are captured/uploaded.
            diagnosticsRepo.observeQueueCount().collect { queued ->
                diagnostics = diagnostics.copy(queued = queued)
            }
        }
        viewModelScope.launch {
            // Live upload-worker state so "Sync now" has a visible effect.
            androidx.work.WorkManager.getInstance(appContext)
                .getWorkInfosForUniqueWorkFlow(io.github.nimbleflux.wayli.tracking.GpsUploadWorker.UNIQUE_NAME)
                .collect { infos ->
                    diagnostics = diagnostics.copy(
                        uploadState = when (infos.firstOrNull()?.state) {
                            androidx.work.WorkInfo.State.RUNNING -> "running…"
                            androidx.work.WorkInfo.State.ENQUEUED -> "queued"
                            androidx.work.WorkInfo.State.FAILED -> "failed"
                            else -> "idle"
                        },
                    )
                }
        }
        refreshDiagnostics()
    }

    /** Local counters instantly; server-side numbers best-effort (network). */
    fun refreshDiagnostics() {
        viewModelScope.launch(Dispatchers.IO) {
            diagnostics = diagnostics.copy(
                oldestQueuedAtMs = diagnosticsRepo.oldestQueuedAtMs(),
                capturedToday = diagnosticsRepo.capturedToday(),
                capturedTotal = diagnosticsRepo.capturedTotal(),
                droppedTotal = diagnosticsRepo.droppedTotal(),
                log = diagnosticsRepo.uploadLog(),
                credential = credentialStatus(),
            )
            val userId = client.auth.currentSession?.user?.id ?: return@launch
            diagnostics = diagnostics.copy(
                serverPoints = diagnosticsRepo.serverPointCount(userId).getOrNull(),
                lastAcceptedAt = deviceTokenRepo.list().getOrNull()
                    ?.firstOrNull { it.id == deviceTokenStore.tokenId }?.lastUsedAt,
            )
        }
    }

    /** Local credential state, cross-checked against the server when possible. */
    private suspend fun credentialStatus(): String {
        if (!deviceTokenStore.isActive) return "missing"
        val rows = deviceTokenRepo.list().getOrNull() ?: return "active"
        val known = deviceTokenStore.tokenId != null &&
            rows.any { it.id == deviceTokenStore.tokenId && !it.isRevoked }
        return if (known) "active" else "orphaned — sync re-provisions"
    }

    /** Heal the credential if orphaned, then force an upload attempt. */
    fun syncNow() {
        viewModelScope.launch(Dispatchers.IO) {
            val repair = deviceTokenRepo.repairIfOrphaned(android.os.Build.MODEL)
            if (repair.status == io.github.nimbleflux.wayli.repo.DeviceTokenRepository.TokenRepair.OFFLINE) {
                android.util.Log.e("WayliTokens", "device token provision failed: ${repair.error}")
            }
            controller.syncNow()
            kotlinx.coroutines.delay(2_000)
            refreshDiagnostics()
        }
    }

    /** Manual "submit one location" attempt, shown inline in the card. */
    data class ManualSubmit(val inProgress: Boolean = false, val message: String? = null)

    var manualSubmit by mutableStateOf(ManualSubmit())
        private set

    fun submitManualLocation() {
        if (manualSubmit.inProgress) return
        manualSubmit = ManualSubmit(inProgress = true)
        viewModelScope.launch(Dispatchers.IO) {
            val startedAt = System.currentTimeMillis()
            val result = controller.submitManualLocation()
            result.fold(
                onSuccess = { point ->
                    manualSubmit = ManualSubmit(
                        inProgress = false,
                        message = "Location captured (%.5f, %.5f) — queued for upload"
                            .format(point.lat, point.lon),
                    )
                    // The upload log is the in-app submission log: poll it
                    // briefly so this button reports its own outcome.
                    var outcome: String? = null
                    val deadline = System.currentTimeMillis() + 20_000
                    while (System.currentTimeMillis() < deadline && outcome == null) {
                        delay(2_000)
                        outcome = diagnosticsRepo.uploadLog()
                            .lastOrNull { it.atMs >= startedAt }
                            ?.let { entry ->
                                "Upload ${entry.outcome}" +
                                    (entry.httpCode?.let { " · HTTP ${it}" } ?: "") +
                                    " · ${entry.batch} pts"
                            }
                    }
                    manualSubmit = ManualSubmit(
                        inProgress = false,
                        message = outcome ?: "Queued — upload will retry automatically",
                    )
                },
                onFailure = {
                    manualSubmit = ManualSubmit(
                        inProgress = false,
                        message = it.message ?: "Couldn't get a GPS fix",
                    )
                },
            )
            refreshDiagnostics()
        }
    }

    /** Auto-dismiss callback target for the manual-submit status line. */
    fun clearManualSubmitMessage() {
        manualSubmit = ManualSubmit()
    }

    fun update(newConfig: TrackingConfig) {
        config = newConfig
        store.set(newConfig)
    }

    fun updateStatusNotification(enabled: Boolean) {
        statusNotification = enabled
        store.statusNotificationEnabled = enabled
    }
}

private fun formatInterval(seconds: Long): String = when {
    seconds < 60 -> "${seconds}s"
    seconds < 3600 -> "${seconds / 60}min"
    else -> "${seconds / 3600}h ${(seconds % 3600) / 60}min"
}
