package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.FluxbaseError
import io.github.nimbleflux.fluxbase.FluxbaseResponse
import io.github.nimbleflux.fluxbase.core.FluxbaseException
import io.github.nimbleflux.fluxbase.core.FluxbaseHttpClient
import io.github.nimbleflux.fluxbase.core.HttpResponse
import io.github.nimbleflux.wayli.db.CacheDao
import io.github.nimbleflux.wayli.db.CacheEntity
import io.github.nimbleflux.wayli.models.Trip
import io.github.nimbleflux.wayli.models.TripEntry
import io.github.nimbleflux.wayli.session.SessionArbiter
import io.github.nimbleflux.wayli.session.SessionExpiryBus
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer

/**
 * Regression guards for [TripRepository.getTrip]'s error handling: an
 * auth-shaped failure must propagate as-is so [CacheStore.withCache] can
 * adjudicate a dead session (masked as "Trip not found" it never reached the
 * arbiter), while a genuinely missing row must still read as "Trip not found"
 * without triggering adjudication.
 */
class TripRepositoryTest {

    private lateinit var client: FluxbaseClient
    private lateinit var http: FluxbaseHttpClient
    private lateinit var repo: TripRepository
    private lateinit var cache: CacheStore

    @BeforeTest
    fun setUp() {
        client = mockk(relaxed = true)
        http = mockk()
        every { client.http } returns http
        // In-memory CacheDao: puts land in the map, reads answer from it (a
        // null-returning stub could never serve the stale cache).
        val cacheMap = mutableMapOf<String, String>()
        val dao = mockk<CacheDao> {
            coEvery { payload(any()) } coAnswers { cacheMap[firstArg<String>()] }
            coEvery { upsert(any()) } coAnswers { cacheMap[firstArg<CacheEntity>().key] = firstArg<CacheEntity>().payload }
        }
        cache = CacheStore(dao, SessionArbiter(client, io.github.nimbleflux.wayli.session.RefreshGate()))
        repo = TripRepository(client, cache, SessionArbiter(client, io.github.nimbleflux.wayli.session.RefreshGate()))
        SessionExpiryBus.consume()
    }

    @AfterTest
    fun tearDown() {
        SessionExpiryBus.consume()
    }

    @Test
    fun `getTrip propagates a 401 so the dead session is adjudicated`() = runTest {
        coEvery { http.getWithHeaders(any()) } throws
            FluxbaseException(status = 401, message = "JWT expired")
        coEvery { client.auth.refreshSession() } returns
            FluxbaseResponse.Error(FluxbaseError(status = 401, message = "Invalid or expired refresh token"))

        val result = repo.getTrip("t1")

        assertTrue(result.isFailure)
        assertEquals(401, (result.exceptionOrNull() as? FluxbaseError)?.status)
        // The masked "Trip not found" was never auth-shaped, so the arbiter
        // was skipped and the bus never fired — the zombie-session bug.
        assertTrue(SessionExpiryBus.expired.value)
    }

    @Test
    fun `getTrip maps a missing row to Trip not found without adjudicating`() = runTest {
        // Blank body → zero rows → single() answers PGRST116 "No rows found".
        coEvery { http.getWithHeaders(any()) } returns
            HttpResponse(body = "", status = 200, headers = emptyMap())
        coEvery { client.auth.refreshSession() } answers { error("must not adjudicate a missing row") }

        val result = repo.getTrip("missing")

        assertTrue(result.isFailure)
        assertEquals("Trip not found", result.exceptionOrNull()?.message)
        assertFalse(SessionExpiryBus.expired.value)
    }

    @Test
    fun `getTrip serves the stale cache on a transient failure`() = runTest {
        // The real HTTP layer surfaces a non-2xx as a thrown exception; the
        // QueryBuilder folds it into the response error. First read succeeds
        // (primes the cache), second fails with a non-auth 503.
        var calls = 0
        coEvery { http.getWithHeaders(any()) } coAnswers {
            calls++
            if (calls == 1) {
                HttpResponse(
                    body = """[{"id":"t1","user_id":"u1","title":"Cached","start_date":"2026-01-01"}]""",
                    status = 200,
                    headers = emptyMap(),
                )
            } else {
                throw FluxbaseException(status = 503, message = "backend unavailable")
            }
        }
        coEvery { client.auth.refreshSession() } answers { error("must not adjudicate a transient failure") }
        repo.getTrip("t1").getOrThrow()

        val stale = repo.getTrip("t1")

        // 503 is not auth-shaped: no adjudication, stale cache served.
        assertEquals("Cached", stale.getOrThrow().title)
        assertFalse(SessionExpiryBus.expired.value)
    }

    @Test
    fun `cached accessors serve the stale paint for trip detail`() = runTest {
        // Nothing cached yet (first-ever open).
        assertEquals(null, repo.getTripCached("t1"))
        assertEquals(emptyList(), repo.listEntriesCached("t1"))

        // Prime the cache the same way getTrip/listEntries would.
        val trip = Trip(id = "t1", userId = "u1", title = "Cached", startDate = "2026-01-01")
        val entries = listOf(
            TripEntry(
                id = "e2", tripId = "t1", title = "Older",
                entryDate = "2026-01-02", createdAt = "2026-01-02T10:00:00Z",
            ),
            TripEntry(
                id = "e1", tripId = "t1", title = "Newer",
                entryDate = "2026-01-05", createdAt = "2026-01-05T10:00:00Z",
            ),
        )
        cache.put("trip:t1", trip, Trip.serializer())
        cache.put("entries:t1", entries, ListSerializer(TripEntry.serializer()))

        assertEquals("Cached", repo.getTripCached("t1")?.title)
        // Same newest-first ordering guarantee as listEntries.
        assertEquals(listOf("Newer", "Older"), repo.listEntriesCached("t1").map { it.title })
    }
}
