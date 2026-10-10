package io.github.nimbleflux.wayli.feature.travel

import android.content.Context
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.nimbleflux.wayli.entry.EntryBlocks
import io.github.nimbleflux.wayli.feature.media.MediaUploader
import io.github.nimbleflux.wayli.models.TripMedia
import io.github.nimbleflux.wayli.repo.TripRepository
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Editor-side block model — what the entry editor manipulates. It extends the
 * persisted [EntryBlocks] model with local photo picks (files not yet
 * uploaded): a photo reference is either a server media id or a local file
 * path. On publish, locals upload and resolve to media ids.
 */
@Serializable
data class EditorPhotoRef(
    /** Server media id when the photo is already uploaded. */
    val mediaId: String? = null,
    /** App-local file path for a pick that uploads on save. */
    val localPath: String? = null,
)

@Serializable
data class EditorBlockDto(
    val t: String,
    val md: String? = null,
    val photos: List<EditorPhotoRef> = emptyList(),
)

object EditorBlockModel {
    const val TEXT = "text"
    const val PHOTOS = "photos"

    fun text(md: String) = EditorBlockDto(t = TEXT, md = md)
    fun photos(refs: List<EditorPhotoRef>) = EditorBlockDto(t = PHOTOS, photos = refs)

    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(EditorBlockDto.serializer())

    fun encode(blocks: List<EditorBlockDto>): String = json.encodeToString(serializer, blocks)

    fun decode(raw: String?): List<EditorBlockDto>? =
        raw?.takeIf { it.isNotBlank() }?.let {
            runCatching { json.decodeFromString(serializer, it) }.getOrNull()
        }

    /** All local pick paths, in order — used to clean up files on discard. */
    fun localPaths(blocks: List<EditorBlockDto>): List<String> =
        blocks.flatMap { b -> b.photos.mapNotNull { it.localPath } }
}

/**
 * Shared publish pipeline for block-based entries — used by both the editor
 * (online save) and [io.github.nimbleflux.wayli.tracking.EntrySyncWorker]
 * (offline retries). Uploads local picks, creates media rows, rewrites the
 * block structure with final media ids, writes the entry with both the
 * blocks and the flat legacy `body` projection, aligns media sort_order with
 * the block order, and deletes entry media rows that are no longer
 * referenced by any block.
 */
@Singleton
class EntryPublisher @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val tripRepo: TripRepository,
    private val mediaUploader: MediaUploader,
) {
    /**
     * @return the published entry id (created or updated).
     * @throws Exception on the first failure — callers decide retry semantics.
     */
    suspend fun publish(
        tripId: String,
        entryId: String?,
        title: String,
        entryDate: String,
        editorBlocks: List<EditorBlockDto>,
        existingMedia: List<ExistingMedia>,
    ): String {
        // 1. Upload local picks (block order) → storage path per local path.
        val uploadedPaths = mutableMapOf<String, String>() // localPath -> storagePath
        for (block in editorBlocks) {
            for (ref in block.photos) {
                val local = ref.localPath ?: continue
                if (uploadedPaths.contains(local)) continue
                val storagePath = mediaUploader
                    .uploadPhoto(appContext, Uri.fromFile(File(local)))
                    .getOrThrow()
                uploadedPaths[local] = storagePath
            }
        }

        // 2. Create media rows for the uploads. For new entries the row is
        // created with entry_id null and attached after the entry exists.
        uploadedPaths.values.forEachIndexed { index, storagePath ->
            tripRepo.createMedia(tripId, entryId, storagePath, index).getOrThrow()
        }
        // Resolve media ids by re-querying (insert doesn't return the row) —
        // storage paths are unique per upload.
        val mediaRows = tripRepo.listMedia(tripId).getOrThrow()
        val pathToId = mediaRows.associate { it.storagePath to it.id }

        // 3. Final block structure + legacy body projection.
        val referencedIds = mutableListOf<String>()
        val finalBlocks = editorBlocks.mapNotNull { block ->
            when (block.t) {
                EditorBlockModel.TEXT -> block.md?.trim()?.takeIf { it.isNotEmpty() }
                    ?.let { EntryBlocks.Block.Text(it) }

                EditorBlockModel.PHOTOS -> {
                    val ids = block.photos.mapNotNull { ref ->
                        ref.mediaId ?: ref.localPath?.let { uploadedPaths[it] }?.let { pathToId[it] }
                    }
                    if (ids.isEmpty()) null
                    else EntryBlocks.Block.Photos(ids).also { referencedIds += ids }
                }

                else -> null
            }
        }
        val mediaById = mediaRows.associateBy { it.id } +
            existingMedia.associateBy({ it.id }, { TripMedia(id = it.id, tripId = tripId, storagePath = it.storagePath) })
        val body = EntryBlocks.legacyBody(finalBlocks, mediaById)
        val blocksJson = EntryBlocks.toJson(EntryBlocks.Envelope(finalBlocks))

        // 4. Upsert the entry with blocks + projection.
            val targetEntryId: String = if (entryId != null) {
                tripRepo.updateEntry(entryId, title, entryDate, body, blocksJson).getOrThrow()
                entryId
            } else {
                val created = tripRepo.createEntry(tripId, title, entryDate, body, blocksJson).getOrThrow()
                // Attach media rows created with entry_id null while composing:
                // the local uploads above AND any server rows the blocks
                // reference (Immich attaches while composing — #246).
                val newIds = (
                    uploadedPaths.values.mapNotNull { pathToId[it] } +
                        editorBlocks.flatMap { block -> block.photos.mapNotNull { it.mediaId } }
                    ).distinct()
                if (newIds.isNotEmpty()) tripRepo.attachMediaToEntry(created.id, newIds).getOrThrow()
                created.id
            }

        // 5. Align sort_order with block order (legacy cover fallbacks).
        if (referencedIds.isNotEmpty()) {
            tripRepo.updateMediaSortOrder(referencedIds.distinct())
        }

        // 6. Entry media rows no longer referenced by any block are removed —
        // with everything-in-blocks, unplaced rows would only linger invisibly.
        val referenced = referencedIds.toSet()
        existingMedia.filter { it.id !in referenced }.forEach { row ->
            runCatching { tripRepo.deleteMedia(row.id) }
        }
        return targetEntryId
    }
}
