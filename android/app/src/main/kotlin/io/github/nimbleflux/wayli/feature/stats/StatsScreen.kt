package io.github.nimbleflux.wayli.feature.stats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.nimbleflux.wayli.designsystem.TransportModeColors
import io.github.nimbleflux.wayli.designsystem.displayLabel
import io.github.nimbleflux.wayli.demo.DemoData

/**
 * Stats / Where-I've-Been screen — mobile-native design:
 * - Vertically scrollable stat cards
 * - 2x2 summary grid at top
 * - Transport mode breakdown as colored bars
 * - Activity map below
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    demoMode: Boolean = false,
    onBack: () -> Unit = {},
    viewModel: StatsViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
) {
    val uiState by viewModel.state.collectAsState()
    val reloading by viewModel.reloading.collectAsState()
    val selectedRange by viewModel.selectedRange.collectAsState()
    val isDemo = viewModel.isDemoMode
    val message by viewModel.message.collectAsState()
    val snackbar = remember { androidx.compose.material3.SnackbarHostState() }

    androidx.compose.runtime.LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    val scrollBehavior = androidx.compose.material3.TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        snackbarHost = {
            androidx.compose.material3.SnackbarHost(
                snackbar,
                // stay above the floating dock
                Modifier.padding(bottom = io.github.nimbleflux.wayli.designsystem.rememberDockClearance()),
            )
        },
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        // Viewport reaches the screen bottom; content scrolls beneath the dock.
        contentWindowInsets = WindowInsets.systemBars.only(
            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
        ),
        topBar = {
            TopAppBar(
                scrollBehavior = scrollBehavior,
                title = { Text("Statistics") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.load() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                },
            )
        },
    ) { padding ->
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            // Subtle indicator while re-fetching (range switch / refresh) —
            // the previous data stays on screen underneath it.
            if (reloading && uiState is StatsUiState.Success) {
                androidx.compose.material3.LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                )
                androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
            }
            when (val s = uiState) {
            is StatsUiState.Loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { androidx.compose.material3.CircularProgressIndicator() }
            is StatsUiState.Error -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { Text(s.message, color = MaterialTheme.colorScheme.error) }
            is StatsUiState.Success -> androidx.compose.material3.pulltorefresh.PullToRefreshBox(
                isRefreshing = reloading,
                onRefresh = { viewModel.load() },
                modifier = Modifier.fillMaxSize(),
            ) {
                StatsContent(
                data = s.data,
                rangeLabel = if (isDemo) "Sample data · all time" else selectedRange.displayLabel(),
                showSelector = !isDemo,
                selectedRange = selectedRange,
                onRangeSelected = viewModel::setRange,
                onBuildActivity = viewModel::buildActivityData,
                padding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            )
            }
        }
        }
    }
}

@Composable
private fun StatsContent(
    data: StatsData,
    rangeLabel: String,
    showSelector: Boolean,
    selectedRange: io.github.nimbleflux.wayli.designsystem.DateRange,
    onRangeSelected: (io.github.nimbleflux.wayli.designsystem.DateRange) -> Unit,
    onBuildActivity: () -> Unit,
    padding: androidx.compose.foundation.layout.PaddingValues,
) {
    val distance = data.distanceKm
    val countries = data.countries
    val timeMoving = data.timeMovingHours
    val points = data.dataPoints
    val modes = data.modes

    var selectedDay by remember {
        mutableStateOf<Pair<java.time.LocalDate, io.github.nimbleflux.wayli.repo.DailyActivity>?>(null)
    }

    androidx.compose.foundation.layout.Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(8.dp))

            if (showSelector) {
                io.github.nimbleflux.wayli.designsystem.DateRangeSelector(
                    selected = selectedRange,
                    onSelect = onRangeSelected,
                )
            }
            Text(
                rangeLabel,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(modifier = Modifier.weight(1f), label = "Total Distance", value = distance, unit = "km")
                StatCard(modifier = Modifier.weight(1f), label = "Countries", value = countries, unit = "")
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(modifier = Modifier.weight(1f), label = "Time Moving", value = timeMoving, unit = "h")
                StatCard(modifier = Modifier.weight(1f), label = "Data Points", value = points, unit = "")
            }

            io.github.nimbleflux.wayli.designsystem.WorldMapCard(visited = data.visited)

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Transport Modes",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        "Share of moving distance",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    // Dynamic bars over the modes present in the data
                    // (stationary isn't movement and is excluded by the
                    // aggregator); percentages round to sum exactly 100.
                    val percentages = remember(modes) {
                        io.github.nimbleflux.wayli.repo.StatsAggregator.percentagesSummingTo100(modes)
                    }
                    val orderedModes = remember(modes) {
                        modes.entries.sortedByDescending { it.value }.map { it.key }
                    }
                    if (orderedModes.isEmpty()) {
                        Text(
                            "No moving data in this period",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        orderedModes.take(6).forEach { mode ->
                            ModeBar(
                                label = mode.replaceFirstChar { it.uppercase() },
                                fraction = modes.getValue(mode).toFloat(),
                                percentText = "${percentages.getValue(mode)}%",
                                color = modeColor(mode),
                            )
                        }
                    }
                }
            }

            // Activity heatmap (daily distance over the past year)
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Activity",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(12.dp))
                    ActivityHeatmap(rows = data.dailyRows, onDayClick = { day, row ->
                        selectedDay = day to row
                    })
                    Spacer(Modifier.height(10.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("Less", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        repeat(5) { i ->
                            val a = 0.25f + 0.75f * (i / 4f)
                            Box(
                                Modifier
                                    .size(10.dp)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(MaterialTheme.colorScheme.primary.copy(alpha = a)),
                            )
                        }
                        Text("More", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (data.dailyCacheEmpty) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "Derived from raw points — the server's activity cache is empty.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = onBuildActivity, modifier = Modifier.fillMaxWidth()) {
                            Text("Build activity data on the server")
                        }
                    }
                }
            }

            // NOTE: no duplicate track map here — the Home "Your journeys"
            // map already shows the same range WITH transport-mode colors.

            Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
        }
        selectedDay?.let { (day, row) ->
            DayDetailSheet(day = day, row = row, onDismiss = { selectedDay = null })
        }
    }
}

private fun formatNumber(n: Int): String = "%,d".format(n)

/** Web mode palette; anything unknown falls back to the muted gray. */
private fun modeColor(mode: String): Color = when (mode) {
    "car" -> TransportModeColors.car
    "walking" -> TransportModeColors.walking
    "train" -> TransportModeColors.train
    "cycling" -> TransportModeColors.cycling
    "airplane" -> TransportModeColors.airplane
    else -> TransportModeColors.stationary
}

@Composable
private fun StatCard(modifier: Modifier, label: String, value: String, unit: String) {
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("$value $unit".trim(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ColumnScope.ModeBar(label: String, fraction: Float, percentText: String, color: Color) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(80.dp))
        Box(modifier = Modifier.weight(1f).height(12.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(modifier = Modifier.fillMaxWidth(fraction).height(12.dp).clip(RoundedCornerShape(6.dp)).background(color))
        }
        Text(percentText, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 8.dp))
    }
}

/**
 * GitHub-style activity heatmap: columns = weeks (oldest left), rows = weekdays
 * (Mon–Sun). Covers a full trailing year (53 weeks) in a horizontally
 * scrollable strip; cells scale with that day's distance relative to the max,
 * and tapping a day with data opens a detail sheet.
 */
@Composable
private fun ActivityHeatmap(
    rows: Map<String, io.github.nimbleflux.wayli.repo.DailyActivity>,
    onDayClick: (java.time.LocalDate, io.github.nimbleflux.wayli.repo.DailyActivity) -> Unit,
    modifier: Modifier = Modifier,
) {
    val today = remember { java.time.LocalDate.now() }
    val weeks = 53
    val startMonday = remember(today) {
        today.minusWeeks((weeks - 1).toLong())
            .with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
    }
    val kmByDay = remember(rows) {
        rows.mapValues { (_, row) -> (row.distance ?: 0.0) / 1000.0 }
    }
    // GitHub-style intensity LEVELS by rank (quartiles of the active days),
    // not a linear ratio to the max — a single huge day otherwise compresses
    // every other day into the same barely-tinted shade.
    val thresholds = remember(rows) {
        val active = kmByDay.values.filter { it > 0.0 }.sorted()
        when {
            active.isEmpty() -> doubleArrayOf(Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE)
            active.size < 4 -> doubleArrayOf(active[0], active[0], active[active.size - 1])
            else -> doubleArrayOf(
                active[active.size / 4],
                active[active.size / 2],
                active[(active.size * 3) / 4],
            )
        }
    }
    val levelAlpha = floatArrayOf(0.20f, 0.40f, 0.62f, 0.88f)
    val empty = MaterialTheme.colorScheme.surfaceVariant
    val active = MaterialTheme.colorScheme.primary
    val monthLabel = remember { java.time.format.DateTimeFormatter.ofPattern("LLL") }

    val scrollState = rememberScrollState()
    // Start at the newest week (right end) — that's what users care about.
    LaunchedEffect(Unit) { scrollState.scrollTo(scrollState.maxValue) }

    val cellSize = 13.dp
    val cellGap = 3.dp
    val slot = cellSize + cellGap

    Column(modifier = modifier) {
        // Month labels — one per week column that contains the 1st of a month.
        Row {
            Spacer(Modifier.width(slot * 2.6f)) // room for the weekday labels
            Row(horizontalArrangement = Arrangement.spacedBy(cellGap)) {
                for (w in 0 until weeks) {
                    val weekStart = startMonday.plusWeeks(w.toLong())
                    val firstOfMonth = remember(weekStart) {
                        (1..7).map { weekStart.plusDays((it - 1).toLong()) }
                            .firstOrNull { it.dayOfMonth == 1 }
                    }
                    Box(modifier = Modifier.width(cellSize)) {
                        if (firstOfMonth != null) {
                            Text(
                                firstOfMonth.format(monthLabel),
                                style = MaterialTheme.typography.labelSmall,
                                fontSize = 9.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.align(Alignment.CenterStart),
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(2.dp))
        Row {
            // Weekday labels at the Mon/Wed/Fri slots.
            Column(verticalArrangement = Arrangement.spacedBy(cellGap)) {
                listOf("M", "W", "F").forEachIndexed { i, label ->
                    Box(modifier = Modifier.size(cellSize), contentAlignment = Alignment.Center) {
                        Text(
                            label,
                            style = MaterialTheme.typography.labelSmall,
                            fontSize = 9.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (i < 2) Spacer(Modifier.height(cellSize * 2 + cellGap * 2 - cellGap))
                }
            }
            Spacer(Modifier.width(cellGap))
            Row(
                modifier = Modifier.horizontalScroll(scrollState),
                horizontalArrangement = Arrangement.spacedBy(cellGap),
            ) {
                for (w in 0 until weeks) {
                    Column(verticalArrangement = Arrangement.spacedBy(cellGap)) {
                        for (dow in 0 until 7) {
                            val date = startMonday.plusWeeks(w.toLong()).plusDays(dow.toLong())
                            val inRange = !date.isAfter(today)
                            val row = rows[date.toString()]
                            val km = if (inRange) kmByDay[date.toString()] ?: 0.0 else 0.0
                            val hasData = inRange && row != null && km > 0.0
                            val color = if (hasData) {
                                val level = when {
                                    km <= thresholds[0] -> 0
                                    km <= thresholds[1] -> 1
                                    km <= thresholds[2] -> 2
                                    else -> 3
                                }
                                active.copy(alpha = levelAlpha[level])
                            } else {
                                empty.copy(alpha = if (inRange) 0.4f else 0.15f)
                            }
                            Box(
                                modifier = Modifier
                                    .size(cellSize)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(color)
                                    .then(
                                        if (hasData) {
                                            Modifier.clickable { onDayClick(date, row!!) }
                                        } else {
                                            Modifier
                                        },
                                    ),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Day detail sheet behind a heatmap cell: date plus the day's distance,
 * moving time and recorded point count.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun DayDetailSheet(
    day: java.time.LocalDate,
    row: io.github.nimbleflux.wayli.repo.DailyActivity?,
    onDismiss: () -> Unit,
) {
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val dateText = remember(day) {
                day.format(java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.FULL))
            }
            Text(
                dateText,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            val km = (row?.distance ?: 0.0) / 1000.0
            val seconds = row?.timeSpent ?: 0.0
            val hours = (seconds / 3600).toInt()
            val minutes = ((seconds % 3600) / 60).toInt()
            val timeText = when {
                hours > 0 -> "${hours}h ${minutes}m"
                minutes > 0 -> "${minutes}m"
                else -> "—"
            }
            if (km <= 0.0) {
                Text(
                    "No activity recorded on this day.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(modifier = Modifier.weight(1f), label = "Distance", value = "%.1f".format(km), unit = "km")
                    StatCard(modifier = Modifier.weight(1f), label = "Moving time", value = timeText, unit = "")
                    StatCard(modifier = Modifier.weight(1f), label = "Points", value = (row?.points ?: 0).toString(), unit = "")
                }
            }
        }
    }
}
