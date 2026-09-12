package io.github.nimbleflux.wayli.feature.settings

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.wayli.designsystem.SettingRow
import io.github.nimbleflux.wayli.designsystem.ThemeManager
import io.github.nimbleflux.wayli.designsystem.ThemeMode
import io.github.nimbleflux.wayli.designsystem.WayliSectionCard
import javax.inject.Inject

/**
 * Settings — mobile-native design with grouped cards, icon + label rows,
 * and a functional theme selector. Every row navigates to a real screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    demoMode: Boolean = false,
    onProfile: () -> Unit = {},
    onSecurity: () -> Unit = {},
    onTrackingSettings: () -> Unit = {},
    onConnections: () -> Unit = {},
    onDataSampling: () -> Unit = {},
    onTripExclusions: () -> Unit = {},
    onImportExport: () -> Unit = {},
    onPreferences: () -> Unit = {},
    onSignOut: () -> Unit = {},
    onAdminUsers: () -> Unit = {},
    onAdminMaintenance: () -> Unit = {},
    onJobs: () -> Unit = {},
    serverUrl: String? = null,
    onReconfigureServer: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
    sessionViewModel: SessionViewModel = hiltViewModel(),
) {
    val isAdmin by sessionViewModel.isAdmin.collectAsState()
    var showChangeServer by remember { mutableStateOf(false) }

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = { TopAppBar(title = { Text("Settings") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(8.dp))

            // Demo mode banner — with a direct exit action so it's discoverable
            // without scrolling to the bottom-of-screen sign-out button.
            if (demoMode) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                    ),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Demo Mode", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "You're viewing sample data. Connect to a real Wayli instance to track your own travels.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        androidx.compose.material3.OutlinedButton(
                            onClick = onSignOut,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Exit demo") }
                    }
                }
            }

            // Theme selector
            WayliSectionCard(title = "Appearance") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Palette, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                    Spacer(Modifier.size(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Theme", style = MaterialTheme.typography.bodyLarge)
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                            ThemeMode.entries.forEachIndexed { index, mode ->
                                SegmentedButton(
                                    selected = viewModel.themeMode == mode,
                                    onClick = { viewModel.setThemeMode(mode) },
                                    shape = SegmentedButtonDefaults.itemShape(index, ThemeMode.entries.size),
                                ) { Text(mode.label) }
                            }
                        }
                    }
                }
            }

            // Account section
            WayliSectionCard(title = "Account") {
                SettingRow(icon = Icons.Filled.Person, label = "Profile", onClick = onProfile)
                SettingRow(icon = Icons.Filled.Lock, label = "Security & 2FA", onClick = onSecurity)
                SettingRow(
                    icon = Icons.AutoMirrored.Filled.Logout,
                    label = if (demoMode) "Exit demo" else "Sign out",
                    onClick = onSignOut,
                )
            }

            // Connection (real instances only — demo has no server)
            if (!demoMode) {
                WayliSectionCard(title = "Connection") {
                    Text("Server", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        serverUrl ?: "Not configured",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { showChangeServer = true },
                        modifier = Modifier.fillMaxWidth().height(40.dp),
                        shape = MaterialTheme.shapes.medium,
                    ) { Text("Change server") }
                }
            }

            // Recording
            WayliSectionCard(title = "Recording") {
                SettingRow(icon = Icons.Filled.LocationOn, label = "Tracking Settings", onClick = onTrackingSettings)
                SettingRow(icon = Icons.Filled.Devices, label = "Connections & Integrations", onClick = onConnections)
            }

            // Permissions — what tracking needs, with status and a direct
            // request/settings path.
            PermissionCard()

            // Data & Trips
            WayliSectionCard(title = "Data & Trips") {
                SettingRow(icon = Icons.Filled.BatteryFull, label = "Data Sampling", onClick = onDataSampling)
                SettingRow(icon = Icons.Filled.Block, label = "Trip Exclusions", onClick = onTripExclusions)
                SettingRow(icon = Icons.Filled.SwapVert, label = "Import / Export", onClick = onImportExport)
                if (!demoMode) {
                    SettingRow(
                        icon = Icons.Filled.Bolt,
                        label = "Jobs & logs",
                        onClick = onJobs,
                    )
                }
            }

            // Preferences
            WayliSectionCard(title = "Preferences") {
                SettingRow(icon = Icons.Filled.Translate, label = "Preferences", onClick = onPreferences)
            }

            // Server admin (role-gated)
            if (isAdmin) {
                WayliSectionCard(title = "Server admin") {
                    SettingRow(icon = Icons.Filled.People, label = "Users", onClick = onAdminUsers)
                    SettingRow(icon = Icons.Filled.Build, label = "Maintenance", onClick = onAdminMaintenance)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Server settings, Auth, Email, OAuth, AI, and Web search arrive once the Fluxbase admin SDK ships.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // About
            WayliSectionCard(title = "About") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    io.github.nimbleflux.wayli.designsystem.WayliLogo(size = 40.dp)
                    Spacer(Modifier.size(12.dp))
                    Column {
                        Text("Wayli", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        Text("Android v${io.github.nimbleflux.wayli.BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text("fluxbase-kotlin ${io.github.nimbleflux.wayli.BuildConfig.FLUXBASE_KOTLIN_VERSION}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // Sign out / Exit demo
            Button(
                onClick = onSignOut,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = MaterialTheme.shapes.medium,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                ),
            ) {
                Text(if (demoMode) "Exit demo" else "Sign out")
            }
            // Keep the sign-out button clear of the floating dock when fully
            // scrolled (spacedBy only applies between children).
            Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))

            if (showChangeServer) {
                AlertDialog(
                    onDismissRequest = { showChangeServer = false },
                    title = { Text("Change server?") },
                    text = { Text("You'll be signed out and returned to setup to connect to a different Wayli instance.") },
                    confirmButton = {
                        TextButton(onClick = {
                            showChangeServer = false
                            onReconfigureServer()
                        }) { Text("Change") }
                    },
                    dismissButton = {
                        TextButton(onClick = { showChangeServer = false }) { Text("Cancel") }
                    },
                )
            }

        }
    }
}

/**
 * Runtime-permission status card. Each row shows granted/denied and taps
 * into the system request dialog; background location only links to the
 * app-details screen (Play policy keeps it out of runtime prompts). Rows
 * re-check whenever the screen resumes so changes made in system settings
 * are reflected immediately.
 */
@Composable
private fun PermissionCard() {
    val context = androidx.compose.ui.platform.LocalContext.current
    var refreshKey by remember { mutableStateOf(0) }

    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) refreshKey++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { refreshKey++ }

    fun openAppSettings() {
        runCatching {
            context.startActivity(
                android.content.Intent(
                    android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.fromParts("package", context.packageName, null),
                ),
            )
        }
    }

    fun granted(permission: String): Boolean = refreshKey.let {
        androidx.core.content.ContextCompat.checkSelfPermission(context, permission) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    val anyDenied = !granted(android.Manifest.permission.ACCESS_FINE_LOCATION) ||
        (android.os.Build.VERSION.SDK_INT >= 33 && !granted(android.Manifest.permission.POST_NOTIFICATIONS)) ||
        (
            io.github.nimbleflux.wayli.di.FlavorCapabilities.requestsActivityRecognition &&
                !granted(android.Manifest.permission.ACTIVITY_RECOGNITION)
            )

    WayliSectionCard(title = "Permissions") {
        PermissionStatusRow(
            icon = Icons.Filled.LocationOn,
            label = "Location",
            granted = granted(android.Manifest.permission.ACCESS_FINE_LOCATION),
            onClick = {
                if (granted(android.Manifest.permission.ACCESS_FINE_LOCATION)) {
                    openAppSettings()
                } else {
                    launcher.launch(android.Manifest.permission.ACCESS_FINE_LOCATION)
                }
            },
        )
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            PermissionStatusRow(
                icon = Icons.Filled.Notifications,
                label = "Notifications",
                granted = granted(android.Manifest.permission.POST_NOTIFICATIONS),
                onClick = {
                    if (granted(android.Manifest.permission.POST_NOTIFICATIONS)) {
                        openAppSettings()
                    } else {
                        launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
            )
        }
        if (io.github.nimbleflux.wayli.di.FlavorCapabilities.requestsActivityRecognition) {
            PermissionStatusRow(
                icon = Icons.Filled.DirectionsRun,
                label = "Activity recognition",
                granted = granted(android.Manifest.permission.ACTIVITY_RECOGNITION),
                onClick = {
                    if (granted(android.Manifest.permission.ACTIVITY_RECOGNITION)) {
                        openAppSettings()
                    } else {
                        launcher.launch(android.Manifest.permission.ACTIVITY_RECOGNITION)
                    }
                },
            )
        }
        PermissionStatusRow(
            icon = Icons.Filled.Map,
            label = "Background location",
            granted = granted(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION),
            onClick = { openAppSettings() }, // special toggle lives in system settings only
        )
        if (anyDenied) {
            Text(
                "Denied permissions can be re-enabled from the app's system settings.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PermissionStatusRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    granted: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.size(16.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        Text(
            if (granted) "Granted" else "Not granted",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = if (granted) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.error
            },
        )
    }
}

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val themeManager: ThemeManager,
) : ViewModel() {
    val themeMode: ThemeMode get() = themeManager.themeMode

    fun setThemeMode(mode: ThemeMode) {
        themeManager.setThemeMode(mode)
    }
}

