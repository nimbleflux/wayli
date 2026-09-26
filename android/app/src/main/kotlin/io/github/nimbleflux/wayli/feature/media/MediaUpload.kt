package io.github.nimbleflux.wayli.feature.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import io.github.nimbleflux.fluxbase.FluxbaseClient
import java.io.ByteArrayOutputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Handles photo upload to the Fluxbase storage bucket. Compresses images
 * client-side before uploading (matching the web app's behavior).
 */
@Singleton
class MediaUploader @Inject constructor(
    private val client: FluxbaseClient,
) {

    private class CachedUrl(val url: String, val expiresAt: Long)

    /**
     * Session-scoped signed-URL cache — signing is one HTTP round trip per
     * image, so re-signing on every screen load dominates trip load times.
     * Entries are kept until 10 min before their expiry.
     */
    private val signedUrlCache = java.util.concurrent.ConcurrentHashMap<String, CachedUrl>()

    /**
     * Upload a photo from a content [Uri]. Compresses to JPEG (quality 85,
     * max edge 1920px) before uploading to the `trip-images` bucket.
     *
     * @return the PUBLIC absolute URL of the uploaded file — the same format
     * the web client stores in `trip_media.storage_path` (web renders
     * `<img src={storage_path}>` directly, so a bare bucket path would break
     * there).
     */
    suspend fun uploadPhoto(
        context: Context,
        uri: Uri,
        bucket: String = "trip-images",
        pathPrefix: String = "entries",
    ): Result<String> = runCatching {
        // Bitmap decode + JPEG compression are heavy CPU work — keep them off
        // the main thread no matter which dispatcher the caller used.
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val bitmap = decodeAndCompress(context, uri, maxEdge = 1920)
            val bytes = bitmapToJpeg(bitmap, quality = 85)
            val path = "$pathPrefix/${UUID.randomUUID()}.jpg"

            client.storage.from(bucket).upload(
                path = path,
                data = bytes,
                contentType = "image/jpeg",
                upsert = false,
            )
            client.storage.from(bucket).getPublicUrl(path)
        }
    }

    /**
     * Resolve a `trip_media.storage_path` value into a displayable URL.
     * Web clients store the ABSOLUTE public URL there; older Android builds
     * stored the bare bucket path. Absolute URLs load directly (object GETs
     * are public on self-hosted instances) — signing them would ask the
     * server to sign the whole URL as if it were an object key and 404.
     * Bare paths still go through [getSignedUrl].
     */
    suspend fun resolveDisplayUrl(
        bucket: String = "trip-images",
        storagePath: String?,
    ): String? {
        if (storagePath.isNullOrBlank()) return null
        return when {
            // Legacy web rows: absolute URL, load directly.
            storagePath.startsWith("http://") || storagePath.startsWith("https://") ->
                storagePath
            // Host-relative API path (web 2.7.0+): re-derive the public URL
            // from the embedded bucket and object — signing would treat the
            // whole path as an object key and 404.
            storagePath.startsWith("/api/v1/storage/") ->
                runCatching {
                    val withoutPrefix = storagePath.removePrefix("/api/v1/storage/")
                    val refBucket = withoutPrefix.substringBefore('/')
                    val obj = withoutPrefix.substringAfter('/')
                    client.storage.from(refBucket).getPublicUrl(obj)
                }.getOrNull()
            // Android-stored rows: bare bucket path, sign it.
            else -> getSignedUrl(bucket = bucket, path = storagePath).getOrNull()
        }
    }

    /**
     * Create a signed URL for displaying a stored image. Cached for (nearly)
     * the whole validity window, so repeat views cost zero round trips.
     */
    suspend fun getSignedUrl(
        bucket: String = "trip-images",
        path: String,
        expiresIn: Int = 3600,
    ): Result<String> {
        val key = "$bucket/$path"
        val now = System.currentTimeMillis()
        signedUrlCache[key]?.let { cached ->
            if (cached.expiresAt > now) return Result.success(cached.url)
        }
        return runCatching {
            val result = client.storage.from(bucket).createSignedUrl(path, expiresIn)
            val url = result.data?.signedUrl ?: throw Exception("Failed to get signed URL")
            // Keep a 10-minute safety margin before the server-side expiry.
            signedUrlCache[key] = CachedUrl(url, now + expiresIn * 1000L - 600_000L)
            url
        }
    }

    /**
     * Upload an avatar for [userId] (256px JPEG, matching the web app) and
     * return a long-lived signed URL suitable for storing on `avatar_url`.
     */
    suspend fun uploadAvatar(context: Context, uri: Uri, userId: String): Result<String> = runCatching {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val bitmap = decodeAndCompress(context, uri, maxEdge = 256)
            val bytes = bitmapToJpeg(bitmap, quality = 85)
            val path = "$userId/avatar-${UUID.randomUUID()}.jpg"
            client.storage.from("trip-images").upload(
                path = path,
                data = bytes,
                contentType = "image/jpeg",
                upsert = false,
            )
            val signed = client.storage.from("trip-images").createSignedUrl(path, 31_536_000)
            signed.data?.signedUrl ?: throw Exception("Failed to get signed URL")
        }
    }

    private fun decodeAndCompress(context: Context, uri: Uri, maxEdge: Int): Bitmap {
        val inputStream = context.contentResolver.openInputStream(uri)
            ?: throw Exception("Cannot open image")

        // First decode bounds to check dimensions
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeStream(inputStream, null, options)
        inputStream.close()

        // Calculate sample size for memory efficiency
        var sampleSize = 1
        val maxDimension = maxOf(options.outWidth, options.outHeight)
        while (maxDimension / sampleSize > maxEdge * 2) {
            sampleSize *= 2
        }

        // Decode at sample size
        val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val stream2 = context.contentResolver.openInputStream(uri)!!
        val bitmap = BitmapFactory.decodeStream(stream2, null, decodeOptions)
        stream2.close()

        // Scale to max edge if still too large
        return if (bitmap != null && (bitmap.width > maxEdge || bitmap.height > maxEdge)) {
            val scale = maxEdge.toFloat() / maxOf(bitmap.width, bitmap.height)
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * scale).toInt(),
                (bitmap.height * scale).toInt(),
                true,
            )
        } else {
            bitmap ?: throw Exception("Failed to decode image")
        }
    }

    private fun bitmapToJpeg(bitmap: Bitmap, quality: Int): ByteArray {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        return stream.toByteArray()
    }
}
