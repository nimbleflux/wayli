package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.FluxbaseResponse
import io.github.nimbleflux.fluxbase.core.FluxbaseException
import io.github.nimbleflux.fluxbase.rpc.FluxbaseRpc
import io.github.nimbleflux.fluxbase.rpc.RpcInvokeResponse
import io.github.nimbleflux.wayli.session.DeviceTokenStore
import io.github.nimbleflux.wayli.session.RefreshGate
import io.github.nimbleflux.wayli.session.SessionArbiter
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.coroutines.test.runTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The phone can hold an upload token the server no longer knows (server-side
 * DB restore) while `isActive` still reports true — every ingest attempt then
 * 401s forever. [DeviceTokenRepository.repairIfOrphaned] must detect the
 * orphan via the server's token list and provision a replacement.
 */
class DeviceTokenRepositoryTest {

    private lateinit var client: FluxbaseClient
    private lateinit var rpc: FluxbaseRpc
    private lateinit var store: DeviceTokenStore
    private lateinit var repo: DeviceTokenRepository

    private fun rows(vararg ids: String) = RpcInvokeResponse(
        result = JsonArray(
            ids.map { id ->
                JsonObject(
                    mapOf(
                        "id" to JsonPrimitive(id),
                        "label" to JsonPrimitive("Device"),
                        "revoked_at" to kotlinx.serialization.json.JsonNull,
                    ),
                )
            },
        ),
    )

    @BeforeTest
    fun setUp() {
        client = mockk(relaxed = true)
        rpc = mockk(relaxed = true)
        every { client.rpc } returns rpc
        store = mockk(relaxed = true)
        repo = DeviceTokenRepository(client, store, SessionArbiter(client, RefreshGate()))
    }

    @Test
    fun `token known to the server is left alone`() = runTest {
        every { store.isActive } returns true
        every { store.tokenId } returns "dt-old"
        coEvery { rpc.invoke(any(), any(), any()) } returns FluxbaseResponse.Success(rows("dt-old"))

        val result = repo.repairIfOrphaned("Test device")

        assertEquals(DeviceTokenRepository.TokenRepair.OK, result)
        coVerify(exactly = 0) { store.clear() }
        coVerify(exactly = 0) { store.save(any(), any(), any()) }
    }

    @Test
    fun `orphaned token is cleared and replaced`() = runTest {
        every { store.isActive } returns true
        every { store.tokenId } returns "dt-old"
        // Server knows a different token only — ours is orphaned.
        coEvery { rpc.invoke(any(), any(), any()) } returnsMany listOf(
            FluxbaseResponse.Success(rows("dt-server")),
            FluxbaseResponse.Success(
                RpcInvokeResponse(result = JsonArray(listOf(JsonObject(mapOf("id" to JsonPrimitive("dt-new")))))),
            ),
        )

        val result = repo.repairIfOrphaned("Test device")

        assertEquals(DeviceTokenRepository.TokenRepair.REPAIRED, result)
        coVerify { store.clear() }
        coVerify { store.save(match { it.startsWith("wayli_dt_") }, "dt-new", any()) }
    }

    @Test
    fun `no local token provisions one directly`() = runTest {
        every { store.isActive } returns false
        coEvery { rpc.invoke(any(), any(), any()) } returns
            FluxbaseResponse.Success(
                RpcInvokeResponse(result = JsonArray(listOf(JsonObject(mapOf("id" to JsonPrimitive("dt-new")))))),
            )

        val result = repo.repairIfOrphaned("Test device")

        assertEquals(DeviceTokenRepository.TokenRepair.REPAIRED, result)
        coVerify(exactly = 0) { rpc.invoke(eq("list-device-tokens"), any(), any()) }
        coVerify { store.save(any(), "dt-new", any()) }
    }

    @Test
    fun `server unreachable means no action and no store changes`() = runTest {
        every { store.isActive } returns true
        every { store.tokenId } returns "dt-old"
        coEvery { rpc.invoke(any(), any(), any()) } throws
            FluxbaseException(status = 503, message = "backend unavailable")

        val result = repo.repairIfOrphaned("Test device")

        assertEquals(DeviceTokenRepository.TokenRepair.OFFLINE, result)
        coVerify(exactly = 0) { store.clear() }
        coVerify(exactly = 0) { store.save(any(), any(), any()) }
    }
}
