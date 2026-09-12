package io.github.nimbleflux.wayli.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * Key-value access to the generic `metadata` table — local diagnostics state
 * (capture/drop counters, upload log) that must survive process death
 * without a schema change.
 */
@Dao
interface MetadataDao {
    @Query("SELECT value FROM metadata WHERE `key` = :key")
    suspend fun get(key: String): String?

    @Query("SELECT value FROM metadata WHERE `key` = :key")
    fun observe(key: String): Flow<String?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entity: MetadataEntity)
}
