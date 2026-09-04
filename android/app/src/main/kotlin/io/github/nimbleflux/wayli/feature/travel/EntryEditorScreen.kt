package io.github.nimbleflux.wayli.feature.travel

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Notes
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.feature.media.MediaUploader
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.repo.DraftRepository
import io.github.nimbleflux.wayli.repo.EntryDraft
import io.github.nimbleflux.wayli.repo.TripRepository
import java.io.File
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/**
 * Hands an in-memory [TripEntry] to the editor (demo mode / just-created
 * entries) without serializing it through nav args. Set right before
 * navigating; consumed (and cleared) by [EntryEditorViewModel].
 */
object EntryEditorInputCache {
    var entry: TripEntry? = null
}

/**
 * Hands a saved entry back to the trip screen (demo in-memory entries)
 * alongside the nav-graph "entry_saved" result.
 */
object EntryEditorResultCache {
    var entry: TripEntry? = null
}

/** Everything the editor renders. */
data class EditorState(
    /** Stable id of the backing draft row (assigned on first auto-save). */
    val draftId: String = "",
    val isEdit: Boolean = false,
    val title: String = "",
    val entryDate: String = "",
    /** Ordered content blocks — text (markdown) and photo blocks. */
    val blocks: List<EditorBlockDto> = emptyList(),
    /** Existing server media for the edited entry (id + display URL). */
    val existingMedia: List<ExistingMedia> = emptyList(),

    /** The entry's current cover (hero) media id, for the ★ indicator. */
    val heroMediaId: String? = null,
    val saving: Boolean = false,
    val pendingSyncNotice: Boolean = false,
    val loaded: Boolean = false,
    /** Preview (read-only render) vs Edit — Edit is the default; toggle in the top bar. */
    val previewMode: Boolean = false,
)

/** A server-side photo attached to the entry being edited. */
data class ExistingMedia(val id: String, val url: String, val storagePath: String = "")

/**
 * Backing for the full-screen journal-entry editor (Polarsteps-style).
 *
 * - The whole state auto-saves as a local draft (debounced) — nothing is
 *   lost on process death, and composing works fully offline.
 * - Save publishes: demo keeps the entry in memory; real mode
 *   creates/updates the entry, uploads photos, and attaches media rows.
 *   When publishing fails (offline), the draft is marked PENDING_SYNC and
 *   [io.github.nimbleflux.wayli.tracking.EntrySyncWorker] retries later.
 */
@HiltViewModel
class EntryEditorViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    @ApplicationContext private val appContext: Context,
    private val tripRepo: TripRepository,
    private val draftRepo: DraftRepository,
    private val mediaUploader: MediaUploader,
    private val entryPublisher: EntryPublisher,
    private val demoManager: DemoManager,
) : ViewModel() {

    val tripId: String = savedStateHandle.get<String>("tripId") ?: ""
    /** Existing entry being edited, if any. */
    val entryId: String? = savedStateHandle.get<String>("entryId")?.takeIf { it.isNotBlank() }
    /** An existing draft being resumed, if any. */
    val draftId: String? = savedStateHandle.get<String>("draftId")?.takeIf { it.isNotBlank() }

    val isDemo: Boolean get() = demoManager.isDemoMode

    private val _state = MutableStateFlow(EditorState())
    val state: StateFlow<EditorState> = _state.asStateFlow()

    /** Set on successful save; the screen pops back and hands this to the trip screen. */
    val savedEntry = MutableStateFlow<TripEntry?>(null)
    val message = MutableStateFlow<String?>(null)

    /** true when the save was queued offline instead of published. */
    val queuedOffline = MutableStateFlow(false)

    private var lastSaved: EntryDraft? = null

    /** Draft-relevant fields only — preview mode, cover picks and server-photo
     * deletes are not draft content; changing them must NOT conjure a draft
     * for an otherwise-unchanged published entry. */
    private data class DraftContent(
        val title: String,
        val blocks: String,
        val entryDate: String,
    )

    /** Draft content at load time — persist() only acts on divergence. */
    private var baseline: DraftContent? = null

    /** The draft row resumed from nav args (never auto-deleted on close). */
    private val resumedDraftId: String? = draftId

    private fun draftContentOf(state: EditorState) = DraftContent(
        title = state.title,
        blocks = EditorBlockModel.encode(state.blocks),
        entryDate = state.entryDate,
    )

    init {
        viewModelScope.launch(Dispatchers.IO) { loadInitial() }
    }

    private suspend fun loadInitial() {
        val cached = EntryEditorInputCache.entry
        EntryEditorInputCache.entry = null

        val editing = entryId != null
        var title = ""
        var body = ""
        var blocksJson: JsonElement? = null
        var date = java.time.LocalDate.now().toString()
        var mediaRows = emptyList<io.github.nimbleflux.wayli.models.TripMedia>()

        var entryCoverId: String? = null
        if (editing) {
            if (cached != null && cached.id == entryId) {
                title = cached.title.orEmpty()
                body = cached.body.orEmpty()
                blocksJson = cached.blocks
                date = cached.entryDate
                entryCoverId = cached.coverMediaId
            } else if (!demoManager.isDemoMode) {
                tripRepo.listEntries(tripId).getOrNull()
                    ?.firstOrNull { it.id == entryId }
                    ?.let { entry ->
                        title = entry.title.orEmpty()
                        body = entry.body.orEmpty()
                        blocksJson = entry.blocks
                        date = entry.entryDate
                        entryCoverId = entry.coverMediaId
                    }
            } else {
                io.github.nimbleflux.wayli.demo.DemoData.entries[tripId]
                    ?.firstOrNull { it.id == entryId }
                    ?.let { entry ->
                        title = entry.title.orEmpty()
                        body = entry.body.orEmpty()
                        date = entry.entryDate
                    }
            }
        }

        // Resuming a specific draft (multi-draft: the trip screen routes to
        // one) — its content wins over the entry's server content.
        val draft = draftId?.let { draftRepo.get(it) }
        var draftBlocks: List<EditorBlockDto>? = null
        if (draft != null) {
            title = draft.title.ifBlank { title }
            if (draft.entryDate.isNotBlank()) date = draft.entryDate
            draftBlocks = EditorBlockModel.decode(draft.blocks)
            if (draftBlocks == null) {
                // Legacy draft (body + local photos, no block list yet).
                body = draft.body.ifBlank { body }
            }
        }
        val draftLocalPhotos = draft?.photos.orEmpty()

        // Existing server photos load on EVERY edit — the cache-hit branch
        // above used to skip this, which hid the × / ★ management entirely.
        if (editing && !demoManager.isDemoMode) {
            mediaRows = tripRepo.listMedia(tripId, entryId).getOrNull().orEmpty()
        }
        val existingMedia = mediaRows.mapNotNull { media ->
            mediaUploader.resolveDisplayUrl(storagePath = media.storagePath)
                ?.let { ExistingMedia(media.id, it, media.storagePath) }
        }

        // Block list for the editor: draft blocks > stored blocks > derived
        // from the legacy body + media rows.
        val editorBlocks: List<EditorBlockDto> = when {
            draftBlocks != null -> draftBlocks
            else -> {
                val effective = when {
                    blocksJson != null -> io.github.nimbleflux.wayli.entry.EntryBlocks.fromJson(blocksJson)
                    else -> null
                }?.let { envelope ->
                    if (io.github.nimbleflux.wayli.entry.EntryBlocks.legacyBody(
                            envelope.blocks,
                            mediaRows.associateBy { it.id },
                        ) == body
                    ) envelope else null // stale blocks (legacy client edit) → derive
                } ?: io.github.nimbleflux.wayli.entry.EntryBlocks.derive(body, mediaRows)

                val fromEntry = effective?.blocks?.map { block ->
                    when (block) {
                        is io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Text ->
                            EditorBlockModel.text(block.md)
                        is io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Photos ->
                            EditorBlockModel.photos(block.ids.map { EditorPhotoRef(mediaId = it) })
                    }
                }.orEmpty()

                // Legacy drafts carry local picks that were never uploaded —
                // they extend the trailing photo block.
                if (draftLocalPhotos.isEmpty()) fromEntry
                else {
                    val locals = draftLocalPhotos.map { EditorPhotoRef(localPath = it) }
                    val last = fromEntry.lastOrNull()
                    if (last != null && last.t == EditorBlockModel.PHOTOS) {
                        fromEntry.dropLast(1) + EditorBlockModel.photos(last.photos + locals)
                    } else {
                        fromEntry + EditorBlockModel.photos(locals)
                    }
                }
            }
        }

        _state.value = EditorState(
            draftId = draft?.id.orEmpty(),
            isEdit = editing,
            heroMediaId = entryCoverId,
            title = title,
            entryDate = date,
            blocks = editorBlocks.ifEmpty { listOf(EditorBlockModel.text("")) },
            existingMedia = existingMedia,
            pendingSyncNotice = draft?.pendingSync == true,
            loaded = true,
        )
        lastSaved = draft
        baseline = draftContentOf(_state.value)
    }

    fun togglePreview() = update { it.copy(previewMode = !it.previewMode) }

    // ---- Field updates (auto-save via persist()) ----

    fun setTitle(value: String) = update { it.copy(title = value) }
    fun setDate(value: String) = update { it.copy(entryDate = value) }

    fun setBlockText(index: Int, md: String) = updateBlocks { blocks ->
        blocks.mapIndexed { i, b -> if (i == index && b.t == EditorBlockModel.TEXT) b.copy(md = md) else b }
    }

    fun addTextBlock() = updateBlocks { it + EditorBlockModel.text("") }

    /** Move a block one position up (delta -1) or down (delta +1). */
    fun moveBlock(index: Int, delta: Int) = updateBlocks { blocks ->
        val target = index + delta
        if (target < 0 || target >= blocks.size) blocks
        else blocks.toMutableList().apply {
            val moved = removeAt(index)
            add(target, moved)
        }
    }

    /** Remove a block. Photo blocks lose their server media rows on publish. */
    fun removeBlock(index: Int) = updateBlocks { blocks ->
        blocks.filterIndexed { i, _ -> i != index }
    }

    /**
     * Copies the picked images into app storage (so drafts survive restarts)
     * and appends them to a photo block — the trailing one when [blockIndex]
     * is null, else the given block.
     */
    fun addPhotos(blockIndex: Int?, uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch(Dispatchers.IO) {
            val refs = uris.mapNotNull { uri ->
                runCatching { copyPhotoLocally(uri) }
                    .onFailure { message.value = "Could not read the selected photo" }
                    .getOrNull()
                    ?.let { EditorPhotoRef(localPath = it) }
            }
            if (refs.isNotEmpty()) {
                updateBlocks { blocks ->
                    val index = blockIndex ?: blocks.indexOfLast { it.t == EditorBlockModel.PHOTOS }
                    if (index >= 0) {
                        blocks.mapIndexed { i, b ->
                            if (i == index && b.t == EditorBlockModel.PHOTOS) b.copy(photos = b.photos + refs) else b
                        }
                    } else {
                        blocks + EditorBlockModel.photos(refs)
                    }
                }
            }
        }
    }

    private fun copyPhotoLocally(uri: Uri): String {
        val dir = File(appContext.filesDir, "entry-media").apply { mkdirs() }
        val file = File(dir, "${UUID.randomUUID()}.jpg")
        appContext.contentResolver.openInputStream(uri)!!.use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        return file.absolutePath
    }

    /** Remove one photo (local pick or server media) from its block. */
    fun removePhotoRef(blockIndex: Int, photoIndex: Int) {
        var removedMediaId: String? = null
        updateBlocks { blocks ->
            blocks.mapIndexed { i, b ->
                if (i == blockIndex && b.t == EditorBlockModel.PHOTOS && photoIndex < b.photos.size) {
                    removedMediaId = b.photos[photoIndex].mediaId
                    b.copy(photos = b.photos.filterIndexed { p, _ -> p != photoIndex })
                } else b
            }.filter { it.t == EditorBlockModel.TEXT || it.photos.isNotEmpty() }
        }
        // Server photos are removed from the entry entirely (row + storage).
        removedMediaId?.let(::deleteExistingMedia)
    }

    /**
     * Delete an existing server photo from the entry (row + storage, best
     * effort) and strip it from every block.
     */
    fun deleteExistingMedia(mediaId: String) {
        update {
            it.copy(
                existingMedia = it.existingMedia.filterNot { m -> m.id == mediaId },
                blocks = it.blocks.map { b ->
                    if (b.t == EditorBlockModel.PHOTOS) {
                        b.copy(photos = b.photos.filterNot { r -> r.mediaId == mediaId })
                    } else b
                }.filter { it.t == EditorBlockModel.TEXT || it.photos.isNotEmpty() },
            )
        }
        if (!demoManager.isDemoMode && entryId != null) {
            viewModelScope.launch(Dispatchers.IO) {
                tripRepo.deleteMedia(mediaId).onFailure {
                    message.value = "Couldn't delete the photo: ${it.message ?: "network error"}"
                }
            }
        }
    }

    /** Make an existing photo the entry's cover (hero). */
    fun setCover(mediaId: String) {
        update { it.copy(heroMediaId = mediaId) } // optimistic ★ indicator
        if (demoManager.isDemoMode || entryId == null) return
        viewModelScope.launch(Dispatchers.IO) {
            tripRepo.updateEntryCover(entryId!!, mediaId)
                .onSuccess { message.value = "Cover updated" }
                .onFailure { message.value = "Couldn't set the cover: ${it.message ?: "network error"}" }
        }
    }

    private fun updateBlocks(transform: (List<EditorBlockDto>) -> List<EditorBlockDto>) {
        update { it.copy(blocks = transform(it.blocks)) }
    }

    private fun update(transform: (EditorState) -> EditorState) {
        _state.value = transform(_state.value)
        persist()
    }

    /**
     * Debounced draft persistence — one stable draft row per editor session.
     * A draft is only written when the draft-relevant content has DIVERGED
     * from the loaded baseline; reverting back to baseline deletes the draft
     * row again, so closing an unchanged editor never leaves a phantom
     * "draft" behind for a published entry.
     */
    private fun persist() {
        val snapshot = _state.value
        val base = baseline ?: return
        if (draftContentOf(snapshot) == base) {
            deleteSessionDraftIfAny()
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            kotlinx.coroutines.delay(800) // debounce
            if (snapshot !== _state.value && !savingNow()) return@launch // superseded
            val draft = EntryDraft(
                id = snapshot.draftId,
                tripId = tripId,
                entryId = entryId,
                title = snapshot.title,
                blocks = EditorBlockModel.encode(snapshot.blocks),
                entryDate = snapshot.entryDate,
            )
            val id = draftRepo.save(draft)
            if (snapshot.draftId.isBlank()) {
                _state.value = _state.value.copy(draftId = id)
            }
            lastSaved = draft
        }
    }

    /**
     * Remove a draft row created THIS session (not one resumed from args)
     * when its content matches the baseline. Called from persist() on
     * revert and from onCleared() so closing an unchanged editor —
     * including via the system back gesture — leaves no draft behind.
     */
    private fun deleteSessionDraftIfAny() {
        val current = _state.value
        val id = current.draftId.takeIf { it.isNotBlank() } ?: return
        if (id == resumedDraftId) return
        if (current.pendingSyncNotice || sessionDraftPendingSync) return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { draftRepo.delete(id) }
            if (_state.value.draftId == id) {
                _state.value = _state.value.copy(draftId = "")
            }
        }
    }

    /** True once save() queued this session's draft for background publish. */
    @Volatile private var sessionDraftPendingSync = false

    override fun onCleared() {
        // Closing the editor without net changes (arrow OR system back) must
        // not leave a phantom draft — viewModelScope is already cancelled by
        // the time onCleared runs, so this tiny Room delete runs blocking.
        val state = _state.value
        val base = baseline
        val id = state.draftId.takeIf { it.isNotBlank() }
        if (base != null && draftContentOf(state) == base &&
            id != null && id != resumedDraftId && !sessionDraftPendingSync
        ) {
            runCatching { kotlinx.coroutines.runBlocking { draftRepo.delete(id) } }
        }
        super.onCleared()
    }

    private fun savingNow() = _state.value.saving

    // ---- Save / publish ----

    fun save() {
        val snapshot = _state.value
        if (snapshot.title.isBlank()) {
            message.value = "Add a title first"
            return
        }
        _state.value = snapshot.copy(saving = true)
        viewModelScope.launch(Dispatchers.IO) {
            if (demoManager.isDemoMode) {
                val blocksJson = io.github.nimbleflux.wayli.entry.EntryBlocks.toJson(
                    io.github.nimbleflux.wayli.entry.EntryBlocks.Envelope(cleanBlocks(snapshot.blocks)),
                )
                val body = snapshot.blocks
                    .filter { it.t == EditorBlockModel.TEXT }
                    .joinToString("\n\n") { it.md.orEmpty().trim() }
                    .trim().takeIf { it.isNotBlank() }
                val entry = TripEntry(
                    id = entryId ?: "local-${System.currentTimeMillis()}",
                    tripId = tripId,
                    entryDate = snapshot.entryDate.ifBlank { java.time.LocalDate.now().toString() },
                    title = snapshot.title.trim(),
                    body = body,
                    blocks = blocksJson,
                    status = "published",
                    createdAt = "",
                    updatedAt = "",
                )
                if (snapshot.draftId.isNotBlank()) draftRepo.delete(snapshot.draftId)
                _state.value = _state.value.copy(saving = false)
                EntryEditorResultCache.entry = entry
                savedEntry.value = entry
                return@launch
            }

            val published = publishReal(snapshot)
            _state.value = _state.value.copy(saving = false)
            if (published != null) {
                if (snapshot.draftId.isNotBlank()) draftRepo.delete(snapshot.draftId)
                savedEntry.value = TripEntry(
                    id = published,
                    tripId = tripId,
                    entryDate = snapshot.entryDate,
                    title = snapshot.title.trim(),
                )
            } else {
                // Offline (or server unreachable): keep everything as a
                // pending draft; the sync worker publishes it later. Make
                // sure a draft row exists even if auto-save hasn't fired.
                val draftIdNow = snapshot.draftId.ifBlank {
                    draftRepo.save(
                        EntryDraft(
                            tripId = tripId,
                            entryId = entryId,
                            title = snapshot.title,
                            blocks = EditorBlockModel.encode(snapshot.blocks),
                            entryDate = snapshot.entryDate,
                        ),
                    )
                }
                draftRepo.markPendingSync(draftIdNow)
                sessionDraftPendingSync = true
                io.github.nimbleflux.wayli.tracking.EntrySyncWorker.schedule(appContext)
                queuedOffline.value = true
                message.value = "No connection — saved as a draft. It will be published automatically when you're back online."
            }
        }
    }

    /** Blank text blocks and empty photo blocks never publish. */
    private fun cleanBlocks(blocks: List<EditorBlockDto>): List<io.github.nimbleflux.wayli.entry.EntryBlocks.Block> =
        blocks.mapNotNull { block ->
            when (block.t) {
                EditorBlockModel.TEXT -> block.md?.trim()?.takeIf { it.isNotEmpty() }
                    ?.let { io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Text(it) }
                EditorBlockModel.PHOTOS -> block.photos.takeIf { it.isNotEmpty() }
                    ?.let { io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Photos(it.mapNotNull { r -> r.mediaId }) }
                else -> null
            }
        }.filter { b -> b !is io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Text || b.md.isNotEmpty() }
            .filter { b -> b !is io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Photos || b.ids.isNotEmpty() }

    /** Returns the published entry id, or null on failure. */
    private suspend fun publishReal(snapshot: EditorState): String? = runCatching {
        entryPublisher.publish(
            tripId = tripId,
            entryId = entryId,
            title = snapshot.title.trim(),
            entryDate = snapshot.entryDate.ifBlank { java.time.LocalDate.now().toString() },
            editorBlocks = snapshot.blocks,
            existingMedia = snapshot.existingMedia,
        )
    }.getOrElse {
        message.value = "Publish failed: ${it.message ?: "network error"}"
        null
    }

    fun clearMessage() { message.value = null }
}


// ---- UI ----

/**
 * Full-screen journal-entry editor (Polarsteps-style): date + title on top,
 * a photo strip, and a body editor that fills the remaining height.
 * Every keystroke auto-saves a local draft — closing mid-edit loses nothing.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun EntryEditorScreen(
    onBack: () -> Unit,
    onSaved: () -> Unit,
    viewModel: EntryEditorViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val savedEntry by viewModel.savedEntry.collectAsState()
    val message by viewModel.message.collectAsState()
    val queuedOffline by viewModel.queuedOffline.collectAsState()
    val snackbar = remember { androidx.compose.material3.SnackbarHostState() }

    // Photos land inside photo blocks. Which block a pick extends is decided
    // by the tile that launched the picker (null = trailing photo block).
    var pendingPhotoBlockIndex by remember { androidx.compose.runtime.mutableStateOf<Int?>(null) }
    val photoPicker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia(),
    ) { uris -> viewModel.addPhotos(pendingPhotoBlockIndex, uris) }

    fun launchPhotoPicker(blockIndex: Int?) {
        pendingPhotoBlockIndex = blockIndex
        photoPicker.launch(
            androidx.activity.result.PickVisualMediaRequest(
                androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly,
            ),
        )
    }

    // Destructive photo removals ask first — deleting a server photo also
    // removes the stored file.
    var pendingPhotoDelete by remember {
        androidx.compose.runtime.mutableStateOf<Pair<String, () -> Unit>?>(null)
    }
    if (pendingPhotoDelete != null) {
        val (label, confirm) = pendingPhotoDelete!!
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pendingPhotoDelete = null },
            title = { Text("Remove photo?") },
            text = { Text("$label will be removed${if (state.isEdit) " everywhere" else ""}. This can't be undone.") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    confirm()
                    pendingPhotoDelete = null
                }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { pendingPhotoDelete = null }) { Text("Cancel") }
            },
        )
    }

    LaunchedEffect(savedEntry) {
        if (savedEntry != null) onSaved()
    }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            viewModel.clearMessage()
        }
    }
    LaunchedEffect(queuedOffline) {
        if (queuedOffline) {
            viewModel.queuedOffline.value = false
            onSaved()
        }
    }

    androidx.compose.material3.Scaffold(
        snackbarHost = {
            androidx.compose.material3.SnackbarHost(
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
            androidx.compose.material3.TopAppBar(
                title = { Text(if (state.isEdit) "Edit entry" else "New entry") },
                navigationIcon = {
                    androidx.compose.material3.IconButton(onClick = onBack) {
                        Icon(
                            androidx.compose.material.icons.Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                },
                actions = {
                    androidx.compose.material3.TextButton(
                        onClick = { viewModel.togglePreview() },
                        enabled = state.loaded && !state.saving,
                    ) { Text(if (state.previewMode) "Edit" else "Preview") }
                    androidx.compose.material3.TextButton(
                        onClick = { viewModel.save() },
                        enabled = state.loaded && !state.saving,
                    ) { Text("Save", fontWeight = FontWeight.Bold) }
                },
            )
        },
    ) { padding ->
        if (!state.loaded) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { androidx.compose.material3.CircularProgressIndicator() }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState())
                .imePadding(),
        ) {
            if (state.previewMode) {
                // ---- Preview pane: read-only render (also used for drafts) ----
                // Server photos resolve to display URLs, local picks to file URIs.
                val previewItems = remember(state.blocks, state.existingMedia) {
                    state.blocks.mapNotNull { block ->
                        when (block.t) {
                            EditorBlockModel.TEXT -> block.md?.trim()?.takeIf { it.isNotEmpty() }
                                ?.let { PreviewItem.Text(it) }
                            else -> block.photos.mapNotNull { ref ->
                                ref.mediaId?.let { id -> state.existingMedia.firstOrNull { it.id == id }?.url }
                                    ?: ref.localPath?.let { java.io.File(it).toURI().toString() }
                            }.takeIf { it.isNotEmpty() }?.let { PreviewItem.Photos(it) }
                        }
                    }
                }
                EntryPreviewPane(
                    title = state.title,
                    entryDate = state.entryDate,
                    items = previewItems,
                )
                return@Column
            }

            if (state.pendingSyncNotice) {
                androidx.compose.material3.Surface(
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.12f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Draft waiting to go online — it will publish automatically.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(12.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
            }

            // ---- Date: friendly display + Material date picker ----
            var showDatePicker by remember { androidx.compose.runtime.mutableStateOf(false) }
            val formattedDate = remember(state.entryDate) { formatFriendlyDate(state.entryDate) }
            androidx.compose.material3.OutlinedButton(
                onClick = { showDatePicker = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    androidx.compose.material.icons.Icons.Filled.DateRange,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.size(8.dp))
                Text(formattedDate)
            }
            if (showDatePicker) {
                val pickerState = androidx.compose.material3.rememberDatePickerState(
                    initialSelectedDateMillis = parseDateMillis(state.entryDate),
                )
                androidx.compose.material3.DatePickerDialog(
                    onDismissRequest = { showDatePicker = false },
                    confirmButton = {
                        androidx.compose.material3.TextButton(
                            onClick = {
                                pickerState.selectedDateMillis?.let { millis ->
                                    viewModel.setDate(millisToIsoDate(millis))
                                }
                                showDatePicker = false
                            },
                        ) { Text("OK") }
                    },
                    dismissButton = {
                        androidx.compose.material3.TextButton(onClick = { showDatePicker = false }) { Text("Cancel") }
                    },
                ) {
                    androidx.compose.material3.DatePicker(state = pickerState)
                }
            }
            Spacer(Modifier.height(16.dp))

            // ---- Title: big placeholder-styled field (no label) ----
            androidx.compose.material3.OutlinedTextField(
                value = state.title,
                onValueChange = viewModel::setTitle,
                placeholder = {
                    Text(
                        "Title",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.headlineSmall,
            )
            Spacer(Modifier.height(12.dp))

            // ---- Content blocks: text (markdown) and photo groups. ----
            state.blocks.forEachIndexed { blockIndex, block ->
                // Block controls: move up / move down / remove.
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.material3.IconButton(
                        onClick = { viewModel.moveBlock(blockIndex, -1) },
                        enabled = blockIndex > 0 && !state.saving,
                        modifier = Modifier.size(32.dp),
                    ) {
                        Icon(
                            Icons.Filled.KeyboardArrowUp,
                            contentDescription = "Move block up",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    androidx.compose.material3.IconButton(
                        onClick = { viewModel.moveBlock(blockIndex, 1) },
                        enabled = blockIndex < state.blocks.lastIndex && !state.saving,
                        modifier = Modifier.size(32.dp),
                    ) {
                        Icon(
                            Icons.Filled.KeyboardArrowDown,
                            contentDescription = "Move block down",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    androidx.compose.material3.IconButton(
                        onClick = { viewModel.removeBlock(blockIndex) },
                        enabled = !state.saving,
                        modifier = Modifier.size(32.dp),
                    ) {
                        Icon(
                            androidx.compose.material.icons.Icons.Filled.Close,
                            contentDescription = "Remove block",
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (block.t == EditorBlockModel.TEXT) {
                    // ---- Text block: markdown field; the column scrolls, so
                    // tall content below can't crush the field to zero. ----
                    androidx.compose.material3.OutlinedTextField(
                        value = block.md.orEmpty(),
                        onValueChange = { viewModel.setBlockText(blockIndex, it) },
                        label = { Text("Your story…") },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                        textStyle = MaterialTheme.typography.bodyLarge,
                    )
                } else {
                    // ---- Photo block: grid tiles + a trailing add tile. ----
                    val columns = 3
                    (0 until block.photos.size + 1).chunked(columns).forEach { rowIndices ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            rowIndices.forEach { index ->
                                Box(Modifier.weight(1f).height(104.dp)) {
                                    if (index < block.photos.size) {
                                        val ref = block.photos[index]
                                        val url = ref.mediaId?.let { id ->
                                            state.existingMedia.firstOrNull { it.id == id }?.url
                                        }
                                        PhotoTile(
                                            model = url ?: ref.localPath?.let { java.io.File(it) } ?: "",
                                            isHero = ref.mediaId != null && ref.mediaId == state.heroMediaId,
                                            onRemove = {
                                                pendingPhotoDelete = "This photo" to {
                                                    viewModel.removePhotoRef(blockIndex, index)
                                                }
                                            },
                                            onSetCover = ref.mediaId?.let { id -> { viewModel.setCover(id) } },
                                        )
                                    } else {
                                        AddPhotoTile(
                                            onAdd = { launchPhotoPicker(blockIndex) },
                                            modifier = Modifier.fillMaxWidth(),
                                        )
                                    }
                                }
                            }
                            // Pad short rows so tiles keep grid width.
                            repeat(columns - rowIndices.size) { Spacer(Modifier.weight(1f)) }
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            // ---- Add-block actions ----
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                androidx.compose.material3.OutlinedButton(
                    onClick = { viewModel.addTextBlock() },
                    enabled = !state.saving,
                ) {
                    Icon(
                        Icons.Filled.Notes,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.size(6.dp))
                    Text("Add text")
                }
                androidx.compose.material3.OutlinedButton(
                    onClick = { launchPhotoPicker(null) },
                    enabled = !state.saving,
                ) {
                    Icon(
                        androidx.compose.material.icons.Icons.Filled.AddPhotoAlternate,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.size(6.dp))
                    Text("Add photos")
                }
            }
            Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
        }
    }
}

@Composable
private fun PhotoTile(
    model: Any,
    onRemove: () -> Unit,
    onSetCover: (() -> Unit)? = null,
    selected: Boolean = false,
    isHero: Boolean = false,
    onToggleSelect: () -> Unit = {},
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
            .then(
                if (selected) {
                    Modifier.border(
                        3.dp,
                        MaterialTheme.colorScheme.primary,
                        androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                    )
                } else {
                    Modifier
                },
            ),
    ) {
        io.github.nimbleflux.wayli.designsystem.WayliAsyncImage(
            model = model,
            contentDescription = "Photo",
            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            modifier = Modifier
                .matchParentSize()
                .clickable(onClick = onToggleSelect),
        )
        if (isHero) {
            // Vector icons center optically inside the badge; text glyphs
            // ("★") sit off-center because of font metrics.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(4.dp)
                    .background(
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                        androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                    )
                    .padding(3.dp),
            ) {
                Icon(
                    Icons.Filled.Star,
                    contentDescription = "Cover photo",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
        if (onSetCover != null) {
            androidx.compose.material3.Surface(
                shape = androidx.compose.foundation.shape.CircleShape,
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(4.dp)
                    .size(26.dp),
            ) {
                androidx.compose.material3.IconButton(onClick = onSetCover, modifier = Modifier.size(26.dp)) {
                    Icon(
                        Icons.Filled.Star,
                        contentDescription = "Set as cover",
                        modifier = Modifier.size(15.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        androidx.compose.material3.Surface(
            shape = androidx.compose.foundation.shape.CircleShape,
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(4.dp)
                .size(26.dp),
        ) {
            androidx.compose.material3.IconButton(onClick = onRemove, modifier = Modifier.size(26.dp)) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Remove photo",
                    modifier = Modifier.size(15.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun AddPhotoTile(onAdd: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        onClick = onAdd,
        modifier = modifier.fillMaxSize(),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
            Icon(
                androidx.compose.material.icons.Icons.Filled.AddPhotoAlternate,
                contentDescription = "Add photo",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ---- Date helpers ----

/** "2026-08-15" (or full timestamp) → "Aug 15, 2026"; today when unparseable. */
internal fun formatFriendlyDate(iso: String): String {
    val date = io.github.nimbleflux.wayli.util.parseIsoDate(iso) ?: java.time.LocalDate.now()
    return java.time.format.DateTimeFormatter.ofPattern("MMM d, yyyy")
        .format(date)
}

/** ISO date/timestamp → epoch millis for the picker (UTC midnight); today as fallback. */
internal fun parseDateMillis(iso: String): Long {
    val date = io.github.nimbleflux.wayli.util.parseIsoDate(iso) ?: java.time.LocalDate.now()
    return date.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
}

/** Picker epoch millis (UTC midnight) → ISO "yyyy-MM-dd". */
internal fun millisToIsoDate(millis: Long): String =
    java.time.Instant.ofEpochMilli(millis)
        .atZone(java.time.ZoneOffset.UTC)
        .toLocalDate()
        .toString()

/** Render model for the editor's preview pane. */
private sealed interface PreviewItem {
    data class Text(val md: String) : PreviewItem
    data class Photos(val urls: List<String>) : PreviewItem
}

/**
 * Read-only render of the story — the preview mode of the editor. Reuses
 * the same visual language as [EntryDetailScreen]: the first photo is the
 * hero, text blocks render as markdown, photo blocks as strips.
 */
@Composable
private fun EntryPreviewPane(
    title: String,
    entryDate: String,
    items: List<PreviewItem>,
) {
    val allPhotos = items.filterIsInstance<PreviewItem.Photos>().flatMap { it.urls }
    Column(modifier = Modifier.fillMaxSize()) {
        if (allPhotos.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(16.dp)),
            ) {
                io.github.nimbleflux.wayli.designsystem.WayliAsyncImage(
                    model = allPhotos.first(),
                    contentDescription = "Hero photo",
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Spacer(Modifier.height(16.dp))
        }

        Text(
            title.ifBlank { "Untitled" },
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            formatFriendlyDate(entryDate),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        val heroShown = allPhotos.isNotEmpty()
        var firstPhotoBlockHandled = false
        for (item in items) {
            when (item) {
                is PreviewItem.Text -> {
                    Spacer(Modifier.height(16.dp))
                    io.github.nimbleflux.wayli.designsystem.MarkdownText(markdown = item.md)
                }
                is PreviewItem.Photos -> {
                    // The first photo of the first block already renders as
                    // the hero above — don't repeat it in the strip.
                    val strip = if (heroShown && !firstPhotoBlockHandled) {
                        firstPhotoBlockHandled = true
                        item.urls.drop(1)
                    } else {
                        item.urls
                    }
                    if (strip.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        androidx.compose.foundation.lazy.LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(strip.size) { i ->
                                io.github.nimbleflux.wayli.designsystem.WayliAsyncImage(
                                    model = strip[i],
                                    contentDescription = "Photo",
                                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                                    modifier = Modifier
                                        .fillMaxWidth(0.45f)
                                        .height(140.dp)
                                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp)),
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
    }
}
