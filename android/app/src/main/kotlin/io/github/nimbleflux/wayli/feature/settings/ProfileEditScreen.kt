package io.github.nimbleflux.wayli.feature.settings

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.designsystem.Avatar
import io.github.nimbleflux.wayli.demo.DemoData
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.feature.media.MediaUploader
import io.github.nimbleflux.wayli.models.UserProfile
import io.github.nimbleflux.wayli.repo.UserRepository
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface ProfileUiState {
    data object Loading : ProfileUiState
    data class Error(val message: String) : ProfileUiState
    data class Success(val profile: UserProfile) : ProfileUiState
}

@HiltViewModel
class ProfileEditViewModel @Inject constructor(
    private val demoManager: DemoManager,
    private val fluxbaseClient: FluxbaseClient,
    private val userRepo: UserRepository,
    private val mediaUploader: MediaUploader,
) : ViewModel() {
    val isDemoMode: Boolean = demoManager.isDemoMode

    private val _state = MutableStateFlow<ProfileUiState>(ProfileUiState.Loading)
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()
    private val _saving = MutableStateFlow(false)
    val saving: StateFlow<Boolean> = _saving.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        if (demoManager.isDemoMode) {
            _state.value = ProfileUiState.Success(DemoData.profile)
        } else {
            load()
        }
    }

    private fun load() {
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: run {
            _state.value = ProfileUiState.Error("Not signed in")
            return
        }
        viewModelScope.launch {
            userRepo.getProfile(uid)
                .onSuccess { _state.value = ProfileUiState.Success(it) }
                .onFailure { _state.value = ProfileUiState.Error(it.message ?: "Failed to load profile") }
        }
    }

    fun save(firstName: String, lastName: String, username: String, discoverable: String) {
        if (demoManager.isDemoMode) return
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        _saving.value = true
        viewModelScope.launch {
            userRepo.updateProfile(
                userId = uid,
                firstName = firstName.ifBlank { null },
                lastName = lastName.ifBlank { null },
                username = username.ifBlank { null },
                discoverable = discoverable,
            )
                .onSuccess { _message.value = "Saved"; load() }
                .onFailure { _message.value = it.message ?: "Failed to save" }
            _saving.value = false
        }
    }

    fun uploadAvatar(context: Context, uri: Uri) {
        if (demoManager.isDemoMode) return
        val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        _saving.value = true
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            mediaUploader.uploadAvatar(context, uri, uid)
                .onSuccess { _message.value = "Avatar updated"; load() }
                .onFailure { _message.value = it.message ?: "Avatar upload failed" }
            _saving.value = false
        }
    }

    fun clearMessage() {
        _message.value = null
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileEditScreen(onBack: () -> Unit) {
    val viewModel: ProfileEditViewModel = hiltViewModel()
    val state by viewModel.state.collectAsState()
    val saving by viewModel.saving.collectAsState()
    val message by viewModel.message.collectAsState()
    val context = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let { snackbarHost.showSnackbar(it); viewModel.clearMessage() }
    }

    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) viewModel.uploadAvatar(context, uri)
    }

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Edit profile") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
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
            is ProfileUiState.Loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is ProfileUiState.Error -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(s.message, color = MaterialTheme.colorScheme.error)
            }
            is ProfileUiState.Success -> {
                val p = s.profile
                var firstName by remember(p) { mutableStateOf(p.firstName ?: "") }
                var lastName by remember(p) { mutableStateOf(p.lastName ?: "") }
                var username by remember(p) { mutableStateOf(p.username ?: "") }
                var discoverable by remember(p) { mutableStateOf(p.discoverable) }

                Column(
                    modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    // Avatar with a change-avatar FAB
                    Box(contentAlignment = Alignment.BottomEnd) {
                        Avatar(
                            initials = (
                                (p.firstName?.firstOrNull()?.toString() ?: "") +
                                    (p.lastName?.firstOrNull()?.toString() ?: "")
                                ).ifBlank { "W" },
                            url = p.avatarUrl,
                            size = 96.dp,
                        )
                        SmallFloatingActionButton(
                            onClick = { photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                            shape = CircleShape,
                            modifier = Modifier.padding(start = 60.dp),
                        ) {
                            Icon(Icons.Filled.PhotoCamera, contentDescription = "Change avatar")
                        }
                    }
                    OutlinedTextField(value = firstName, onValueChange = { firstName = it }, label = { Text("First name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = lastName, onValueChange = { lastName = it }, label = { Text("Last name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it.lowercase().filter { ch -> ch.isLetterOrDigit() || ch == '-' } },
                        label = { Text("Username") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = { Text("3–30 chars: a–z, 0–9, -") },
                    )
                    Text("Who can discover you", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("everyone" to "Everyone", "friends_of_friends" to "Friends", "nobody" to "Nobody").forEach { (value, label) ->
                            FilterChip(
                                selected = discoverable == value,
                                onClick = { discoverable = value },
                                label = { Text(label) },
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.Button(
                        onClick = { viewModel.save(firstName, lastName, username, discoverable) },
                        enabled = !saving && !viewModel.isDemoMode,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = MaterialTheme.shapes.medium,
                    ) { Text(if (saving) "Saving…" else "Save") }
                    if (viewModel.isDemoMode) {
                        Text("Profile editing isn't available in demo mode.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
                }
            }
        }
    }
}
