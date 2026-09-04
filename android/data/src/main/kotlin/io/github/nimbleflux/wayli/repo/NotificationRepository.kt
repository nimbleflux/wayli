package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.models.Notification
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.builtins.ListSerializer

/**
 * The `notifications` table (owner-private via RLS) — job completions,
 * trip suggestions and friends activity, created server-side by the
 * jobs.queue terminal trigger (and by the web's job store). Reads are
 * cached serve-stale like the other repositories.
 */
@Singleton
class NotificationRepository @Inject constructor(
    private val client: FluxbaseClient,
    private val cache: CacheStore,
) {

    suspend fun list(userId: String, limit: Int = 50): Result<List<Notification>> =
        cache.withCacheList("notifications:$userId", Notification.serializer()) {
            runCatching {
                val result = client.from<Notification>("notifications")
                    .select()
                    .eq("user_id", userId)
                    .order("created_at", ascending = false)
                    .limit(limit)
                    .execute()
                result.dataOrThrow() ?: emptyList()
            }
        }

    suspend fun unreadCount(userId: String): Int =
        list(userId).getOrDefault(emptyList()).count { it.readAt == null }

    /**
     * Mark one notification read and mirror the change into the Room cache.
     * The cache is serve-stale, so without this a later failed refetch would
     * resurrect the unread row on screen. Mutations return HTTP errors
     * in-band (never throw) — surface them instead of swallowing, or a failed
     * write is indistinguishable from a successful one.
     */
    suspend fun markRead(userId: String, id: String): Result<Unit> = runCatching {
        val now = nowIso()
        val result = client.from<Notification>("notifications")
            .eq("id", id)
            .update(mapOf("read_at" to now))
        result.error?.let { throw it }
        updateCache(userId) { if (it.id == id) it.copy(readAt = now) else it }
    }

    /**
     * Mark ALL unread rows read in a single UPDATE (`read_at IS NULL`),
     * instead of one PATCH per id — same call shape as the web client.
     */
    suspend fun markAllRead(userId: String): Result<Unit> = runCatching {
        val now = nowIso()
        val result = client.from<Notification>("notifications")
            .eq("user_id", userId)
            .is_("read_at", null)
            .update(mapOf("read_at" to now))
        result.error?.let { throw it }
        updateCache(userId) { if (it.readAt == null) it.copy(readAt = now) else it }
    }

    suspend fun delete(id: String): Result<Unit> = runCatching {
        val result = client.from<Notification>("notifications").eq("id", id).delete()
        result.error?.let { throw it }
    }

    private suspend fun updateCache(userId: String, transform: (Notification) -> Notification) {
        cache.get("notifications:$userId", ListSerializer(Notification.serializer()))
            ?.let { cached -> cache.put("notifications:$userId", cached.map(transform), ListSerializer(Notification.serializer())) }
    }

    private fun nowIso(): String = Instant.now().toString()
}
