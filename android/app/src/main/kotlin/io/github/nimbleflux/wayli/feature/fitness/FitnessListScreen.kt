package io.github.nimbleflux.wayli.feature.fitness

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.DirectionsBike
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.wayli.repo.FitnessActivity
import io.github.nimbleflux.wayli.repo.FitnessRepository
import io.github.nimbleflux.wayli.repo.formatDistance
import io.github.nimbleflux.wayli.repo.formatDuration
import io.github.nimbleflux.wayli.repo.groupByMonth
import io.github.nimbleflux.wayli.repo.sportTheme
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface FitnessListUiState {
    data object Loading : FitnessListUiState
    data class Error(val message: String) : FitnessListUiState
    data class Success(val activities: List<FitnessActivity>) : FitnessListUiState
}

@HiltViewModel
class FitnessListViewModel @Inject constructor(
    private val repo: FitnessRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<FitnessListUiState>(FitnessListUiState.Loading)
    val state: StateFlow<FitnessListUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch(Dispatchers.IO) {
            _state.value = FitnessListUiState.Loading
            repo.listActivities()
                .onSuccess { _state.value = FitnessListUiState.Success(it) }
                .onFailure { _state.value = FitnessListUiState.Error(it.message ?: "Failed to load activities") }
        }
    }
}

private val listDateFormatter = DateTimeFormatter.ofPattern("EEE d MMM · HH:mm", Locale.getDefault())

private fun formatStart(iso: String): String = runCatching {
    listDateFormatter.format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
}.getOrElse { iso }

/**
 * Fitness tab (beta-gated in the nav host): month-grouped activity cards,
 * web-list parity. Importing happens in Import / Export (same flow as web),
 * reachable from the FAB and the empty state.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FitnessListScreen(
    onActivityClick: (FitnessActivity) -> Unit,
    onImport: () -> Unit,
    viewModel: FitnessListViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Fitness")
                        Spacer(Modifier.size(8.dp))
                        Text(
                            "Beta",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onImport,
                icon = { Icon(Icons.Filled.CloudUpload, contentDescription = null) },
                text = { Text("Import .fit") },
                modifier = Modifier.padding(
                    bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                ), // float above the dock
            )
        },
    ) { padding ->
        when (val s = state) {
            is FitnessListUiState.Loading -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            is FitnessListUiState.Error -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        s.message,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(12.dp))
                    androidx.compose.material3.TextButton(onClick = { viewModel.load() }) {
                        Text("Retry")
                    }
                }
            }

            is FitnessListUiState.Success -> {
                if (s.activities.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(padding).padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(
                            Icons.Filled.CloudUpload,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(48.dp),
                        )
                        Spacer(Modifier.height(12.dp))
                        Text("No activities yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Upload a .fit file from your sports watch to see it analyzed here.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(16.dp))
                        androidx.compose.material3.Button(onClick = onImport) {
                            Text("Import a fitness file")
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            top = 8.dp,
                            bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance(),
                        ),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        groupByMonth(s.activities).forEach { (monthLabel, activities) ->
                            item(key = "month-$monthLabel") {
                                Text(
                                    monthLabel,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                            activities.forEach { activity ->
                                item(key = activity.id) {
                                    FitnessActivityCard(activity = activity, onClick = { onActivityClick(activity) })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FitnessActivityCard(activity: FitnessActivity, onClick: () -> Unit) {
    val theme = sportTheme(activity.sport)
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column {
            // Sport accent strip (web gradient parity)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(Color(android.graphics.Color.parseColor(theme.strokeHex))),
            )
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                        Icon(
                            Icons.Filled.DirectionsBike,
                            contentDescription = null,
                            tint = Color(android.graphics.Color.parseColor(theme.strokeHex)),
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.size(10.dp))
                        Column {
                            Text(
                                activity.title ?: theme.label,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                            Text(
                                buildString {
                                    if (activity.title != null) append("${theme.label} · ")
                                    append(formatStart(activity.startedAt))
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        formatDistance(activity.totalDistanceM),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.size(10.dp))
                    Text(
                        formatDuration(activity.movingTimeS ?: activity.elapsedTimeS),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                val metrics = buildList {
                    activity.avgHeartrate?.let { add("❤ ${it.toInt()}/${activity.maxHeartrate?.toInt() ?: "—"} bpm") }
                    activity.avgPower?.let { add("⚡ ${it.toInt()}/${activity.maxPower?.toInt() ?: "—"} W") }
                    activity.calories?.let { add("🔥 ${it.toInt()} kcal") }
                }
                if (metrics.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        metrics.joinToString("   "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                activity.manufacturer?.let {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        it.uppercase(Locale.getDefault()) + (activity.product?.let { p -> " · $p" } ?: ""),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    )
                }
            }
        }
    }
}
