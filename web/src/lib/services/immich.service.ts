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
export type ThumbRow = ImmichAssetRow;

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

/**
 * LIVE query against the user's Immich library via the immich-search
 * function (server-side API key — never client-side). Returns the same row
 * shape as immich_assets so consumers are format-agnostic. Empty array on
 * any failure — callers fall back to the local table.
 *
 * Uses fluxbase.functions.invoke (same as snap-track etc.) — the SDK handles
 * auth, URL construction, and the namespace. Raw fetch with a manually
 * built URL silently no-ops in production (env vars not set, no session
 * extraction).
 */
export async function searchPhotosLive(
	startISO: string,
	endISO: string
): Promise<ImmichAssetRow[]> {
	try {
		const { data, error } = await fluxbase.functions.invoke('immich-search', {
			method: 'POST',
			body: { takenAfter: startISO, takenBefore: endISO },
			namespace: 'wayli'
		});
		if (error) return [];

		// Functions may wrap the payload ({ success, data }) — unwrap defensively.
		const result = ((data as any)?.data ?? data) as {
			ok: boolean;
			assets?: ImmichAssetRow[];
		} | null;
		if (!result?.ok || !Array.isArray(result.assets)) return [];
		return result.assets;
	} catch {
		return [];
	}
}

// object-URL cache: assetId → URL. one fetch per asset per session.
const thumbCache = new Map<string, string>();

function functionBaseUrl(): string {
	// Same origin as the fluxbase client; the functions live under /functions/.
	const base = import.meta.env.VITE_FLUXBASE_URL ?? import.meta.env.PUBLIC_FLUXBASE_URL ?? '';
	return String(base).replace(/\/+$/, '');
}

/**
 * Fetch a thumbnail/preview blob through the authenticated immich-thumb
 * proxy. Returns { ok: false } when the proxy fails (Immich down, asset gone,
 * not authorized) — never throws.
 */
export async function proxyThumbBlob(
	assetId: string,
	size: 'thumbnail' | 'preview' = 'thumbnail'
): Promise<{ ok: true; blob: Blob } | { ok: false; blob: null }> {
	try {
		const { data } = await fluxbase.auth.getSession();
		const token = data?.session?.access_token;
		if (!token) return { ok: false, blob: null };

		const response = await fetch(
			`${functionBaseUrl()}/${THUMB_FUNCTION}?assetId=${encodeURIComponent(assetId)}&size=${size}`,
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		if (!response.ok) return { ok: false, blob: null };

		const blob = await response.blob();
		return { ok: true, blob };
	} catch {
		return { ok: false, blob: null };
	}
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

	const result = await proxyThumbBlob(assetId, size);
	if (!result.ok) return null;

	const url = URL.createObjectURL(result.blob);
	thumbCache.set(`${assetId}:${size}`, url);
	return url;
}

/** Revoke all cached object URLs (call on page teardown). */
export function clearThumbCache(): void {
	for (const url of thumbCache.values()) URL.revokeObjectURL(url);
	thumbCache.clear();
}
