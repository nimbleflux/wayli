import { describe, expect, it } from 'vitest';
import { isDefinitiveAuthError } from './auth-error';

/** Shape of errors thrown by the Fluxbase SDK for HTTP failures. */
function httpError(status: number, message = 'Request failed'): Error {
	const error = new Error(message);
	(error as Error & { status?: number }).status = status;
	return error;
}

describe('isDefinitiveAuthError', () => {
	it('treats 401 as definitive', () => {
		expect(isDefinitiveAuthError(httpError(401))).toBe(true);
	});

	it('treats 403 as definitive', () => {
		expect(isDefinitiveAuthError(httpError(403))).toBe(true);
	});

	it('treats transport failures (no status) as transient', () => {
		// SDK wraps offline fetch TypeErrors as plain Errors without a status
		expect(isDefinitiveAuthError(new Error('Failed to fetch'))).toBe(false);
		expect(isDefinitiveAuthError(new TypeError('NetworkError when attempting to fetch'))).toBe(
			false
		);
	});

	it('treats timeouts, rate limits and server errors as transient', () => {
		expect(isDefinitiveAuthError(httpError(408))).toBe(false);
		expect(isDefinitiveAuthError(httpError(429))).toBe(false);
		expect(isDefinitiveAuthError(httpError(500))).toBe(false);
		expect(isDefinitiveAuthError(httpError(503))).toBe(false);
	});

	it('treats other client errors as transient', () => {
		expect(isDefinitiveAuthError(httpError(400))).toBe(false);
		expect(isDefinitiveAuthError(httpError(422))).toBe(false);
	});

	it('handles null/undefined and non-error values', () => {
		expect(isDefinitiveAuthError(null)).toBe(false);
		expect(isDefinitiveAuthError(undefined)).toBe(false);
		expect(isDefinitiveAuthError('Failed to fetch')).toBe(false);
		expect(isDefinitiveAuthError({ status: '401' })).toBe(false);
	});
});
