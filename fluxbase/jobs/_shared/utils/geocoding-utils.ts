// Shared geocoding utilities for Deno runtime

/**
 * Determines if a geocode field indicates the point needs geocoding
 */
export function needsGeocoding(geocode: unknown): boolean {
	if (!geocode) {
		return true; // null or undefined
	}

	if (typeof geocode === 'object' && geocode !== null) {
		const geocodeObj = geocode as Record<string, unknown>;

		// Empty object {}
		if (Object.keys(geocodeObj).length === 0) {
			return true;
		}

		// Check for retryable errors
		if ('error' in geocodeObj && geocodeObj.error) {
			return isRetryableError(geocode);
		}
	}

	// Has valid geocode data
	return false;
}

/**
 * Determines if a geocoding error is retryable
 */
export function isRetryableError(geocode: unknown): boolean {
	if (!geocode || typeof geocode !== 'object' || geocode === null) {
		return false;
	}

	const geocodeObj = geocode as Record<string, unknown>;

	// Check if it has an error
	if (!('error' in geocodeObj) || !geocodeObj.error) {
		return false;
	}

	// If it has a "permanent" flag set to true, it's not retryable
	if ('permanent' in geocodeObj && geocodeObj.permanent === true) {
		return false;
	}

	// If it has a "retryable" flag set to true, it is retryable
	if ('retryable' in geocodeObj && geocodeObj.retryable === true) {
		return true;
	}

	// Check error message to determine if retryable
	const errorMessage = String(geocodeObj.error_message || '');

	// Retryable errors (temporary issues)
	const retryablePatterns = [
		'rate limit',
		'timeout',
		'network',
		'connection',
		'temporary',
		'service unavailable',
		'too many requests',
		'quota exceeded',
		'deadlock',
		'database update error'
	];

	// Non-retryable errors (permanent issues)
	const nonRetryablePatterns = [
		'invalid coordinates',
		'coordinates out of bounds',
		'no results found',
		'address not found',
		'invalid address',
		'unable to geocode',
		'all pelias endpoints failed'
	];

	const lowerError = errorMessage.toLowerCase();

	// Check for non-retryable patterns first
	for (const pattern of nonRetryablePatterns) {
		if (lowerError.includes(pattern)) {
			return false;
		}
	}

	// Check for retryable patterns
	for (const pattern of retryablePatterns) {
		if (lowerError.includes(pattern)) {
			return true;
		}
	}

	// Default: assume non-retryable for unknown errors (more conservative)
	return false;
}

/**
 * Creates a geocode error object for permanent failures
 */
export function createPermanentError(message: string): Record<string, unknown> {
	return {
		error: true,
		error_message: message,
		permanent: true
	};
}

/**
 * Creates a geocode error object for retryable failures
 */
export function createRetryableError(message: string): Record<string, unknown> {
	return {
		error: true,
		error_message: message,
		retryable: true
	};
}

/**
 * Calculate the distance between two points using the Haversine formula
 * @returns Distance in meters
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371e3; // Earth's radius in meters
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δφ = ((lat2 - lat1) * Math.PI) / 180;
	const Δλ = ((lng2 - lng1) * Math.PI) / 180;

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return R * c;
}
