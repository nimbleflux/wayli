package io.github.nimbleflux.wayli.feature.wishlist

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.nimbleflux.wayli.designsystem.EmptyState
import io.github.nimbleflux.wayli.designsystem.WayliAsyncImage
import io.github.nimbleflux.wayli.models.WantToVisit

/**
 * Wishlist — toggle between Map and List views of places you want to visit.
 * Real mode loads places from the WishlistRepository; demo mode serves
 * DemoData. The "Add Place" FAB opens a bottom sheet that prepends a new
 * place to the list (kept in-memory for now).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistScreen(
    places: List<WantToVisit> = emptyList(),
    viewModel: WishlistViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
) {
    val loadedPlaces by viewModel.places.collectAsState()
    val online by viewModel.online.collectAsState()
    // Demo/explicit places take precedence; places added through the ViewModel
    // (demo in-memory adds, or the reload after the RPC insert) join them on top.
    val effectivePlaces = remember(places, loadedPlaces) {
        if (places.isEmpty()) {
            loadedPlaces
        } else {
            val ids = places.map { it.id }.toSet()
            loadedPlaces.filter { it.id !in ids } + places
        }
    }

    var viewMode by remember { mutableStateOf(WishlistViewMode.LIST) }
    var placeState by remember(effectivePlaces) { mutableStateOf(effectivePlaces) }
    var showAdd by remember { mutableStateOf(false) }

    val scrollBehavior = androidx.compose.material3.TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                scrollBehavior = scrollBehavior,
                title = { Text("Wishlist") },
                actions = {
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.padding(end = 16.dp)) {
                        WishlistViewMode.entries.forEachIndexed { index, mode ->
                            SegmentedButton(
                                selected = viewMode == mode,
                                onClick = { viewMode = mode },
                                shape = SegmentedButtonDefaults.itemShape(index, WishlistViewMode.entries.size),
                            ) {
                                Text(if (mode == WishlistViewMode.MAP) "Map" else "List")
                            }
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showAdd = true },
                modifier = Modifier.padding(
                    bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                ), // float above the dock
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Add Place") },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            io.github.nimbleflux.wayli.designsystem.OfflineBanner(visible = !online)
            when (viewMode) {
                WishlistViewMode.MAP -> {
                    val mapPoints = remember(placeState) {
                        placeState.mapNotNull { p ->
                            io.github.nimbleflux.wayli.repo.StatsAggregator.parseLocation(p.location)?.let { (lat, lng) ->
                                io.github.nimbleflux.wayli.designsystem.map.MapPoint(
                                    lat = lat, lng = lng, title = p.title, color = p.markerColor,
                                )
                            }
                        }
                    }
                    io.github.nimbleflux.wayli.designsystem.map.WayliMap(
                        modifier = Modifier.fillMaxSize(),
                        points = mapPoints,
                    )
                }
                WishlistViewMode.LIST -> {
                    if (placeState.isEmpty()) {
                        EmptyState(
                            emoji = "📍",
                            title = "No places yet",
                            subtitle = "Tap 'Add Place' to save somewhere you'd like to go",
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                                bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                            ),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(placeState, key = { it.id }) { place ->
                                androidx.compose.foundation.layout.Box(Modifier.animateItem()) {
                                    PlaceCard(place = place) {}
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAdd) {
        AddPlaceSheet(
            viewModel = viewModel,
            onDismiss = { showAdd = false },
            onAdd = { title, lat, lng, address ->
                viewModel.addPlace(title, lat, lng, address)
                showAdd = false
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddPlaceSheet(
    viewModel: WishlistViewModel,
    onDismiss: () -> Unit,
    onAdd: (title: String, lat: Double, lng: Double, address: String?) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val suggestions by viewModel.suggestions.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current

    var query by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var lat by remember { mutableStateOf("") }
    var lng by remember { mutableStateOf("") }
    var locating by remember { mutableStateOf(false) }

    fun latValid(): Boolean = lat.toDoubleOrNull()?.let { it in -90.0..90.0 } == true
    fun lngValid(): Boolean = lng.toDoubleOrNull()?.let { it in -180.0..180.0 } == true

    fun fillFrom(suggestion: io.github.nimbleflux.wayli.repo.PlaceSuggestion) {
        if (title.isBlank()) title = suggestion.name
        if (address.isBlank()) address = suggestion.secondary.orEmpty()
        lat = "%.6f".format(suggestion.lat)
        lng = "%.6f".format(suggestion.lng)
        query = ""
        viewModel.clearSuggestions()
    }

    fun applyLocation(coords: Pair<Double, Double>) {
        lat = "%.6f".format(coords.first)
        lng = "%.6f".format(coords.second)
        locating = true
        viewModel.reverseLookup(coords.first, coords.second) { hit ->
            locating = false
            if (title.isBlank()) title = hit?.name ?: "Location at ${"%.2f".format(coords.first)}, ${"%.2f".format(coords.second)}"
            if (address.isBlank()) address = hit?.secondary.orEmpty()
        }
    }

    fun useCurrentLocation() {
        val lm = context.getSystemService(android.content.Context.LOCATION_SERVICE)
            as? android.location.LocationManager ?: return
        val best = listOf(
            android.location.LocationManager.GPS_PROVIDER,
            android.location.LocationManager.NETWORK_PROVIDER,
            android.location.LocationManager.PASSIVE_PROVIDER,
        ).mapNotNull { p -> runCatching { lm.getLastKnownLocation(p) }.getOrNull() }
            .maxByOrNull { it.time }
        if (best != null) {
            applyLocation(best.latitude to best.longitude)
        } else {
            locating = false
        }
    }

    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) useCurrentLocation() else locating = false
    }

    fun onUseMyLocation() {
        locating = true
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.ACCESS_FINE_LOCATION,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            useCurrentLocation()
        } else {
            permissionLauncher.launch(android.Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Add a place", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

            // ---- Search helper (Pelias autocomplete, web parity) ----
            OutlinedTextField(
                value = query,
                onValueChange = {
                    query = it
                    viewModel.search(it)
                },
                label = { Text("Search for a place") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (suggestions.isNotEmpty()) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                ) {
                    Column {
                        suggestions.forEach { suggestion ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { fillFrom(suggestion) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                            ) {
                                Text(suggestion.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                suggestion.secondary?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // ---- Current location helper ----
            OutlinedButton(
                onClick = { onUseMyLocation() },
                enabled = !locating,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (locating) {
                    androidx.compose.material3.CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Icon(Icons.Filled.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp))
                }
                Spacer(Modifier.size(8.dp))
                Text(if (locating) "Locating…" else "Use my location")
            }

            // ---- Manual fields ----
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Title") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                label = { Text("Address (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = lat,
                    onValueChange = { lat = it },
                    label = { Text("Latitude") },
                    isError = lat.isNotBlank() && !latValid(),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = lng,
                    onValueChange = { lng = it },
                    label = { Text("Longitude") },
                    isError = lng.isNotBlank() && !lngValid(),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                "Search or use your location — coordinates are filled for you.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = {
                    onAdd(title.trim(), lat.toDoubleOrNull() ?: 0.0, lng.toDoubleOrNull() ?: 0.0, address.ifBlank { null })
                },
                enabled = title.isNotBlank() && latValid() && lngValid(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Add") }
            Spacer(Modifier.size(8.dp))
        }
    }
}

@Composable
private fun PlaceCard(place: WantToVisit, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = MaterialTheme.shapes.medium,
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            place.imageUrl?.let { url ->
                WayliAsyncImage(
                    model = url,
                    contentDescription = place.title,
                    modifier = Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)),
                )
            } ?: Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.LocationOn, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(place.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                place.address?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            place.rating?.let { rating ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Star, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                    Text(" $rating", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

enum class WishlistViewMode { LIST, MAP }
