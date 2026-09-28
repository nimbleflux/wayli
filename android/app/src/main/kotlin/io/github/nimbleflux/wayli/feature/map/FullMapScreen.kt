package io.github.nimbleflux.wayli.feature.map

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.designsystem.MapLegend
import io.github.nimbleflux.wayli.designsystem.map.MapTrack
import io.github.nimbleflux.wayli.designsystem.map.MapPhoto
import io.github.nimbleflux.wayli.designsystem.map.WayliMap
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.designsystem.toDates
import io.github.nimbleflux.wayli.repo.ImmichRepository
import io.github.nimbleflux.wayli.repo.StatsRepository
import io.github.nimbleflux.wayli.repo.TripRepository
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.maplibre.android.geometry.LatLng

/**
 * Fullscreen, fully-interactive map. Mini maps inside scrollable lists have
 * pan disabled (gesture conflict), so their expand affordances land here:
 * with an optional tripId it draws that trip's track; otherwise the track
 * for the selected stats range.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FullMapScreen(
    onBack: () -> Unit,
    viewModel: FullMapViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    Scaffold(
        // Viewport reaches the screen bottom; the map extends beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Map") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.Center,
        ) {
            when (val s = state) {
                is FullMapUiState.Loading -> CircularProgressIndicator()
                is FullMapUiState.Ready -> Box(Modifier.fillMaxSize()) {
                    var tappedAsset by androidx.compose.runtime.remember {
                        androidx.compose.runtime.mutableStateOf<io.github.nimbleflux.wayli.models.ImmichAsset?>(null)
                    }
                    val mapPhotos = s.immichAssets.map {
                        MapPhoto(id = it.assetId, lat = it.latitude, lng = it.longitude)
                    }
                    WayliMap(
                        modifier = Modifier.fillMaxSize(),
                        tracks = s.tracks,
                        photos = mapPhotos,
                        onPhotoTap = { tapped ->
                            tappedAsset = s.immichAssets.firstOrNull { it.assetId == tapped.id }
                        },
                        zoom = 6.0,
                        controls = true,
                        // keep the zoom buttons above the floating dock
                        controlsBottomPadding = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                    )
                    // Immich photo tap → detail sheet with thumbnail + deep link.
                    tappedAsset?.let { asset ->
                        ImmichPhotoSheet(
                            asset = asset,
                            serverUrl = s.immichServerUrl,
                            thumbnailProvider = { assetId, size ->
                                viewModel.thumbnailBytes(assetId, size)
                            },
                            onDismiss = { tappedAsset = null },
                            modifier = Modifier.align(androidx.compose.ui.Alignment.BottomCenter),
                        )
                    }
                    // Compact legend — mode colors only appear when present.
                    val presentModes = s.tracks.map { it.color }.distinct()
                    if (s.tracks.size > 1 || presentModes != listOf("#3b82f6")) {
                        MapLegend(
                            colors = presentModes,
                            modifier = Modifier
                                .align(androidx.compose.ui.Alignment.TopStart)
                                .padding(12.dp),
                        )
                    }
                }
                is FullMapUiState.Error -> Text(s.message, color = androidx.compose.material3.MaterialTheme.colorScheme.error)
            }
        }
    }
}

sealed interface FullMapUiState {
    data object Loading : FullMapUiState
    data class Ready(
        val title: String,
        val tracks: List<MapTrack>,
        /** Geotagged Immich assets for the same window (#13); empty when disabled. */
        val immichAssets: List<io.github.nimbleflux.wayli.models.ImmichAsset> = emptyList(),
        /** Immich server URL for "open in Immich" deep links; null when unset. */
        val immichServerUrl: String? = null,
    ) : FullMapUiState
    data class Error(val message: String) : FullMapUiState
}

@HiltViewModel
class FullMapViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val demoManager: DemoManager,
    private val fluxbaseClient: FluxbaseClient,
    private val tripRepo: TripRepository,
    private val statsRepo: StatsRepository,
    private val immichRepo: ImmichRepository,
    private val rangeStore: io.github.nimbleflux.wayli.feature.stats.StatsRangeStore,
) : ViewModel() {

    private val tripId: String? = savedStateHandle.get<String>("tripId")?.takeIf { it.isNotBlank() }

    private val _state = MutableStateFlow<FullMapUiState>(FullMapUiState.Loading)
    val state: StateFlow<FullMapUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch(Dispatchers.IO) { load() }
    }

    private suspend fun load() {
        if (demoManager.isDemoMode) {
            _state.value = FullMapUiState.Ready(
                title = "Your journeys",
                tracks = listOf(
                    MapTrack(
                        points = io.github.nimbleflux.wayli.demo.DemoData.homeTrack.map { LatLng(it.first, it.second) },
                        color = "#3b82f6",
                        width = 4f,
                    ),
                ),
            )
            return
        }
        runCatching {
            val uid = fluxbaseClient.auth?.currentSession?.user?.id ?: return@runCatching
            val points: List<io.github.nimbleflux.wayli.models.TrackerPoint> = if (tripId != null) {
                val trip = tripRepo.getTrip(tripId).getOrNull()
                val start = io.github.nimbleflux.wayli.util.parseIsoDate(trip?.startDate)
                val end = io.github.nimbleflux.wayli.util.parseIsoDate(trip?.endDate)
                    ?: java.time.LocalDate.now()
                statsRepo.fetchPoints(uid, (start ?: end.minusDays(30)).toString(), end.toString())
                    .getOrNull().orEmpty()
            } else {
                val (start, end) = rangeStore.range.value.toDates()
                statsRepo.fetchPoints(uid, start.toString(), end.toString()).getOrNull().orEmpty()
            }
            // Colored by transport mode — richer detail than the mini map,
            // since the fullscreen view has room for it (plus the legend).
            val tracks = io.github.nimbleflux.wayli.repo.StatsAggregator
                .segmentsByMode(points)
                .map { seg ->
                    MapTrack(
                        points = seg.points.map { LatLng(it.first, it.second) },
                        color = io.github.nimbleflux.wayli.designsystem.TransportModeColors.hexFor(seg.mode),
                        width = 4f,
                    )
                }
                .ifEmpty {
                    io.github.nimbleflux.wayli.repo.StatsAggregator.track(points).takeIf { it.size >= 2 }?.let { coords ->
                        listOf(MapTrack(coords.map { LatLng(it.first, it.second) }, color = "#3b82f6", width = 4f))
                    }.orEmpty()
                }
            // Geotagged Immich assets for the same window (#13); skipped
            // entirely when the user hasn't enabled the integration.
            val immichRepo = ImmichRepository(fluxbaseClient)
            val immichSettings = uid?.let { immichRepo.settings(uid) }
            val assets = if (immichSettings?.enabled == true) {
                val (start, end) = if (tripId != null) {
                    val trip = tripRepo.getTrip(tripId).getOrNull()
                    val start = io.github.nimbleflux.wayli.util.parseIsoDate(trip?.startDate)
                        ?: java.time.LocalDate.now().minusDays(30)
                    val end = io.github.nimbleflux.wayli.util.parseIsoDate(trip?.endDate)
                        ?: java.time.LocalDate.now()
                    Pair(start, end)
                } else {
                    rangeStore.range.value.toDates()
                }
                immichRepo.photosForRange(
                    start.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toString(),
                    end.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toString(),
                ).getOrNull().orEmpty()
            } else {
                emptyList()
            }

            _state.value = FullMapUiState.Ready(
                title = if (tripId != null) "Trip map" else "Your journeys",
                tracks = tracks,
                immichAssets = assets,
                immichServerUrl = immichSettings?.serverUrl,
            )
        }.onFailure {
            _state.value = FullMapUiState.Error(it.message ?: "Failed to load the map")
        }
    }

    /** Preview bytes through the authenticated immich-thumb proxy (#13). */
    suspend fun thumbnailBytes(assetId: String, size: String): ByteArray? =
        immichRepo.thumbnailBytes(assetId, size)
}
