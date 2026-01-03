interface RateLimitConfig {
	windowMs: number; // Time window in milliseconds
	maxRequests: number; // Maximum requests per window
	message?: string;
	statusCode?: number;
}

interface RateLimitEntry {
	count: number;
	resetTime: number;
}

class RateLimitService {
	private store = new Map<string, RateLimitEntry>();
	private cleanupInterval: NodeJS.Timeout | number;

	constructor() {
		// Clean up expired entries every 5 minutes
		this.cleanupInterval = setInterval(
			() => {
				this.cleanup();
			},
			5 * 60 * 1000
		);
	}

	private cleanup() {
		const now = Date.now();
		for (const [key, entry] of this.store.entries()) {
			if (now > entry.resetTime) {
				this.store.delete(key);
			}
		}
	}

	private getClientIdentifier(request: Request): string {
		// Try to get real IP from various headers
		const forwarded = request.headers.get('x-forwarded-for');
		const realIp = request.headers.get('x-real-ip');
		const cfConnectingIp = request.headers.get('cf-connecting-ip');

		let ip = forwarded?.split(',')[0] || realIp || cfConnectingIp;

		// Fallback to a default if no IP is found
		if (!ip) {
			ip = 'unknown';
		}

		return ip;
	}

	checkRateLimit(
		request: Request,
		config: RateLimitConfig
	): { allowed: true } | { allowed: false; retryAfter: number; message: string } {
		const clientId = this.getClientIdentifier(request);
		const key = `${clientId}:${config.windowMs}`;
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
				message: config.message || 'Too many requests'
			};
		}

		// Increment count
		entry.count++;
		return { allowed: true };
	}

	// Specific rate limit configurations
	static readonly AUTH_RATE_LIMIT: RateLimitConfig = {
		windowMs: 15 * 60 * 1000, // 15 minutes
		maxRequests: 5, // 5 attempts per 15 minutes
		message: 'Too many authentication attempts. Please try again later.',
		statusCode: 429
	};

	static readonly API_RATE_LIMIT: RateLimitConfig = {
		windowMs: 60 * 1000, // 1 minute
		maxRequests: 100, // 100 requests per minute
		message: 'API rate limit exceeded. Please try again later.',
		statusCode: 429
	};

	static readonly GEOCODING_RATE_LIMIT: RateLimitConfig = {
		windowMs: 60 * 1000, // 1 minute
		maxRequests: 30, // 30 geocoding requests per minute
		message: 'Geocoding rate limit exceeded. Please try again later.',
		statusCode: 429
	};

	static readonly UPLOAD_RATE_LIMIT: RateLimitConfig = {
		windowMs: 60 * 60 * 1000, // 1 hour
		maxRequests: 10, // 10 uploads per hour
		message: 'Upload rate limit exceeded. Please try again later.',
		statusCode: 429
	};

	static readonly PEXELS_RATE_LIMIT: RateLimitConfig = {
		windowMs: 60 * 60 * 1000, // 1 hour
		maxRequests: 200, // 200 requests per hour (Pexels free tier default)
		message: 'Pexels API rate limit exceeded. Please try again later.',
		statusCode: 429
	};

	/**
	 * Create a custom Pexels rate limit config based on configured limit
	 * @param maxRequestsPerHour - Custom rate limit (0 = unlimited)
	 */
	static createPexelsRateLimit(maxRequestsPerHour: number): RateLimitConfig | null {
		// 0 means unlimited
		if (maxRequestsPerHour === 0) {
			return null;
		}

		return {
			windowMs: 60 * 60 * 1000, // 1 hour
			maxRequests: maxRequestsPerHour,
			message: 'Pexels API rate limit exceeded. Please try again later.',
			statusCode: 429
		};
	}

	destroy() {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.store.clear();
	}
}

// Export singleton instance
export const rateLimitService = new RateLimitService();

// Helper function to create rate-limited API handlers
export function createRateLimitedHandler(
	config: RateLimitConfig,
	handler: (request: Request, context: { request: Request }) => Promise<Response>
) {
	return async (context: { request: Request }) => {
		const { request } = context;

		const rateLimitResult = rateLimitService.checkRateLimit(request, config);

		if (!rateLimitResult.allowed) {
			return new Response(
				JSON.stringify({
					success: false,
					error: {
						message: rateLimitResult.message,
						code: 'RATE_LIMIT_EXCEEDED',
						retryAfter: rateLimitResult.retryAfter
					}
				}),
				{
					status: config.statusCode || 429,
					headers: {
						'Content-Type': 'application/json',
						'Retry-After': rateLimitResult.retryAfter.toString(),
						'X-RateLimit-Limit': config.maxRequests.toString(),
						'X-RateLimit-Remaining': '0',
						'X-RateLimit-Reset': new Date(
							Date.now() + rateLimitResult.retryAfter * 1000
						).toISOString()
					}
				}
			);
		}

		return handler(request, context);
	};
}
