package io.github.nimbleflux.wayli.repo

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.wayli.db.PendingPointEntity
import io.github.nimbleflux.wayli.db.WayliDatabase
import io.mockk.mockk
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.runner.RunWith

/**
 * Tracking diagnostics counters and upload log live in the generic metadata
 * table (key-value) — verify the counting/day-reset/ring-buffer logic and
 * the queue-derived numbers.
 */
@RunWith(AndroidJUnit4::class)
class TrackingDiagnosticsRepositoryTest {

    private lateinit var db: WayliDatabase
    private lateinit var repo: TrackingDiagnosticsRepository

    @BeforeTest
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, WayliDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = TrackingDiagnosticsRepository(
            db.pendingPointDao(),
            db.metadataDao(),
            mockk<FluxbaseClient>(relaxed = true),
        )
    }

    @AfterTest
    fun tearDown() {
        db.close()
    }

    @Test
    fun `capture and drop counters accumulate`() = runTest {
        repo.onPointsCaptured(3)
        repo.onPointsCaptured(2)
        repo.onPointsDropped(1)

        assertEquals(5, repo.capturedTotal())
        assertEquals(5, repo.capturedToday())
        assertEquals(1, repo.droppedTotal())
    }

    @Test
    fun `upload log keeps only the newest entries in order`() = runTest {
        repeat(25) { i ->
            repo.logUpload(
                UploadLogEntry(atMs = i * 1000L, batch = i, outcome = "ok", httpCode = 200),
            )
        }

        val log = repo.uploadLog()
        assertEquals(20, log.size)
        // Oldest entries were evicted; newest is last.
        assertEquals(5, log.first().batch)
        assertEquals(24, log.last().batch)
    }

    @Test
    fun `queue numbers derive from pending points`() = runTest {
        assertEquals(0, repo.queueCount())
        assertNull(repo.oldestQueuedAtMs())

        db.pendingPointDao().insertAll(
            listOf(
                PendingPointEntity(lat = 1.0, lon = 2.0, recordedAtSec = 100, createdAtMs = 5_000),
                PendingPointEntity(lat = 3.0, lon = 4.0, recordedAtSec = 200, createdAtMs = 1_000),
            ),
        )

        assertEquals(2, repo.queueCount())
        assertEquals(1_000, repo.oldestQueuedAtMs())
        assertTrue(repo.uploadLog().isEmpty())
    }
}
