package io.github.nimbleflux.wayli.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.demo.DemoData
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.models.Notification
import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.models.UserProfile
import io.github.nimbleflux.wayli.models.WantToVisit
import io.github.nimbleflux.wayli.repo.StatsAggregator
import io.github.nimbleflux.wayli.repo.StatsRepository
import io.github.nimbleflux.wayli.repo.TripRepository
import io.github.nimbleflux.wayli.repo.UserRepository
import io.github.nimbleflux.wayli.designsystem.DateRange
import io.github.nimbleflux.wayli.designsystem.toDates
import io.github.nimbleflux.wayli.repo.WishlistRepository
import java.time.LocalDate
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch

/** Headline numbers shown in the "At a glance" grid. */
data class HomeStats(
    val distanceKm: String,
    val countries: String,
    val timeMovingHours: String,
    val trips: String,
)

/** Everything the Home dashboard renders. */
data class HomeData(
    val profile: UserProfile?,
    val initials: String,
    val stats: HomeStats,
    val trips: List<Trip>,
    val wishlist: List<WantToVisit>,
    val activity: List<Notification>,
)

sealed interface HomeUiState {
    data object Loading : HomeUiState
    data class Error(val message: String) : HomeUiState
    data class Success(val data: HomeData) : HomeUiState
}

/** Results of [HomeViewModel]'s parallel initial fetches. */
private data class LoadResults(
    val trips: kotlin.Result<List<Trip>>,
    val wishlist: List<WantToVisit>,
    val profile: UserProfile?,
    val notifications: List<Notification>,
)

/**
 * Feeds the Home dashboard. In demo mode it serves [DemoData] instantly so the
 * front page is immediately full of content. In real mode it loads trips +
 * wishlist from the repositories (stats beyond trip count aren't aggregated
 * client-side yet, so they show "—").
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val demoManager: DemoManager,
    private val fluxbaseClient: FluxbaseClient,
    private val tripRepo: TripRepository,
    private val wishlistRepo: WishlistRepository,
    private val statsRepo: StatsRepository,
    private val userRepo: UserRepository,
    private val notificationRepo: io.github.nimbleflux.wayli.repo.NotificationRepository,
    private val sessionArbiter: io.github.nimbleflux.wayli.session.SessionArbiter,
    private val rangeStore: io.github.nimbleflux.wayli.feature.stats.StatsRangeStore,
    onlineMonitor: io.github.nimbleflux.wayli.util.OnlineMonitor,
) : ViewModel() {

    private val _uiState = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    /** Set once a 401 declares the persisted session dead; blocks retry loops. */
    @Volatile private var sessionDead = false

    val isDemoMode: Boolean = demoManager.isDemoMode

    /** Live connectivity — drives the offline banner (cached data served). */
    val online: StateFlow<Boolean> = onlineMonitor.online

    /** Selected stats period — shared with Statistics; stats and the map track react to it. */
    private val _selectedRange = MutableStateFlow(rangeStore.range.value)
    val selectedRange: StateFlow<DateRange> = _selectedRange.asStateFlow()

    /** Ordered (lat, lon) coordinates for the map card over the selected range. */
    private val _track = MutableStateFlow<List<Pair<Double, Double>>>(emptyList())
    val track: StateFlow<List<Pair<Double, Double>>> = _track.asStateFlow()

    /** Transport-mode-colored polyline segments for the map card. */
    private val _trackSegments = MutableStateFlow<List<StatsAggregator.TrackSegment>>(emptyList())
    val trackSegments: StateFlow<List<StatsAggregator.TrackSegment>> = _trackSegments.asStateFlow()

    /** ISO alpha-2 country codes visited in the selected range (world map). */
    private val _visitedCountries = MutableStateFlow<Set<String>>(emptySet())
    val visitedCountries: StateFlow<Set<String>> = _visitedCountries.asStateFlow()

    init {
        load()
        // Reload when the session is (re)established — e.g. the OAuth return
        // after a cold start restored a dead token: the first load() failed,
        // and without this the dashboard would stay empty until a process
        // death. Mirrors the routing collector in WayliNavHost.
        viewModelScope.launch {
            callbackFlow {
                val unsubscribe = fluxbaseClient.auth.onAuthStateChange { trySend(it) }
                awaitClose { unsubscribe() }
            }.collect { state ->
                val event = state.event
                val signedIn = event == io.github.nimbleflux.fluxbase.auth.AuthChangeEvent.SIGNED_IN ||
                    event == io.github.nimbleflux.fluxbase.auth.AuthChangeEvent.TOKEN_REFRESHED
                // Once the session is declared dead, stop reacting to auth
                // events entirely — the failed-refresh cycle keeps emitting
                // them and would loop the dashboard between Loading/Error.
                if (signedIn && !sessionDead && !demoManager.isDemoMode && _uiState.value !is HomeUiState.Loading) {
                    load()
                }
            }
        }
    }

    fun setRange(range: DateRange) {
        if (_selectedRange.value == range) return
        _selectedRange.value = range
        rangeStore.set(range)
        loadWindow()
    }

    /** In-flight initial load, so retries/auth-event reloads can't overlap it. */
    private var loadJob: kotlinx.coroutines.Job? = null

    /** True while a silent (keep-content) refresh runs — pull-to-refresh. */
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    fun load(silent: Boolean = false) {
        if (sessionDead || demoManager.isDemoMode) {
            _track.value = DemoData.homeTrack
            _trackSegments.value = listOf(
                StatsAggregator.TrackSegment("car", DemoData.homeTrack.take(DemoData.homeTrack.size / 2)),
                StatsAggregator.TrackSegment("walking", DemoData.homeTrack.drop(DemoData.homeTrack.size / 2)),
            )
            _visitedCountries.value = DemoData.visitedCountries
            val d = DemoData
            _uiState.value = HomeUiState.Success(
                HomeData(
                    profile = d.profile,
                    initials = initials(d.profile),
                    stats = HomeStats(
                        distanceKm = formatNumber(d.totalDistanceKm),
                        countries = d.countriesVisited.toString(),
                        timeMovingHours = d.timeMovingHours.toString(),
                        trips = d.trips.size.toString(),
                    ),
                    trips = d.trips.sortedByDescending { it.startDate },
                    wishlist = d.wishlist,
                    activity = d.notifications,
                ),
            )
            return
        }
        val userId = fluxbaseClient.auth?.currentSession?.user?.id ?: run {
            _uiState.value = HomeUiState.Error("Not authenticated")
            return
        }
        loadJob?.cancel()
        val keepContent = silent && _uiState.value is HomeUiState.Success
        loadJob = viewModelScope.launch(Dispatchers.IO) {
            if (keepContent) _refreshing.value = true else _uiState.value = HomeUiState.Loading
            try {
            // Parallel fetches — the dashboard's first paint waits on the
            // slowest call, not the sum of all of them.
            val results = coroutineScope {
                val trips = async { tripRepo.listTrips(userId) }
                val wishlist = async { wishlistRepo.listPlaces(userId) }
                val profile = async { userRepo.getProfile(userId).getOrNull() }
                val notifications = async {
                    notificationRepo.list(userId, limit = 20).getOrDefault(emptyList())
                }
                LoadResults(
                    trips = trips.await(),
                    wishlist = wishlist.await().getOrDefault(emptyList()),
                    profile = profile.await(),
                    notifications = notifications.await(),
                )
            }
            val tripsValue = results.trips.getOrNull()
            if (tripsValue != null) {
                // Android sign-ups (and some OAuth flows) can miss creating
                // the user_profiles row — the web bootstraps it on every
                // sign-in. Lazily ensure it exists instead of greeting the
                // user as "Traveler" forever.
                val profile = results.profile ?: run {
                    userRepo.ensureProfile(userId).getOrNull() ?: userRepo.getProfile(userId).getOrNull()
                }
                _uiState.value = HomeUiState.Success(
                    HomeData(
                        profile = profile,
                        initials = initials(profile),
                        stats = HomeStats("", "", "", tripsValue.size.toString()),
                        trips = tripsValue,
                        wishlist = results.wishlist,
                        activity = results.notifications,
                    ),
                )
                loadWindow()
            } else {
                val error = results.trips.exceptionOrNull()
                // A 401-shaped failure must be adjudicated before it is
                // treated as fatal: it only proves one refresh attempt
                // didn't yield a working token, which includes transient
                // network failures. Only a refresh endpoint rejection
                // (SessionArbiter's DEAD verdict) signs the user out.
                if (io.github.nimbleflux.wayli.session.isSessionDeadError(error)) {
                    when (sessionArbiter.adjudicate("home:trips", error)) {
                        io.github.nimbleflux.wayli.session.SessionArbiter.Verdict.DEAD -> {
                            // NEVER gate the UI on the sign-out network call —
                            // a hanging POST here froze the dashboard on a
                            // blank Loading screen. WayliNavHost performs the
                            // hardened sign-out and routes to sign-in via the
                            // bus (fired by the arbiter).
                            sessionDead = true
                            _uiState.value = HomeUiState.Error("Session expired — please sign in again")
                            return@launch
                        }
                        io.github.nimbleflux.wayli.session.SessionArbiter.Verdict.RECOVERED -> {
                            // The refresh just rotated the token — retry once
                            // with the working session instead of surfacing
                            // the stale 401.
                            load(silent = keepContent)
                            return@launch
                        }
                        // Transient (network/5xx): connectivity-style error,
                        // NOT a dead session — the SDK background loop
                        // recovers and auth events trigger a reload.
                        io.github.nimbleflux.wayli.session.SessionArbiter.Verdict.TRANSIENT -> Unit
                    }
                }
                _uiState.value = HomeUiState.Error(error?.message ?: "Couldn't load — check your connection")
            }
            } finally {
                if (keepContent) _refreshing.value = false
            }
        }
    }

    /** True while the range-scoped stats/map window is re-fetching. */
    private val _windowLoading = MutableStateFlow(false)
    val windowLoading: StateFlow<Boolean> = _windowLoading.asStateFlow()

    /** Transient "couldn't refresh the window" hint — previous numbers stay. */
    private val _windowError = MutableStateFlow(false)
    val windowError: StateFlow<Boolean> = _windowError.asStateFlow()

    private var windowJob: kotlinx.coroutines.Job? = null

    /** Reload stats + map track for the selected range (real mode). */
    private fun loadWindow() {
        if (demoManager.isDemoMode) return
        val userId = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        if (_uiState.value !is HomeUiState.Success) return
        // Capture the triggering range up front — the fetch must answer the
        // selection that started it, whatever the user taps next.
        val range = _selectedRange.value
        // Cancel any in-flight window load so a slow old range can never
        // overwrite the results of a newer one.
        windowJob?.cancel()
        windowJob = viewModelScope.launch(Dispatchers.IO) {
            _windowLoading.value = true
            try {
                val (start, end) = range.toDates()
                val (dailyResult, pointsResult, countriesResult) = coroutineScope {
                    val dailyDeferred = async {
                        statsRepo.fetchDailyActivity(userId, start.toString(), end.toString())
                    }
                    val pointsDeferred = async {
                        statsRepo.fetchPoints(userId, start.toString(), end.toString())
                    }
                    val countriesDeferred = async {
                        statsRepo.fetchCountryCodes(userId, start.toString(), end.toString())
                    }
                    Triple(dailyDeferred.await(), pointsDeferred.await(), countriesDeferred.await())
                }
                val daily = dailyResult.getOrNull().orEmpty()
                val pointRows = pointsResult.getOrNull().orEmpty()

                if (dailyResult.isFailure && pointsResult.isFailure && countriesResult.isFailure) {
                    // A 401-shaped failure must be adjudicated before it is
                    // treated as a transient blip — the same rule as load().
                    if (adjudicateWindowAuth(listOf(dailyResult, pointsResult, countriesResult))) {
                        return@launch
                    }
                    // Keep the previous numbers on screen — zeroing them out
                    // on a flaky connection would look like lost data.
                    _windowError.value = true
                    return@launch
                }
                _windowError.value = false

                val totals = if (daily.isNotEmpty()) {
                    StatsAggregator.totalsFromDailyActivity(daily)
                } else {
                    StatsAggregator.totalsFromPoints(pointRows)
                }

                if (pointsResult.isSuccess) {
                    _track.value = StatsAggregator.track(pointRows)
                    _trackSegments.value = StatsAggregator.segmentsByMode(pointRows)
                }
                val countriesValue = countriesResult.getOrNull()
                if (countriesValue != null) {
                    _visitedCountries.value = countriesValue.toSet()
                }

                // Write back into the CURRENT state (not a pre-launch
                // snapshot) — the dashboard may have reloaded meanwhile.
                val current = _uiState.value as? HomeUiState.Success ?: return@launch
                _uiState.value = current.copy(
                    data = current.data.copy(
                        stats = HomeStats(
                            distanceKm = "%.0f".format(totals.totalDistanceKm),
                            countries = (countriesValue?.size ?: current.data.stats.countries.toIntOrNull() ?: 0).toString(),
                            timeMovingHours = "%.0f".format(totals.timeMovingHours),
                            trips = current.data.stats.trips,
                        ),
                    ),
                )
            } finally {
                _windowLoading.value = false
            }
        }
    }

    /**
     * Adjudicates a session-dead-shaped stats-window failure — the same rule
     * as [load]: only a double-confirmed refresh rejection (DEAD) ends the
     * session (the arbiter fires the expiry bus, which routes to sign-in).
     * Returns true when the verdict was handled (DEAD surfaced, RECOVERED
     * reloaded the window); false for TRANSIENT, where the caller keeps the
     * previous numbers with the connectivity-style banner.
     */
    private suspend fun adjudicateWindowAuth(failures: List<kotlin.Result<*>>): Boolean {
        val deadCandidate = failures.firstNotNullOfOrNull { it.exceptionOrNull() }
            ?.takeIf { io.github.nimbleflux.wayli.session.isSessionDeadError(it) } ?: return false
        return when (sessionArbiter.adjudicate("home:window", deadCandidate)) {
            io.github.nimbleflux.wayli.session.SessionArbiter.Verdict.DEAD -> {
                sessionDead = true
                _uiState.value = HomeUiState.Error("Session expired — please sign in again")
                true
            }
            io.github.nimbleflux.wayli.session.SessionArbiter.Verdict.RECOVERED -> {
                // The refresh just rotated the token — retry the window
                // with the working session.
                loadWindow()
                true
            }
            // Transient (network/5xx): connectivity-style failure, not a
            // dead session — the banner is the honest message.
            io.github.nimbleflux.wayli.session.SessionArbiter.Verdict.TRANSIENT -> false
        }
    }

    /**
     * Re-list notifications into the current Success state — called on every
     * ON_RESUME so the bell badge reflects marks made in the tray (the list
     * is cache-backed, so this is instant and reflects mark-read mirrors).
     */
    fun refreshActivity() {
        if (demoManager.isDemoMode || sessionDead) return
        val userId = fluxbaseClient.auth?.currentSession?.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val notifications = notificationRepo.list(userId, limit = 20).getOrDefault(emptyList())
            val current = _uiState.value as? HomeUiState.Success ?: return@launch
            _uiState.value = current.copy(data = current.data.copy(activity = notifications))
        }
    }

    /** Retry the stats window after the "Couldn't refresh" banner appeared. */
    fun retryWindow() {
        if (_windowError.value && !sessionDead) loadWindow()
    }

    private fun initials(profile: UserProfile?): String {
        val first = profile?.firstName?.firstOrNull()?.uppercase() ?: ""
        val last = profile?.lastName?.firstOrNull()?.uppercase() ?: ""
        return "$first$last".ifBlank { "W" }
    }

    private fun formatNumber(n: Int): String = "%,d".format(n)
}
