package io.github.nimbleflux.wayli.nav

import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.TravelExplore
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.auth.ForgotPasswordScreen
import io.github.nimbleflux.wayli.auth.SignInScreen
import io.github.nimbleflux.wayli.auth.SignUpScreen
import io.github.nimbleflux.wayli.auth.TwoFactorScreen
import io.github.nimbleflux.wayli.designsystem.WayliBottomBar
import io.github.nimbleflux.wayli.designsystem.WayliTab
import io.github.nimbleflux.wayli.feature.home.HomeScreen
import io.github.nimbleflux.wayli.feature.settings.AdminMaintenanceScreen
import io.github.nimbleflux.wayli.feature.settings.AdminUsersScreen
import io.github.nimbleflux.wayli.feature.settings.ConnectionsScreen
import io.github.nimbleflux.wayli.feature.settings.DataSamplingScreen
import io.github.nimbleflux.wayli.feature.settings.ImportExportScreen
import io.github.nimbleflux.wayli.feature.settings.PreferencesScreen
import io.github.nimbleflux.wayli.feature.settings.ProfileEditScreen
import io.github.nimbleflux.wayli.feature.settings.SecuritySettingsScreen
import io.github.nimbleflux.wayli.feature.settings.SettingsScreen
import io.github.nimbleflux.wayli.feature.settings.TripExclusionsScreen
import io.github.nimbleflux.wayli.feature.settings.TwoFactorSetupScreen
import io.github.nimbleflux.wayli.feature.stats.StatsScreen
import io.github.nimbleflux.wayli.feature.tracking.TrackingSettingsScreen
import io.github.nimbleflux.wayli.feature.travel.TripDetailScreen
import io.github.nimbleflux.wayli.feature.travel.TripsListScreen
import io.github.nimbleflux.wayli.feature.wishlist.WishlistScreen
import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.onboarding.InstanceSetupScreen
import io.github.nimbleflux.wayli.session.InstanceManager
import javax.inject.Inject

object Routes {
    const val INSTANCE_SETUP = "instance_setup"
    const val SIGN_IN = "sign_in"
    const val SIGN_UP = "sign_up"
    const val TWO_FACTOR = "two_factor/{userId}"
    const val FORGOT_PASSWORD = "forgot_password"

    // Tab routes
    const val MAP = "map" // The first tab is the Home dashboard (route name kept for continuity)
    const val TRAVEL = "travel"
    const val WISHLIST = "wishlist"
    const val SETTINGS = "settings"
    const val FITNESS = "fitness" // Beta-gated 5th tab

    // Pushed screens
    const val TRIP_DETAIL = "trip_detail/{tripId}"
    const val FITNESS_DETAIL = "fitness_detail/{activityId}"
    const val FULL_MAP = "full_map?tripId={tripId}"
    const val ENTRY_EDITOR = "entry_editor/{tripId}?entryId={entryId}&draftId={draftId}"
    const val ENTRY_DETAIL = "entry_detail/{tripId}/{entryId}"
    const val STATS = "stats"
    const val SUGGESTIONS = "suggestions"
    const val TRACKING_SETTINGS = "tracking_settings"
    const val PROFILE = "profile"
    const val SECURITY = "security"
    const val PREFERENCES = "preferences"
    const val CONNECTIONS = "connections"
    const val DATA_SAMPLING = "data_sampling"
    const val TWO_FACTOR_SETUP = "two_factor_setup"
    const val TRIP_EXCLUSIONS = "trip_exclusions"
    const val IMPORT_EXPORT = "import_export"
    const val ADMIN_USERS = "admin_users"
    const val ADMIN_MAINTENANCE = "admin_maintenance"
    const val JOBS = "jobs"
    const val NOTIFICATIONS = "notifications"
}

private val tabs = listOf(
    WayliTab(Routes.MAP, "Home", Icons.Filled.Home),
    WayliTab(Routes.TRAVEL, "Travel", Icons.Filled.TravelExplore),
    WayliTab(Routes.WISHLIST, "Wishlist", Icons.Filled.Star),
    WayliTab(Routes.SETTINGS, "Settings", Icons.Filled.Settings),
)

/** The beta-gated 5th dock tab — slotted in before Settings when enabled. */
private val fitnessTab = WayliTab(Routes.FITNESS, "Fitness", Icons.Filled.DirectionsRun)

private val tabRoutes = setOf(Routes.MAP, Routes.TRAVEL, Routes.WISHLIST, Routes.FITNESS, Routes.SETTINGS)

/**
 * The dock tab that owns [route], so the tab stays highlighted while the user
 * is inside a pushed screen of that section (e.g. Travel on a trip page).
 * Tab routes map to themselves; null means "no tab active".
 */
private fun parentTabOf(route: String?): String? = when {
    route == null -> null
    route.startsWith("trip_detail") ||
        route.startsWith("entry_detail") ||
        route.startsWith("entry_editor") ||
        route == Routes.SUGGESTIONS -> Routes.TRAVEL
    route.startsWith("fitness_detail") -> Routes.FITNESS
    route.startsWith("full_map") ||
        route == Routes.STATS ||
        route == Routes.NOTIFICATIONS -> Routes.MAP
    route in setOf(
        Routes.PROFILE,
        Routes.SECURITY,
        Routes.TRACKING_SETTINGS,
        Routes.CONNECTIONS,
        Routes.DATA_SAMPLING,
        Routes.TRIP_EXCLUSIONS,
        Routes.IMPORT_EXPORT,
        Routes.ADMIN_USERS,
        Routes.ADMIN_MAINTENANCE,
        Routes.JOBS,
        Routes.PREFERENCES,
        Routes.TWO_FACTOR_SETUP,
    ) -> Routes.SETTINGS
    else -> route.takeIf { it in tabRoutes }
}

@HiltViewModel
class NavViewModel @Inject constructor(
    private val instanceManager: InstanceManager,
    private val demoManager: io.github.nimbleflux.wayli.demo.DemoManager,
    private val fluxbaseClient: FluxbaseClient,
    private val encryptedStorage: io.github.nimbleflux.wayli.session.EncryptedStorageAdapter,
    private val deviceTokenStore: io.github.nimbleflux.wayli.session.DeviceTokenStore,
    private val deviceTokenRepo: io.github.nimbleflux.wayli.repo.DeviceTokenRepository,
    private val tripRepo: io.github.nimbleflux.wayli.repo.TripRepository,
    private val draftRepo: io.github.nimbleflux.wayli.repo.DraftRepository,
    private val preferencesRepository: io.github.nimbleflux.wayli.repo.PreferencesRepository,
    private val trackingController: io.github.nimbleflux.wayli.gps.TrackingController,
    val sessionRefresher: io.github.nimbleflux.wayli.session.SessionRefresher,
) : ViewModel() {

    /** Trips offered by the share-target inbox ("save to trip…"). */
    val inboxTrips = MutableStateFlow<List<io.github.nimbleflux.wayli.models.Trip>>(emptyList())

    /**
     * Fitness beta opt-in (`user_preferences.preferences.beta_features.fitness`
     * — the same flag the web reads). Gates the Fitness dock tab. Refreshed on
     * construction, on sign-in, and when Preferences reports a save.
     */
    private val _fitnessBeta = MutableStateFlow(false)
    val fitnessBeta: kotlinx.coroutines.flow.StateFlow<Boolean> = _fitnessBeta.asStateFlow()

    fun refreshFitnessBeta() {
        if (demoManager.isDemoMode) {
            _fitnessBeta.value = false
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val userId = fluxbaseClient.auth.currentSession?.user?.id ?: return@launch
            _fitnessBeta.value = preferencesRepository.getPreferences(userId)
                .getOrNull()
                ?.let { preferencesRepository.fitnessBetaOf(it) } == true
        }
    }

    init { refreshFitnessBeta() }

    fun loadInboxTrips() {
        viewModelScope.launch(Dispatchers.IO) {
            inboxTrips.value = if (demoManager.isDemoMode) {
                io.github.nimbleflux.wayli.demo.DemoData.trips.sortedByDescending { it.startDate }
            } else {
                val userId = fluxbaseClient.auth.currentSession?.user?.id
                if (userId == null) emptyList() else tripRepo.listTrips(userId).getOrDefault(emptyList())
            }
        }
    }

    /** Save a shared payload as a journal draft under [tripId]. */
    suspend fun saveSharedDraft(
        tripId: String,
        text: String?,
        photoPaths: List<String>,
    ): String = draftRepo.save(
        io.github.nimbleflux.wayli.repo.EntryDraft(
            tripId = tripId,
            body = text.orEmpty(),
            photos = photoPaths,
        ),
    )

    /** Live read — demo mode can flip mid-session (Try Demo / Exit demo). */
    val isDemoMode: Boolean get() = demoManager.isDemoMode

    val startRoute: String = when {
        demoManager.isDemoMode -> Routes.MAP
        !instanceManager.isConfigured -> Routes.INSTANCE_SETUP
        else -> {
            if (fluxbaseClient.auth.currentSession != null) Routes.MAP else Routes.SIGN_IN
        }
    }

    /**
     * Session state as a flow — emits on sign-in/out/refresh. [WayliNavHost]
     * collects this to re-route when a session ends (e.g. revoked or expired
     * server-side), not just on the manual Settings sign-out.
     */
    val authEvents: Flow<io.github.nimbleflux.fluxbase.auth.AuthState> = callbackFlow {
        val unsubscribe = fluxbaseClient.auth.onAuthStateChange { state -> trySend(state) }
        awaitClose { unsubscribe() }
    }

    /**
     * Sign out of the current session. In demo mode this just clears the demo
     * flag; in real mode it calls the Fluxbase auth signOut endpoint. The
     * caller then navigates to INSTANCE_SETUP (demo) or SIGN_IN (real).
     *
     * Hardened: the persisted session is removed locally even when the network
     * call fails (the SDK only clears its storage after a successful POST),
     * and the device's GPS token is revoked + cleared.
     */
    fun signOut() {
        if (demoManager.isDemoMode) {
            demoManager.disableDemoMode()
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            // Best-effort server-side sign-out and token revocation — local
            // state must be cleared regardless of network outcome.
            runCatching { fluxbaseClient.auth.signOut() }
            deviceTokenStore.tokenId?.let { id -> runCatching { deviceTokenRepo.revoke(id) } }
            deviceTokenStore.clear()
            encryptedStorage.removeItem(SESSION_STORAGE_KEY)
        }
    }

    /**
     * Auto-provision / self-heal the tracking upload credential. The local
     * store can hold a token the server no longer knows (e.g. orphaned by a
     * DB restore) — [io.github.nimbleflux.wayli.repo.DeviceTokenRepository.repairIfOrphaned]
     * detects that and provisions a replacement. Drains the queue after a
     * repair so stuck points upload immediately.
     */
    fun ensureTrackingToken() {
        if (demoManager.isDemoMode) return
        viewModelScope.launch(Dispatchers.IO) {
            val repair = deviceTokenRepo.repairIfOrphaned(label = android.os.Build.MODEL)
            if (repair.status == io.github.nimbleflux.wayli.repo.DeviceTokenRepository.TokenRepair.REPAIRED) {
                trackingController.syncNow()
            } else if (repair.status == io.github.nimbleflux.wayli.repo.DeviceTokenRepository.TokenRepair.OFFLINE) {
                android.util.Log.e(TAG, "device token provision failed: ${repair.error}")
            }
        }
    }

    /** The currently configured server URL, if any (for display in Settings). */
    val instanceUrl: String? get() = instanceManager.getConfig()?.url

    /**
     * Clear the stored instance config and sign out, so the user is returned to
     * the instance-setup screen to connect to a different Wayli server.
     */
    fun reconfigureServer() {
        instanceManager.clear()
        if (demoManager.isDemoMode) {
            demoManager.disableDemoMode()
        } else {
            viewModelScope.launch(Dispatchers.IO) {
                runCatching { fluxbaseClient.auth.signOut() }
                deviceTokenStore.tokenId?.let { id -> runCatching { deviceTokenRepo.revoke(id) } }
                deviceTokenStore.clear()
                encryptedStorage.removeItem(SESSION_STORAGE_KEY)
            }
        }
    }

    companion object {
        /** Storage key the SDK persists its session under. */
        private const val SESSION_STORAGE_KEY = "fluxbase.auth.session"
        private const val TAG = "WayliTokens"
    }
}

@Composable
fun WayliNavHost() {
    val navController = rememberNavController()
    val viewModel: NavViewModel = hiltViewModel()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    // Dock tab that owns the current screen (stays highlighted on pushed
    // screens of a section, e.g. Travel while a trip page is open).
    val activeTab = parentTabOf(currentRoute)
    // Beta-gated Fitness tab — hidden in demo mode (no server, no activities).
    val fitnessBeta by viewModel.fitnessBeta.collectAsState()
    val visibleTabs = if (fitnessBeta && !viewModel.isDemoMode) {
        listOf(tabs[0], tabs[1], tabs[2], fitnessTab, tabs[3])
    } else {
        tabs
    }
    // Auth/setup screens show no dock (logged-out users must not see the main
    // menu) — also drops the NavHost's dock-clearing bottom padding there.
    val isAuthRoute = currentRoute in setOf(
        Routes.SIGN_IN,
        Routes.SIGN_UP,
        Routes.FORGOT_PASSWORD,
        Routes.INSTANCE_SETUP,
    ) || currentRoute?.startsWith("two_factor") == true

    // Re-route when the session ends outside the manual sign-out flow —
    // e.g. revoked/expired server-side. The manual Settings sign-out already
    // navigates; the launchSingleTop guard makes the duplicate event a no-op.
    // SIGNED_IN re-routes without a process restart after the OAuth deep-link
    // exchange, so returning from the browser lands on Home immediately.
        androidx.compose.runtime.LaunchedEffect(Unit) {
        viewModel.authEvents.collect { state ->
            val route = navController.currentBackStackEntry?.destination?.route
            val onTabs = route in tabRoutes
            if (state.event == io.github.nimbleflux.fluxbase.auth.AuthChangeEvent.SIGNED_OUT && onTabs) {
                navController.navigate(Routes.SIGN_IN) {
                    popUpTo(Routes.MAP) { inclusive = true }
                    launchSingleTop = true
                }
            }
            if (state.event == io.github.nimbleflux.fluxbase.auth.AuthChangeEvent.SIGNED_IN) {
                viewModel.ensureTrackingToken()
                viewModel.refreshFitnessBeta()
                if (route == Routes.SIGN_IN) {
                    navController.navigate(Routes.MAP) {
                        popUpTo(Routes.SIGN_IN) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            }

        }
    }

    // A restored session (cold start straight to the dashboard) never fired
    // SIGNED_IN — provision the tracking token once here.
    if (viewModel.startRoute == Routes.MAP) {
        androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.ensureTrackingToken() }
    }

    // Keep the session alive: proactively refresh the access token before it
    // expires (the Kotlin SDK has no autoRefresh of its own).
    LaunchedEffect(Unit) { viewModel.sessionRefresher.runLoop() }

    // A dead persisted session (expired refresh token): perform the hardened
    // sign-out and route to sign-in instead of looping the dashboard.
    androidx.compose.runtime.LaunchedEffect(Unit) {
        io.github.nimbleflux.wayli.session.SessionExpiryBus.expired.collect { expired ->
            if (expired && !viewModel.isDemoMode) {
                io.github.nimbleflux.wayli.session.SessionExpiryBus.consume()
                viewModel.signOut()
                navController.navigate(Routes.SIGN_IN) {
                    popUpTo(Routes.MAP) { inclusive = true }
                    launchSingleTop = true
                }
            }
        }
    }

    // Switching tabs: when the tab's root is already on the back stack (the
    // user is inside that section), pop back to it — re-tapping Travel from a
    // trip page returns to the travel overview. Otherwise switch tabs and land
    // on the tab's root screen (no saved-state restore, so a tab never reopens
    // a pushed detail screen).
    val switchTab: (String) -> Unit = { route ->
        if (!navController.popBackStack(route, inclusive = false)) {
            navController.navigate(route) {
                popUpTo(Routes.MAP)
                launchSingleTop = true
            }
        }
    }

    // ---- Launcher shortcuts + share-target (QuickActionBus) ----
    var autoRecord by remember { mutableStateOf(false) }
    var autoNewTrip by remember { mutableStateOf(false) }
    val quickAction by io.github.nimbleflux.wayli.util.QuickActionBus.pending.collectAsState()
    LaunchedEffect(quickAction) {
        when (quickAction) {
            io.github.nimbleflux.wayli.util.QuickActionBus.QuickAction.Record -> {
                navController.navigate(Routes.MAP) { launchSingleTop = true }
                autoRecord = true
                io.github.nimbleflux.wayli.util.QuickActionBus.consume()
            }
            io.github.nimbleflux.wayli.util.QuickActionBus.QuickAction.NewTrip -> {
                navController.navigate(Routes.TRAVEL) { launchSingleTop = true }
                autoNewTrip = true
                io.github.nimbleflux.wayli.util.QuickActionBus.consume()
            }
            else -> Unit // Shared handled by the inbox dialog below
        }
    }

    // The root paints the in-app theme background (the window background
    // would follow SYSTEM dark mode instead of the in-app theme).
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        NavHost(
            navController = navController,
            startDestination = viewModel.startRoute,
            modifier = Modifier.fillMaxSize(),
            // Content is full-height: screens scroll beneath the floating
            // dock and clear it via bottom content padding (dock clearance),
            // not via a reserved viewport margin.

            enterTransition = { fadeIn(animationSpec = tween(220)) },
            exitTransition = { fadeOut(animationSpec = tween(160)) },
            popEnterTransition = { fadeIn(animationSpec = tween(220)) },
            popExitTransition = { fadeOut(animationSpec = tween(160)) },
        ) {
            composable(Routes.INSTANCE_SETUP) {
                InstanceSetupScreen(
                    onDemoEnabled = {
                        navController.navigate(Routes.MAP) {
                            popUpTo(Routes.INSTANCE_SETUP) { inclusive = true }
                        }
                    },
                )
            }
            composable(Routes.SIGN_IN) {
                SignInScreen(
                    onSignedIn = {
                        navController.navigate(Routes.MAP) {
                            popUpTo(Routes.SIGN_IN) { inclusive = true }
                        }
                    },
                    onNeed2FA = { userId -> navController.navigate("two_factor/$userId") },
                    onSignUp = { navController.navigate(Routes.SIGN_UP) },
                    serverUrl = viewModel.instanceUrl,
                    onChangeServer = {
                        viewModel.reconfigureServer()
                        navController.navigate(Routes.INSTANCE_SETUP) {
                            popUpTo(Routes.MAP) { inclusive = true }
                        }
                    },
                    onForgotPassword = { navController.navigate(Routes.FORGOT_PASSWORD) },
                )
            }
            composable(Routes.SIGN_UP) {
                SignUpScreen(
                    onSignedUp = {
                        navController.navigate(Routes.MAP) {
                            popUpTo(Routes.SIGN_UP) { inclusive = true }
                        }
                    },
                    onBack = { navController.popBackStack() },
                )
            }
            composable(
                route = Routes.TWO_FACTOR,
                arguments = listOf(navArgument("userId") { type = NavType.StringType }),
            ) { entry ->
                TwoFactorScreen(
                    userId = entry.arguments?.getString("userId") ?: "",
                    onVerified = {
                        navController.navigate(Routes.MAP) {
                            popUpTo(Routes.SIGN_IN) { inclusive = true }
                        }
                    },
                )
            }
            composable(Routes.FORGOT_PASSWORD) {
                ForgotPasswordScreen(onBack = { navController.popBackStack() })
            }

            // ---- Tab screens ----
            composable(Routes.MAP) {
                HomeScreen(
                    onNotificationsClick = { navController.navigate(Routes.NOTIFICATIONS) },
                    onStatsClick = { navController.navigate(Routes.STATS) },
                    onTripClick = { trip: Trip -> navController.navigate("trip_detail/${trip.id}") },
                    onWishlistClick = { switchTab(Routes.WISHLIST) },
                    // Base route only — the pattern contains the {tripId}
                    // placeholder, and navigating it verbatim leaks the
                    // literal into the trip query (seen in server SQL logs).
                    onOpenMap = { navController.navigate("full_map") },
                    autoStartRecording = autoRecord,
                    onAutoActionConsumed = { autoRecord = false },
                )
            }
            composable(Routes.TRAVEL) {
                TripsListScreen(
                    onTripClick = { trip -> navController.navigate("trip_detail/${trip.id}") },
                    onNewTrip = {},
                    autoOpenCreate = autoNewTrip,
                    onAutoActionConsumed = { autoNewTrip = false },
                    onReviewSuggestions = { navController.navigate(Routes.SUGGESTIONS) },
                )
            }
            composable(Routes.WISHLIST) {
                WishlistScreen(
                    places = if (viewModel.isDemoMode) {
                        io.github.nimbleflux.wayli.demo.DemoData.wishlist
                    } else {
                        emptyList()
                    },
                )
            }
            composable(Routes.FITNESS) {
                io.github.nimbleflux.wayli.feature.fitness.FitnessListScreen(
                    onActivityClick = { activity ->
                        navController.navigate("fitness_detail/${activity.id}")
                    },
                    onImport = { navController.navigate(Routes.IMPORT_EXPORT) },
                )
            }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    demoMode = viewModel.isDemoMode,
                    serverUrl = viewModel.instanceUrl,
                    onProfile = { navController.navigate(Routes.PROFILE) },
                    onSecurity = { navController.navigate(Routes.SECURITY) },
                    onTrackingSettings = { navController.navigate(Routes.TRACKING_SETTINGS) },
                    onConnections = { navController.navigate(Routes.CONNECTIONS) },
                    onDataSampling = { navController.navigate(Routes.DATA_SAMPLING) },
                    onTripExclusions = { navController.navigate(Routes.TRIP_EXCLUSIONS) },
                    onImportExport = { navController.navigate(Routes.IMPORT_EXPORT) },
                    onPreferences = { navController.navigate(Routes.PREFERENCES) },
                    onAdminUsers = { navController.navigate(Routes.ADMIN_USERS) },
                    onAdminMaintenance = { navController.navigate(Routes.ADMIN_MAINTENANCE) },
                    onJobs = { navController.navigate(Routes.JOBS) },
                    onReconfigureServer = {
                        viewModel.reconfigureServer()
                        navController.navigate(Routes.INSTANCE_SETUP) {
                            popUpTo(Routes.MAP) { inclusive = true }
                        }
                    },
                    onSignOut = {
                        val dest = if (viewModel.isDemoMode) Routes.INSTANCE_SETUP else Routes.SIGN_IN
                        viewModel.signOut()
                        navController.navigate(dest) {
                            popUpTo(Routes.MAP) { inclusive = true }
                        }
                    },
                )
            }

            // ---- Pushed screens ----
            composable(
                route = Routes.TRIP_DETAIL,
                arguments = listOf(navArgument("tripId") { type = NavType.StringType }),
            ) { entry ->
                val detailVm: io.github.nimbleflux.wayli.feature.travel.TripDetailViewModel =
                    androidx.hilt.navigation.compose.hiltViewModel(entry)

                // Apply the editor's save result when we come back to this entry.
                val entrySaved by entry.savedStateHandle
                    .getStateFlow("entry_saved", false)
                    .collectAsState()
                LaunchedEffect(entrySaved) {
                    if (entrySaved) {
                        entry.savedStateHandle["entry_saved"] = false
                        val saved = io.github.nimbleflux.wayli.feature.travel.EntryEditorResultCache.entry
                        io.github.nimbleflux.wayli.feature.travel.EntryEditorResultCache.entry = null
                        detailVm.applyEditorResult(saved)
                    }
                }

                TripDetailScreen(
                    onBack = { navController.popBackStack() },
                    onOpenDraft = { draft ->
                        navController.navigate("entry_editor/${detailVm.tripId}?draftId=${draft.id}")
                    },
                    onOpenEntry = { journalEntry ->
                        // Entries open in the read view; Edit lives in its top bar.
                        navController.navigate("entry_detail/${detailVm.tripId}/${journalEntry.id}")
                    },
                    onNewEntry = {
                        navController.navigate("entry_editor/${detailVm.tripId}")
                    },
                    viewModel = detailVm,
                )
            }
            composable(
                route = Routes.FITNESS_DETAIL,
                arguments = listOf(navArgument("activityId") { type = NavType.StringType }),
            ) { entry ->
                io.github.nimbleflux.wayli.feature.fitness.FitnessDetailScreen(
                    activityId = entry.arguments?.getString("activityId").orEmpty(),
                    onBack = { navController.popBackStack() },
                    onOpenNeighbour = { id ->
                        // Replace the current detail with the neighbour's.
                        navController.navigate("fitness_detail/$id") {
                            popUpTo(Routes.FITNESS)
                            launchSingleTop = true
                        }
                    },
                )
            }
            composable(
                route = Routes.ENTRY_DETAIL,
                arguments = listOf(
                    navArgument("tripId") { type = NavType.StringType },
                    navArgument("entryId") { type = NavType.StringType },
                ),
            ) {
                io.github.nimbleflux.wayli.feature.travel.EntryDetailScreen(
                    onBack = { navController.popBackStack() },
                    onEdit = { entry ->
                        // Stash for instant prefill (demo in-memory entries have no server copy).
                        io.github.nimbleflux.wayli.feature.travel.EntryEditorInputCache.entry = entry
                        navController.navigate("entry_editor/${entry.tripId}?entryId=${entry.id}")
                    },
                )
            }
            composable(
                route = Routes.ENTRY_EDITOR,
                arguments = listOf(
                    navArgument("tripId") { type = NavType.StringType },
                    navArgument("entryId") {
                        type = NavType.StringType
                        defaultValue = ""
                    },
                    navArgument("draftId") {
                        type = NavType.StringType
                        defaultValue = ""
                    },
                ),
            ) {
                io.github.nimbleflux.wayli.feature.travel.EntryEditorScreen(
                    onBack = { navController.popBackStack() },
                    onSaved = {
                        navController.previousBackStackEntry
                            ?.savedStateHandle?.set("entry_saved", true)
                        navController.popBackStack()
                    },
                )
            }
            composable(
                Routes.FULL_MAP,
                arguments = listOf(
                    androidx.navigation.navArgument("tripId") {
                        type = androidx.navigation.NavType.StringType
                        defaultValue = ""
                    },
                ),
            ) {
                io.github.nimbleflux.wayli.feature.map.FullMapScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.SUGGESTIONS) {
                io.github.nimbleflux.wayli.feature.travel.SuggestionsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.STATS) {
                StatsScreen(
                    demoMode = viewModel.isDemoMode,
                    onBack = { navController.popBackStack() },
                )
            }
            composable(Routes.TRACKING_SETTINGS) {
                TrackingSettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.PROFILE) {
                ProfileEditScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.SECURITY) {
                SecuritySettingsScreen(
                    onBack = { navController.popBackStack() },
                    demoMode = viewModel.isDemoMode,
                    onTwoFactor = { navController.navigate(Routes.TWO_FACTOR_SETUP) },
                )
            }
            composable(Routes.PREFERENCES) {
                PreferencesScreen(
                    onBack = { navController.popBackStack() },
                    // The fitness beta flag may have changed — refresh the dock tab.
                    onSaved = { viewModel.refreshFitnessBeta() },
                )
            }
            composable(Routes.CONNECTIONS) {
                ConnectionsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.DATA_SAMPLING) {
                DataSamplingScreen(onBack = { navController.popBackStack() }, demoMode = viewModel.isDemoMode)
            }
            composable(Routes.TWO_FACTOR_SETUP) {
                TwoFactorSetupScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.TRIP_EXCLUSIONS) {
                TripExclusionsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.IMPORT_EXPORT) {
                ImportExportScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.ADMIN_USERS) {
                AdminUsersScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.ADMIN_MAINTENANCE) {
                AdminMaintenanceScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.JOBS) {
                io.github.nimbleflux.wayli.feature.jobs.JobsScreen(
                    onBack = { navController.popBackStack() },
                )
            }
            composable(Routes.NOTIFICATIONS) {
                io.github.nimbleflux.wayli.feature.notifications.NotificationsScreen(
                    onBack = { navController.popBackStack() },
                )
            }
        }

        // Floating dock navigation — persistent on every screen except the
        // auth/setup flow, where a logged-out user must not see (or tap) the
        // main menu; the tab highlight only applies on tab routes. NavHost
        // content is padded so screens clear the dock.
        androidx.compose.animation.AnimatedVisibility(
            visible = !isAuthRoute,
            enter = androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(200)),
            exit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(150)),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .zIndex(4f),
        ) {
            Box {
                WayliBottomBar(
                    tabs = visibleTabs,
                    currentRoute = activeTab,
                    onTabSelected = switchTab,
                )
            }
        }
    }

    // Share-target inbox: pick which trip receives the shared text/photos.
    val sharedAction = quickAction as? io.github.nimbleflux.wayli.util.QuickActionBus.QuickAction.Shared
    if (sharedAction != null) {
        ShareInboxDialog(
            shared = sharedAction,
            viewModel = viewModel,
            onDismiss = { io.github.nimbleflux.wayli.util.QuickActionBus.consume() },
            onSaved = { tripId, draftId ->
                io.github.nimbleflux.wayli.util.QuickActionBus.consume()
                navController.navigate("entry_editor/${tripId}?entryId=&draftId=$draftId")
            },
        )
    }
}

@Composable
private fun ShareInboxDialog(
    shared: io.github.nimbleflux.wayli.util.QuickActionBus.QuickAction.Shared,
    viewModel: NavViewModel,
    onDismiss: () -> Unit,
    onSaved: (tripId: String, draftId: String) -> Unit,
) {
    val trips by viewModel.inboxTrips.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.loadInboxTrips() }
    val saving = androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { androidx.compose.material3.Text("Save to trip") },
        text = {
            androidx.compose.foundation.layout.Column {
                androidx.compose.material3.Text(
                    buildString {
                        shared.text?.let { append("\"").append(it.take(80)).append("\"") }
                        if (shared.photoPaths.isNotEmpty()) {
                            if (isNotEmpty()) append("\n")
                            append("${shared.photoPaths.size} photo(s)")
                        }
                    },
                    style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                )
                if (trips.isEmpty()) {
                    androidx.compose.material3.Text(
                        if (saving.value) "Saving…" else "No trips yet — create one first.",
                        style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                        color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    trips.take(6).forEach { trip ->
                        androidx.compose.material3.TextButton(
                            onClick = {
                                if (!saving.value) {
                                    saving.value = true
                                    viewModel.viewModelScope.launch {
                                        val draftId = viewModel.saveSharedDraft(trip.id, shared.text, shared.photoPaths)
                                        onSaved(trip.id, draftId)
                                    }
                                }
                            },
                        ) {
                            androidx.compose.material3.Text(trip.title)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { androidx.compose.material3.Text("Cancel") }
        },
    )
}
