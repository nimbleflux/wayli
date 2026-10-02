package io.github.nimbleflux.wayli.feature.travel

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.github.nimbleflux.wayli.feature.immich.ImmichViewModel
import io.github.nimbleflux.wayli.feature.map.ImmichPhotoSheet
import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.repo.ImmichPhotoPage
import io.github.nimbleflux.wayli.repo.ImmichRepository.Companion.PHOTO_PAGE_SIZE
import io.github.nimbleflux.wayli.repo.entryPhotoRange
import io.github.nimbleflux.wayli.repo.hasMorePhotos

/** Thumbnail load state per strip item: spinner while the proxy round trip is
 * in flight, the image on success, a silent placeholder on failure. */
private sealed interface ThumbLoad {
    data object Loading : ThumbLoad
    data object Failed : ThumbLoad
    data class Ok(val bitmap: ImageBitmap) : ThumbLoad
}

/** Strip load state: the loaded pages, the server-side total, paging flags. */
private class StripState {
    var enabled by mutableStateOf(false)
    var photos by mutableStateOf<List<ImmichAsset>>(emptyList())
    var total by mutableStateOf<Long?>(null)
    var loadingMore by mutableStateOf(false)
    var canLoadMore by mutableStateOf(false)
}

/** True when the row's tail is within a few items of the viewport — the
 * infinite-scroll trigger. */
private fun stripNearEnd(listState: LazyListState): Boolean {
    val info = listState.layoutInfo
    val last = info.visibleItemsInfo.lastOrNull()?.index ?: -1
    return last >= 0 && last >= info.totalItemsCount - 4
}

/**
 * Append the next page for [entry]'s range, deduped by asset id (the sync can
 * shift rows between pages). Null when a page isn't needed or the query failed.
 */
private suspend fun loadNextPage(
    entry: TripEntry,
    state: StripState,
    viewModel: ImmichViewModel,
): ImmichPhotoPage? {
    if (!state.canLoadMore || state.loadingMore) return null
    val (startIso, endIso) = entryPhotoRange(entry) ?: return null
    state.loadingMore = true
    try {
        val page = viewModel.photoPage(startIso, endIso, offset = state.photos.size)
            ?: return null
        val known = state.photos.map { it.assetId }.toSet()
        state.photos = state.photos + page.assets.filter { it.assetId !in known }
        if (page.total != null) state.total = page.total
        state.canLoadMore = page.assets.isNotEmpty() &&
            hasMorePhotos(ImmichPhotoPage(state.photos, page.total), PHOTO_PAGE_SIZE)
        return page
    } finally {
        state.loadingMore = false
    }
}

/**
 * "Photos from this entry" strip under a journal entry card (#13): paged
 * thumbnails of the user's synced Immich photos within the entry's date
 * range (entry_date → end_date), loaded with infinite scroll so a 500-photo
 * range never fetches or decodes more than the visible window. Display-only;
 * tap opens the photo sheet. Hidden when the integration is disabled or the
 * range has no photos.
 */
@Composable
fun ImmichEntryStrip(
    entry: TripEntry,
    modifier: Modifier = Modifier,
    viewModel: ImmichViewModel = hiltViewModel(),
) {
    val state = remember { StripState() }
    var tapped by remember { mutableStateOf<ImmichAsset?>(null) }
    var serverUrl by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(entry.id, entry.entryDate, entry.endDate) {
        val uid = viewModel.userId ?: return@LaunchedEffect
        val settings = viewModel.settings(uid) ?: return@LaunchedEffect
        if (!settings.enabled) return@LaunchedEffect
        val (startIso, endIso) = entryPhotoRange(entry) ?: return@LaunchedEffect
        val page = viewModel.photoPage(startIso, endIso) ?: return@LaunchedEffect
        state.enabled = true
        serverUrl = settings.serverUrl
        state.photos = page.assets
        state.total = page.total
        state.canLoadMore = hasMorePhotos(page, PHOTO_PAGE_SIZE)
    }

    val listState = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { stripNearEnd(listState) } }
    LaunchedEffect(nearEnd) {
        if (nearEnd) loadNextPage(entry, state, viewModel)
    }

    if (!state.enabled || state.photos.isEmpty()) return

    Column(modifier = modifier.fillMaxWidth().padding(top = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "Photos from this entry",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "${state.total ?: state.photos.size}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyRow(
            state = listState,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(top = 6.dp),
        ) {
            items(
                count = state.photos.size,
                key = { index -> state.photos[index].assetId },
            ) { index ->
                StripThumb(
                    photo = state.photos[index],
                    viewModel = viewModel,
                    onTap = { tapped = state.photos[index] },
                )
            }
            if (state.loadingMore) {
                item(key = "loading-more") {
                    Box(
                        modifier = Modifier.size(72.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                    }
                }
            }
        }
    }

    tapped?.let { asset ->
        ImmichPhotoSheet(
            asset = asset,
            serverUrl = serverUrl,
            thumbnailProvider = { assetId, size -> viewModel.thumbnailBytes(assetId, size) },
            onDismiss = { tapped = null },
        )
    }
}

/** One 72dp strip thumbnail with its load state. */
@Composable
private fun StripThumb(
    photo: ImmichAsset,
    viewModel: ImmichViewModel,
    onTap: () -> Unit,
) {
    var thumb by remember(photo.assetId) { mutableStateOf<ThumbLoad>(ThumbLoad.Loading) }
    LaunchedEffect(photo.assetId) {
        thumb = viewModel.thumbnailBytes(photo.assetId)
            ?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            ?.let { ThumbLoad.Ok(it.asImageBitmap()) }
            ?: ThumbLoad.Failed
    }
    Box(
        modifier = Modifier
            .size(72.dp)
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onTap),
        contentAlignment = Alignment.Center,
    ) {
        when (val load = thumb) {
            is ThumbLoad.Ok -> Image(
                bitmap = load.bitmap,
                contentDescription = photo.city ?: "Immich photo",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth(),
            )
            is ThumbLoad.Loading -> CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
            )
            is ThumbLoad.Failed -> Icon(
                Icons.Filled.Image,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
