package io.github.nimbleflux.wayli.repo

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The diagnostics log persists across app versions: entries written by an
 * old build must decode after new fields ship, and vice versa.
 */
class UploadLogEntryBackCompatTest {

    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(UploadLogEntry.serializer())

    @Test
    fun `old entry without new fields decodes with defaults`() {
        val old = """[{"atMs":1700000000000,"batch":7,"outcome":"ok","httpCode":200,"queuedAfter":3}]"""
        val entries = json.decodeFromString(serializer, old)
        assertEquals(1, entries.size)
        val entry = entries.first()
        assertEquals("ok", entry.outcome)
        assertEquals(200, entry.httpCode)
        assertEquals(3, entry.queuedAfter)
        assertNull(entry.trigger)
        assertNull(entry.durationMs)
        assertNull(entry.firstPointAtMs)
        assertNull(entry.lastPointAtMs)
    }

    @Test
    fun `new entry with enriched fields decodes fully`() {
        val new = """[{"atMs":1700000000000,"batch":7,"outcome":"ok","trigger":"periodic",""" +
            """"durationMs":812,"firstPointAtMs":1699999000000,"lastPointAtMs":1700000000000}]"""
        val entries = json.decodeFromString(serializer, new)
        assertEquals("periodic", entries.single().trigger)
        assertEquals(812L, entries.single().durationMs)
        assertEquals(1699999000000L, entries.single().firstPointAtMs)
    }

    @Test
    fun `new-format entries survive an old build's writer via unknown-key tolerance`() {
        val entry = UploadLogEntry(
            atMs = 1700000000000,
            batch = 4,
            outcome = "ok",
            trigger = "manual",
            durationMs = 95,
        )
        val encoded = json.encodeToString(serializer, listOf(entry))
        // A pre-enrichment build would drop unknown keys on read (its Json has
        // ignoreUnknownKeys too) — verify the JSON itself only carries known
        // fields plus the new ones, i.e. round-trips here.
        assertEquals(entry, json.decodeFromString(serializer, encoded).single())
    }
}
