package io.github.nimbleflux.wayli.session

/**
 * Recognizes "the session is dead" errors — a 401 that already survived the
 * SDK's automatic refresh+retry, or the server's "Invalid or expired token"
 * wording. Shared by the cache layer, the RPC retry wrapper and Home's
 * fallback check so every screen reacts the same way: fire
 * [SessionExpiryBus] and let the nav host route to sign-in.
 */
fun isSessionDeadError(error: Throwable?): Boolean {
    val status = (error as? io.github.nimbleflux.fluxbase.FluxbaseError)?.status
        ?: (error as? io.github.nimbleflux.fluxbase.core.FluxbaseException)?.status
    if (status == 401) return true
    val message = error?.message ?: return false
    return message.contains("expired token", ignoreCase = true) ||
        message.contains("invalid token", ignoreCase = true) ||
        // The auth endpoint's exact refresh-failure wording.
        message.contains("invalid or expired refresh token", ignoreCase = true)
}

/** True when the server's auth_refresh rate limiter answered with 429. */
fun isRateLimitedError(error: Throwable?): Boolean {
    val status = (error as? io.github.nimbleflux.fluxbase.FluxbaseError)?.status
        ?: (error as? io.github.nimbleflux.fluxbase.core.FluxbaseException)?.status
    return status == 429
}
