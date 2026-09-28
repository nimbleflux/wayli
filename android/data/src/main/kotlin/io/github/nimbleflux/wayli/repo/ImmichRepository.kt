package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.models.UserPreferences
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

/**
 * Repository for the Immich photo integration (#13). Photo metadata is
 * DISPLAY-ONLY: coordinates from `immich_assets` never become tracking
 * points and never affect trip detection.
 *
 * Pure helpers ([immichEnabledOf], [unattachedCount], [immichPhotoUrl]) are
 * top-level functions so they test without a client.
 */
@Singleton
class ImmichRepository @Inject constructor(
    private val client: FluxbaseClient,
) {
    companion object {
        const val IMMICH_API_KEY = "immich_api_key"
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

    /** Connection settings from the user's preferences jsonb. */
    suspend fun settings(userId: String): ImmichSettings? {
        val result = client.from<UserPreferences>("user_preferences")
            .select()
            .eq("id", userId)
            .single()
        val prefs = result.data ?: return null
        return immichSettingsOf(prefs)
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

    /**
     * Raw thumbnail/preview bytes via the `immich-thumb` edge function
     * (auth header + 401-refresh handled by the SDK's http client).
     * Null when the proxy fails (Immich down, asset gone, not authorized).
     */
    suspend fun thumbnailBytes(assetId: String, size: String = "thumbnail"): ByteArray? =
        runCatching {
            client.http.getBytes(
                "/functions/immich-thumb?assetId=${android.net.Uri.encode(assetId)}&size=$size",
            )
        }.getOrNull()

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

/** Minimal projection of a `trip_media` row for attached-asset queries. */
@kotlinx.serialization.Serializable
data class AttachedImmichRef(
    @kotlinx.serialization.SerialName("immich_asset_id") val immichAssetId: String? = null,
)
