// Shared geocoding utilities for Edge Functions
// File: web/fluxbase/functions/_shared/geocoding-utils.ts (Fluxbase-compatible)

/**
 * Determines if a geocode field indicates the point needs geocoding
 *
 * Points need geocoding if:
 * - geocode is null
 * - geocode is an empty object {}
 * - geocode contains a retryable error
 *
 * Points do NOT need geocoding if:
 * - geocode contains valid data
 * - geocode contains a non-retryable error
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
		'all nominatim endpoints failed'
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
