package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.db.MetadataDao
import io.github.nimbleflux.wayli.db.MetadataEntity
import io.github.nimbleflux.wayli.db.PendingPointDao
import io.github.nimbleflux.wayli.models.TrackerPoint
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** One upload attempt's outcome, for the tracking-diagnostics log. */
@Serializable
data class UploadLogEntry(
    val atMs: Long,
    val batch: Int,
    /** ok / retry / fatal / network */
    val outcome: String,
    val httpCode: Int? = null,
    /** Queue depth right after the attempt. */
    val queuedAfter: Int? = null,
)

private val uploadLogJson = Json { ignoreUnknownKeys = true }
private const val LOG_CAP = 20

/**
 * Local tracking diagnostics: how many points the device captured vs.
 * submitted vs. queued vs. dropped, and a compact log of recent upload
 * attempts. Counters and the log live in the generic `metadata` table
 * (key-value) so no schema change is needed; they survive process death.
 */
@Singleton
class TrackingDiagnosticsRepository @Inject constructor(
    private val pendingPointDao: PendingPointDao,
    private val metadataDao: MetadataDao,
    private val client: FluxbaseClient,
) {
    fun observeQueueCount(): Flow<Int> = pendingPointDao.observeCount()

    suspend fun queueCount(): Int = pendingPointDao.count()

    suspend fun oldestQueuedAtMs(): Long? = pendingPointDao.oldestCreatedAtMs()

    suspend fun capturedToday(): Int =
        if (metadataDao.get(KEY_CAPTURED_DAY) == today()) {
            metadataDao.get(KEY_CAPTURED_DAY_COUNT)?.toIntOrNull() ?: 0
        } else {
            0
        }

    suspend fun capturedTotal(): Int = getInt(KEY_CAPTURED_TOTAL)

    suspend fun droppedTotal(): Int = getInt(KEY_DROPPED_TOTAL)

    suspend fun onPointsCaptured(count: Int) {
        putInt(KEY_CAPTURED_TOTAL, getInt(KEY_CAPTURED_TOTAL) + count)
        val day = metadataDao.get(KEY_CAPTURED_DAY)
        if (day != today()) {
            metadataDao.put(MetadataEntity(KEY_CAPTURED_DAY, today()))
            putInt(KEY_CAPTURED_DAY_COUNT, count)
        } else {
            putInt(KEY_CAPTURED_DAY_COUNT, getInt(KEY_CAPTURED_DAY_COUNT) + count)
        }
    }

    suspend fun onPointsDropped(count: Int) {
        putInt(KEY_DROPPED_TOTAL, getInt(KEY_DROPPED_TOTAL) + count)
    }

    suspend fun uploadLog(): List<UploadLogEntry> =
        metadataDao.get(KEY_UPLOAD_LOG)
            ?.let { runCatching { uploadLogJson.decodeFromString(LOG_SERIALIZER, it) }.getOrNull() }
            ?: emptyList()

    /** Append one outcome, keeping the newest [LOG_CAP] entries. */
    suspend fun logUpload(entry: UploadLogEntry) {
        val updated = (uploadLog() + entry).takeLast(LOG_CAP)
        metadataDao.put(
            MetadataEntity(KEY_UPLOAD_LOG, uploadLogJson.encodeToString(LOG_SERIALIZER, updated)),
        )
    }

    /**
     * Total points stored for this user on the server (`tracker_data` exact
     * count, no rows transferred) — the "submitted" number.
     */
    suspend fun serverPointCount(userId: String): Result<Long> = runCatching {
        val result = client.from<TrackerPoint>("tracker_data")
            .select()
            .eq("user_id", userId)
            .count()
            .limit(1)
            .execute()
        result.error?.let { throw it }
        result.count ?: 0L
    }

    private suspend fun getInt(key: String): Int = metadataDao.get(key)?.toIntOrNull() ?: 0

    private suspend fun putInt(key: String, value: Int) {
        metadataDao.put(MetadataEntity(key, value.toString()))
    }

    private fun today(): String = LocalDate.now().toString()

    private companion object {
        const val KEY_CAPTURED_TOTAL = "diag_captured_total"
        const val KEY_CAPTURED_DAY = "diag_captured_day"
        const val KEY_CAPTURED_DAY_COUNT = "diag_captured_day_count"
        const val KEY_DROPPED_TOTAL = "diag_dropped_total"
        const val KEY_UPLOAD_LOG = "diag_upload_log"
        val LOG_SERIALIZER = ListSerializer(UploadLogEntry.serializer())
    }
}
