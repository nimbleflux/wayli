package io.github.nimbleflux.wayli.feature.immich

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.repo.ImmichRepository
import io.github.nimbleflux.wayli.repo.ImmichSettings
import javax.inject.Inject
import kotlinx.coroutines.launch

/**
 * Android surface for the Immich photo integration (#13). Photos are
 * DISPLAY-ONLY on Android: read from `immich_assets`, thumbnails streamed
 * through the authenticated immich-thumb proxy. Connection management (URL,
 * API key) stays on the web app — Android consumes the connection.
 */
@HiltViewModel
class ImmichViewModel @Inject constructor(
    private val repo: ImmichRepository,
    private val client: FluxbaseClient,
) : ViewModel() {
    /** Current user id, or null when signed out. */
    val userId: String?
        get() = client.auth.currentSession?.user?.id

    suspend fun settings(userId: String): ImmichSettings? = repo.settings(userId)

    suspend fun photosForRange(startISO: String, endISO: String): List<ImmichAsset> =
        repo.photosForRange(startISO, endISO).getOrDefault(emptyList())

    suspend fun thumbnailBytes(assetId: String, size: String = "thumbnail"): ByteArray? =
        repo.thumbnailBytes(assetId, size)

    suspend fun hasApiKey(): Boolean = repo.hasApiKey()
}
