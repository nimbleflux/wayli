package io.github.nimbleflux.wayli.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.designsystem.WayliSectionCard
import io.github.nimbleflux.wayli.repo.DeviceToken
import io.github.nimbleflux.wayli.repo.DeviceTokenRepository
import io.github.nimbleflux.wayli.repo.SecretsRepository
import io.github.nimbleflux.wayli.session.DeviceTokenStore
import io.github.nimbleflux.wayli.session.InstanceManager
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.security.SecureRandom

private const val OWNTRACKS_KEY = "owntracks_api_key"
private const val PEXELS_KEY = "pexels_api_key"

@HiltViewModel
class ConnectionsViewModel @Inject constructor(
    private val secretsRepo: SecretsRepository,
    private val deviceTokenRepo: DeviceTokenRepository,
    private val deviceTokenStore: DeviceTokenStore,
    private val instanceManager: InstanceManager,
    private val demoManager: DemoManager,
    private val client: FluxbaseClient,
    private val immichRepo: io.github.nimbleflux.wayli.repo.ImmichRepository,
) : ViewModel() {

    val isDemo: Boolean get() = demoManager.isDemoMode
    val baseUrl: String? get() = instanceManager.getConfig()?.url
    val userId: String? get() = client.auth.currentUser?.id

    /** Immich connection status for the read-only Connections card (#13). */
    data class ImmichStatus(
        val enabled: Boolean,
        val keyConfigured: Boolean,
        val lastSyncAt: String?,
    )

    suspend fun immichStatus(userId: String): ImmichStatus {
        val settings = immichRepo.settings(userId)
        return ImmichStatus(
            enabled = settings?.enabled == true,
            keyConfigured = runCatching { immichRepo.hasApiKey() }.getOrDefault(false),
            lastSyncAt = settings?.lastSyncAt,
        )
    }

    sealed class UiState {
        object Loading : UiState()
        data class Loaded(
            val owntracksSet: Boolean,
            val owntracksUpdatedAt: String?,
            val pexelsSet: Boolean,
            val pexelsUpdatedAt: String?,
        ) : UiState()
        data class Error(val message: String) : UiState()
    }

    private val _state = MutableStateFlow<UiState>(UiState.Loading)
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val _generatedKey = MutableStateFlow<String?>(null)
    val generatedKey: StateFlow<String?> = _generatedKey.asStateFlow()

    private val _deviceTokens = MutableStateFlow<List<DeviceToken>>(emptyList())
    val deviceTokens: StateFlow<List<DeviceToken>> = _deviceTokens.asStateFlow()

    private val _activeTokenLabel = MutableStateFlow<String?>(null)
    val activeTokenLabel: StateFlow<String?> = _activeTokenLabel.asStateFlow()

    private val _createdToken = MutableStateFlow<String?>(null)
    val createdToken: StateFlow<String?> = _createdToken.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init { refresh() }

    /** Device-token listing failure (shown with a retry + the real message). */
    private val _tokensError = MutableStateFlow<String?>(null)
    val tokensError: StateFlow<String?> = _tokensError.asStateFlow()

    fun loadDeviceTokens() {
        if (isDemo) return
        viewModelScope.launch(Dispatchers.IO) {
            deviceTokenRepo.list()
                .onSuccess {
                    _deviceTokens.value = it
                    _tokensError.value = null
                }
                .onFailure { _tokensError.value = it.message ?: "Network error" }
            _activeTokenLabel.value = deviceTokenStore.label
        }
    }

    /** Registers a device token for this device; the plaintext is returned once. */
    fun createDeviceToken(label: String) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            deviceTokenRepo.create(label)
                .onSuccess { token -> _createdToken.value = token }
                .onFailure { _tokensError.value = "Couldn't create token: ${it.message ?: "network error"}" }
            loadDeviceTokens()
            _busy.value = false
        }
    }

    fun revokeDeviceToken(id: String) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            deviceTokenRepo.revoke(id)
                .onFailure { _tokensError.value = "Couldn't revoke token: ${it.message ?: "network error"}" }
            loadDeviceTokens()
            _busy.value = false
        }
    }

    fun clearCreatedToken() { _createdToken.value = null }

    fun refresh() {
        if (isDemo) { _state.value = UiState.Loaded(true, null, false, null); return }
        viewModelScope.launch(Dispatchers.IO) {
            val result = secretsRepo.listSecrets()
            result.fold(
                onSuccess = { list ->
                    val ot = list.firstOrNull { it.key == OWNTRACKS_KEY }
                    val px = list.firstOrNull { it.key == PEXELS_KEY }
                    _state.value = UiState.Loaded(
                        owntracksSet = ot != null,
                        owntracksUpdatedAt = ot?.updatedAt,
                        pexelsSet = px != null,
                        pexelsUpdatedAt = px?.updatedAt,
                    )
                },
                onFailure = { _state.value = UiState.Error(it.message ?: "Failed to load") },
            )
        }
    }

    fun endpointFor(key: String): String {
        val base = baseUrl?.trimEnd('/') ?: ""
        val uid = userId ?: ""
        return "$base/api/v1/functions/owntracks-points/invoke?namespace=wayli&api_key=$key&user_id=$uid"
    }

    fun generateOwnTracksKey() {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            val key = randomHex(16)
            secretsRepo.setSecret(OWNTRACKS_KEY, key, "OwnTracks integration API key")
                .onSuccess { _generatedKey.value = key; refresh() }
            _busy.value = false
        }
    }

    fun savePexelsKey(value: String) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            secretsRepo.setSecret(PEXELS_KEY, value.trim(), "Pexels API key for trip images")
            refresh()
            _busy.value = false
        }
    }

    fun deletePexelsKey() {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            secretsRepo.deleteSecret(PEXELS_KEY)
            refresh()
            _busy.value = false
        }
    }

    fun clearGenerated() { _generatedKey.value = null }

    private fun randomHex(bytes: Int): String {
        val out = ByteArray(bytes)
        SecureRandom().nextBytes(out)
        return out.joinToString("") { "%02x".format(it) }
    }
}

@Composable
fun ConnectionsScreen(
    onBack: () -> Unit,
    viewModel: ConnectionsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val generated by viewModel.generatedKey.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val deviceTokens by viewModel.deviceTokens.collectAsState()
    val tokensError by viewModel.tokensError.collectAsState()
    val activeTokenLabel by viewModel.activeTokenLabel.collectAsState()
    val createdToken by viewModel.createdToken.collectAsState()
    val clipboard = LocalClipboardManager.current

    var pexelsInput by remember { mutableStateOf("") }
    var showPexelsField by remember { mutableStateOf(false) }

    // Immich photos (#13) — read-only here: the connection (URL + API key)
    // is managed in the Wayli web app.
    var immichEnabled by remember { mutableStateOf(false) }
    var immichKeyConfigured by remember { mutableStateOf(false) }
    var immichLastSync by remember { mutableStateOf<String?>(null) }
    var showAddDevice by remember { mutableStateOf(false) }
    var deviceLabel by remember { mutableStateOf("") }

    androidx.compose.runtime.LaunchedEffect(Unit) {
        viewModel.loadDeviceTokens()
        val uid = viewModel.userId
        if (uid != null) {
            try {
                val status = viewModel.immichStatus(uid)
                immichEnabled = status.enabled
                immichKeyConfigured = status.keyConfigured
                immichLastSync = status.lastSyncAt
            } catch (err: Exception) {
                // Status read is best-effort; the card simply shows defaults.
            }
        }
    }

    SubScreenScaffold(title = "Connections & Integrations", onBack = onBack) {
        WayliSectionCard(title = "Devices (GPS tracking)") {
            Text(
                "This app submits location points with a scoped device token — it can only post GPS data, nothing else. The token never appears in URLs.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            ProfileCard(
                title = "This device",
                value = if (activeTokenLabel != null) "Active · ${activeTokenLabel}" else "No token",
                subtitle = if (activeTokenLabel != null) "Points will be submitted automatically while tracking" else "Create a token to enable point submission",
            )
            Spacer(Modifier.height(8.dp))

            val active = deviceTokens.filter { !it.isRevoked }
            if (active.isNotEmpty()) {
                active.forEach { token ->
                    ProfileCard(
                        title = token.label,
                        value = "Active",
                        subtitle = buildString {
                            token.createdAt?.let { append("Created $it") }
                            token.lastUsedAt?.let { if (isNotEmpty()) append(" · "); append("Last used $it") }
                        }.ifBlank { null },
                    )
                    Spacer(Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = { viewModel.revokeDeviceToken(token.id) },
                        enabled = !viewModel.isDemo && !busy,
                        modifier = Modifier.fillMaxWidth().height(40.dp),
                    ) { Text("Revoke") }
                    Spacer(Modifier.height(8.dp))
                }
            } else if (!viewModel.isDemo && tokensError != null) {
                Text(
                    "Couldn't load device tokens: $tokensError",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                androidx.compose.material3.TextButton(onClick = { viewModel.loadDeviceTokens() }) {
                    Text("Retry")
                }
            } else if (!viewModel.isDemo && state is ConnectionsViewModel.UiState.Loaded) {
                Text(
                    "No device tokens yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
            }

            Button(
                onClick = { showAddDevice = true },
                enabled = !viewModel.isDemo && !busy,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text(if (activeTokenLabel != null) "Replace token" else "Create token") }
            if (viewModel.isDemo) DemoNote()
        }

        Spacer(Modifier.height(8.dp))

        WayliSectionCard(title = "OwnTracks (external devices)") {
            Text(
                "Connect an OwnTracks device to feed location points into Wayli. Generate a private API key and point your device at the endpoint shown after creation.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            when (val s = state) {
                is ConnectionsViewModel.UiState.Loading ->
                    ProfileCard("API key", "Loading…")
                is ConnectionsViewModel.UiState.Error ->
                    ProfileCard("API key", "Not loaded", s.message)
                is ConnectionsViewModel.UiState.Loaded -> {
                    ProfileCard(
                        title = "API key",
                        value = if (s.owntracksSet) "Configured" else "Not configured",
                        subtitle = s.owntracksUpdatedAt?.let { "Updated $it" },
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { viewModel.generateOwnTracksKey() },
                        enabled = !viewModel.isDemo && !busy,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(if (s.owntracksSet) "Regenerate key" else "Generate key") }
                }
            }
            if (viewModel.isDemo) DemoNote()
        }

        Spacer(Modifier.height(8.dp))

        WayliSectionCard(title = "Trip images (Pexels)") {
            Text(
                "Add your own Pexels API key to source trip cover images. The key is stored encrypted and never shown again after saving.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            when (val s = state) {
                is ConnectionsViewModel.UiState.Loaded -> {
                    ProfileCard(
                        title = "Pexels API key",
                        value = if (s.pexelsSet) "Configured" else "Not configured",
                        subtitle = s.pexelsUpdatedAt?.let { "Updated $it" },
                    )
                    Spacer(Modifier.height(8.dp))
                    if (showPexelsField) {
                        OutlinedTextField(
                            value = pexelsInput,
                            onValueChange = { pexelsInput = it },
                            label = { Text("Pexels API key") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = {
                                viewModel.savePexelsKey(pexelsInput)
                                pexelsInput = ""
                                showPexelsField = false
                            },
                            enabled = pexelsInput.isNotBlank() && !viewModel.isDemo && !busy,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) { Text("Save key") }
                    } else {
                        Button(
                            onClick = { showPexelsField = true },
                            enabled = !viewModel.isDemo && !busy,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) { Text(if (s.pexelsSet) "Replace key" else "Add key") }
                    }
                    if (s.pexelsSet) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { viewModel.deletePexelsKey() },
                            enabled = !viewModel.isDemo && !busy,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) { Text("Remove key") }
                    }
                }
                is ConnectionsViewModel.UiState.Loading -> ProfileCard("Pexels API key", "Loading…")
                is ConnectionsViewModel.UiState.Error -> ProfileCard("Pexels API key", "Not loaded")
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "Per-user rate limit isn't available in the Android app yet.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    WayliSectionCard(title = "Immich Photos") {
        if (!immichEnabled && !immichKeyConfigured) {
            Text(
                "Not connected. Connect your Immich instance in the Wayli web app to show your geotagged photos on the map and timeline.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            ProfileCard(
                title = "Connection",
                value = if (immichEnabled) "Enabled" else "Disabled",
                subtitle = "Managed in the Wayli web app (Connections → Immich)",
            )
            Spacer(Modifier.height(8.dp))
            ProfileCard(
                title = "API key",
                value = if (immichKeyConfigured) "Configured" else "Not configured",
                subtitle = null,
            )
            if (immichLastSync != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Last photo sync: ${immichLastSync}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "Photos are display-only — they never become tracking points.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (generated != null) {
        GeneratedKeyDialog(
            key = generated!!,
            endpoint = viewModel.endpointFor(generated!!),
            clipboard = clipboard,
            onDismiss = { viewModel.clearGenerated() },
        )
    }

    if (showAddDevice) {
        AlertDialog(
            onDismissRequest = { showAddDevice = false },
            title = { Text("Add device token") },
            text = {
                Column {
                    Text(
                        "A GPS-scoped token will be generated on this device. It can only submit location points.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = deviceLabel,
                        onValueChange = { deviceLabel = it },
                        label = { Text("Label (e.g. Pixel 8)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.createDeviceToken(deviceLabel)
                        deviceLabel = ""
                        showAddDevice = false
                    },
                    enabled = !busy,
                ) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { showAddDevice = false }) { Text("Cancel") } },
        )
    }

    createdToken?.let { token ->
        AlertDialog(
            onDismissRequest = { viewModel.clearCreatedToken() },
            title = { Text("Device token created") },
            text = {
                Column {
                    Text(
                        "This token is now active on this device and will be used for point submission. Save a copy if you need it — it won't be shown again:",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(12.dp))
                    ProfileCard(title = "Device token", value = token)
                    Spacer(Modifier.height(4.dp))
                    TextButton(onClick = { clipboard.setText(AnnotatedString(token)) }) { Text("Copy token") }
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.clearCreatedToken() }) { Text("Done") }
            },
        )
    }
}

@Composable
private fun GeneratedKeyDialog(
    key: String,
    endpoint: String,
    clipboard: ClipboardManager,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("OwnTracks key created") },
        text = {
            Column {
                Text("Save this key now — it won't be shown again:", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                ProfileCard(title = "API key", value = key)
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { clipboard.setText(AnnotatedString(key)) }) { Text("Copy API key") }
                Spacer(Modifier.height(8.dp))
                ProfileCard(title = "Endpoint", value = endpoint)
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { clipboard.setText(AnnotatedString(endpoint)) }) { Text("Copy endpoint") }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(endpoint))
                onDismiss()
            }) { Text("Copy endpoint & close") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun DemoNote() {
    Spacer(Modifier.height(8.dp))
    Text(
        "Demo mode — connect to a real instance to manage integrations.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
