/**
 * Auth error classification, mirroring the Android app's SessionArbiter.
 *
 * Only a definitive rejection from the auth server means the session is
 * really dead. Everything else — being offline, DNS failures, timeouts,
 * rate limits, server errors — is transient: the session must be kept and
 * retried later, otherwise users get logged out every time they open the
 * app without connectivity.
 */

/**
 * Whether an error from an auth call definitively invalidates the session.
 *
 * Transport-level failures surface as plain `Error`s with no `status`
 * (e.g. `TypeError: Failed to fetch` wrapped by the SDK), so the absence
 * of a status is the signal for "network problem, not an auth decision".
 */
export function isDefinitiveAuthError(error: unknown): boolean {
	const status = (error as { status?: unknown } | null)?.status;
	if (typeof status !== 'number') return false;
	return status === 401 || status === 403;
}
