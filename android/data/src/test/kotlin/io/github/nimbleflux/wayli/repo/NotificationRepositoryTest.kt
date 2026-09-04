package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseError
import io.github.nimbleflux.fluxbase.createFluxbaseClient
import io.github.nimbleflux.fluxbase.core.FluxbaseException
import io.github.nimbleflux.fluxbase.core.HttpMethod
import io.github.nimbleflux.fluxbase.core.HttpResponse
import io.github.nimbleflux.fluxbase.core.HttpTransport
import io.github.nimbleflux.wayli.db.CacheDao
import io.github.nimbleflux.wayli.db.CacheEntity
import io.github.nimbleflux.wayli.models.Notification
import io.github.nimbleflux.wayli.session.SessionArbiter
import io.mockk.coEvery
import io.mockk.mockk
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer

/**
 * Regression guards for notification read-state: the PATCH responses carry
 * HTTP errors in-band (never throw), so a mark-read that swallows them
 * reports success while the server keeps the row unread — the bug where
 * going back and returning showed the notification unread again. Uses a
 * real client over a scripted transport, so the actual PATCH path is
 * exercised end to end.
 */
class NotificationRepositoryTest {

    private class FakeTransport : HttpTransport {
        val gets = ArrayDeque<HttpResponse>()
        var patchResponse = HttpResponse(body = "", status = 204, headers = emptyMap())
        var patchError: FluxbaseException? = null
        var patchCalls = 0

        override suspend fun request(
            method: HttpMethod,
            path: String,
            body: Any?,
            headers: Map<String, String>,
        ): HttpResponse {
            val response = when (method) {
                HttpMethod.GET ->
                    if (gets.isEmpty()) HttpResponse("[]", 200, emptyMap()) else gets.removeFirst()
                HttpMethod.PATCH -> {
                    patchCalls++
                    patchError?.let { throw it }
                    patchResponse
                }
                else -> HttpResponse("[]", 200, emptyMap())
            }
            // The real transport throws for non-2xx; the query builder folds
            // that into an in-band error. Mirror that here.
            if (response.status >= 400) {
                throw FluxbaseException(status = response.status, message = "HTTP ${response.status}")
            }
            return response
        }

        override suspend fun requestBytes(
            method: HttpMethod,
            path: String,
            headers: Map<String, String>,
        ): ByteArray = ByteArray(0)
    }

    private lateinit var transport: FakeTransport
    private lateinit var repo: NotificationRepository
    private lateinit var cache: CacheStore

    @BeforeTest
    fun setUp() {
        transport = FakeTransport()
        val client = createFluxbaseClient(url = "https://example.com", key = "anon", transport = transport)
        val cacheMap = mutableMapOf<String, String>()
        val dao = mockk<CacheDao> {
            coEvery { payload(any()) } coAnswers { cacheMap[firstArg<String>()] }
            coEvery { upsert(any()) } coAnswers { cacheMap[firstArg<CacheEntity>().key] = firstArg<CacheEntity>().payload }
        }
        cache = CacheStore(dao, SessionArbiter(client))
        repo = NotificationRepository(client, cache)
    }

    private fun unreadJson(): String =
        """[{"id":"n1","user_id":"u1","type":"job","title":"T","read_at":null,"created_at":"2026-09-01T00:00:00Z"}]"""

    @Test
    fun `markRead surfaces a failed PATCH instead of reporting success`() = runTest {
        transport.patchError = FluxbaseException(status = 401, message = "JWT expired")

        val result = repo.markRead("u1", "n1")

        assertTrue(result.isFailure)
        assertEquals(401, (result.exceptionOrNull() as? FluxbaseError)?.status)
    }

    @Test
    fun `markRead mirrors the read state into the serve-stale cache`() = runTest {
        cache.put(
            "notifications:u1",
            listOf(Notification(id = "n1", userId = "u1", type = "job", title = "T", readAt = null)),
            ListSerializer(Notification.serializer()),
        )

        val result = repo.markRead("u1", "n1")

        assertTrue(result.isSuccess)
        val cached = cache.get("notifications:u1", ListSerializer(Notification.serializer()))
        assertNotNull(cached)
        assertNotNull(cached.single().readAt)
    }

    @Test
    fun `markAllRead issues a single bulk update and mirrors the cache`() = runTest {
        cache.put(
            "notifications:u1",
            listOf(
                Notification(id = "n1", userId = "u1", type = "job", title = "A", readAt = null),
                Notification(id = "n2", userId = "u1", type = "job", title = "B", readAt = "2026-09-01T00:00:00Z"),
            ),
            ListSerializer(Notification.serializer()),
        )

        val result = repo.markAllRead("u1")

        assertTrue(result.isSuccess)
        // One UPDATE for all unread rows (read_at IS NULL) — not one PATCH per id.
        assertEquals(1, transport.patchCalls)
        val cached = cache.get("notifications:u1", ListSerializer(Notification.serializer()))!!
        assertNotNull(cached.first { it.id == "n1" }.readAt)
        assertNotNull(cached.first { it.id == "n2" }.readAt)
    }

    @Test
    fun `list serves the cached read row when the refetch fails`() = runTest {
        transport.gets += HttpResponse(body = unreadJson(), status = 200, headers = emptyMap())
        repo.list("u1").getOrThrow()
        repo.markRead("u1", "n1").getOrThrow()
        // Next GET fails (503) — withCache serves the stale cached list.
        transport.gets += HttpResponse(body = "", status = 503, headers = emptyMap())

        val stale = repo.list("u1").getOrThrow().single()

        // The mirrored cache keeps the row read even though the refetch failed.
        assertNotNull(stale.readAt)
    }
}
