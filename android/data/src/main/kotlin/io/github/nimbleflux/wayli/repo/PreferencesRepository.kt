package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.models.TripExclusion
import io.github.nimbleflux.wayli.models.UserPreferences
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject

/**
 * Reads/writes the `user_preferences` row. `language`, `timezone`, and
 * `notifications_enabled` are columns; `units` lives inside the `preferences`
 * JSONB and is merged (not overwritten) to preserve any other keys.
 *
 * The table has NO `user_id` column — its primary key `id` IS the user's
 * uuid (RLS compares `auth.uid() = id`), so every filter/insert keys on `id`.
 */
@Singleton
class PreferencesRepository @Inject constructor(
    private val client: FluxbaseClient,
) {
    private companion object {
        val FITNESS_AUDIENCES = setOf("private", "friends", "public")
    }

    suspend fun getPreferences(userId: String): Result<UserPreferences> = runCatching {
        val result = client.from<UserPreferences>("user_preferences")
            .select()
            .eq("id", userId)
            .maybeSingle()
        result.data ?: UserPreferences(id = userId)
    }

    suspend fun updatePreferences(
        userId: String,
        language: String? = null,
        timezone: String? = null,
        notificationsEnabled: Boolean? = null,
        units: String? = null,
    ): Result<Unit> = runCatching {
        val fields = mutableMapOf<String, Any?>()
        language?.let { fields["language"] = it }
        timezone?.let { fields["timezone"] = it }
        notificationsEnabled?.let { fields["notifications_enabled"] = it }
        // units lives in the `preferences` JSONB — merge into the existing object.
        if (units != null) {
            val current = getPreferences(userId).getOrNull()?.preferences?.jsonObject ?: emptyMap()
            fields["preferences"] = JsonObject(current.toMutableMap().apply { put("units", JsonPrimitive(units)) })
        }
        if (fields.isNotEmpty()) {
            client.from<UserPreferences>("user_preferences").eq("id", userId).update(fields)
        }
    }

    /** Extract the `units` value ("metric"|"imperial") from the preferences JSONB. */
    fun unitsOf(prefs: UserPreferences): String? =
        prefs.preferences?.jsonObject?.get("units")?.let { (it as? JsonPrimitive)?.content }

    /**
     * Fitness beta opt-in, stored at `preferences.beta_features.fitness` —
     * the same flag the web reads. Gates the Fitness tab and FIT import UI.
     */
    fun fitnessBetaOf(prefs: UserPreferences): Boolean =
        (prefs.preferences?.jsonObject?.get("beta_features") as? JsonObject)
            ?.get("fitness") == JsonPrimitive(true)

    suspend fun setFitnessBeta(userId: String, enabled: Boolean): Result<Unit> = runCatching {
        val current = getPreferences(userId).getOrNull()
        val merged = JsonObject(
            (current?.preferences?.jsonObject ?: emptyMap()).toMutableMap().apply {
                put(
                    "beta_features",
                    JsonObject(
                        ((this["beta_features"] as? JsonObject)?.toMutableMap() ?: mutableMapOf())
                            .apply { put("fitness", JsonPrimitive(enabled)) },
                    ),
                )
            },
        )
        if (current?.id != null) {
            client.from<UserPreferences>("user_preferences")
                .eq("id", userId)
                .update(mapOf("preferences" to merged))
        } else {
            // No preferences row yet — an UPDATE alone would affect 0 rows and
            // silently lose the toggle (the web inserts for the same reason).
            client.from<UserPreferences>("user_preferences")
                .insert(mapOf("id" to userId, "preferences" to merged))
        }
        Unit
    }

    /**
     * Global default sharing audience for fitness activities, stored at
     * `preferences.fitness_sharing.default` (same setting the web edits).
     * Private when unset/invalid.
     */
    fun fitnessDefaultOf(prefs: UserPreferences): String =
        (prefs.preferences?.jsonObject?.get("fitness_sharing") as? JsonObject)
            ?.get("default")?.let { (it as? JsonPrimitive)?.content }
            ?.takeIf { it in FITNESS_AUDIENCES } ?: "private"

    suspend fun setFitnessDefault(userId: String, audience: String): Result<Unit> = runCatching {
        val current = getPreferences(userId).getOrNull()
        val sharing = (current?.preferences?.jsonObject?.get("fitness_sharing") as? JsonObject)
            ?.toMutableMap() ?: mutableMapOf()
        sharing["default"] = JsonPrimitive(audience)
        val merged = JsonObject(
            (current?.preferences?.jsonObject ?: emptyMap()).toMutableMap().apply {
                put("fitness_sharing", JsonObject(sharing))
            },
        )
        if (current?.id != null) {
            client.from<UserPreferences>("user_preferences")
                .eq("id", userId)
                .update(mapOf("preferences" to merged))
        } else {
            client.from<UserPreferences>("user_preferences")
                .insert(mapOf("id" to userId, "preferences" to merged))
        }
        Unit
    }

    // ---- Trip exclusions (the `trip_exclusions` JSONB array on the same row) ----

    private val exclusionsSerializer = ListSerializer(TripExclusion.serializer())

    /** Read the user's trip-exclusion zones (empty if none set). */
    suspend fun getTripExclusions(userId: String): Result<List<TripExclusion>> = runCatching {
        val prefs = getPreferences(userId).getOrNull()
        val element = prefs?.tripExclusions
        when {
            element == null || element is JsonNull -> emptyList()
            else -> Json.decodeFromJsonElement(exclusionsSerializer, element)
        }
    }

    /**
     * Replace the whole trip-exclusion list (max 10). The full array is written
     * back to the `trip_exclusions` column.
     */
    suspend fun saveTripExclusions(userId: String, exclusions: List<TripExclusion>): Result<Unit> =
        runCatching {
            val array = Json.encodeToJsonElement(exclusionsSerializer, exclusions) as JsonArray
            client.from<UserPreferences>("user_preferences")
                .eq("id", userId)
                .update(mapOf("trip_exclusions" to array))
            Unit
        }
}
