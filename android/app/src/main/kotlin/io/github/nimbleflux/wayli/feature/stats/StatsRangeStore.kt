package io.github.nimbleflux.wayli.feature.stats

import io.github.nimbleflux.wayli.designsystem.DateRange
import io.github.nimbleflux.wayli.designsystem.dateRangePresets
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The app-wide stats period, shared by Home and Statistics so navigating
 * between them keeps the selected date range. Session-scoped (not persisted),
 * defaulting to the 7-day preset (#247).
 */
@Singleton
class StatsRangeStore @Inject constructor() {

    private val _range = MutableStateFlow<DateRange>(dateRangePresets[0]) // 7d
    val range: StateFlow<DateRange> = _range.asStateFlow()

    fun set(range: DateRange) {
        _range.value = range
    }
}
