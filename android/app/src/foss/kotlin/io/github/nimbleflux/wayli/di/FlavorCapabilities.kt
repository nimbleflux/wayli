package io.github.nimbleflux.wayli.di

/**
 * foss flavor: no Play Services — activity recognition is unavailable, and
 * stationary pause has no wake-up mechanism (the noop resume trigger can't
 * fire), so pausing would never resume.
 */
object FlavorCapabilities {
    const val requestsActivityRecognition = false
    const val supportsStationaryResume = false
}
