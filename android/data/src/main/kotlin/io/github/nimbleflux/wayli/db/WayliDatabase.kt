package io.github.nimbleflux.wayli.db

import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters

/**
 * Generic key-value metadata (misc local state).
 */
@Entity(tableName = "metadata")
data class MetadataEntity(
    @PrimaryKey val key: String,
    val value: String,
)

/**
 * Room database for offline-first access. Mirrors the subset of Wayli tables
 * the app reads/writes, plus the pending-point upload queue.
 */
@Database(
    entities = [MetadataEntity::class, PendingPointEntity::class, DraftEntryEntity::class, CacheEntity::class],
    version = 7,
    exportSchema = false,
)
@TypeConverters(WayliConverters::class)
abstract class WayliDatabase : RoomDatabase() {
    abstract fun pendingPointDao(): PendingPointDao
    abstract fun draftEntryDao(): DraftEntryDao
    abstract fun cacheDao(): CacheDao
    abstract fun metadataDao(): MetadataDao
}

class WayliConverters {
    @TypeConverter
    fun fromStringList(value: String?): List<String>? =
        value?.split(",")?.filter { it.isNotEmpty() }

    @TypeConverter
    fun toStringList(list: List<String>?): String? =
        list?.joinToString(",")
}

