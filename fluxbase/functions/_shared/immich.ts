// Shared pure validators for the Immich edge functions (#13).
// No I/O — testable in isolation.

export type ThumbSize = 'thumbnail' | 'preview';

export interface ThumbAuthorizationInput {
	adminEnabled: boolean;
	userEnabled: boolean;
	/** The requesting user has this asset in their synced immich_assets. */
	hasAssetRow: boolean;
}

export type ThumbDenial =
	| { allowed: false; status: 403; reason: 'admin-disabled' }
	| { allowed: false; status: 403; reason: 'user-disabled' }
	| { allowed: false; status: 404; reason: 'asset-not-synced' }
	| { allowed: true };

/**
 * Authorize a thumbnail proxy request. The three denial paths are deliberate:
 * the proxy must never serve as a generic gateway to an Immich instance.
 */
export function authorizeThumb(input: ThumbAuthorizationInput): ThumbDenial {
	if (!input.adminEnabled) return { allowed: false, status: 403, reason: 'admin-disabled' };
	if (!input.userEnabled) return { allowed: false, status: 403, reason: 'user-disabled' };
	if (!input.hasAssetRow) return { allowed: false, status: 404, reason: 'asset-not-synced' };
	return { allowed: true };
}

/** Parse/validate the requested thumbnail size; anything else → default. */
export function thumbSize(input: string | null | undefined): ThumbSize {
	return input === 'preview' ? 'preview' : 'thumbnail';
}

/** Cache headers for proxied thumbnails (Immich thumbnails are immutable). */
export const THUMB_CACHE_CONTROL = 'private, max-age=604800, immutable';
