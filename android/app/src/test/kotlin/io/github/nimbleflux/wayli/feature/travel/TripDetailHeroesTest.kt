package io.github.nimbleflux.wayli.feature.travel

import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.models.TripMedia
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Pure hero-resolution helpers on the trip detail page. */
class TripDetailHeroesTest {

    private fun entry(coverMediaId: String? = null) = TripEntry(
        id = "e1",
        tripId = "t1",
        entryDate = "2026-09-05",
        coverMediaId = coverMediaId,
    )

    private fun media(id: String, entryId: String?) = TripMedia(
        id = id,
        tripId = "t1",
        entryId = entryId,
    )

    private fun trip(imageUrl: String? = null) = Trip(
        id = "t1",
        userId = "u1",
        title = "Trip",
        startDate = "2026-09-05",
        imageUrl = imageUrl,
    )

    // ---- entryHeroUrl ----

    @Test
    fun `entryHeroUrl resolves the cover media over the first row`() {
        val rows = listOf(media("m1", "e1"), media("m2", "e1"))
        val urls = mapOf("m1" to "u1", "m2" to "u2")
        assertEquals("u2", entryHeroUrl(entry(coverMediaId = "m2"), rows, urls))
        assertEquals("u1", entryHeroUrl(entry(), rows, urls))
    }

    @Test
    fun `entryHeroUrl ignores other entries' media`() {
        val rows = listOf(media("m1", "other-entry"))
        assertNull(entryHeroUrl(entry(), rows, mapOf("m1" to "u1")))
    }

    @Test
    fun `entryHeroUrl is null while the URL has not resolved`() {
        val rows = listOf(media("m1", "e1"))
        assertNull(entryHeroUrl(entry(), rows, emptyMap()))
    }

    // ---- tripCoverUrl ----

    @Test
    fun `tripCoverUrl prefers the trip image_url over media`() {
        val rows = listOf(media("m1", null))
        val urls = mapOf("m1" to "u1")
        assertEquals("hero.jpg", tripCoverUrl(trip(imageUrl = "hero.jpg"), rows, urls))
        assertEquals("u1", tripCoverUrl(trip(), rows, urls))
    }

    @Test
    fun `tripCoverUrl is null without image_url or media`() {
        assertNull(tripCoverUrl(trip(), emptyList(), emptyMap()))
    }
}
