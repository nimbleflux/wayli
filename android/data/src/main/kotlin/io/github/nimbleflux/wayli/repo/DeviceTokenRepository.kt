package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.rpc.RpcInvokeOptions
import io.github.nimbleflux.wayli.session.DeviceTokenStore
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray

/** A registered device token as listed by the `list-device-tokens` RPC. */
@Serializable
data class DeviceToken(
    val id: String,
    val label: String = "Device",
    val scopes: List<String> = emptyList(),
    @SerialName("last_used_at") val lastUsedAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("revoked_at") val revokedAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
) {
    val isRevoked: Boolean get() = revokedAt != null
}

/**
 * Creates, lists, and revokes GPS device tokens via the Wayli RPCs
 * (`create-device-token` / `list-device-tokens` / `revoke-device-token`,
 * namespace `wayli`).
 *
 * The plaintext token is generated on-device; only its SHA-256 hash is sent
 * to the server. On creation the plaintext is persisted in the encrypted
 * [DeviceTokenStore] so the upload worker can authenticate with it.
 */
@Singleton
class DeviceTokenRepository @Inject constructor(
    private val client: FluxbaseClient,
    private val store: DeviceTokenStore,
    private val arbiter: io.github.nimbleflux.wayli.session.SessionArbiter,
) {
    /** List the current user's tokens (no hashes are ever returned). */
    suspend fun list(): Result<List<DeviceToken>> = withRpcAuthRetry(client, arbiter) { runCatching {
        val res = client.rpc.invoke("list-device-tokens", null, RpcInvokeOptions(namespace = NAMESPACE))
        res.error?.let { error(it.message ?: "list-device-tokens failed") }
        parseRows(res.data?.result)
    } }

    /**
     * Register a new token for this device and persist the plaintext.
     * Returns the plaintext (shown once in the UI, never stored server-side).
     */
    suspend fun create(label: String): Result<String> = withRpcAuthRetry(client, arbiter) { runCatching {
        val token = DeviceTokenCodec.generate()
        val res = client.rpc.invoke(
            "create-device-token",
            mapOf(
                "label" to label.ifBlank { "Android" },
                "token_hash" to DeviceTokenCodec.sha256Hex(token),
            ),
            RpcInvokeOptions(namespace = NAMESPACE),
        )
        res.error?.let { error(it.message ?: "create-device-token failed") }
        val row = parseRows(res.data?.result).firstOrNull()
            ?: error("create-device-token returned no row")
        store.save(token = token, id = row.id, label = row.label)
        token
    } }

    /** Revoke a token server-side; clears the local store if it was active. */
    suspend fun revoke(id: String): Result<Unit> = withRpcAuthRetry(client, arbiter) { runCatching {
        val res = client.rpc.invoke(
            "revoke-device-token",
            mapOf("id" to id),
            RpcInvokeOptions(namespace = NAMESPACE),
        )
        res.error?.let { error(it.message ?: "revoke-device-token failed") }
        if (store.tokenId == id) store.clear()
    } }

    /** True when this device holds an active token (ready to submit points). */
    fun hasActiveToken(): Boolean = store.isActive

    /** Outcome of [repairIfOrphaned]. */
    enum class TokenRepair { OK, REPAIRED, OFFLINE }

    /**
     * Ensures the locally stored upload credential is still known to the
     * server, and self-heals when it isn't. A server-side DB restore wipes
     * `device_tokens` while the phone keeps its (now orphaned) copy —
     * `isActive` stays true, `ensureTrackingToken` never re-provisions, and
     * every ingest attempt 401s forever with points stuck in the queue.
     *
     * - No local token → provision one (REPAIRED).
     * - Local token present → verify against the server list; unknown or
     * revoked → clear + provision (REPAIRED).
     * - The verification RPC fails (offline/expired session) → OFFLINE, no
     * action taken.
     */
    suspend fun repairIfOrphaned(label: String): TokenRepair {
        if (!store.isActive) {
            return create(label).fold(
                onSuccess = { TokenRepair.REPAIRED },
                onFailure = { TokenRepair.OFFLINE },
            )
        }
        val rows = list().getOrNull() ?: return TokenRepair.OFFLINE
        val tokenId = store.tokenId
        val known = tokenId != null && rows.any { it.id == tokenId && !it.isRevoked }
        if (known) return TokenRepair.OK
        store.clear()
        return create(label).fold(
            onSuccess = { TokenRepair.REPAIRED },
            onFailure = { TokenRepair.OFFLINE },
        )
    }

    /**
     * RPC results arrive as a JsonElement that may be an array of rows, a
     * JSON-encoded string, or nested — unwrap defensively (the web app does
     * the same).
     */
    private fun parseRows(result: JsonElement?): List<DeviceToken> {
        val element = when (result) {
            null -> return emptyList()
            is JsonPrimitive -> runCatching { Json.parseToJsonElement(result.content) }.getOrElse { return emptyList() }
            else -> result
        }
        val array = when (element) {
            is JsonArray -> element
            is JsonObject -> element["result"] as? JsonArray ?: element["rows"] as? JsonArray ?: return emptyList()
            else -> return emptyList()
        }
        return array.mapNotNull { row ->
            runCatching { Json.decodeFromJsonElement(DeviceToken.serializer(), row) }.getOrNull()
        }
    }

    companion object {
        private const val NAMESPACE = "wayli"
    }
}
