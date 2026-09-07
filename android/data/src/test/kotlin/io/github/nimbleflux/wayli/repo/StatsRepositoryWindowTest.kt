package io.github.nimbleflux.wayli.repo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sampling-window arithmetic for range point fetches. The invariant that
 * matters: whatever the range size, the windows' union is a uniformly-spread
 * sample that always includes both the oldest and the newest rows — capping
 * at the newest N made every wide range render the same trailing week.
 */
class StatsRepositoryWindowTest {

    @Test fun emptyAndSmallRangesAreOneWindow() {
        assertEquals(emptyList<Int>(), StatsRepository.windowOffsets(0))
        assertEquals(listOf(0), StatsRepository.windowOffsets(1))
        assertEquals(listOf(0), StatsRepository.windowOffsets(1000))
    }

    @Test fun justOverOnePageSpawnsTwo() {
        assertEquals(listOf(0, 500), StatsRepository.windowOffsets(1500))
    }

    @Test fun multiWindowSpreadsUniformly() {
        // 2580 rows → 3 windows of 1000 covering [0..999], [790..1789], [1580..2579].
        assertEquals(listOf(0, 790, 1580), StatsRepository.windowOffsets(2580))
    }

    @Test fun oversizedRangesCapWindowsAndPinNewest() {
        val offsets = StatsRepository.windowOffsets(70_301)
        assertEquals(20, offsets.size)
        assertEquals(0, offsets.first())
        // Last window pinned so the newest rows are never dropped by drift.
        assertEquals(70_301 - 1000, offsets.last())
        // Strictly increasing, evenly-ish spaced.
        assertTrue(offsets.zipWithNext().all { (a, b) -> b > a })
    }

    @Test fun unionCoversWholeRangeBelowTheCap() {
        // For total ≤ MAX_SAMPLED_ROWS neighbouring windows overlap or touch,
        // so no row is invisible to the sample.
        for (total in listOf(1001L, 2000L, 2580L, 19_999L, 20_000L)) {
            val offsets = StatsRepository.windowOffsets(total)
            var covered = 0L
            offsets.sorted().forEach { off ->
                val start = off.toLong().coerceAtMost(covered)
                covered = start + 1000
            }
            assertTrue("total=$total covered=$covered", covered >= total.coerceAtMost(20_000))
        }
    }
}
