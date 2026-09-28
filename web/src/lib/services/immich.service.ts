// Immich photo query + thumbnail service (#13).
//
// Photos come from the local `immich_assets` sync table (RLS scopes all
// queries to the current user). Thumbnails are fetched through the
// `immich-thumb` edge function with the session auth header and turned into
// object URLs — the function URL with a token is never handed to <img>.

import { fluxbase } from '$lib/fluxbase';
import type { ImmichAssetRow } from '$lib/types/immich.types';

const THUMB_FUNCTION = 'functions/immich-thumb';

/** Geotagged photos taken within [startISO, endISO), oldest first. */
export async function loadPhotosForRange(
	startISO: string,
	endISO: string
): Promise<ImmichAssetRow[]> {
	const { data, error } = await fluxbase
		.from('immich_assets')
		.select('*')
		.gte('taken_at', startISO)
		.lt('taken_at', endISO)
		.order('taken_at');
	if (error) {
		console.error('[immich] photo range query failed:', error.message);
		return [];
	}
	return (data ?? []) as ImmichAssetRow[];
}

// object-URL cache: assetId → URL. one fetch per asset per session.
const thumbCache = new Map<string, string>();

function functionBaseUrl(): string {
	// Same origin as the fluxbase client; the functions live under /functions/.
	const base = import.meta.env.VITE_FLUXBASE_URL ?? import.meta.env.PUBLIC_FLUXBASE_URL ?? '';
	return String(base).replace(/\/+$/, '');
}

/**
 * Resolve a thumbnail object URL for an asset, cached across calls.
 * Returns null when the proxy fails (Immich down, asset gone, not authorized).
 */
export async function getThumbUrl(
	assetId: string,
	size: 'thumbnail' | 'preview' = 'thumbnail'
): Promise<string | null> {
	const cached = thumbCache.get(`${assetId}:${size}`);
	if (cached) return cached;

	try {
		const {
			data: { session }
		} = await fluxbase.auth.getSession();
		const token = session?.access_token;
		if (!token) return null;

		const response = await fetch(
			`${functionBaseUrl()}/${THUMB_FUNCTION}?assetId=${encodeURIComponent(assetId)}&size=${size}`,
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		if (!response.ok) return null;

		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		thumbCache.set(`${assetId}:${size}`, url);
		return url;
	} catch {
		return null;
	}
}

/** Revoke all cached object URLs (call on page teardown). */
export function clearThumbCache(): void {
	for (const url of thumbCache.values()) URL.revokeObjectURL(url);
	thumbCache.clear();
}
