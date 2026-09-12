package io.github.nimbleflux.wayli.feature.settings

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
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.models.UserPreferences
import io.github.nimbleflux.wayli.repo.PreferencesRepository
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface PreferencesUiState {
    data object Loading : PreferencesUiState
    data class Error(val message: String) : PreferencesUiState
    data class Success(
        val prefs: UserPreferences,
        val units: String,
        val language: String?,
        val fitnessBeta: Boolean = false,
        val fitnessDefault: String = "private",
    ) : PreferencesUiState
}

@HiltViewModel
class PreferencesViewModel @Inject constructor(
    private val demoManager: DemoManager,
    private val fluxbaseClient: FluxbaseClient,
    private val prefsRepo: PreferencesRepository,
) : ViewModel() {
    val isDemoMode: Boolean get() = demoManager.isDemoMode

    private val _state = MutableStateFlow<PreferencesUiState>(PreferencesUiState.Loading)
    val state: StateFlow<PreferencesUiState> = _state.asStateFlow()
    private val _saving = MutableStateFlow(false)
    val saving: StateFlow<Boolean> = _saving.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    /** Emitted after any successful persist — e.g. the nav host refreshes the Fitness tab flag. */
    private val _saved = MutableSharedFlow<Unit>()
    val saved: SharedFlow<Unit> = _saved.asSharedFlow()

    init {
        if (demoManager.isDemoMode) {
            _state.value = PreferencesUiState.Success(UserPreferences(), "metric", null)
        } else {
            load()
        }
    }

    private fun load() {
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: run {
            _state.value = PreferencesUiState.Error("Not signed in")
            return
        }
        viewModelScope.launch {
            prefsRepo.getPreferences(uid)
                .onSuccess {
                    _state.value = PreferencesUiState.Success(
                        it,
                        prefsRepo.unitsOf(it) ?: "metric",
                        it.language,
                        prefsRepo.fitnessBetaOf(it),
                        prefsRepo.fitnessDefaultOf(it),
                    )
                }
                .onFailure { _state.value = PreferencesUiState.Error(it.message ?: "Failed to load preferences") }
        }
    }

    fun save(units: String, timezone: String?, notificationsEnabled: Boolean, language: String?) {
        if (demoManager.isDemoMode) return
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        _saving.value = true
        viewModelScope.launch {
            prefsRepo.updatePreferences(uid, language = language, timezone = timezone, notificationsEnabled = notificationsEnabled, units = units)
                .onSuccess { _message.value = "Saved"; load() }
                .onFailure { _message.value = it.message ?: "Failed to save" }
            _saving.value = false
        }
    }

    /** Fitness beta opt-in — persisted immediately (same flag the web toggles). */
    fun setFitnessBeta(enabled: Boolean) {
        if (demoManager.isDemoMode) return
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        viewModelScope.launch {
            prefsRepo.setFitnessBeta(uid, enabled)
                .onSuccess {
                    (_state.value as? PreferencesUiState.Success)?.let {
                        _state.value = it.copy(fitnessBeta = enabled)
                    }
                    _message.value = if (enabled) "Fitness beta enabled" else "Fitness beta disabled"
                    _saved.emit(Unit)
                }
                .onFailure { _message.value = it.message ?: "Failed to save" }
        }
    }

    /** Default sharing audience for fitness activities (same setting the web edits). */
    fun setFitnessDefault(audience: String) {
        if (demoManager.isDemoMode) return
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        viewModelScope.launch {
            prefsRepo.setFitnessDefault(uid, audience)
                .onSuccess {
                    (_state.value as? PreferencesUiState.Success)?.let {
                        _state.value = it.copy(fitnessDefault = audience)
                    }
                    _message.value = "Default activity sharing: $audience"
                }
                .onFailure { _message.value = it.message ?: "Failed to save" }
        }
    }

    fun clearMessage() {
        _message.value = null
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PreferencesScreen(
    onBack: () -> Unit,
    onSaved: () -> Unit = {},
    viewModel: PreferencesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val saving by viewModel.saving.collectAsState()
    val message by viewModel.message.collectAsState()
    val snackbarHost = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let { snackbarHost.showSnackbar(it); viewModel.clearMessage() }
    }

    // A persist happened (e.g. the fitness beta toggled) — notify the host so
    // gated UI like the Fitness dock tab refreshes immediately.
    LaunchedEffect(Unit) {
        viewModel.saved.collect { onSaved() }
    }

    val timezones = remember {
        listOf("UTC", "Europe/Amsterdam", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney")
    }

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Preferences") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = {
            SnackbarHost(
                snackbarHost,
                // stay above the floating dock
                Modifier.padding(bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance()),
            )
        },
    ) { padding ->
        when (val s = state) {
            is PreferencesUiState.Loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            is PreferencesUiState.Error -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text(s.message, color = MaterialTheme.colorScheme.error) }
            is PreferencesUiState.Success -> {
                var units by remember(s) { mutableStateOf(s.units) }
                var timezone by remember(s) { mutableStateOf(s.prefs.timezone ?: "UTC") }
                var notifications by remember(s) { mutableStateOf(s.prefs.notificationsEnabled ?: true) }
                // language: null or "system" => System
                var language by remember(s) { mutableStateOf(s.language ?: "system") }
                var tzExpanded by remember { mutableStateOf(false) }

                Column(
                    modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    // Distance units
                    Column {
                        Text("Distance units", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(8.dp))
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            listOf("metric" to "Metric (km)", "imperial" to "Imperial (mi)").forEachIndexed { i, (value, label) ->
                                SegmentedButton(selected = units == value, onClick = { units = value }, shape = SegmentedButtonDefaults.itemShape(i, 2)) { Text(label) }
                            }
                        }
                    }
                    // Notifications
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Notifications", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                            Text("In-app activity notifications", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = notifications, onCheckedChange = { notifications = it }, enabled = !viewModel.isDemoMode)
                    }
                    // Fitness beta — persisted immediately, not via the Save button
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Fitness (beta)", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                            Text(
                                "Import and analyze .fit activities from your sports watch",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = s.fitnessBeta,
                            onCheckedChange = { viewModel.setFitnessBeta(it) },
                            enabled = !viewModel.isDemoMode,
                        )
                    }
                    // Default sharing audience for activities — same setting as
                    // the web's account settings; per-activity overrides live
                    // on the activity itself.
                    if (s.fitnessBeta) {
                        Column {
                            Text("Default activity sharing", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                            Text(
                                "Audience for activities without their own sharing setting",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(8.dp))
                            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                listOf("private" to "Private", "friends" to "Friends", "public" to "Public").forEachIndexed { i, (value, label) ->
                                    SegmentedButton(
                                        selected = s.fitnessDefault == value,
                                        onClick = { viewModel.setFitnessDefault(value) },
                                        shape = SegmentedButtonDefaults.itemShape(i, 3),
                                    ) { Text(label) }
                                }
                            }
                        }
                    }
                    // Timezone
                    Column {
                        Text("Timezone", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(8.dp))
                        ExposedDropdownMenuBox(expanded = tzExpanded, onExpandedChange = { tzExpanded = it }) {
                            OutlinedTextField(
                                value = timezone,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Timezone") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(tzExpanded) },
                                modifier = Modifier.fillMaxWidth().menuAnchor(),
                            )
                            ExposedDropdownMenu(expanded = tzExpanded, onDismissRequest = { tzExpanded = false }) {
                                timezones.forEach { tz ->
                                    androidx.compose.material3.DropdownMenuItem(text = { Text(tz) }, onClick = { timezone = tz; tzExpanded = false })
                                }
                            }
                        }
                    }
                    // Language
                    Column {
                        Text("Language", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("system" to "System", "en" to "English", "nl" to "Nederlands").forEach { (value, label) ->
                                FilterChip(selected = language == value, onClick = { language = value }, label = { Text(label) })
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.Button(
                        onClick = { viewModel.save(units, timezone, notifications, language.takeIf { it != "system" }) },
                        enabled = !saving && !viewModel.isDemoMode,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = MaterialTheme.shapes.medium,
                    ) { Text(if (saving) "Saving…" else "Save") }
                    if (viewModel.isDemoMode) {
                        Text("Preferences can't be changed in demo mode.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
                }
            }
        }
    }
}
