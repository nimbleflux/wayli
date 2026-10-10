package io.github.nimbleflux.wayli.feature.travel

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.github.nimbleflux.wayli.feature.immich.ImmichViewModel
import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.repo.ImmichPhotoPage
import io.github.nimbleflux.wayli.repo.ImmichRepository.Companion.PHOTO_PAGE_SIZE
import io.github.nimbleflux.wayli.repo.hasMorePhotos
import io.github.nimbleflux.wayli.repo.pickerPhotoRange

/** Browse window sizes offered as chips — mirrors the web picker's ±1/3/7/14. */
private val RANGE_CHIPS = listOf(1, 3, 7, 14)

/**
 * "Add from Immich" bottom sheet for the journal-entry editor (#246): a paged
 * photo grid around the entry date, multi-select, then attach. Mirrors the
 * web `ImmichPhotoPicker`: range chips (±days around the entry date), photos
 * already attached to this trip are dimmed and can't be re-attached.
 * Display-only browsing — attaching copies renditions into `trip_media` via
 * [EntryEditorViewModel.addImmichPhotos].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImmichPickerSheet(
    tripId: String,
    entryDate: String,
    onAdd: (List<ImmichAsset>) -> Unit,
    onDismiss: () -> Unit,
    viewModel: ImmichViewModel = hiltViewModel(),
) {
    var rangeDays by remember { mutableStateOf(3) }
    var photos by remember { mutableStateOf<List<ImmichAsset>>(emptyList()) }
    var total by remember { mutableStateOf<Long?>(null) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var canLoadMore by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }

    val attached by produceState<Set<String>>(initialValue = emptySet(), tripId) {
        value = viewModel.attachedAssetIds(tripId)
    }

    suspend fun loadFirstPage() {
        val range = pickerPhotoRange(entryDate, rangeDays) ?: return
        loading = true
        try {
            val page = viewModel.photoPage(range.first, range.second)
            photos = page?.assets.orEmpty()
            total = page?.total
            canLoadMore = page != null && hasMorePhotos(page, PHOTO_PAGE_SIZE)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(entryDate, rangeDays) {
        selected = emptySet()
        loadFirstPage()
    }

    suspend fun loadMore() {
        if (!canLoadMore || loadingMore || loading) return
        val range = pickerPhotoRange(entryDate, rangeDays) ?: return
        loadingMore = true
        try {
            val page = viewModel.photoPage(range.first, range.second, offset = photos.size)
                ?: return
            val known = photos.map { it.assetId }.toSet()
            photos = photos + page.assets.filter { it.assetId !in known }
            if (page.total != null) total = page.total
            canLoadMore = page.assets.isNotEmpty() &&
                hasMorePhotos(ImmichPhotoPage(photos, page.total), PHOTO_PAGE_SIZE)
        } finally {
            loadingMore = false
        }
    }

    val gridState = rememberLazyGridState()
    val nearEnd by remember {
        derivedStateOf {
            val info = gridState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            last >= 0 && last >= info.totalItemsCount - 6
        }
    }
    LaunchedEffect(nearEnd) {
        if (nearEnd) loadMore()
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.padding(bottom = 16.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Photos around $entryDate",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    buildString {
                        append("${total ?: photos.size} photos")
                        if (selected.isNotEmpty()) append(" · ${selected.size} selected")
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RANGE_CHIPS.forEach { days ->
                    FilterChip(
                        selected = rangeDays == days,
                        onClick = { rangeDays = days },
                        label = { Text("±${days}d") },
                    )
                }
            }

            when {
                loading -> Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(320.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                photos.isEmpty() -> Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(320.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "No geotagged Immich photos in this range",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    state = gridState,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(360.dp),
                ) {
                    items(
                        count = photos.size,
                        key = { index -> photos[index].assetId },
                    ) { index ->
                        val asset = photos[index]
                        PickerThumb(
                            photo = asset,
                            attached = asset.assetId in attached,
                            selected = asset.assetId in selected,
                            viewModel = viewModel,
                            onToggle = {
                                selected = if (asset.assetId in selected) {
                                    selected - asset.assetId
                                } else {
                                    selected + asset.assetId
                                }
                            },
                        )
                    }
                    if (loadingMore) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(3) }) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                )
                            }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                TextButton(
                    onClick = {
                        onAdd(photos.filter { it.assetId in selected })
                    },
                    enabled = selected.isNotEmpty(),
                ) {
                    Text(if (selected.isEmpty()) "Add" else "Add ${selected.size}")
                }
            }
        }
    }
}

/** One grid thumbnail: tap toggles selection, already-attached rows are dimmed. */
@Composable
private fun PickerThumb(
    photo: ImmichAsset,
    attached: Boolean,
    selected: Boolean,
    viewModel: ImmichViewModel,
    onToggle: () -> Unit,
) {
    var thumb by remember(photo.assetId) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(photo.assetId) {
        thumb = viewModel.thumbnailBytes(photo.assetId)
            ?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            ?.asImageBitmap()
    }
    val borderShape = RoundedCornerShape(8.dp)
    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                borderShape,
            )
            .then(
                if (selected) {
                    Modifier.border(3.dp, MaterialTheme.colorScheme.primary, borderShape)
                } else {
                    Modifier
                },
            )
            .clickable(enabled = !attached, onClick = onToggle)
            .semantics {
                contentDescription = when {
                    attached -> "Already attached"
                    selected -> "Selected"
                    else -> "Immich photo"
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        val bitmap = thumb
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth(),
                alpha = if (attached) 0.3f else 1f,
            )
        } else if (attached) {
            Icon(
                Icons.Filled.Image,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                modifier = Modifier.fillMaxWidth().padding(24.dp),
            )
        } else {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
            )
        }
        if (selected) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp),
            )
        }
    }
}
