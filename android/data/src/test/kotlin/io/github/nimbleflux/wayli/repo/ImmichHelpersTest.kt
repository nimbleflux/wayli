package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.wayli.models.ImmichAsset
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.models.UserPreferences
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

    // ---- decodeThumbPayload (immich-thumb proxy envelope) ----

    @Test
    fun `decodeThumbPayload decodes ok envelopes with base64 bytes`() {
        val payload = buildJsonObject {
            put("ok", true)
            put("contentType", "image/webp")
            put("base64", java.util.Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3)))
        }
        assertTrue(byteArrayOf(1, 2, 3).contentEquals(decodeThumbPayload(payload)))
    }

    @Test
    fun `decodeThumbPayload rejects non-ok or malformed envelopes`() {
        assertNull(decodeThumbPayload(null))
        assertNull(
            decodeThumbPayload(
                buildJsonObject {
                    put("ok", false)
                    put("base64", "aGVsbG8=")
                },
            ),
        )
        assertNull(decodeThumbPayload(buildJsonObject { put("ok", true) })) // no base64
        assertNull(
            decodeThumbPayload(
                buildJsonObject {
                    put("ok", true)
                    put("base64", "!!!not base64!!!")
                },
            ),
        )
    }

    // ---- entryPhotoRange ----

    private fun entry(date: String, endDate: String? = null) = TripEntry(
        id = "e1",
        tripId = "t1",
        entryDate = date,
        endDate = endDate,
    )

    @Test
    fun `entryPhotoRange covers the entry day in UTC`() {
        val (start, end) = assertNotNull(entryPhotoRange(entry("2026-09-05")))
        assertEquals("2026-09-05T00:00:00Z", start)
        assertEquals("2026-09-06T00:00:00Z", end)
    }

    @Test
    fun `entryPhotoRange spans multi-day entries end to end`() {
        val (start, end) = assertNotNull(entryPhotoRange(entry("2026-09-05", "2026-09-08")))
        assertEquals("2026-09-05T00:00:00Z", start)
        assertEquals("2026-09-09T00:00:00Z", end)
    }

    @Test
    fun `entryPhotoRange is null for an unparseable date and ignores a bad end date`() {
        assertNull(entryPhotoRange(entry("09/05/2026")))
        // Unparseable endDate falls back to the single entry day.
        val (start, end) = assertNotNull(entryPhotoRange(entry("2026-09-05", "soon")))
        assertEquals("2026-09-05T00:00:00Z", start)
        assertEquals("2026-09-06T00:00:00Z", end)
    }

    // ---- hasMorePhotos ----

    private fun page(assets: Int, total: Long?) =
        ImmichPhotoPage(List(assets) { photo("a$it") }, total)

    @Test
    fun `hasMorePhotos uses the server total when known`() {
        assertFalse(hasMorePhotos(page(40, total = 40), limit = 40))
        assertTrue(hasMorePhotos(page(40, total = 41), limit = 40))
        assertTrue(hasMorePhotos(page(10, total = 500), limit = 40))
    }

    @Test
    fun `hasMorePhotos falls back to a full page when the count is unknown`() {
        assertTrue(hasMorePhotos(page(40, total = null), limit = 40))
        assertFalse(hasMorePhotos(page(12, total = null), limit = 40))
    }

    // ---- ByteArrayLruCache ----

    @Test
    fun `byte cache returns stored bytes by key`() {
        val cache = ByteArrayLruCache(maxBytes = 100)
        cache.put("a:thumbnail", byteArrayOf(1))
        assertTrue(byteArrayOf(1).contentEquals(cache.get("a:thumbnail")))
        assertNull(cache.get("missing"))
    }

    @Test
    fun `byte cache evicts least recently used entries over the byte budget`() {
        val cache = ByteArrayLruCache(maxBytes = 10)
        cache.put("a", ByteArray(4)) // 4 bytes
        cache.put("b", ByteArray(4)) // 8 total
        cache.get("a") // touch a — b becomes the LRU entry
        cache.put("c", ByteArray(4)) // 12 > 10 → evict b
        assertNotNull(cache.get("a"))
        assertNull(cache.get("b"))
        assertNotNull(cache.get("c"))
    }

    @Test
    fun `byte cache rejects entries larger than the whole budget`() {
        val cache = ByteArrayLruCache(maxBytes = 4)
        cache.put("huge", ByteArray(8))
        assertNull(cache.get("huge"))
    }
}
