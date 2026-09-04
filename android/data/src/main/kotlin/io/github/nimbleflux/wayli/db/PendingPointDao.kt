package io.github.nimbleflux.wayli.db

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * A captured GPS point waiting to be uploaded. Written by the tracking
 * pipeline (TrackingController), drained by GpsUploadWorker in batches.
 */
@Entity(tableName = "pending_points")
data class PendingPointEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val lat: Double,
    val lon: Double,
    /** OwnTracks `tst` — Unix epoch seconds. */
    @androidx.room.ColumnInfo(name = "recorded_at_sec") val recordedAtSec: Long,
    val altitude: Double? = null,
    /** meters */
    val accuracy: Float? = null,
    /** m/s */
    val speed: Float? = null,
    /** degrees 0-359 */
    val heading: Float? = null,
    /** 0-100 */
    val battery: Int? = null,
    val deviceId: String = "android",
    /** Activity-recognition hint: still/on_foot/in_vehicle/on_bike, or null. */
    val activityType: String? = null,
    /** Failed upload attempts — used to drop poison points after many retries. */
    val attempts: Int = 0,
    @androidx.room.ColumnInfo(name = "created_at_ms") val createdAtMs: Long = System.currentTimeMillis(),
)

@Dao
interface PendingPointDao {
    @Insert
    suspend fun insert(point: PendingPointEntity)

    @Insert
    suspend fun insertAll(points: List<PendingPointEntity>)

    /** Oldest-first batch for upload. */
    @Query("SELECT * FROM pending_points ORDER BY recorded_at_sec ASC, id ASC LIMIT :limit")
    suspend fun takeBatch(limit: Int): List<PendingPointEntity>

    @Query("DELETE FROM pending_points WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    /** Drop points that failed too many uploads so the queue can't clog. Returns the deleted count. */
    @Query("DELETE FROM pending_points WHERE attempts >= :maxAttempts")
    suspend fun dropExhausted(maxAttempts: Int): Int

    @Query("UPDATE pending_points SET attempts = attempts + 1 WHERE id IN (:ids)")
    suspend fun bumpAttempts(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM pending_points")
    suspend fun count(): Int

    /** Live queue depth for the tracking-diagnostics surface. */
    @Query("SELECT COUNT(*) FROM pending_points")
    fun observeCount(): kotlinx.coroutines.flow.Flow<Int>

    /** When the oldest still-queued point was captured — a large age means uploads are stuck. */
    @Query("SELECT MIN(created_at_ms) FROM pending_points")
    suspend fun oldestCreatedAtMs(): Long?

    @Query("DELETE FROM pending_points")
    suspend fun clear()
}
