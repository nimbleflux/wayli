package io.github.nimbleflux.wayli.feature.travel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.transformable
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
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.wayli.designsystem.DateBadge
import io.github.nimbleflux.wayli.demo.DemoManager
import io.github.nimbleflux.wayli.feature.media.MediaUploader
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.repo.TripRepository
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The read view for a published journal entry: hero photo, title, date,
 * full body, and the entry's photo gallery. The top-bar Edit button opens
 * the editor — this screen is what a trip's journal overview navigates to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EntryDetailScreen(
    onBack: () -> Unit,
    onEdit: (entry: TripEntry) -> Unit,
    viewModel: EntryDetailViewModel = hiltViewModel(),
) {
    val entry by viewModel.entry.collectAsState()
    val renderBlocks by viewModel.renderBlocks.collectAsState()
    val gallery by viewModel.gallery.collectAsState()
    var menuOpen by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    var confirmDelete by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    var viewerIndex by remember { mutableStateOf<Int?>(null) }

    if (confirmDelete && entry != null) {
        val target = entry
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete entry?") },
            text = { Text("\"${target?.title ?: "This entry"}\" will be removed permanently.") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    confirmDelete = false
                    target?.let { viewModel.deleteEntry(it) { onBack() } }
                }) { Text("Delete", color = androidx.compose.material3.MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { confirmDelete = false }) { Text("Cancel") }
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
                title = { Text(entry?.title ?: "Entry", maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { entry?.let(onEdit) }) {
                        Icon(Icons.Filled.Edit, contentDescription = "Edit entry")
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "Entry options")
                        }
                        androidx.compose.material3.DropdownMenu(
                            expanded = menuOpen,
                            onDismissRequest = { menuOpen = false },
                        ) {
                            androidx.compose.material3.DropdownMenuItem(
                                text = { Text("Delete entry") },
                                onClick = { menuOpen = false; confirmDelete = true },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        val e = entry ?: run {
            // Fetching — never a blank scaffold.
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
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            // Hero photo
            viewModel.heroUrl?.let { url ->
                io.github.nimbleflux.wayli.designsystem.WayliAsyncImage(
                    model = url,
                    contentDescription = e.title ?: "Entry",
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(220.dp)
                        .clip(RoundedCornerShape(16.dp)),
                )
                Spacer(Modifier.height(16.dp))
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                DateBadge(isoDate = e.entryDate)
                Spacer(Modifier.width(12.dp))
                Text(
                    e.title ?: "Entry",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
            // Content blocks: text renders as markdown, photo groups as
            // tappable grids. The hero above already shows the first photo —
            // the first grid skips it so it never appears twice.
            var heroSkipped = false
            renderBlocks.forEach { block ->
                when (block) {
                    is RenderBlock.Text -> {
                        Spacer(Modifier.height(20.dp))
                        // Same markdown renderer as the editor preview.
                        io.github.nimbleflux.wayli.designsystem.MarkdownText(markdown = block.md)
                    }
                    is RenderBlock.Photos -> {
                        val gridUrls = if (viewModel.heroUrl != null && !heroSkipped) {
                            heroSkipped = true
                            block.urls.drop(1)
                        } else {
                            block.urls
                        }
                        if (gridUrls.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            gridUrls.chunked(3).forEach { rowUrls ->
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    rowUrls.forEach { url ->
                                        val index = gallery.indexOf(url).takeIf { it >= 0 } ?: 0
                                        Box(
                                            modifier = Modifier
                                                .weight(1f)
                                                .aspectRatio(1f)
                                                .clip(RoundedCornerShape(12.dp))
                                                .clickable { viewerIndex = index },
                                        ) {
                                            io.github.nimbleflux.wayli.designsystem.WayliAsyncImage(
                                                model = url,
                                                contentDescription = "Photo",
                                                modifier = Modifier.fillMaxSize(),
                                            )
                                        }
                                    }
                                    // Pad a short last row so its tiles keep the grid width.
                                    repeat(3 - rowUrls.size) { Spacer(Modifier.weight(1f)) }
                                }
                                Spacer(Modifier.height(8.dp))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(io.github.nimbleflux.wayli.designsystem.rememberDockClearance()))
        }
    }

    if (viewerIndex != null && gallery.isNotEmpty()) {
        PhotoViewer(
            urls = gallery,
            initialIndex = viewerIndex ?: 0,
            onDismiss = { viewerIndex = null },
        )
    }
}

/**
 * Fullscreen photo viewer: swipe between photos, pinch to zoom (1–5×),
 * tap or the ✕ button to close.
 */
@Composable
private fun PhotoViewer(
    urls: List<String>,
    initialIndex: Int,
    onDismiss: () -> Unit,
) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val pagerState = androidx.compose.foundation.pager.rememberPagerState(
            initialPage = initialIndex,
        ) { urls.size }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                // Tap-only dismiss: a clickable() backdrop consumed aborted
                // swipes as taps and closed the viewer mid-gesture.
                .pointerInput(Unit) {
                    detectTapGestures { onDismiss() }
                },
        ) {
            androidx.compose.foundation.pager.HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                var scale by remember { mutableFloatStateOf(1f) }
                var offset by remember { mutableStateOf(Offset.Zero) }
                val transformState = androidx.compose.foundation.gestures.rememberTransformableState(
                    onTransformation = { zoom, pan, _ ->
                        scale = (scale * zoom).coerceIn(1f, 5f)
                        offset = if (scale > 1f) offset + pan else Offset.Zero
                    },
                )
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        // Zoom/pan handling only engages once zoomed — at rest
                        // zoom the HorizontalPager must own horizontal drags
                        // (transformable otherwise eats every swipe).
                        .then(if (scale > 1f) Modifier.transformable(transformState) else Modifier),
                ) {
                    coil.compose.AsyncImage(
                        model = urls[page],
                        contentDescription = "Photo ${page + 1}",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer {
                                scaleX = scale
                                scaleY = scale
                                translationX = offset.x
                                translationY = offset.y
                            }
                            .pointerInput(Unit) {
                                detectTapGestures(
                                    onDoubleTap = {
                                        if (scale > 1f) {
                                            scale = 1f
                                            offset = Offset.Zero
                                        } else {
                                            scale = 2.5f
                                        }
                                    },
                                )
                            },
                    )
                }
            }
            Text(
                "${pagerState.settledPage + 1} / ${urls.size}",
                color = Color.White.copy(alpha = 0.8f),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 32.dp),
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 8.dp),
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Close viewer",
                    tint = Color.White,
                )
            }
        }
    }
}

@HiltViewModel
class EntryDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val demoManager: DemoManager,
    private val tripRepo: TripRepository,
    private val mediaUploader: MediaUploader,
) : ViewModel() {

    val tripId: String = savedStateHandle.get<String>("tripId") ?: ""
    val entryId: String = savedStateHandle.get<String>("entryId") ?: ""

    private val _entry = MutableStateFlow<TripEntry?>(null)
    val entry: StateFlow<TripEntry?> = _entry.asStateFlow()

    /** Ordered render model: text (markdown) and photo groups. */
    private val _renderBlocks = MutableStateFlow<List<RenderBlock>>(emptyList())
    val renderBlocks: StateFlow<List<RenderBlock>> = _renderBlocks.asStateFlow()

    /** Flat photo list across blocks — the fullscreen viewer sequence. */
    private val _gallery = MutableStateFlow<List<String>>(emptyList())
    val gallery: StateFlow<List<String>> = _gallery.asStateFlow()

    /** Delete the entry (owner-only via RLS); demo/local entries just vanish. */
    fun deleteEntry(entry: TripEntry, onDone: (Boolean) -> Unit = {}) {
        if (demoManager.isDemoMode || entry.id.startsWith("local-")) {
            _entry.value = null
            onDone(true)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val result = tripRepo.deleteEntry(entry.id)
            _entry.value = null
            kotlinx.coroutines.withContext(Dispatchers.Main) { onDone(result.isSuccess) }
        }
    }

    /** Hero URL — computed once the gallery resolves (cover rule applied). */
    var heroUrl: String? = null
        private set

    init {
        viewModelScope.launch(Dispatchers.IO) { load() }
    }

    private suspend fun load() {
        if (demoManager.isDemoMode) {
            val demo = io.github.nimbleflux.wayli.demo.DemoData.entries[tripId]
                ?.firstOrNull { it.id == entryId }
            _entry.value = demo
            val images = io.github.nimbleflux.wayli.demo.DemoData.entryImages[entryId].orEmpty()
            heroUrl = images.firstOrNull()
            val blocks = buildList {
                demo?.body?.trim()?.takeIf { it.isNotBlank() }
                    ?.let { add(RenderBlock.Text(it)) }
                if (images.isNotEmpty()) add(RenderBlock.Photos(images))
            }
            _renderBlocks.value = blocks
            _gallery.value = images
            return
        }

        // Entry and its media in parallel; the entry itself is fetched by id
        // (server-side filter) instead of downloading the whole journal.
        val (entry, media) = coroutineScope {
            val entryDeferred = async { tripRepo.getEntry(entryId).getOrNull() }
            val mediaDeferred = async { tripRepo.listMedia(tripId, entryId).getOrNull().orEmpty() }
            entryDeferred.await() to mediaDeferred.await()
        }
        _entry.value = entry ?: return

        val urls = coroutineScope {
            media.map { m ->
                async {
                    mediaUploader.resolveDisplayUrl(storagePath = m.storagePath)?.let { m.id to it }
                }
            }.map { it.await() }
        }.filterNotNull().toMap()

        // The effective block list: stored blocks when fresh, derived from the
        // legacy body + media rows otherwise (read-compat rule).
        val effective = io.github.nimbleflux.wayli.entry.EntryBlocks.effective(entry, media)
        val renderBlocks = effective.mapNotNull { block ->
            when (block) {
                is io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Text ->
                    block.md.takeIf { it.isNotBlank() }?.let { RenderBlock.Text(it) }
                is io.github.nimbleflux.wayli.entry.EntryBlocks.Block.Photos -> {
                    val blockUrls = block.ids.mapNotNull { urls[it] }
                    if (blockUrls.isEmpty()) null else RenderBlock.Photos(blockUrls)
                }
            }
        }
        val flat = renderBlocks.filterIsInstance<RenderBlock.Photos>().flatMap { it.urls }

        // Cover rule: cover_media_id → first photo in block order.
        val coverId = entry.coverMediaId
        heroUrl = if (coverId != null) urls[coverId] ?: flat.firstOrNull() else flat.firstOrNull()
        _renderBlocks.value = renderBlocks
        _gallery.value = flat
    }
}

/** Render model for the entry detail screen. */
sealed interface RenderBlock {
    data class Text(val md: String) : RenderBlock
    data class Photos(val urls: List<String>) : RenderBlock
}
