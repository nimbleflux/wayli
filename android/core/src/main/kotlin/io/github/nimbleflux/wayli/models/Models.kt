package io.github.nimbleflux.wayli.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

// ---- Sync state ----

/**
 * Sync state for offline-first entities. Entities start as PENDING when created
 * locally, transition to SYNCING when a WorkManager worker picks them up, then
 * SYNCED on success or FAILED on error.
 */
enum class SyncState { PENDING, SYNCING, SYNCED, FAILED }

// ---- Core entities (mirror Wayli DB schema) ----

@Serializable
data class Trip(
    val id: String,
    @SerialName("user_id") val userId: String,
    val title: String,
    val description: String? = null,
    @SerialName("start_date") val startDate: String,
    @SerialName("end_date") val endDate: String? = null,
    val status: String = "completed",
    val visibility: String = "private",
    val labels: List<String>? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    val metadata: JsonElement? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/**
 * Precomputed trip distance in meters (`metadata.distanceTraveled`) — written
 * by the web app and trip jobs on create/update; absent on fresh/ongoing
 * trips that haven't been recalculated.
 */
val Trip.distanceMeters: Double?
    get() = (metadata as? JsonObject)
        ?.get("distanceTraveled")
        ?.let { it as? JsonPrimitive }
        ?.doubleOrNull

@Serializable
data class TripEntry(
    val id: String,
    @SerialName("trip_id") val tripId: String,
    @SerialName("entry_date") val entryDate: String,
    val body: String? = null,
    /** Raw jsonb of the block structure — decode via [io.github.nimbleflux.wayli.entry.EntryBlocks]. */
    val blocks: JsonElement? = null,
    val title: String? = null,
    @SerialName("cover_media_id") val coverMediaId: String? = null,
    val status: String = "published",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class TripMedia(
    val id: String,
    @SerialName("trip_id") val tripId: String,
    @SerialName("entry_id") val entryId: String? = null,
    @SerialName("storage_path") val storagePath: String = "",
    @SerialName("thumbnail_path") val thumbnailPath: String? = null,
    @SerialName("media_type") val mediaType: String = "image",
    val width: Int? = null,
    val height: Int? = null,
    @SerialName("taken_at") val takenAt: String? = null,
)

@Serializable
data class TrackerPoint(
    @SerialName("user_id") val userId: String,
    @SerialName("recorded_at") val recordedAt: String,
    /** GeoJSON Point object from the tables API, or a WKT/GeoJSON string. */
    val location: kotlinx.serialization.json.JsonElement? = null,
    @SerialName("country_code") val countryCode: String? = null,
    val altitude: Double? = null,
    val accuracy: Double? = null,
    val speed: Double? = null,
    val distance: Double? = null,
    @SerialName("time_spent") val timeSpent: Double? = null,
    val heading: Double? = null,
    @SerialName("battery_level") val batteryLevel: Int? = null,
    @SerialName("is_charging") val isCharging: Boolean? = null,
    @SerialName("activity_type") val activityType: String? = null,
    @SerialName("transport_mode") val transportMode: String? = null,
    @SerialName("transport_mode_confidence") val transportModeConfidence: Double? = null,
    @SerialName("device_id") val deviceId: String? = null,
)

@Serializable
data class UserProfile(
    val id: String,
    val email: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    val username: String? = null,
    val role: String = "user",
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("home_address") val homeAddress: JsonElement? = null,
    val discoverable: String = "nobody",
    @SerialName("cover_photo_url") val coverPhotoUrl: String? = null,
    @SerialName("cover_focal_x") val coverFocalX: Double? = null,
    @SerialName("cover_focal_y") val coverFocalY: Double? = null,
    @SerialName("onboarding_completed") val onboardingCompleted: Boolean? = null,
    @SerialName("created_at") val createdAt: String = "",
)

/**
 * User preferences (mirrors the `user_preferences` table). `language`,
 * `timezone`, `notifications_enabled` are columns; `units` lives inside the
 * `preferences` JSONB; `trip_exclusions` is its own JSONB column.
 */
@Serializable
data class UserPreferences(
    /** The row's PK — the user's uuid (the table has no user_id column). */
    val id: String? = null,
    val language: String? = null,
    val timezone: String? = null,
    @SerialName("notifications_enabled") val notificationsEnabled: Boolean? = null,
    val preferences: JsonElement? = null,
    @SerialName("trip_exclusions") val tripExclusions: JsonElement? = null,
)

/** Nightly data-sampling config (mirrors the `user_data_sampling` table). */
@Serializable
data class UserDataSampling(
    @SerialName("user_id") val userId: String? = null,
    val enabled: Boolean = false,
    @SerialName("min_distance_m") val minDistanceM: Double? = null,
    @SerialName("min_time_s") val minTimeS: Double? = null,
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("last_deleted") val lastDeleted: String? = null,
)

// ---- Trip exclusions (stored as the `user_preferences.trip_exclusions` JSONB array) ----

/** A geographic zone excluded from trip detection (max 10 per user). */
@Serializable
data class TripExclusion(
    val id: String,
    val name: String,
    val location: TripExclusionLocation = TripExclusionLocation(),
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class TripExclusionLocation(
    @SerialName("display_name") val displayName: String? = null,
    val coordinates: TripExclusionCoords? = null,
    val address: String? = null,
    val layer: String? = null,
)

@Serializable
data class TripExclusionCoords(
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class WantToVisit(
    val id: String,
    @SerialName("user_id") val userId: String,
    val title: String,
    val location: JsonElement? = null, // GeoJSON Point object; WKT string in demo data
    val address: String? = null,
    @SerialName("country_code") val countryCode: String? = null,
    @SerialName("marker_type") val markerType: String = "default",
    @SerialName("marker_color") val markerColor: String = "#3B82F6",
    val labels: List<String>? = null,
    val rating: Int? = null,
    val favorite: Boolean = false,
    @SerialName("image_url") val imageUrl: String? = null,
)

@Serializable
data class Notification(
    val id: String,
    @SerialName("user_id") val userId: String,
    val type: String,
    val title: String,
    val body: String? = null,
    val icon: String? = null,
    val link: String? = null,
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)
