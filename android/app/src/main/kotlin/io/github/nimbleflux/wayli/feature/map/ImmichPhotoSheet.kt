package io.github.nimbleflux.wayli.feature.map

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import io.github.nimbleflux.wayli.models.ImmichAsset
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Detail sheet for a tapped Immich photo (#13): preview streamed through the
 * immich-thumb proxy (auth handled by the repository), capture date, place,
 * and a deep link into the user's Immich web app.
 */
@Composable
fun ImmichPhotoSheet(
    asset: ImmichAsset,
    serverUrl: String?,
    thumbnailProvider: suspend (assetId: String, size: String) -> ByteArray?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val preview = remember(asset.assetId) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(asset.assetId) {
        thumbnailProvider(asset.assetId, "preview")
            ?.let { bytes -> preview.value = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
    }

    val place = listOf(asset.city, asset.state, asset.country)
        .filterNotNull()
        .filter { it.isNotBlank() }
        .joinToString(", ")
    val captured = runCatching {
        java.time.OffsetDateTime.parse(asset.takenAt)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("EEE, d MMM yyyy HH:mm"))
    }.getOrElse { asset.takenAt }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp))
                .padding(16.dp),
        ) {
            val bitmap = preview.value
            if (bitmap != null) {
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = place.ifBlank { "Immich photo" },
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(240.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                    horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                ) {
                    Text(
                        "…",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 48.dp),
                    )
                }
            }

            Text(
                captured,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 12.dp),
            )
            if (place.isNotBlank()) {
                Text(
                    place,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val url = serverUrl?.trimEnd('/')?.let { "$it/photos/${asset.assetId}" }
            if (!url.isNullOrBlank()) {
                Text(
                    "Open in Immich",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .clickable {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            context.startActivity(intent)
                        },
                )
            }
        }
    }
}
