package io.github.nimbleflux.wayli.feature.fitness

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.designsystem.chart.ChartPoint
import io.github.nimbleflux.wayli.designsystem.chart.ChartSeries
import io.github.nimbleflux.wayli.designsystem.chart.ChartXAxis
import io.github.nimbleflux.wayli.designsystem.chart.FitnessChart
import io.github.nimbleflux.wayli.designsystem.map.MapTrack
import io.github.nimbleflux.wayli.designsystem.map.WayliMap
import io.github.nimbleflux.wayli.repo.FitnessActivity
import io.github.nimbleflux.wayli.repo.FitnessRepository
import io.github.nimbleflux.wayli.repo.FitnessTrackPoint
import io.github.nimbleflux.wayli.repo.elevationGain
import io.github.nimbleflux.wayli.repo.formatDistance
import io.github.nimbleflux.wayli.repo.formatDuration
import io.github.nimbleflux.wayli.repo.formatSpeed
import io.github.nimbleflux.wayli.repo.speedSegments
import io.github.nimbleflux.wayli.repo.sportTheme
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.maplibre.android.geometry.LatLng

data class FitnessDetailUiState(
    val loading: Boolean = true,
    val notFound: Boolean = false,
    val activity: FitnessActivity? = null,
    val prev: FitnessActivity? = null,
    val next: FitnessActivity? = null,
    val track: List<FitnessTrackPoint> = emptyList(),
    /** Track loading failed — the summary still shows, minus map/charts. */
    val trackError: String? = null,
)

@HiltViewModel
class FitnessDetailViewModel @Inject constructor(
    private val repo: FitnessRepository,
    private val client: FluxbaseClient,
    private val instanceManager: io.github.nimbleflux.wayli.session.InstanceManager,
    private val userRepo: io.github.nimbleflux.wayli.repo.UserRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(FitnessDetailUiState())
    val state: StateFlow<FitnessDetailUiState> = _state.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Cached username for share links (loads once per user). */
    private var cachedUsername: String? = null

    suspend fun shareLinkFor(activity: FitnessActivity): String? {
        val webUrl = instanceManager.getConfig()?.webUrl ?: return null
        val username = cachedUsername ?: run {
            val userId = client.auth.currentSession?.user?.id ?: return null
            userRepo.getProfile(userId).getOrNull()?.username?.also { cachedUsername = it }
        } ?: return null
        return "$webUrl/u/$username/fitness/${activity.id}"
    }

    /**
     * Set (or clear, when null) the activity's sharing audience override;
     * null makes it follow the global fitness default again.
     */
    fun setVisibility(visibility: String?, onDone: (Boolean) -> Unit) {
        val id = _state.value.activity?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            val result = repo.updateVisibility(id, visibility)
            result.onSuccess {
                _state.value = _state.value.copy(
                    activity = _state.value.activity?.copy(visibility = visibility),
                )
            }
            onDone(result.isSuccess)
            _busy.value = false
        }
    }

    fun load(activityId: String) {
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            repo.getActivity(activityId)
                .onSuccess { activity ->
                    if (activity == null) {
                        _state.value = FitnessDetailUiState(loading = false, notFound = true)
                    } else {
                        val userId = client.auth.currentSession?.user?.id
                        val neighbours = userId?.let {
                            repo.getNeighbours(it, activity.startedAt).getOrNull()
                        }
                        _state.value = FitnessDetailUiState(
                            loading = false,
                            activity = activity,
                            prev = neighbours?.first,
                            next = neighbours?.second,
                        )
                        repo.loadTrack(activity)
                            .onSuccess { track -> _state.value = _state.value.copy(track = track) }
                            .onFailure { _state.value = _state.value.copy(trackError = it.message ?: "Failed to load track") }
                    }
                }
                .onFailure {
                    _state.value = FitnessDetailUiState(loading = false, notFound = true)
                }
            _busy.value = false
        }
    }

    fun saveEdits(title: String, description: String, onSaved: (Boolean) -> Unit) {
        val id = _state.value.activity?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            val result = repo.updateActivity(id, title.trim().ifEmpty { null }, description.trim().ifEmpty { null })
            result.onSuccess {
                _state.value = _state.value.copy(
                    activity = _state.value.activity?.copy(
                        title = title.trim().ifEmpty { null },
                        description = description.trim().ifEmpty { null },
                    ),
                )
            }
            onSaved(result.isSuccess)
            _busy.value = false
        }
    }

    fun delete(onDeleted: (Boolean) -> Unit) {
        val id = _state.value.activity?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true
            val result = repo.deleteActivity(id)
            onDeleted(result.isSuccess)
            _busy.value = false
        }
    }
}

private val headerDateFormatter = java.time.format.DateTimeFormatter.ofPattern("EEEE d MMMM uuuu")
private val headerTimeFormatter = java.time.format.DateTimeFormatter.ofPattern("HH:mm")

private fun formatHeaderDate(iso: String): String = runCatching {
    headerDateFormatter.format(java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()))
}.getOrElse { iso }

private fun formatHeaderTime(iso: String): String = runCatching {
    headerTimeFormatter.format(java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()))
}.getOrElse { "" }

private data class StatItem(val label: String, val value: String, val sub: String? = null)

private fun buildStats(activity: FitnessActivity, elevation: Int?): List<StatItem> {
    val cards = mutableListOf(
        StatItem("Distance", formatDistance(activity.totalDistanceM)),
        StatItem("Moving time", formatDuration(activity.movingTimeS ?: activity.elapsedTimeS)),
    )
    val totalDistance = activity.totalDistanceM
    val movingTime = activity.movingTimeS
    val avgSpeed = if (totalDistance != null && movingTime != null && movingTime > 0) {
        totalDistance / movingTime
    } else {
        null
    }
    avgSpeed?.let { cards += StatItem("Avg speed", "${formatSpeed(it)} km/h") }
    if (elevation != null && elevation > 0) cards += StatItem("Elevation gain", "$elevation m")
    activity.avgHeartrate?.let {
        cards += StatItem("Avg HR", "${it.toInt()} bpm", activity.maxHeartrate?.let { m -> "max ${m.toInt()} bpm" })
    }
    activity.avgPower?.let {
        cards += StatItem("Avg power", "${it.toInt()} W", activity.maxPower?.let { m -> "max ${m.toInt()} W" })
    }
    activity.avgCadence?.let { cards += StatItem("Avg cadence", "${it.toInt()} rpm") }
    activity.calories?.let { cards += StatItem("Calories", "${it.toInt()} kcal") }
    return cards
}

/**
 * Activity analyzer — web detail-page parity: hero header, stats grid,
 * speed-colored map, HR/Power + Speed/Cadence charts with a time/distance
 * x axis, title/description editing and delete. Charts pin the map on tap.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FitnessDetailScreen(
    activityId: String,
    onBack: () -> Unit,
    onOpenNeighbour: (String) -> Unit,
    viewModel: FitnessDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val busy by viewModel.busy.collectAsState()

    LaunchedEffect(activityId) { viewModel.load(activityId) }

    var showEditDialog by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var showVisibilityDialog by remember { mutableStateOf(false) }
    // Chart x axis: elapsed time or distance covered
    var xMode by remember { mutableStateOf(ChartXAxis.TIME) }
    // Map pin synced from a chart tap (null = no pin)
    var scrubPin by remember { mutableStateOf<LatLng?>(null) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val context = androidx.compose.ui.platform.LocalContext.current

    val activity = state.activity
    val theme = sportTheme(activity?.sport)
    val sportColor = Color(android.graphics.Color.parseColor(theme.strokeHex))

    if (showEditDialog && activity != null) {
        var title by remember(activity.id) { mutableStateOf(activity.title ?: "") }
        var description by remember(activity.id) { mutableStateOf(activity.description ?: "") }
        AlertDialog(
            onDismissRequest = { showEditDialog = false },
            title = { Text("Edit activity") },
            text = {
                Column {
                    OutlinedTextField(
                        value = title, onValueChange = { title = it },
                        label = { Text("Title") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = description, onValueChange = { description = it },
                        label = { Text("Comment") },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = !busy,
                    onClick = {
                        viewModel.saveEdits(title, description) { ok -> if (ok) showEditDialog = false }
                    },
                ) { Text("Save") }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { showEditDialog = false }) { Text("Cancel") }
            },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete activity?") },
            text = { Text("This removes the activity and its metrics. The imported GPS points stay in your location history.") },
            confirmButton = {
                Button(
                    enabled = !busy,
                    onClick = { viewModel.delete { ok -> if (ok) onBack() } },
                ) { Text("Delete") }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { confirmDelete = false }) { Text("Cancel") }
            },
        )
    }

    if (showVisibilityDialog && activity != null) {
        val options = listOf(
            null to "Default (follow fitness settings)",
            "private" to "Private — only me",
            "friends" to "Friends",
            "public" to "Public — anyone with the link",
        )
        AlertDialog(
            onDismissRequest = { showVisibilityDialog = false },
            title = { Text("Share activity") },
            text = {
                Column {
                    options.forEach { (value, label) ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    showVisibilityDialog = false
                                    viewModel.setVisibility(value) { }
                                },
                        ) {
                            androidx.compose.material3.RadioButton(
                                selected = activity.visibility == value,
                                onClick = {
                                    showVisibilityDialog = false
                                    viewModel.setVisibility(value) { }
                                },
                            )
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showVisibilityDialog = false }) { Text("Close") }
            },
        )
    }

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text(activity?.title ?: theme.label) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(
                        enabled = state.prev != null,
                        onClick = { state.prev?.let { onOpenNeighbour(it.id) } },
                    ) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Newer activity") }
                    IconButton(
                        enabled = state.next != null,
                        onClick = { state.next?.let { onOpenNeighbour(it.id) } },
                    ) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Older activity") }
                    if (activity != null) {
                        IconButton(onClick = { showVisibilityDialog = true }) {
                            val tint = when (activity.visibility) {
                                "public" -> MaterialTheme.colorScheme.primary
                                "friends" -> MaterialTheme.colorScheme.tertiary
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }
                            Icon(
                                when (activity.visibility) {
                                    "private" -> Icons.Filled.Lock
                                    "friends" -> Icons.Filled.People
                                    "public" -> Icons.Filled.Public
                                    else -> Icons.Filled.Tune
                                },
                                contentDescription = "Sharing: ${activity.visibility ?: "default"}",
                                tint = tint,
                            )
                        }
                        IconButton(onClick = {
                            val current = activity
                            if (current != null) {
                                viewModel.viewModelScope.launch {
                                    val link = viewModel.shareLinkFor(current)
                                    if (link != null) {
                                        clipboard.setText(androidx.compose.ui.text.AnnotatedString(link))
                                        android.widget.Toast.makeText(
                                            context,
                                            if (current.visibility == "private") {
                                                "Link copied — activity is private, only you can open it"
                                            } else {
                                                "Share link copied"
                                            },
                                            android.widget.Toast.LENGTH_SHORT,
                                        ).show()
                                    } else {
                                        android.widget.Toast.makeText(context, "No server web URL configured", android.widget.Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        }) {
                            Icon(Icons.Filled.Share, contentDescription = "Copy share link")
                        }
                        IconButton(onClick = { showEditDialog = true }) {
                            Icon(Icons.Filled.Edit, contentDescription = "Edit title and comment")
                        }
                        IconButton(onClick = { confirmDelete = true }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Delete activity", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            state.notFound || activity == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Activity not found", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> {
                val track = state.track
                val elevation = remember(track) { elevationGain(track.map { it.altitude }) }.takeIf { track.isNotEmpty() }
                val stats = remember(activity, elevation) { buildStats(activity, elevation) }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    // Hero
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    Brush.horizontalGradient(
                                        listOf(sportColor.copy(alpha = 0.85f), sportColor.copy(alpha = 0.55f)),
                                    ),
                                ),
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Text(
                                    buildString {
                                        append(theme.label.uppercase())
                                        activity.subSport?.let { append(" · ${it.replace('_', ' ')}") }
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color.White.copy(alpha = 0.8f),
                                )
                                Text(
                                    activity.title ?: formatHeaderDate(activity.startedAt),
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White,
                                )
                                Text(
                                    buildString {
                                        append(formatHeaderDate(activity.startedAt))
                                        append(" · ${formatHeaderTime(activity.startedAt)}")
                                        activity.endedAt?.let { append(" – ${formatHeaderTime(it)}") }
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color.White.copy(alpha = 0.85f),
                                )
                                activity.description?.let {
                                    Spacer(Modifier.height(8.dp))
                                    Text(it, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.92f))
                                }
                                Spacer(Modifier.height(12.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                                    Text(
                                        formatDistance(activity.totalDistanceM),
                                        style = MaterialTheme.typography.headlineMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                    )
                                    Text(
                                        formatDuration(activity.movingTimeS ?: activity.elapsedTimeS),
                                        style = MaterialTheme.typography.headlineMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                    )
                                }
                            }
                        }
                    }

                    // Stats grid (two per row)
                    stats.chunked(2).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            row.forEach { stat ->
                                StatCard(stat, Modifier.weight(1f))
                            }
                            if (row.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }

                    state.trackError?.let {
                        Text(
                            "Couldn't load the track: $it",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    if (track.isNotEmpty()) {
                        // Map with speed-colored track + optional scrub pin
                        val segments = remember(track, theme) {
                            speedSegments(track, theme.strokeHex).map { seg ->
                                MapTrack(
                                    points = seg.latLngs.map { (lat, lon) -> LatLng(lat, lon) },
                                    color = seg.color,
                                    width = 4f,
                                )
                            }
                        }
                        Card(
                            shape = RoundedCornerShape(14.dp),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("Track", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                    activity.manufacturer?.let {
                                        Text(
                                            it + (activity.product?.let { p -> " $p" } ?: ""),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                WayliMap(
                                    modifier = Modifier.fillMaxWidth().height(300.dp),
                                    tracks = segments,
                                    points = scrubPin?.let { pin ->
                                        listOf(io.github.nimbleflux.wayli.designsystem.map.MapPoint(pin.latitude, pin.longitude, color = "#1f2937"))
                                    } ?: emptyList(),
                                    controls = true,
                                )
                            }
                        }

                        // Charts
                        fun xOf(p: FitnessTrackPoint): Double = if (xMode == ChartXAxis.DISTANCE) p.distM else p.epochMs.toDouble()
                        val hrPower = listOfNotNull(
                            ChartSeries(
                                label = "bpm",
                                color = Color(0xFFEF4444),
                                area = true,
                                points = track.filter { it.hr != null }.map { ChartPoint(xOf(it), it.hr!!) },
                            ).takeIf { it.points.isNotEmpty() },
                            ChartSeries(
                                label = "W",
                                color = Color(0xFF3B82F6),
                                points = track.filter { it.power != null }.map { ChartPoint(xOf(it), it.power!!) },
                            ).takeIf { it.points.isNotEmpty() },
                        )
                        val speedCadence = listOfNotNull(
                            ChartSeries(
                                label = "km/h",
                                color = sportColor,
                                area = true,
                                points = track.filter { it.speedSmooth != null }
                                    .map { ChartPoint(xOf(it), Math.round(it.speedSmooth!! * 10.0) / 10.0) },
                            ).takeIf { it.points.isNotEmpty() },
                            ChartSeries(
                                label = "rpm",
                                color = Color(0xFFA855F7),
                                points = track.mapNotNull { p ->
                                    p.cadence?.takeIf { it > 0 }?.let { ChartPoint(xOf(p), it) }
                                },
                            ).takeIf { it.points.isNotEmpty() },
                        )
                        val hasCharts = hrPower.isNotEmpty() || speedCadence.isNotEmpty()

                        if (hasCharts) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.align(Alignment.End)) {
                                FilterChip(
                                    selected = xMode == ChartXAxis.TIME,
                                    onClick = { xMode = ChartXAxis.TIME },
                                    label = { Text("Time") },
                                )
                                FilterChip(
                                    selected = xMode == ChartXAxis.DISTANCE,
                                    onClick = { xMode = ChartXAxis.DISTANCE },
                                    label = { Text("Distance") },
                                )
                            }
                        }

                        // Tapping a chart pins the nearest point on the map.
                        val onScrub: (Double?) -> Unit = { x ->
                            scrubPin = x?.let { target ->
                                track.minByOrNull { Math.abs(xOf(it) - target) }?.let { LatLng(it.lat, it.lon) }
                            }
                        }

                        if (hrPower.isNotEmpty()) {
                            ChartCard(title = "Heart rate · Power") {
                                FitnessChart(series = hrPower, xAxis = xMode, onScrub = onScrub)
                            }
                        }
                        if (speedCadence.isNotEmpty()) {
                            ChartCard(title = "Speed · Cadence") {
                                FitnessChart(series = speedCadence, xAxis = xMode, onScrub = onScrub)
                            }
                        }
                    }

                    activity.sourceFile?.let {
                        Text(
                            "Source: $it",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        )
                    }
                    Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
                }
            }
        }
    }
}

@Composable
private fun StatCard(stat: StatItem, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                stat.label.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(stat.value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            stat.sub?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ChartCard(title: String, content: @Composable () -> Unit) {
    Card(
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            content()
            Spacer(Modifier.height(4.dp))
            Text(
                "Tap the chart to pin that point on the map",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }
}
