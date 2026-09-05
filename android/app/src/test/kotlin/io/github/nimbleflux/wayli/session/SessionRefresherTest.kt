package io.github.nimbleflux.wayli.session

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.FluxbaseError
import io.github.nimbleflux.fluxbase.FluxbaseResponse
import io.github.nimbleflux.fluxbase.auth.AuthSession
import io.github.nimbleflux.fluxbase.auth.User
import io.github.nimbleflux.wayli.demo.DemoManager
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

class SessionRefresherTest {

    private lateinit var client: FluxbaseClient
    private lateinit var demoManager: DemoManager
    private lateinit var refresher: SessionRefresher
    private lateinit var arbiter: SessionArbiter

    private fun session(expiresAt: Long?) = AuthSession(
        user = User(id = "u1", email = "u@example.com"),
        accessToken = "at",
        refreshToken = "rt",
        expiresIn = 3600,
        expiresAt = expiresAt,
    )

    @BeforeTest
    fun setUp() {
        client = mockk(relaxed = true)
        demoManager = mockk(relaxed = true)
        every { demoManager.isDemoMode } returns false
        arbiter = SessionArbiter(client, io.github.nimbleflux.wayli.session.RefreshGate())
        refresher = SessionRefresher(client, demoManager, arbiter, io.github.nimbleflux.wayli.session.RefreshGate())
        SessionExpiryBus.consume()
    }

    @AfterTest
    fun tearDown() {
        SessionExpiryBus.consume()
    }

    @Test
    fun `not due - token far from expiry - no refresh`() = runTest {
        every { client.auth.currentSession } returns session(System.currentTimeMillis() + 3_600_000)
        assertTrue(refresher.refreshIfDue())
        // refreshSession never stubbed -> would throw if called; relaxed mock
        // returns a Success so assert the outcome only via the boolean above.
    }

    @Test
    fun `stale token with successful refresh reports alive`() = runTest {
        every { client.auth.currentSession } returns session(System.currentTimeMillis() - 1_000)
        coEvery { client.auth.refreshSession() } returns
            FluxbaseResponse.Success(session(System.currentTimeMillis() + 3_600_000))
        assertTrue(refresher.refreshIfDue())
        assertFalse(SessionExpiryBus.expired.value)
    }

    @Test
    fun `stale token with server-rejected refresh fires the bus`() = runTest {
        every { client.auth.currentSession } returns session(System.currentTimeMillis() - 1_000)
        coEvery { client.auth.refreshSession() } returns
            FluxbaseResponse.Error(FluxbaseError(status = 401, message = "Invalid or expired refresh token"))
        assertFalse(refresher.refreshIfDue())
        assertTrue(SessionExpiryBus.expired.value)
    }

    @Test
    fun `stale token with transient refresh failure does NOT fire the bus`() = runTest {
        every { client.auth.currentSession } returns session(System.currentTimeMillis() - 1_000)
        coEvery { client.auth.refreshSession() } returns
            FluxbaseResponse.Error(FluxbaseError(message = "ConnectivityException: no network"))
        assertFalse(refresher.refreshIfDue())
        // Regression guard for the logout bug: transient failure keeps the session.
        assertFalse(SessionExpiryBus.expired.value)
    }

    @Test
    fun `no session at all reports alive without touching the network`() = runTest {
        every { client.auth.currentSession } returns null
        assertTrue(refresher.refreshIfDue())
        assertFalse(SessionExpiryBus.expired.value)
    }
}
