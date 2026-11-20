package io.github.nimbleflux.wayli.feature.settings

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.jobs.Job
import io.github.nimbleflux.fluxbase.jobs.SubmitJobOptions
import io.github.nimbleflux.wayli.designsystem.WayliSectionCard
import io.github.nimbleflux.wayli.demo.DemoManager
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private val EXPORT_FORMATS = listOf("JSON", "GeoJSON", "CSV")

@HiltViewModel
class ImportExportViewModel @Inject constructor(
    private val demoManager: DemoManager,
    private val client: FluxbaseClient,
    private val prefsRepo: io.github.nimbleflux.wayli.repo.PreferencesRepository,
) : ViewModel() {

    val isDemo: Boolean get() = demoManager.isDemoMode
    private val userId: String? get() = client.auth.currentUser?.id

    private val _jobs = MutableStateFlow<List<Job>>(emptyList())
    val jobs: StateFlow<List<Job>> = _jobs.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init { loadHistory() }

    fun loadHistory() {
        if (isDemo) { _jobs.value = emptyList(); return }
        viewModelScope.launch(Dispatchers.IO) {
            val res = client.jobs.list(namespace = "wayli", limit = 50)
            val all = res.data ?: emptyList()
            _jobs.value = all.filter { it.jobName == "data-export" || it.jobName.startsWith("data-import") }
                .sortedByDescending { it.createdAt }
        }
    }

    fun submitExport(
        format: String,
        includeLocation: Boolean,
        includeWantToVisit: Boolean,
        includeTrips: Boolean,
        startDate: String?,
        endDate: String?,
    ) {
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true; _message.value = null
            val payload = mapOf<String, Any?>(
                "format" to format,
                "includeLocationData" to includeLocation,
                "includeWantToVisit" to includeWantToVisit,
                "includeTrips" to includeTrips,
                "startDate" to startDate?.takeIf { it.isNotBlank() },
                "endDate" to endDate?.takeIf { it.isNotBlank() },
            )
            val res = client.jobs.submit("data-export", payload, SubmitJobOptions(namespace = "wayli"))
            _message.value = if (res.data != null) "Export queued" else (res.error?.message ?: "Export failed")
            loadHistory()
            _busy.value = false
        }
    }

    /**
     * Queue an import job per picked file (#286). Each file uploads and
     * submits independently — the backend already treats data-import jobs as
     * per-file units (own dedupe, own duplicate-report session), so bulk
     * selection is safe without a batch endpoint.
     */
    fun submitImports(
        context: Context,
        uris: List<Uri>,
        includeLocation: Boolean,
        includeWantToVisit: Boolean,
        includeTrips: Boolean,
    ) {
        val uid = userId ?: return
        if (isDemo || _busy.value) return
        viewModelScope.launch(Dispatchers.IO) {
            _busy.value = true; _message.value = null
            var betaOn: Boolean? = null
            var ok = 0
            val failures = mutableListOf<String>()
            for (uri in uris) {
                val fileName = runCatching { displayName(context, uri) }
                    .getOrNull() ?: "import-${System.currentTimeMillis()}"
                try {
                    val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
                        ?: throw Exception("Cannot read file")
                    val format = detectImportFormat(fileName)
                    // Fitness files are beta-gated (same as web): refuse the upload
                    // while the opt-in is off instead of failing the job later.
                    if (format == "fit") {
                        if (betaOn == null) {
                            betaOn = prefsRepo.getPreferences(uid)
                                .getOrNull()?.let { prefsRepo.fitnessBetaOf(it) } == true
                        }
                        if (betaOn != true) {
                            throw Exception("Fitness files need the Fitness beta — enable it in Preferences first.")
                        }
                    }
                    val storagePath = "$uid/${System.currentTimeMillis()}-$fileName"
                    client.storage.from("temp-files")
                        .upload(path = storagePath, data = bytes, contentType = "application/octet-stream")
                    val payload = mapOf<String, Any?>(
                        "storagePath" to storagePath,
                        "fileName" to fileName,
                        "fileSize" to bytes.size.toLong(),
                        "format" to format,
                        "includeLocationData" to includeLocation,
                        "includeWantToVisit" to includeWantToVisit,
                        "includeTrips" to includeTrips,
                    )
                    val jobType = if (format == "polarsteps") "polarsteps-import" else "data-import"
                    val res = client.jobs.submit(jobType, payload, SubmitJobOptions(namespace = "wayli"))
                    if (res.data != null) ok++ else failures.add("$fileName: ${res.error?.message ?: "Import failed"}")
                } catch (e: Exception) {
                    failures.add("$fileName: ${e.message ?: "Import failed"}")
                }
            }
            _message.value = when {
                failures.isEmpty() -> if (ok == 1) "Import queued" else "$ok imports queued"
                ok > 0 -> "$ok of ${uris.size} imports queued — failures: " + failures.joinToString("; ")
                else -> failures.first()
            }
            loadHistory()
            _busy.value = false
        }
    }

    fun clearMessage() { _message.value = null }

    private fun displayName(context: Context, uri: Uri): String? {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) return c.getString(0)
        }
        return uri.lastPathSegment
    }
}

/** Map a picked file name to the data-import job's `format` string. */
internal fun detectImportFormat(fileName: String): String {
    val lower = fileName.substringAfterLast('.', "").lowercase()
    return when (lower) {
        "geojson", "json" -> "geojson"
        "gpx" -> "gpx"
        "kml" -> "kml"
        "rec" -> "owntracks"
        "zip" -> "polarsteps"
        "fit" -> "fit"
        else -> "geojson"
    }
}

@Composable
fun ImportExportScreen(
    onBack: () -> Unit,
    viewModel: ImportExportViewModel = hiltViewModel(),
) {
    val jobs by viewModel.jobs.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val message by viewModel.message.collectAsState()
    val context = LocalContext.current

    var format by remember { mutableStateOf("JSON") }
    var incLocation by remember { mutableStateOf(true) }
    var incWantToVisit by remember { mutableStateOf(true) }
    var incTrips by remember { mutableStateOf(true) }
    var startDate by remember { mutableStateOf("") }
    var endDate by remember { mutableStateOf("") }

    // #286: multi-select — every picked file becomes its own import job.
    val importLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            if (!uris.isNullOrEmpty()) {
                viewModel.submitImports(context, uris, incLocation, incWantToVisit, incTrips)
            }
        }

    SubScreenScaffold(title = "Import / Export", onBack = onBack) {
        // ---- Export ----
        WayliSectionCard(title = "Export") {
            Text("Choose what to include and a format, then submit a background job.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            Text("Format", style = MaterialTheme.typography.labelMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                EXPORT_FORMATS.forEach { f ->
                    FilterChip(selected = format == f, onClick = { format = f }, label = { Text(f) })
                }
            }
            Spacer(Modifier.height(12.dp))
            IncludeToggles(incLocation, incWantToVisit, incTrips) { l, w, t ->
                incLocation = l; incWantToVisit = w; incTrips = t
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = startDate, onValueChange = { startDate = it },
                    label = { Text("Start (YYYY-MM-DD)") }, singleLine = true,
                    enabled = !viewModel.isDemo, modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = endDate, onValueChange = { endDate = it },
                    label = { Text("End (YYYY-MM-DD)") }, singleLine = true,
                    enabled = !viewModel.isDemo, modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { viewModel.submitExport(format, incLocation, incWantToVisit, incTrips, startDate, endDate) },
                enabled = !viewModel.isDemo && !busy,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text(if (busy) "Working…" else "Create export") }
        }

        Spacer(Modifier.height(8.dp))

        // ---- Import ----
        WayliSectionCard(title = "Import") {
            Text(
                "Import from GeoJSON, GPX, KML, OwnTracks (.rec), Polarsteps (.zip), or a fitness " +
                    ".fit file from your sports watch (Fitness beta). The file is uploaded and " +
                    "processed as a background job.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            IncludeToggles(incLocation, incWantToVisit, incTrips) { l, w, t ->
                incLocation = l; incWantToVisit = w; incTrips = t
            }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = {
                    importLauncher.launch(
                        arrayOf(
                            "application/json", "application/geo+json", "application/gpx+xml",
                            "application/vnd.google-earth.kml+xml", "application/zip",
                            "application/vnd.ant.fit",
                            "*/*",
                        ),
                    )
                },
                enabled = !viewModel.isDemo && !busy,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text(if (busy) "Working…" else "Choose files to import") }
        }

        Spacer(Modifier.height(8.dp))

        // ---- History ----
        WayliSectionCard(title = "Job history") {
            if (viewModel.isDemo) {
                Text("No jobs in demo mode.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (jobs.isEmpty()) {
                Text("No import/export jobs yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                jobs.take(10).forEach { job ->
                    JobRow(job)
                }
            }
        }

        message?.let { msg ->
            Spacer(Modifier.height(8.dp))
            Text(msg, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun IncludeToggles(loc: Boolean, wtv: Boolean, trips: Boolean, onChange: (Boolean, Boolean, Boolean) -> Unit) {
    Text("Include", style = MaterialTheme.typography.labelMedium)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AssistChip(onClick = { onChange(!loc, wtv, trips) }, label = { Text(if (loc) "✓ Location" else "Location") })
        AssistChip(onClick = { onChange(loc, !wtv, trips) }, label = { Text(if (wtv) "✓ Wishlist" else "Wishlist") })
        AssistChip(onClick = { onChange(loc, wtv, !trips) }, label = { Text(if (trips) "✓ Trips" else "Trips") })
    }
}

@Composable
private fun JobRow(job: Job) {
    val isExport = job.jobName == "data-export"
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        elevation = CardDefaults.cardElevation(1.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(if (isExport) "Export" else "Import", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                job.createdAt.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                job.error?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 2)
                }
            }
            StatusBadge(job.status)
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val color = when (status) {
        "completed" -> MaterialTheme.colorScheme.primary
        "failed" -> MaterialTheme.colorScheme.error
        "running" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        status.replaceFirstChar { it.uppercase() },
        style = MaterialTheme.typography.labelSmall,
        color = color,
        fontWeight = FontWeight.SemiBold,
    )
}
