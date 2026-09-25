package io.github.nimbleflux.wayli.tracking

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The upload drop-budget rules hinge entirely on [ingestDisposition]: only a
 * definitive server rejection (400/404) may spend a batch's attempts —
 * outages, 5xx/429 and token rejections must strand points, not drop them.
 */
class IngestDispositionTest {

    @Test
    fun `2xx is accepted`() {
        assertEquals(IngestDisposition.ACCEPTED, ingestDisposition(200))
        assertEquals(IngestDisposition.ACCEPTED, ingestDisposition(204))
    }

    @Test
    fun `missing status is transient`() {
        // The request never reached the server (offline / captive portal).
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(null))
    }

    @Test
    fun `5xx and 429 are transient - no drop budget spend`() {
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(500))
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(502))
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(503))
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(429))
    }

    @Test
    fun `401 and 403 reset the token without dropping the batch`() {
        assertEquals(IngestDisposition.RETRY_AFTER_TOKEN_RESET, ingestDisposition(401))
        assertEquals(IngestDisposition.RETRY_AFTER_TOKEN_RESET, ingestDisposition(403))
    }

    @Test
    fun `400 and 404 are definitive rejections`() {
        assertEquals(IngestDisposition.REJECTED, ingestDisposition(400))
        assertEquals(IngestDisposition.REJECTED, ingestDisposition(404))
    }

    @Test
    fun `unusual statuses fail transient rather than dropping points`() {
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(301))
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(418))
        assertEquals(IngestDisposition.RETRY_TRANSIENT, ingestDisposition(504))
    }
}
