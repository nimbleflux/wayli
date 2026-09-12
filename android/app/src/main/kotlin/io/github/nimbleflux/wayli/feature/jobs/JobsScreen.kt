package io.github.nimbleflux.wayli.feature.jobs

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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.jobs.ExecutionLog
import io.github.nimbleflux.fluxbase.jobs.Job
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.designsystem.EmptyState
import io.github.nimbleflux.wayli.designsystem.LoadingState
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@HiltViewModel
class JobsViewModel @Inject constructor(
    private val demoManager: DemoManager,
    private val client: FluxbaseClient,
) : ViewModel() {

    private val _jobs = MutableStateFlow<List<Job>>(emptyList())
    val jobs: StateFlow<List<Job>> = _jobs.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _filter = MutableStateFlow<String?>(null)
    val filter: StateFlow<String?> = _filter.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    /** The job whose detail sheet is open; drives log polling. */
    private val _selected = MutableStateFlow<Job?>(null)
    val selected: StateFlow<Job?> = _selected.asStateFlow()

    private val _logs = MutableStateFlow<List<ExecutionLog>>(emptyList())
    val logs: StateFlow<List<ExecutionLog>> = _logs.asStateFlow()

    val isDemoMode: Boolean = demoManager.isDemoMode

    init {
        if (!isDemoMode) load()
    }

    fun setFilter(status: String?) {
        if (_filter.value == status) return
        _filter.value = status
        load()
    }

    fun load(silent: Boolean = false) {
        if (isDemoMode) return
        viewModelScope.launch(Dispatchers.IO) {
            if (!silent) _loading.value = true
            val res = runCatching {
                client.jobs.list(status = _filter.value, namespace = "wayli", limit = 50)
            }
            _loading.value = false
            res.getOrNull()?.let { response ->
                _jobs.value = response.data ?: emptyList()
            } ?: run {
                if (!silent) _message.value = "Couldn't load jobs: ${res.exceptionOrNull()?.message ?: "network error"}"
            }
        }
    }

    fun cancelJob(job: Job) {
        viewModelScope.launch(Dispatchers.IO) {
            val res = runCatching { client.jobs.cancel(job.id) }
            _message.value = if (res.getOrNull()?.data != null) {
                "Cancelling ${job.jobName}"
            } else {
                "Couldn't cancel: ${res.getOrNull()?.error?.message ?: res.exceptionOrNull()?.message ?: "error"}"
            }
            load(silent = true)
        }
    }

    fun retryJob(job: Job) {
        viewModelScope.launch(Dispatchers.IO) {
            val res = runCatching { client.jobs.retry(job.id) }
            _message.value = if (res.getOrNull()?.data != null) {
                "Retrying ${job.jobName}"
            } else {
                "Couldn't retry: ${res.getOrNull()?.error?.message ?: res.exceptionOrNull()?.message ?: "error"}"
            }
            load(silent = true)
        }
    }

    fun consumeMessage() {
        _message.value = null
    }

    fun openJob(job: Job) {
        _selected.value = job
        _logs.value = emptyList()
        fetchLogs()
    }

    fun closeJob() {
        _selected.value = null
        _logs.value = emptyList()
    }

    /** Refresh the open job's status (progress) from the server. */
    fun refreshSelected() {
        val job = _selected.value ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client.jobs.get(job.id) }.getOrNull()?.data?.let { fresh ->
                if (_selected.value?.id == fresh.id) _selected.value = fresh
            }
        }
    }

    private fun fetchLogs() {
        val job = _selected.value ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val after = _logs.value.size.takeIf { it > 0 }
            val res = runCatching { client.jobs.getLogs(job.id, afterLine = after) }
            val fresh = res.getOrNull()?.data ?: return@launch
            if (_selected.value?.id == job.id && fresh.isNotEmpty()) {
                _logs.value = _logs.value + fresh
            }
        }
    }

    /** Poll logs + status while the detail sheet is open. */
    fun startLogPolling() {
        viewModelScope.launch(Dispatchers.IO) {
            while (isActive && _selected.value != null) {
                delay(2500)
                if (_selected.value == null) break
                refreshSelected()
                fetchLogs()
            }
        }
    }
}

/**
 * Job monitor: everything the app (or the web admin page) launches on this
 * instance — list with status filters, live progress for running jobs, and a
 * detail sheet with cancel/retry and an incrementally-tailed log viewer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(
    onBack: () -> Unit = {},
    viewModel: JobsViewModel = hiltViewModel(),
) {
    val jobs by viewModel.jobs.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val filter by viewModel.filter.collectAsState()
    val message by viewModel.message.collectAsState()
    val selected by viewModel.selected.collectAsState()
    val logs by viewModel.logs.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    // Poll running/pending jobs while the screen is visible.
    val hasActive = jobs.any { it.status == "pending" || it.status == "running" }
    LaunchedEffect(hasActive) {
        if (hasActive && !viewModel.isDemoMode) {
            while (true) {
                delay(3000)
                viewModel.load(silent = true)
            }
        }
    }

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
                title = { Text("Jobs") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.load() }, enabled = !viewModel.isDemoMode) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                },
            )
        },
    ) { padding ->
        if (viewModel.isDemoMode) {
            EmptyState(
                emoji = "⚙️",
                title = "Jobs live on your server",
                subtitle = "Connect to a real Wayli instance to monitor background jobs and their logs.",
                modifier = Modifier.padding(padding),
            )
            return@Scaffold
        }

        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(selected = filter == null, onClick = { viewModel.setFilter(null) }, label = { Text("All") })
                listOf("pending", "running", "completed", "failed", "cancelled").forEach { status ->
                    FilterChip(
                        selected = filter == status,
                        onClick = { viewModel.setFilter(status) },
                        label = { Text(status.replaceFirstChar { it.uppercase() }) },
                    )
                }
            }

            when {
                loading && jobs.isEmpty() -> LoadingState(Modifier.fillMaxSize())
                jobs.isEmpty() -> EmptyState(
                    emoji = "🗂️",
                    title = "No jobs",
                    subtitle = if (filter == null) "Nothing has run on this instance yet" else "No ${filter} jobs",
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(jobs, key = { it.id }) { job ->
                        JobCard(job = job, onClick = { viewModel.openJob(job) })
                    }
                    item {
                        Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
                    }
                }
            }
        }
    }

    if (selected != null) {
        val job = selected
        if (job != null) {
            LaunchedEffect(job.id) { viewModel.startLogPolling() }
            JobDetailSheet(
                job = job,
                logs = logs,
                onDismiss = { viewModel.closeJob() },
                onCancel = { viewModel.cancelJob(job) },
                onRetry = { viewModel.retryJob(job) },
            )
        }
    }
}

@Composable
private fun JobCard(job: Job, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = MaterialTheme.shapes.medium,
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    job.jobName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(8.dp))
                StatusBadge(job.status)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                formatJobTime(job.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (job.status == "running" && job.progressPercent != null) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { (job.progressPercent ?: 0) / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
                job.progressMessage?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            job.error?.let { err ->
                Spacer(Modifier.height(4.dp))
                Text(
                    err.take(140),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val color = when (status) {
        "completed" -> Color(0xFF16A34A)
        "failed" -> MaterialTheme.colorScheme.error
        "running" -> MaterialTheme.colorScheme.primary
        "cancelled" -> Color(0xFFD97706)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(shape = RoundedCornerShape(6.dp), color = color.copy(alpha = 0.12f)) {
        Text(
            status,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JobDetailSheet(
    job: Job,
    logs: List<ExecutionLog>,
    onDismiss: () -> Unit,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    job.jobName,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                StatusBadge(job.status)
            }

            if (job.status == "running") {
                LinearProgressIndicator(
                    progress = { (job.progressPercent ?: 0) / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${job.progressPercent ?: 0}%",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    job.progressMessage?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            DetailRow("Created", formatJobTime(job.createdAt))
            DetailRow("Updated", formatJobTime(job.updatedAt))
            if (job.retryCount > 0) DetailRow("Retries", job.retryCount.toString())
            job.error?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (job.status == "pending" || job.status == "running") {
                    OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text("Cancel") }
                }
                if (job.status == "failed" || job.status == "cancelled") {
                    Button(onClick = onRetry, modifier = Modifier.weight(1f)) { Text("Retry") }
                }
            }

            Text("Logs", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            if (logs.isEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                    Text(
                        if (job.status == "pending") "Waiting for the job to start…" else "Loading logs…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                ) {
                    Column(modifier = Modifier.padding(10.dp).fillMaxWidth()) {
                        logs.takeLast(200).forEach { log ->
                            Text(
                                log.line,
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = logColor(log.level),
                                modifier = Modifier.padding(vertical = 1.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(80.dp),
        )
        Text(value, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun logColor(level: String?): Color = when (level?.lowercase()) {
    "error" -> MaterialTheme.colorScheme.error
    "warn" -> Color(0xFFD97706)
    "debug" -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
    else -> MaterialTheme.colorScheme.onSurface
}

private fun formatJobTime(iso: String): String = runCatching {
    // Timestamps may or may not carry milliseconds before the Z.
    java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("MMM d, HH:mm"))
}.getOrDefault(iso.take(16))
