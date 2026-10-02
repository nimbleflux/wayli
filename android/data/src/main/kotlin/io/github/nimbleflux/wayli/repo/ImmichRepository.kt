package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.models.UserPreferences
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Connection settings stored at `preferences.immich` jsonb. */
data class ImmichSettings(
    val enabled: Boolean = false,
    val serverUrl: String? = null,
    val lastSyncAt: String? = null,
)

/** One page of a paged photo-range query, plus the total matching row count. */
data class ImmichPhotoPage(
    val assets: List<ImmichAsset>,
    /** Total photos matching the range (server-side exact count), when known. */
    val total: Long? = null,
)

/**
 * Repository for the Immich photo integration (#13). Photo metadata is
 * DISPLAY-ONLY: coordinates from `immich_assets` never become tracking
 * points and never affect trip detection.
 *
 * Pure helpers ([immichEnabledOf], [unattachedCount], [immichPhotoUrl],
 * [decodeThumbPayload], [entryPhotoRange], [hasMorePhotos]) are top-level
 * functions so they test without a client.
 */
@Singleton
class ImmichRepository @Inject constructor(
    private val client: FluxbaseClient,
) {
    companion object {
        const val IMMICH_API_KEY = "immich_api_key"

        /** The Fluxbase namespace the immich edge functions are synced to. */
        const val IMMICH_NAMESPACE = "wayli"

        /** Page size for paged photo-range queries (entry strips). */
        const val PHOTO_PAGE_SIZE = 40

        private const val SETTINGS_CACHE_TTL_MS = 60_000L
        private const val THUMB_CACHE_MAX_BYTES = 32 * 1024 * 1024
    }

    /** Geotagged photos within [startISO, endISO), oldest first. */
    suspend fun photosForRange(startISO: String, endISO: String): Result<List<ImmichAsset>> =
        runCatching {
            val result = client.from<ImmichAsset>("immich_assets")
                .select()
                .gte("taken_at", startISO)
                .lt("taken_at", endISO)
                .order("taken_at")
                .execute()
            result.dataOrThrow() ?: emptyList()
        }

    /**
     * One page of geotagged photos within [startISO, endISO), oldest first,
     * plus the server-side exact total — entry strips page through long
     * ranges with infinite scroll instead of pulling 500+ rows at once.
     */
    suspend fun photosForRangePage(
        startISO: String,
        endISO: String,
        limit: Int = PHOTO_PAGE_SIZE,
        offset: Int = 0,
    ): Result<ImmichPhotoPage> = runCatching {
        val result = client.from<ImmichAsset>("immich_assets")
            .select()
            .gte("taken_at", startISO)
            .lt("taken_at", endISO)
            .order("taken_at")
            .range(offset, offset + limit - 1)
            .count()
            .execute()
        ImmichPhotoPage(result.dataOrThrow().orEmpty(), result.count)
    }

    /** Last-fetched settings for [SettingsCacheEntry.userId], honoring the TTL. */
    private class SettingsCacheEntry(
        val userId: String,
        val settings: ImmichSettings?,
        val fetchedAtMs: Long,
    )

    @Volatile
    private var settingsCache: SettingsCacheEntry? = null

    /**
     * Connection settings from the user's preferences jsonb. Cached briefly —
     * every per-entry strip on a trip page asks for the same settings, and
     * each uncached read is a round trip.
     */
    suspend fun settings(userId: String): ImmichSettings? {
        settingsCache?.let { cached ->
            if (cached.userId == userId &&
                System.currentTimeMillis() - cached.fetchedAtMs < SETTINGS_CACHE_TTL_MS
            ) {
                return cached.settings
            }
        }
        val result = client.from<UserPreferences>("user_preferences")
            .select()
            .eq("id", userId)
            .single()
        val prefs = result.data ?: return null
        val settings = immichSettingsOf(prefs)
        settingsCache = SettingsCacheEntry(userId, settings, System.currentTimeMillis())
        return settings
    }

    /** Immich asset ids already attached to a trip's media rows. */
    suspend fun attachedAssetIds(tripId: String): Set<String> = runCatching {
        val result = client.from<AttachedImmichRef>("trip_media")
            .select("immich_asset_id")
            .eq("trip_id", tripId)
            .execute()
        (result.dataOrThrow() ?: emptyList())
            .mapNotNull { it.immichAssetId }
            .toSet()
    }.getOrDefault(emptySet())

    /** Session-scoped thumbnail byte cache — strips re-request thumbs as their
     * items scroll in and out, and each miss is an authenticated round trip. */
    private val thumbCache = ByteArrayLruCache(THUMB_CACHE_MAX_BYTES)

    /**
     * Thumbnail/preview bytes via the `immich-thumb` edge function. Must go
     * through [FluxbaseClient.functions.invoke] (POST
     * `/api/v1/functions/immich-thumb/invoke`) — a bare `/functions/<name>`
     * path matches no server route and 404s. The proxy returns base64 JSON
     * (`{ok, contentType, base64}`), never raw bytes: the runtime bridge
     * serializes function responses as text, which mangles binary payloads.
     * Null when the proxy fails (Immich down, asset gone, not authorized).
     */
    suspend fun thumbnailBytes(assetId: String, size: String = "thumbnail"): ByteArray? {
        val cacheKey = "$assetId:$size"
        thumbCache.get(cacheKey)?.let { return it }
        val payload = client.functions.invoke<JsonObject>(
            "immich-thumb",
            body = mapOf("assetId" to assetId, "size" to size),
            namespace = IMMICH_NAMESPACE,
        ).data ?: return null
        val bytes = decodeThumbPayload(payload) ?: return null
        thumbCache.put(cacheKey, bytes)
        return bytes
    }

    /** True when the user has an Immich API key stored server-side. */
    suspend fun hasApiKey(): Boolean = runCatching {
        val response = client.settings.listUserSecrets()
        response.error?.let { throw it }
        response.data?.any { it.key == IMMICH_API_KEY } ?: false
    }.getOrDefault(false)
}

// ---- Pure helpers (kotlin.test coverage in ImmichHelpersTest) ----

/** The integration is on when `preferences.immich.enabled` is literally true. */
fun immichEnabledOf(prefs: UserPreferences): Boolean =
    (prefs.preferences?.jsonObject?.get("immich") as? JsonObject)
        ?.get("enabled")?.jsonPrimitive?.booleanOrNull == true

fun immichSettingsOf(prefs: UserPreferences): ImmichSettings? {
    val immich = (prefs.preferences?.jsonObject?.get("immich") as? JsonObject) ?: return null
    return ImmichSettings(
        enabled = immich["enabled"]?.jsonPrimitive?.booleanOrNull == true,
        serverUrl = immich["server_url"]?.jsonPrimitive?.contentOrNull,
        lastSyncAt = immich["last_sync_at"]?.jsonPrimitive?.contentOrNull,
    )
}

/** Photos from the synced library that are not yet attached to trip media. */
fun unattachedCount(photos: List<ImmichAsset>, attachedAssetIds: Set<String>): Int =
    photos.count { it.assetId !in attachedAssetIds }

/** Deep link to a photo inside the user's Immich web app; null without a base. */
fun immichPhotoUrl(serverBaseUrl: String?, assetId: String): String? {
    val base = serverBaseUrl?.trim()?.trimEnd('/') ?: return null
    if (base.isEmpty()) return null
    return "$base/photos/$assetId"
}

/**
 * Decode the immich-thumb proxy's response envelope into image bytes. The
 * envelope is `{ok, contentType, base64}`; null unless `ok` is literally
 * true and the base64 decodes.
 */
fun decodeThumbPayload(payload: JsonObject?): ByteArray? {
    if (payload == null) return null
    if (payload["ok"]?.jsonPrimitive?.booleanOrNull != true) return null
    val base64 = payload["base64"]?.jsonPrimitive?.contentOrNull ?: return null
    return runCatching { Base64.getDecoder().decode(base64) }.getOrNull()
}

/**
 * The half-open UTC window [start, end) of photos belonging to a journal
 * entry: [entryDate 00:00, (endDate ?? entryDate) + 1d 00:00). Multi-day
 * entries include every day they span. Null when entryDate is unparseable.
 */
fun entryPhotoRange(entry: TripEntry): Pair<String, String>? {
    val start = runCatching { LocalDate.parse(entry.entryDate) }.getOrNull() ?: return null
    val endDate = entry.endDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    val lastDay = maxOf(start, endDate ?: start)
    return Pair(
        start.atStartOfDay(ZoneOffset.UTC).toInstant().toString(),
        lastDay.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toString(),
    )
}

/** True when another page likely exists after [page] was fetched with [limit]. */
fun hasMorePhotos(page: ImmichPhotoPage, limit: Int): Boolean =
    page.total?.let { page.assets.size < it } ?: (page.assets.size >= limit)

/** Minimal projection of a `trip_media` row for attached-asset queries. */
@kotlinx.serialization.Serializable
data class AttachedImmichRef(
    @kotlinx.serialization.SerialName("immich_asset_id") val immichAssetId: String? = null,
)

/** Thread-safe, size-bounded LRU cache of byte arrays. Pure JVM (no Android
 * deps) so it unit-tests on the JVM. */
class ByteArrayLruCache(private val maxBytes: Int) {
    private val map = object : LinkedHashMap<String, ByteArray>(16, 0.75f, true) {}
    private var totalBytes = 0L

    @Synchronized
    fun get(key: String): ByteArray? = map[key]

    @Synchronized
    fun put(key: String, bytes: ByteArray) {
        if (bytes.size > maxBytes) return
        map[key]?.let { totalBytes -= it.size }
        map[key] = bytes
        totalBytes += bytes.size
        val eldestFirst = map.entries.iterator()
        while (totalBytes > maxBytes && eldestFirst.hasNext()) {
            val eldest = eldestFirst.next()
            totalBytes -= eldest.value.size
            eldestFirst.remove()
        }
    }

    @Synchronized
    fun clear() {
        map.clear()
        totalBytes = 0
    }
}
