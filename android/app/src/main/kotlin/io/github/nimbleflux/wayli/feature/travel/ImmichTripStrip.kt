package io.github.nimbleflux.wayli.feature.travel

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.github.nimbleflux.wayli.feature.immich.ImmichViewModel
import io.github.nimbleflux.wayli.feature.map.ImmichPhotoSheet
import io.github.nimbleflux.wayli.models.Trip

/**
 * "Photos from this trip" strip for the private trip detail page (#13):
 * thumbnails of the user's synced Immich photos within the trip's date
 * range. Display-only; tap opens the photo sheet. Hidden entirely when the
 * integration is disabled or the range has no photos.
 */
@Composable
fun ImmichTripStrip(
    trip: Trip,
    modifier: Modifier = Modifier,
    viewModel: ImmichViewModel = hiltViewModel(),
) {
    var enabled by remember { mutableStateOf(false) }
    var photos by remember { mutableStateOf<List<io.github.nimbleflux.wayli.models.ImmichAsset>>(emptyList()) }
    var tapped by remember { mutableStateOf<io.github.nimbleflux.wayli.models.ImmichAsset?>(null) }
    var serverUrl by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(trip.id, trip.startDate, trip.endDate) {
        val uid = viewModel.userId ?: return@LaunchedEffect
        val settings = viewModel.settings(uid) ?: return@LaunchedEffect
        if (!settings.enabled) return@LaunchedEffect
        enabled = true
        serverUrl = settings.serverUrl
        val start = trip.startDate
        val end = trip.endDate ?: trip.startDate
        // Inclusive end: query [start, end+1d).
        val endDate = runCatching {
            java.time.LocalDate.parse(end).plusDays(1).toString()
        }.getOrDefault(end)
        photos = viewModel.photosForRange(start, endDate)
    }

    if (!enabled || photos.isEmpty()) return

    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "Photos from Immich",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "${photos.size}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(top = 6.dp),
        ) {
            items(photos.size) { index ->
                val photo = photos[index]
                var thumb by remember(photo.assetId) { mutableStateOf<android.graphics.Bitmap?>(null) }
                LaunchedEffect(photo.assetId) {
                    viewModel.thumbnailBytes(photo.assetId)?.let {
                        thumb = android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size)
                    }
                }
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .background(
                            MaterialTheme.colorScheme.surfaceVariant,
                            RoundedCornerShape(10.dp),
                        )
                        .clickable { tapped = photo },
                ) {
                    thumb?.let { bitmap ->
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = photo.city ?: "Immich photo",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxWidth(),
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

