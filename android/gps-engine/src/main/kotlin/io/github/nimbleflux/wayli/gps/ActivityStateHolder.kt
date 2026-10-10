package io.github.nimbleflux.wayli.gps

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Coarse motion state used to adapt tracking. Populated by the gplay flavor's
 * Activity Recognition driver; the foss flavor reports [ActivityKind.UNKNOWN]
 * (adaptive tracking simply becomes a no-op).
 */
enum class ActivityKind { STILL, ON_FOOT, RUNNING, IN_VEHICLE, ON_BIKE, UNKNOWN }

/**
 * Holds the latest activity-recognition state so location providers can
 * stamp points and adapt their request without a direct Play-Services
 * dependency (gps-engine stays GMS-free).
 */
@Singleton
class ActivityStateHolder @Inject constructor() {

    private val _kind = MutableStateFlow(ActivityKind.UNKNOWN)
    val kind: StateFlow<ActivityKind> = _kind.asStateFlow()

    /** Distinct kind changes — for re-subscribe triggers. */
    val kindChanges = _kind.asStateFlow().map { it }.distinctUntilChanged()

    fun update(kind: ActivityKind) {
        _kind.value = kind
    }
}
