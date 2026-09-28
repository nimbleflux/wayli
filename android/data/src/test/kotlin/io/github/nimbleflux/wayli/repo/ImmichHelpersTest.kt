package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.models.UserPreferences
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Pure-helper coverage for the Immich photo integration (#13). */
class ImmichHelpersTest {

    private fun prefsWithImmich(enabled: Boolean?): UserPreferences =
        UserPreferences(
            preferences = buildJsonObject {
                put(
                    "immich",
                    buildJsonObject {
                        if (enabled != null) put("enabled", enabled)
                        put("server_url", "http://immich:2283")
                    },
                )
            },
        )

    // ---- immichEnabledOf ----

    @Test
    fun `immichEnabledOf is true only for a literal true`() {
        assertTrue(immichEnabledOf(prefsWithImmich(true)))
        assertFalse(immichEnabledOf(prefsWithImmich(false)))
    }

    @Test
    fun `immichEnabledOf is false when the immich object is absent`() {
        assertFalse(immichEnabledOf(UserPreferences(preferences = buildJsonObject { })))
        assertFalse(immichEnabledOf(UserPreferences()))
    }

    // ---- immichSettingsOf ----

    @Test
    fun `immichSettingsOf reads enabled server url and watermark`() {
        val prefs = UserPreferences(
            preferences = buildJsonObject {
                put(
                    "immich",
                    buildJsonObject {
                        put("enabled", true)
                        put("server_url", "http://immich:2283")
                        put("last_sync_at", "2026-09-28T00:00:00Z")
                    },
                )
            },
        )
        val settings = immichSettingsOf(prefs)!!
        assertTrue(settings.enabled)
        assertEquals("http://immich:2283", settings.serverUrl)
        assertEquals("2026-09-28T00:00:00Z", settings.lastSyncAt)
    }

    @Test
    fun `immichSettingsOf returns null without an immich object`() {
        assertNull(immichSettingsOf(UserPreferences()))
    }

    // ---- unattachedCount ----

    private fun photo(id: String) = ImmichAsset(
        assetId = id,
        latitude = -35.0,
        longitude = 150.0,
        takenAt = "2026-09-05T10:00:00Z",
    )

    @Test
    fun `unattachedCount counts only photos not yet attached`() {
        val photos = listOf(photo("a1"), photo("a2"), photo("a3"))
        assertEquals(3, unattachedCount(photos, emptySet()))
        assertEquals(2, unattachedCount(photos, setOf("a1")))
        assertEquals(0, unattachedCount(photos, setOf("a1", "a2", "a3")))
    }

    // ---- immichPhotoUrl ----

    @Test
    fun `immichPhotoUrl joins base and asset id, trimming trailing slashes`() {
        assertEquals(
            "http://immich:2283/photos/a1",
            immichPhotoUrl("http://immich:2283/", "a1"),
        )
    }

    @Test
    fun `immichPhotoUrl is null without a base`() {
        assertNull(immichPhotoUrl(null, "a1"))
        assertNull(immichPhotoUrl("  ", "a1"))
    }
}
