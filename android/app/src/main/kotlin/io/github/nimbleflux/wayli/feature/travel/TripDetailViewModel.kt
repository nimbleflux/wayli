package io.github.nimbleflux.wayli.feature.travel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.demo.DemoData
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.repo.DraftRepository
import io.github.nimbleflux.wayli.repo.StatsRepository
import io.github.nimbleflux.wayli.repo.TripRepository
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TripDetailData(
    val trip: Trip,
)

sealed interface TripDetailUiState {
    data object Loading : TripDetailUiState
    data class Error(val message: String) : TripDetailUiState
    data class Success(val data: TripDetailData) : TripDetailUiState
}

/**
 * Loads a single trip and its journal entries by id (from the nav
 * SavedStateHandle). Demo mode serves [DemoData]; real mode calls the repos.
 * Journal entries are exposed as a separate [StateFlow] so [addEntry] can
 * prepend (in-memory for demo, persisted for real instances).
 *
 * The trip's GPS track ([track]) comes from DemoData in demo mode and from
 * `tracker_data` between the trip's start/end dates in real mode.
 */
@HiltViewModel
class TripDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val demoManager: DemoManager,
    private val tripRepo: TripRepository,
    private val statsRepo: StatsRepository,
    private val client: FluxbaseClient,
    private val draftRepo: DraftRepository,
    private val mediaUploader: io.github.nimbleflux.wayli.feature.media.MediaUploader,
    private val instanceManager: io.github.nimbleflux.wayli.session.InstanceManager,
    private val userRepo: io.github.nimbleflux.wayli.repo.UserRepository,
) : ViewModel() {

    val tripId: String = savedStateHandle.get<String>("tripId") ?: ""

    private val _state = MutableStateFlow<TripDetailUiState>(TripDetailUiState.Loading)
    val state: StateFlow<TripDetailUiState> = _state.asStateFlow()

    private val _entries = MutableStateFlow<List<TripEntry>>(emptyList())
    val entries: StateFlow<List<TripEntry>> = _entries.asStateFlow()

    /** Ordered (lat, lon) coordinates for the trip map; empty = no track. */
    private val _track = MutableStateFlow<List<Pair<Double, Double>>>(emptyList())
    val track: StateFlow<List<Pair<Double, Double>>> = _track.asStateFlow()

    /** Signed URLs per media id (all media of the trip). */
    private val _mediaUrls = MutableStateFlow<Map<String, String>>(emptyMap())
    val mediaUrls: StateFlow<Map<String, String>> = _mediaUrls.asStateFlow()

    /** Raw media rows (id, entryId, cover resolution order preserved). */
    private val _media = MutableStateFlow<List<io.github.nimbleflux.wayli.models.TripMedia>>(emptyList())
    val media: StateFlow<List<io.github.nimbleflux.wayli.models.TripMedia>> = _media.asStateFlow()

    /**
     * The entry's hero photo URL (cover_media_id → first by sort_order —
     * the web's cover-resolution rule), or null when the entry has no media.
     */
    fun heroFor(entry: TripEntry): String? {
        val rows = _media.value.filter { it.entryId == entry.id }
        if (rows.isEmpty()) return null
        val cover = entry.coverMediaId?.let { id -> rows.firstOrNull { it.id == id } }
        val chosen = cover ?: rows.first()
        return _mediaUrls.value[chosen.id]
    }

    /** The trip's cover for the hero header: image_url → first trip media. */
    fun tripCoverFor(trip: Trip): String? =
        trip.imageUrl ?: _media.value.firstOrNull()?.let { _mediaUrls.value[it.id] }

    val isDemoMode: Boolean = demoManager.isDemoMode

    init {
        load()
    }

    private fun load() {
        if (demoManager.isDemoMode) {
            val trip = DemoData.trips.firstOrNull { it.id == tripId }
            if (trip == null) {
                _state.value = TripDetailUiState.Error("Trip not found")
                return
            }
            _state.value = TripDetailUiState.Success(TripDetailData(trip))
            _entries.value = DemoData.entries[tripId].orEmpty()
                .sortedWith(compareByDescending<TripEntry> { it.entryDate }.thenByDescending { it.createdAt })
            _track.value = DemoData.tripTracks[tripId].orEmpty()
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            // Stale-while-revalidate: paint the Room-cached trip/entries/track
            // immediately (re-opening a trip must not re-wait on the network —
            // every fetch used to be network-first), then refresh in place.
            val staleTrip = tripRepo.getTripCached(tripId)
            if (staleTrip != null) {
                _state.value = TripDetailUiState.Success(TripDetailData(staleTrip))
                _entries.value = tripRepo.listEntriesCached(tripId)
                // Track starts right here from the stale dates — it no longer
                // serializes behind the network trip fetch.
                loadTrackFor(staleTrip)
            } else {
                _state.value = TripDetailUiState.Loading
            }
            // Trip, entries, and media don't depend on each other — fetch them
            // concurrently so the screen isn't a serial chain of round trips.
            coroutineScope {
                val tripDeferred = async { tripRepo.getTrip(tripId) }
                val entriesDeferred = async { tripRepo.listEntries(tripId) }
                val mediaDeferred = async { loadMedia() }

                tripDeferred.await()
                    .onSuccess { trip ->
                        _state.value = TripDetailUiState.Success(TripDetailData(trip))
                        _entries.value = entriesDeferred.await().getOrDefault(emptyList())
                        loadTrackFor(trip)
                    }
                    .onFailure {
                        // A stale paint stays on screen when the refresh fails
                        // (serve-stale beats an error screen). The first-ever
                        // open has nothing cached: a dead session shows its own
                        // message — the expiry bus (fired by the arbiter in
                        // withCache) performs the sign-in routing meanwhile.
                        if (_state.value !is TripDetailUiState.Success) {
                            _state.value = TripDetailUiState.Error(
                                if (io.github.nimbleflux.wayli.session.isSessionDeadError(it)) {
                                    "Session expired — please sign in again"
                                } else {
                                    it.message ?: "Failed to load trip"
                                },
                            )
                        }
                    }
                mediaDeferred.await()
            }
        }
    }

    /** Fetch the trip's media rows and sign their display URLs in parallel. */
    private suspend fun loadMedia() {
        val rows = tripRepo.listMedia(tripId).getOrDefault(emptyList())
        _media.value = rows
        val urls = coroutineScope {
            rows.map { m ->
                async {
                    mediaUploader.resolveDisplayUrl(storagePath = m.storagePath)?.let { m.id to it }
                }
            }.map { it.await() }.filterNotNull().toMap()
        }
        _mediaUrls.value = urls
    }

    /** Date range the track was last painted/refreshed for — skips a duplicate fetch. */
    private var loadedTrackDates: Pair<String, String>? = null

    /**
     * Paint the cached polyline immediately, then refresh it from the network
     * in place. Called first from the stale paint (cached trip dates) and
     * again when the fresh trip arrives — the [loadedTrackDates] guard makes
     * the second call a no-op unless the trip's dates changed.
     */
    private suspend fun loadTrackFor(trip: Trip) {
        val userId = client.auth.currentSession?.user?.id ?: return
        val end = trip.endDate ?: java.time.LocalDate.now().toString()
        val dates = trip.startDate to end
        if (loadedTrackDates == dates) return
        loadedTrackDates = dates
        statsRepo.fetchTrackCached(userId, trip.startDate, end)?.let { _track.value = it }
        _track.value = statsRepo.fetchTrack(userId, trip.startDate, end).getOrDefault(_track.value)
    }

    // ---- Editor integration ----

    private val _drafts = MutableStateFlow<List<io.github.nimbleflux.wayli.repo.EntryDraft>>(emptyList())
    val drafts: StateFlow<List<io.github.nimbleflux.wayli.repo.EntryDraft>> = _drafts.asStateFlow()

    init {
        refreshDrafts()
    }

    /** Reload the trip's local drafts (cards with title + edit button). */
    fun refreshDrafts() {
        viewModelScope.launch(Dispatchers.IO) {
            _drafts.value = draftRepo.listForTrip(tripId)
        }
    }

    /** Discard a local draft after confirmation on the trip screen. */
    fun deleteDraft(id: String) {
        viewModelScope.launch(Dispatchers.IO) {
            draftRepo.delete(id)
            refreshDrafts()
        }
    }

    /**
     * Called when returning from the editor. In real mode (or when no
     * in-memory entry was handed back) the entries reload; demo entries are
     * upserted into the in-memory list.
     */
    fun applyEditorResult(entry: TripEntry?) {
        if (entry != null && (demoManager.isDemoMode || entry.id.startsWith("local-"))) {
            // Newest first — re-sort instead of prepend so an older-dated
            // entry lands in its chronological slot.
            _entries.value = (_entries.value.filter { it.id != entry.id } + entry)
                .sortedWith(compareByDescending<TripEntry> { it.entryDate }.thenByDescending { it.createdAt })
        } else if (!demoManager.isDemoMode) {
            viewModelScope.launch(Dispatchers.IO) {
                tripRepo.listEntries(tripId)
                    .onSuccess { _entries.value = it }
            }
        }
        refreshDrafts()
    }

    // ---- Edit / share / delete ----

    private var cachedUsername: String? = null

    /** The shareable web URL, or null when the instance has no known web app. */
    suspend fun shareLinkFor(trip: Trip): String? {
        val webUrl = instanceManager.getConfig()?.webUrl ?: return null
        val username = cachedUsername ?: run {
            val userId = client.auth.currentSession?.user?.id ?: return null
            userRepo.getProfile(userId).getOrNull()?.username?.also { cachedUsername = it }
        } ?: return null
        return "$webUrl/u/$username/trips/${trip.id}"
    }

    /** One-shot upload error surfaced by the screen as a snackbar. */
    val uploadError = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)

    /** Pending hero image for the trip editor: uploaded URL or null=unchanged. */
    val heroImage = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val heroImageCleared = kotlinx.coroutines.flow.MutableStateFlow(false)
    val heroUploading = kotlinx.coroutines.flow.MutableStateFlow(false)

    /** Upload a picked image to the covers folder; the URL feeds the editor. */
    fun pickHeroImage(context: android.content.Context, uri: android.net.Uri) {
        if (demoManager.isDemoMode) return
        val userId = client.auth.currentSession?.user?.id ?: return
        viewModelScope.launch {
            heroUploading.value = true
            mediaUploader.uploadPhoto(
                context,
                uri,
                bucket = "trip-images",
                pathPrefix = "$userId/covers",
            )
                .onSuccess { url ->
                    heroImage.value = url
                    heroImageCleared.value = false
                }
                .onFailure { uploadError.value = "Couldn't upload the image: ${it.message ?: "error"}" }
            heroUploading.value = false
        }
    }

    fun clearHeroImage() {
        heroImage.value = null
        heroImageCleared.value = true
    }

    fun updateTrip(
        tripId: String,
        title: String,
        description: String?,
        startDate: String,
        endDate: String?,
        visibility: String,
        onDone: (Boolean) -> Unit = {},
    ) {
        if (demoManager.isDemoMode) {
            val current = (_state.value as? TripDetailUiState.Success)?.data?.trip ?: return
            _state.value = TripDetailUiState.Success(
                TripDetailData(current.copy(title = title, description = description, startDate = startDate, endDate = endDate, visibility = visibility)),
            )
            onDone(true)
            return
        }
        val newHero = heroImage.value
        val clearHero = heroImageCleared.value
        viewModelScope.launch(Dispatchers.IO) {
            val result = tripRepo.updateTrip(
                tripId, title, description, startDate, endDate, visibility,
                imageUrl = newHero,
                clearImage = clearHero,
            )
            heroImage.value = null
            heroImageCleared.value = false
            load()
            kotlinx.coroutines.withContext(Dispatchers.Main) { onDone(result.isSuccess) }
        }
    }

    fun setVisibility(trip: Trip, visibility: String, onDone: (Boolean) -> Unit = {}) {
        if (demoManager.isDemoMode) {
            updateTrip(trip.id, trip.title, trip.description, trip.startDate, trip.endDate, visibility, onDone)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val result = tripRepo.updateTrip(trip.id, visibility = visibility)
            kotlinx.coroutines.withContext(Dispatchers.Main) { onDone(result.isSuccess) }
        }
    }

    fun deleteTrip(tripId: String, onDone: (Boolean) -> Unit = {}) {
        if (demoManager.isDemoMode) {
            onDone(true)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val result = tripRepo.deleteTrip(tripId)
            kotlinx.coroutines.withContext(Dispatchers.Main) { onDone(result.isSuccess) }
        }
    }

    fun deleteEntry(entry: TripEntry, onDone: (Boolean) -> Unit = {}) {
        if (demoManager.isDemoMode || entry.id.startsWith("local-")) {
            _entries.value = _entries.value.filter { it.id != entry.id }
            onDone(true)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val result = tripRepo.deleteEntry(entry.id)
            if (result.isSuccess) {
                tripRepo.listEntries(tripId).onSuccess { _entries.value = it }
            }
            kotlinx.coroutines.withContext(Dispatchers.Main) { onDone(result.isSuccess) }
        }
    }
}
