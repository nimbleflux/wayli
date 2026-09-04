package io.github.nimbleflux.wayli.feature.travel

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.models.distanceMeters

/**
 * Review auto-suggested trips (status='pending', produced by the server's
 * trip-detection jobs). Approve → completed (server computes distance);
 * Reject → dismissed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SuggestionsScreen(
    onBack: () -> Unit,
    viewModel: TripViewModel = hiltViewModel(),
) {
    val pending by viewModel.pendingSuggestions.collectAsState()
    val loading by viewModel.suggestionsLoading.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var busyId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { viewModel.loadSuggestions() }

    Scaffold(
        snackbarHost = {
            SnackbarHost(
                snackbar,
                // stay above the floating dock
                Modifier.padding(bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance()),
            )
        },
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = { Text("Suggested trips") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when {
            loading && pending.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { androidx.compose.material3.CircularProgressIndicator() }

            pending.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "No suggestions right now — detected trips land here for review.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(32.dp),
                )
            }

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 16.dp,
                    bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(pending.size, key = { pending[it].id }) { index ->
                    val trip = pending[index]
                    SuggestionCard(
                        trip = trip,
                        busy = busyId == trip.id,
                        onApprove = {
                            busyId = trip.id
                            viewModel.approveSuggestion(trip.id) { ok ->
                                busyId = null
                            }
                        },
                        onReject = {
                            busyId = trip.id
                            viewModel.rejectSuggestion(trip.id) { ok ->
                                busyId = null
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SuggestionCard(
    trip: Trip,
    busy: Boolean,
    onApprove: () -> Unit,
    onReject: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(trip.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(
                shortTripRange(trip.startDate, trip.endDate) +
                    " · ${tripDays(trip.startDate, trip.endDate)} days",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            trip.distanceMeters?.let { meters ->
                Text(
                    formatDistance(meters),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onApprove, enabled = !busy) { Text("Approve") }
                OutlinedButton(onClick = onReject, enabled = !busy) { Text("Dismiss") }
                if (busy) {
                    Spacer(Modifier.width(4.dp))
                    androidx.compose.material3.CircularProgressIndicator(
                        modifier = Modifier.height(20.dp).width(20.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
        }
    }
}
