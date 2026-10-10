/**
 * Post-login redirect targets may arrive from query params — restrict them to
 * same-origin relative paths so a crafted link can't bounce users elsewhere.
 */

/**
 * Normalize an untrusted redirect target. Returns the default when the value
 * is empty, or not a single-rooted relative path (absolute URLs, protocol
 * relatives, and backslash tricks are rejected).
 */
export function safeRedirectTo(raw: string | null | undefined, fallback: string): string {
	if (!raw) return fallback;
	const value = raw.trim();
	if (!value.startsWith('/')) return fallback;
	if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
	if (value.includes('://') || value.includes('\\')) return fallback;
	return value;
}
