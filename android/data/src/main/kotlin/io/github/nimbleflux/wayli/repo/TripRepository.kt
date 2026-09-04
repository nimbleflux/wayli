package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.models.TripEntry
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for trips and journal entries. Calls the Fluxbase SDK's PostgREST
 * query builder to fetch/create/update data. Reads are cached (write-through,
 * serve-stale offline) via [CacheStore].
 */
@Singleton
class TripRepository @Inject constructor(
    private val client: FluxbaseClient,
    private val cache: CacheStore,
    private val arbiter: io.github.nimbleflux.wayli.session.SessionArbiter,
) {

    /**
     * List the current user's trips, newest first.
     * Mirrors: client.from<Trip>("trips").select().order("created_at", ascending=false).execute()
     */
    suspend fun listTrips(userId: String): Result<List<Trip>> =
        cache.withCacheList("trips:$userId", Trip.serializer()) {
            runCatching {
                val result = client.from<Trip>("trips")
                    .select()
                    .eq("user_id", userId)
                    .order("created_at", ascending = false)
                    .execute()
                result.dataOrThrow() ?: emptyList()
            }
        }

    /**
     * Get a single trip by ID.
     */
    suspend fun getTrip(tripId: String): Result<Trip> =
        cache.withCache("trip:$tripId", Trip.serializer()) {
            runCatching {
                val result = client.from<Trip>("trips")
                    .select()
                    .eq("id", tripId)
                    .single()
                // Propagate the real error: a 401 or transport failure must
                // reach CacheStore's adjudication — masking it here would
                // surface a dead session as "Trip not found". `single()`
                // never returns data-without-error; a missing row arrives as
                // PostgREST's PGRST116, the one error that means "not found".
                val error = result.error
                result.data ?: throw when {
                    error == null || error.code == "PGRST116" -> Exception("Trip not found")
                    else -> error
                }
            }
        }

    /**
     * Stale cached trip for immediate paint (null when never opened on this
     * device) — the network refresh still runs via [getTrip].
     */
    suspend fun getTripCached(tripId: String): Trip? =
        cache.get("trip:$tripId", Trip.serializer())

    /**
     * Stale cached journal entries, same ordering guarantee as [listEntries]
     * (newest first) — the cached payload is the raw server order.
     */
    suspend fun listEntriesCached(tripId: String): List<TripEntry> =
        cache.get("entries:$tripId", ListSerializer(TripEntry.serializer()))
            ?.sortedWith(
                compareByDescending<TripEntry> { it.entryDate }.thenByDescending { it.createdAt },
            )
            ?: emptyList()

    /**
     * One entry by id, filtered server-side — opening a single entry must not
     * download the trip's whole journal to filter client-side. Cached so a
     * previously opened entry still reads offline.
     */
    suspend fun getEntry(entryId: String): Result<TripEntry> =
        cache.withCache("entry:$entryId", TripEntry.serializer()) {
            runCatching {
                val result = client.from<TripEntry>("trip_entries")
                    .select()
                    .eq("id", entryId)
                    .single()
                result.data ?: throw (result.error ?: Exception("Entry not found"))
            }
        }

    /**
     * Create a new trip.
     */
    suspend fun createTrip(
        userId: String,
        title: String,
        startDate: String,
        endDate: String? = null,
        description: String? = null,
        visibility: String = "private",
    ): Result<Trip> = runCatching {
        val values = buildMap {
            put("user_id", userId)
            put("title", title)
            put("start_date", startDate)
            put("status", "active")
            put("visibility", visibility)
            endDate?.let { put("end_date", it) }
            description?.let { put("description", it) }
        }
        client.from<Trip>("trips").insert(values)
        // The insert response doesn't return the created row in PostgREST by default;
        // re-query for it. In a follow-up we'll add ?select=* to the insert.
        listTrips(userId).getOrThrow().first { it.title == title }
    }

    /**
     * Create a journal entry for a trip.
     */
    suspend fun createEntry(
        tripId: String,
        title: String,
        entryDate: String,
        body: String?,
        blocks: JsonObject? = null,
    ): Result<TripEntry> =
        runCatching {
            val values = buildMap<String, Any> {
                put("trip_id", tripId)
                put("user_id", requireNotNull(currentUserId()) { "Not signed in" })
                put("title", title)
                put("entry_date", entryDate)
                put("status", "published")
                body?.takeIf { it.isNotBlank() }?.let { put("body", it) }
                blocks?.let { put("blocks", it.toPlainValue()) }
            }
            client.from<TripEntry>("trip_entries").insert(values)
            // Re-query (PostgREST insert doesn't return the row by default).
            listEntries(tripId).getOrThrow().first { it.title == title }
        }

    /**
     * Current auth user id — writes must include user_id explicitly: the
     * tables API doesn't inject it and the RLS insert policies compare it
     * with auth.uid().
     */
    private fun currentUserId(): String? = client.auth.currentSession?.user?.id

    /**
     * Fluxbase's payload builder stringifies kotlinx [JsonPrimitive] leaves
     * verbatim (toString() keeps the quotes), so jsonb values like `blocks`
     * must cross as plain maps/lists/scalars instead.
     */
    private fun JsonElement.toPlainValue(): Any = when (this) {
        is JsonObject -> entries.associate { (k, v) -> k to v.toPlainValue() }
        is kotlinx.serialization.json.JsonArray -> map { it.toPlainValue() }
        is kotlinx.serialization.json.JsonPrimitive -> when {
            isString -> content
            content == "true" -> true
            content == "false" -> false
            content.toIntOrNull() != null -> content.toInt()
            content.toLongOrNull() != null -> content.toLong()
            content.toDoubleOrNull() != null -> content.toDouble()
            else -> content
        }
    }

    /**
     * List journal entries for a trip — newest first (latest posts at the top
     * of the timeline, matching the web dashboard). Re-sorted after the cache
     * layer so a stale cache written by an older (ascending) build can't leak
     * the old order.
     */
    suspend fun listEntries(tripId: String): Result<List<TripEntry>> =
        cache.withCacheList("entries:$tripId", TripEntry.serializer()) {
            runCatching {
                val result = client.from<TripEntry>("trip_entries")
                    .select()
                    .eq("trip_id", tripId)
                    .order("entry_date", ascending = false)
                    .order("created_at", ascending = false)
                    .execute()
                result.dataOrThrow() ?: emptyList()
            }
        }.map { entries ->
            entries.sortedWith(
                compareByDescending<TripEntry> { it.entryDate }.thenByDescending { it.createdAt },
            )
        }

    /**
     * Update an existing journal entry (owner-only via RLS).
     *
     * @param blocks new block structure, or null to leave it unchanged.
     */
    suspend fun updateEntry(
        entryId: String,
        title: String,
        entryDate: String,
        body: String?,
        blocks: JsonElement? = null,
    ): Result<Unit> = runCatching {
        val values = buildMap<String, Any> {
            put("title", title)
            put("entry_date", entryDate)
            body?.takeIf { it.isNotBlank() }?.let { put("body", it) }
            blocks?.let { put("blocks", it.toPlainValue()) }
        }
        client.from<TripEntry>("trip_entries").eq("id", entryId).update(values)
    }

    /**
     * Rewrite sort_order so the entry's media matches the order photos
     * appear in the block structure (keeps legacy cover-from-first-media
     * fallbacks aligned with the visual order).
     */
    suspend fun updateMediaSortOrder(orderedMediaIds: List<String>): Result<Unit> = runCatching {
        orderedMediaIds.forEachIndexed { index, mediaId ->
            client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media")
                .eq("id", mediaId)
                .update(mapOf("sort_order" to index))
        }
    }

    /** Point the entry's cover_media_id at a specific media row (the hero). */
    suspend fun updateEntryCover(entryId: String, mediaId: String): Result<Unit> = runCatching {
        client.from<TripEntry>("trip_entries")
            .eq("id", entryId)
            .update(mapOf("cover_media_id" to mediaId))
    }

    /**
     * Delete an attached media row; the stored object is removed too
     * (best-effort — rows written by the web carry absolute URLs, from which
     * the bucket path is the segment after the bucket name).
     */
    suspend fun deleteMedia(mediaId: String): Result<Unit> = runCatching {
        // Read the path before the row goes away.
        val path = client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media")
            .select("storage_path")
            .eq("id", mediaId)
            .single()
            .data?.storagePath
        client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media")
            .eq("id", mediaId)
            .delete()
        // Best-effort object cleanup; a failure here leaves only an orphaned
        // file, which is preferable to blocking the row delete.
        if (path != null) {
            runCatching {
                val bucket = "trip-images"
                val objectPath = if (path.startsWith("http")) {
                    // …/api/v1/storage/{bucket}/{path…}
                    path.substringAfter("/storage/$bucket/").substringBefore("?")
                } else {
                    path
                }
                if (objectPath.isNotBlank()) client.storage.from(bucket).remove(objectPath)
            }
        }
        Unit
    }

    /**
     * Attach an uploaded photo to a trip/entry (`trip_media` row).
     */
    suspend fun createMedia(
        tripId: String,
        entryId: String?,
        storagePath: String,
        sortOrder: Int = 0,
    ): Result<Unit> = runCatching {
        val values = buildMap<String, Any> {
            put("trip_id", tripId)
            put("user_id", requireNotNull(currentUserId()) { "Not signed in" })
            entryId?.let { put("entry_id", it) }
            put("storage_path", storagePath)
            put("media_type", "image")
            put("sort_order", sortOrder)
        }
        client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media").insert(values)
    }

    /**
     * Link media rows (created with a null entry_id while an entry was being
     * composed) to their entry.
     */
    suspend fun attachMediaToEntry(entryId: String, mediaIds: List<String>): Result<Unit> = runCatching {
        if (mediaIds.isEmpty()) return@runCatching
        client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media")
            .`in`("id", mediaIds)
            .update(mapOf("entry_id" to entryId))
    }

    /**
     * List media attached to a trip (optionally filtered to one entry).
     */
    suspend fun listMedia(tripId: String, entryId: String? = null): Result<List<io.github.nimbleflux.wayli.models.TripMedia>> =
        cache.withCacheList("media:$tripId${entryId?.let { ":$it" } ?: ""}", io.github.nimbleflux.wayli.models.TripMedia.serializer()) {
            runCatching {
                var query = client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media")
                    .select()
                    .eq("trip_id", tripId)
                    .order("sort_order")
                entryId?.let { query = query.eq("entry_id", it) }
                query.execute().dataOrThrow() ?: emptyList()
            }
        }

    /**
     * First media row per trip for a batch of trips — one query, used as the
     * cover fallback for trips whose `image_url` is null (auto-detected
     * trips). Ordering matches [listMedia] (lowest sort_order first).
     */
    suspend fun firstMediaPerTrip(tripIds: List<String>): Result<Map<String, io.github.nimbleflux.wayli.models.TripMedia>> =
        runCatching {
            if (tripIds.isEmpty()) return@runCatching emptyMap()
            val result = client.from<io.github.nimbleflux.wayli.models.TripMedia>("trip_media")
                .select()
                .`in`("trip_id", tripIds)
                .order("sort_order")
                .limit(1000)
                .execute()
            (result.dataOrThrow() ?: emptyList())
                .groupBy { it.tripId }
                .mapValues { (_, rows) -> rows.first() }
        }

    /**
     * Update an existing trip's editable fields (owner-only via RLS).
     */
    suspend fun updateTrip(
        tripId: String,
        title: String? = null,
        description: String? = null,
        startDate: String? = null,
        endDate: String? = null,
        visibility: String? = null,
        imageUrl: String? = null,
        clearImage: Boolean = false,
    ): Result<Unit> = runCatching {
        val values = buildMap<String, Any?> {
            title?.let { put("title", it) }
            description?.let { put("description", it) }
            startDate?.let { put("start_date", it) }
            endDate?.let { put("end_date", it) }
            visibility?.let { put("visibility", it) }
            if (clearImage) put("image_url", null) else imageUrl?.let { put("image_url", it) }
        }
        client.from<Trip>("trips").eq("id", tripId).update(values)
    }

    // ---- Auto-suggested trips (status='pending') ----

    /** Trips waiting for review (auto-detected, closed). */
    suspend fun listPendingTrips(userId: String): Result<List<Trip>> = runCatching {
        val result = client.from<Trip>("trips")
            .select()
            .eq("user_id", userId)
            .eq("status", "pending")
            .order("start_date", ascending = false)
            .execute()
        result.dataOrThrow() ?: emptyList()
    }

    /** Approve a suggestion — server flips to completed and computes distance. */
    suspend fun approveSuggestion(tripId: String): Result<Unit> = withRpcAuthRetry(client, arbiter) { runCatching {
        val res = client.rpc.invoke(
            "approve-detected-trip",
            mapOf("id" to tripId),
            io.github.nimbleflux.fluxbase.rpc.RpcInvokeOptions(namespace = "wayli"),
        )
        res.error?.let { throw it }
        Unit
    } }

    /** Dismiss a suggestion (status → rejected). */
    suspend fun rejectSuggestion(tripId: String): Result<Unit> = withRpcAuthRetry(client, arbiter) { runCatching {
        val res = client.rpc.invoke(
            "reject-detected-trip",
            mapOf("id" to tripId),
            io.github.nimbleflux.fluxbase.rpc.RpcInvokeOptions(namespace = "wayli"),
        )
        res.error?.let { throw it }
        Unit
    } }

    /**
     * Delete a journal entry (owner-only via RLS).
     */
    suspend fun deleteEntry(entryId: String): Result<Unit> = runCatching {
        client.from<TripEntry>("trip_entries").eq("id", entryId).delete()
    }

    /**
     * Delete a trip.
     */
    suspend fun deleteTrip(tripId: String): Result<Unit> = runCatching {
        client.from<Trip>("trips").eq("id", tripId).delete()
    }
}
