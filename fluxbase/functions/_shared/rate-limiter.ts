/**
 * Simple in-memory rate limiter for edge functions
 * Works with Deno runtime
 */

interface RateLimitEntry {
	count: number;
	resetTime: number;
}

interface RateLimitConfig {
	windowMs: number; // Time window in milliseconds
	maxRequests: number; // Maximum requests per window
	message?: string;
}

class RateLimiter {
	private store = new Map<string, RateLimitEntry>();

	/**
	 * Check if a request should be rate limited
	 * @param key - Unique identifier for the rate limit (e.g., user ID, IP address)
	 * @param config - Rate limit configuration
	 * @returns true if allowed, false if rate limited
	 */
	checkRateLimit(
		key: string,
		config: RateLimitConfig
	): { allowed: true } | { allowed: false; retryAfter: number; message: string } {
		const now = Date.now();
		const entry = this.store.get(key);

		if (!entry || now > entry.resetTime) {
			// First request or window expired
			this.store.set(key, {
				count: 1,
				resetTime: now + config.windowMs
			});
			return { allowed: true };
		}

		if (entry.count >= config.maxRequests) {
			// Rate limit exceeded
			return {
				allowed: false,
				retryAfter: Math.ceil((entry.resetTime - now) / 1000),
				message: config.message || 'Rate limit exceeded'
			};
		}

		// Increment count
		entry.count++;
		return { allowed: true };
	}

	/**
	 * Clean up expired entries (should be called periodically)
	 */
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.store.entries()) {
			if (now > entry.resetTime) {
				this.store.delete(key);
			}
		}
	}
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Clean up expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
	setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
}
