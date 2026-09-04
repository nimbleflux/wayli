package io.github.nimbleflux.wayli.feature.settings

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.models.UserProfile
import io.github.nimbleflux.wayli.repo.AdminRepository
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class AdminUsersViewModel @Inject constructor(
    private val repo: AdminRepository,
    private val demoManager: DemoManager,
) : ViewModel() {

    val isDemo: Boolean get() = demoManager.isDemoMode

    sealed class UiState {
        object Loading : UiState()
        data class Loaded(val users: List<UserProfile>) : UiState()
        data class Error(val message: String) : UiState()
    }

    private val _state = MutableStateFlow<UiState>(UiState.Loading)
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init { load() }

    fun load() {
        if (isDemo) { _state.value = UiState.Loaded(demoUsers()); return }
        viewModelScope.launch(Dispatchers.IO) {
            _state.value = UiState.Loading
            repo.listUsers().fold(
                onSuccess = { _state.value = UiState.Loaded(it) },
                onFailure = { _state.value = UiState.Error(it.message ?: "Failed to load users") },
            )
        }
    }

    fun addUser(email: String, firstName: String, lastName: String, password: String, role: String) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            repo.addUser(email, firstName, lastName, password, role).fold(
                onSuccess = { _message.value = "User added"; load() },
                onFailure = { _message.value = it.message ?: "Add failed" },
            )
            _busy.value = false
        }
    }

    fun updateUser(userId: String, email: String, firstName: String, lastName: String, role: String) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            repo.updateUser(userId, email, firstName, lastName, role).fold(
                onSuccess = { _message.value = "User updated"; load() },
                onFailure = { _message.value = it.message ?: "Update failed" },
            )
            _busy.value = false
        }
    }

    fun deleteUser(userId: String) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            repo.deleteUser(userId).fold(
                onSuccess = { _message.value = "User deleted"; load() },
                onFailure = { _message.value = it.message ?: "Delete failed" },
            )
            _busy.value = false
        }
    }

    fun clearMessage() { _message.value = null }

    private fun demoUsers(): List<UserProfile> = listOf(
        UserProfile(id = "u1", firstName = "Alex", lastName = "Traveler", fullName = "Alex Traveler", username = "alex", role = "admin", createdAt = "2025-01-12T08:00:00Z"),
        UserProfile(id = "u2", firstName = "Maria", lastName = "Garcia", fullName = "Maria Garcia", username = "maria", role = "user", createdAt = "2025-03-04T10:00:00Z"),
        UserProfile(id = "u3", firstName = "Jonas", lastName = "Müller", fullName = "Jonas Müller", username = "jonas", role = "user", createdAt = "2025-05-22T14:00:00Z"),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminUsersScreen(
    onBack: () -> Unit,
    viewModel: AdminUsersViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val message by viewModel.message.collectAsState()

    var query by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<UserProfile?>(null) }
    var deleteTarget by remember { mutableStateOf<UserProfile?>(null) }

    val all = (state as? AdminUsersViewModel.UiState.Loaded)?.users ?: emptyList()
    val filtered = remember(query, all) {
        val q = query.trim().lowercase()
        if (q.isBlank()) all
        else all.filter {
            (it.fullName ?: "${it.firstName ?: ""} ${it.lastName ?: ""}").lowercase().contains(q) ||
                (it.username ?: "").lowercase().contains(q)
        }
    }

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Users") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
        floatingActionButton = {
            if (!viewModel.isDemo) {
                ExtendedFloatingActionButton(
                    onClick = { adding = true },
                    modifier = Modifier.padding(
                        bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                    ), // float above the dock
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("Add user") },
                )
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search users") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
            )
            when (state) {
                is AdminUsersViewModel.UiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Loading…")
                }
                is AdminUsersViewModel.UiState.Error -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text((state as AdminUsersViewModel.UiState.Error).message, color = MaterialTheme.colorScheme.error)
                }
                is AdminUsersViewModel.UiState.Loaded -> {
                    if (filtered.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(if (viewModel.isDemo) "No users" else "No users found")
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                                start = 16.dp,
                                end = 16.dp,
                                top = 8.dp,
                                bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                            ),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(filtered, key = { it.id }) { user ->
                                UserRow(
                                    user = user,
                                    readOnly = viewModel.isDemo,
                                    onEdit = { editing = user },
                                    onDelete = { deleteTarget = user },
                                )
                            }
                        }
                    }
                }
            }
            message?.let { msg ->
                Text(msg, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.primary)
            }
            if (viewModel.isDemo) {
                Text(
                    "Demo mode — users are read-only.",
                    modifier = Modifier.padding(horizontal = 16.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (adding) {
        UserEditDialog(
            title = "Add user",
            requirePassword = true,
            initial = null,
            onDismiss = { adding = false },
            onSave = { email, firstName, lastName, role, password ->
                viewModel.addUser(email, firstName, lastName, password, role)
                adding = false
            },
        )
    }
    editing?.let { user ->
        UserEditDialog(
            title = "Edit user",
            requirePassword = false,
            initial = user,
            onDismiss = { editing = null },
            onSave = { email, firstName, lastName, role, _ ->
                viewModel.updateUser(user.id, email, firstName, lastName, role)
                editing = null
            },
        )
    }
    deleteTarget?.let { user ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete ${user.fullName ?: "user"}?") },
            text = { Text("This permanently removes the user. This action cannot be undone.") },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteUser(user.id); deleteTarget = null }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun UserRow(
    user: UserProfile,
    readOnly: Boolean,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(1.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    ((user.firstName?.firstOrNull()?.toString() ?: "") + (user.lastName?.firstOrNull()?.toString() ?: "")).ifBlank { "?" },
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(user.fullName ?: "${user.firstName ?: ""} ${user.lastName ?: ""}".ifBlank { "Unknown" }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                user.username?.let { Text("@$it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                user.createdAt.takeIf { it.isNotBlank() }?.let {
                    Text(it.take(10), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            RoleBadge(role = user.role)
            if (!readOnly) {
                IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = "Edit") }
                IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, contentDescription = "Delete") }
            }
        }
    }
}

@Composable
private fun RoleBadge(role: String) {
    val isAdmin = role == "admin"
    AssistChip(
        onClick = {},
        label = { Text(if (isAdmin) "Admin" else "User") },
    )
}

@Composable
private fun UserEditDialog(
    title: String,
    requirePassword: Boolean,
    initial: UserProfile?,
    onDismiss: () -> Unit,
    onSave: (email: String, firstName: String, lastName: String, role: String, password: String) -> Unit,
) {
    var email by remember { mutableStateOf(initial?.email ?: "") }
    var firstName by remember { mutableStateOf(initial?.firstName ?: "") }
    var lastName by remember { mutableStateOf(initial?.lastName ?: "") }
    var password by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(initial?.role ?: "user") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = firstName, onValueChange = { firstName = it }, label = { Text("First name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = lastName, onValueChange = { lastName = it }, label = { Text("Last name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (requirePassword) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = password, onValueChange = { password = it },
                        label = { Text("Password") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(12.dp))
                Text("Role", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(onClick = { role = "user" }, label = { Text(if (role == "user") "✓ User" else "User") })
                    AssistChip(onClick = { role = "admin" }, label = { Text(if (role == "admin") "✓ Admin" else "Admin") })
                }
            }
        },
        confirmButton = {
            val canSave = firstName.isNotBlank() && email.isNotBlank() && (!requirePassword || password.length >= 6)
            TextButton(enabled = canSave, onClick = { onSave(email, firstName, lastName, role, password) }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
