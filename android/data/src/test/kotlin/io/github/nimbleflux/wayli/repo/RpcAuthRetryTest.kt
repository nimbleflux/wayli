package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.FluxbaseError
import io.github.nimbleflux.fluxbase.FluxbaseResponse
import io.github.nimbleflux.fluxbase.auth.AuthSession
import io.github.nimbleflux.fluxbase.auth.User
import io.github.nimbleflux.wayli.session.SessionArbiter
import io.github.nimbleflux.wayli.session.SessionExpiryBus
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RpcAuthRetryTest {

    private lateinit var client: FluxbaseClient
    private lateinit var arbiter: SessionArbiter

    private val authish = FluxbaseError(status = 403, message = "procedure requires authentication")

    private val session = AuthSession(
        user = User(id = "u1", email = "u@example.com"),
        accessToken = "at2",
        refreshToken = "rt2",
        expiresIn = 3600,
    )

    @BeforeTest
    fun setUp() {
        client = mockk(relaxed = true)
        arbiter = SessionArbiter(client, io.github.nimbleflux.wayli.session.RefreshGate())
        SessionExpiryBus.consume()
    }

    @AfterTest
    fun tearDown() {
        SessionExpiryBus.consume()
    }

    @Test
    fun `successful op passes through untouched`() = runTest {
        var calls = 0
        val result = withRpcAuthRetry(client, arbiter) { calls++; Result.success("ok") }
        assertEquals("ok", result.getOrThrow())
        assertEquals(1, calls)
        assertFalse(SessionExpiryBus.expired.value)
    }

    @Test
    fun `non-auth failure passes through without refresh`() = runTest {
        var refreshed = 0
        coEvery { client.auth.refreshSession() } answers { refreshed++; error("must not be called") }
        val result = withRpcAuthRetry<Unit>(client, arbiter) { Result.failure(RuntimeException("boom")) }
        assertTrue(result.isFailure)
        assertEquals(0, refreshed)
    }

    @Test
    fun `403 plus recovered refresh retries the block`() = runTest {
        coEvery { client.auth.refreshSession() } returns FluxbaseResponse.Success(session)
        var calls = 0
        val result = withRpcAuthRetry(client, arbiter) {
            calls++
            if (calls == 1) Result.failure(authish) else Result.success("retried")
        }
        assertEquals("retried", result.getOrThrow())
        assertEquals(2, calls)
        assertFalse(SessionExpiryBus.expired.value)
    }

    @Test
    fun `403 plus server-rejected refresh surfaces the failure and fires the bus`() = runTest {
        coEvery { client.auth.refreshSession() } returns
            FluxbaseResponse.Error(FluxbaseError(status = 401, message = "Invalid or expired refresh token"))
        var calls = 0
        val result = withRpcAuthRetry<Unit>(client, arbiter) { calls++; Result.failure(authish) }
        assertEquals(1, calls)
        assertEquals(authish.message, result.exceptionOrNull()?.message)
        assertTrue(SessionExpiryBus.expired.value)
    }

    @Test
    fun `403 plus transient refresh failure surfaces the failure WITHOUT firing the bus`() = runTest {
        coEvery { client.auth.refreshSession() } returns
            FluxbaseResponse.Error(FluxbaseError(message = "SocketTimeoutException"))
        var calls = 0
        val result = withRpcAuthRetry<Unit>(client, arbiter) { calls++; Result.failure(authish) }
        assertEquals(1, calls)
        assertTrue(result.isFailure)
        // The critical regression guard: a network hiccup during the refresh
        // must not sign the user out.
        assertFalse(SessionExpiryBus.expired.value)
    }
}
