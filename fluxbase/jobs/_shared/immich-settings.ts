// Mirrors the getAdminSetting helper in fluxbase/functions/_shared/immich.ts.
// The functions and jobs trees bundle from separate roots — shared helpers
// are vendored per tree. Update both together.

// Shared settings + authorization helpers for the Immich edge functions and
// jobs (#13). Server settings live in the `app` schema `settings` table with
// a jsonb wrapper: row.value = { value: <actual> }.

export type ImmichErrorKind = 'auth' | 'permission' | 'network' | 'other' | 'disabled';

/** Thumbnail size variants the immich-thumb proxy accepts. */
export type ThumbSize = 'thumbnail' | 'preview';

export interface AdminSettingResult<T> {
	value: T | null;
	error: string | null;
}

/**
 * Read a server-wide `wayli.*` setting (app schema). Returns the unwrapped
 * value or null; errors are surfaced (never silently ignored).
 */
export async function getAdminSetting<T = unknown>(
	fluxbaseService: {
		schema(schema: string): {
			from(table: string): {
				select(columns: string): {
					eq(column: string, value: unknown): {
						maybeSingle(): Promise<{ data: unknown; error: unknown }>;
					};
				};
			};
		};
	},
	key: string
): Promise<AdminSettingResult<T>> {
	try {
		const { data, error } = await fluxbaseService
			.schema('app')
			.from('settings')
			.select('value')
			.eq('key', key)
			.maybeSingle();
		if (error) {
			return { value: null, error: (error as { message?: string })?.message ?? 'settings read failed' };
		}
		const wrapped = data as { value?: { value?: T } } | null;
		const value = (wrapped?.value?.value ?? null) as T | null;
		return { value, error: null };
	} catch (e) {
		return { value: null, error: e instanceof Error ? e.message : String(e) };
	}
}

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
