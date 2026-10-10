// Mirrors fluxbase/jobs/_shared/services/external/immich.service.ts.
// The functions and jobs trees bundle from separate roots — cross-tree
// imports fail at sync time, so shared Immich clients are vendored per tree.
// Update both together.
// Vendored per tree (cross-tree imports fail at sync): outbound fetch guard.
import { assertNotMetadataTarget } from './outbound-guard.ts';

// Immich API client for the photo integration (#13).
//
// Auth is via the `x-api-key` header (API keys created in Immich Account
// Settings). Required key permissions: user.read (test connection),
// asset.read (metadata sync), asset.view (thumbnails).
//
// Error discipline: error messages returned to callers are sanitized —
// Immich response bodies may echo request details, so bodies are discarded
// and replaced with generic status-based messages. The API key is sent only
// in the header, never in URLs, and never included in returned errors.

export interface ImmichAsset {
	id: string;
	lat: number;
	lon: number;
	takenAt: string;
	city?: string;
	state?: string;
	country?: string;
}

export type ImmichErrorKind = 'auth' | 'permission' | 'network' | 'other';

export interface ImmichResult<T> {
	ok: boolean;
	data?: T;
	error?: string;
	errorKind?: ImmichErrorKind;
}

const TIMEOUT_MS = 10_000;

/**
 * One-time public-address validation per resolved Immich base (see
 * outbound-guard). Throws on private/unresolvable hosts.
 */
const validatedBases = new Set<string>();
async function assertPublicImmichBase(base: string): Promise<void> {
	if (validatedBases.has(base)) return;
	await assertNotMetadataTarget(base);
	validatedBases.add(base);
}

/** Normalize a base URL; null when neither the user URL nor the default is usable. */
export function resolveImmichBase(userUrl: string | undefined | null, serverDefault: string | null | undefined): string | null {
	for (const candidate of [userUrl, serverDefault]) {
		if (!candidate) continue;
		const trimmed = candidate.trim().replace(/\/+$/, '');
		if (trimmed && /^https?:\/\//.test(trimmed)) return trimmed;
	}
	return null;
}

function classify(status: number): ImmichErrorKind {
	if (status === 401) return 'auth';
	if (status === 403) return 'permission';
	return 'other';
}

function statusMessage(status: number): string {
	if (status === 401) return 'Immich rejected the API key (401).';
	if (status === 403) return 'The API key is missing a required permission (403). Needs asset.read, asset.view and user.read.';
	return `Immich request failed with status ${status}.`;
}

async function immichFetch(
	base: string,
	path: string,
	apiKey: string,
	init?: Record<string, unknown>
): Promise<{ ok: true; response: Response } | { ok: false; error: string; errorKind: ImmichErrorKind }> {
	// The base URL comes from user preferences — validate that it resolves to
	// public addresses before anything is fetched from it. Cached per base.
	await assertPublicImmichBase(base);
	try {
		const response = (await fetch(`${base}${path}`, {
			...init,
			headers: {
				'x-api-key': apiKey,
				Accept: 'application/json',
				...(init?.headers as Record<string, string> | undefined)
			},
			signal: AbortSignal.timeout(TIMEOUT_MS)
		})) as Response;
		if (!response.ok) {
			// Error discipline (see header): upstream bodies are never echoed to
			// callers — the fetch target comes from user preferences, and body
			// snippets can carry internal response content. Status-based messages
			// are enough to diagnose (401 key rejected, 403 permissions, …).
			return { ok: false, error: statusMessage(response.status), errorKind: classify(response.status) };
		}
		return { ok: true, response };
	} catch (error) {
		// Network/DNS/timeout — generic message, never any request material.
		const detail = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'is unreachable';
		return { ok: false, error: `The Immich instance ${detail}.`, errorKind: 'network' };
	}
}

/**
 * Fetch geotagged assets via POST /api/search/metadata (withExif), following
 * pagination until exhausted. Assets without valid GPS or takenAt are
 * filtered out — they cannot be plotted.
 */
export async function fetchGeotaggedAssets(
	base: string,
	apiKey: string,
	opts: { takenAfter?: string; takenBefore?: string; pageSize?: number; maxPages?: number } = {}
): Promise<{ ok: true; assets: ImmichAsset[] } | { ok: false; assets: ImmichAsset[]; error: string; errorKind: ImmichErrorKind }> {
	const assets: ImmichAsset[] = [];
	let page = 1;
	const maxPages = opts.maxPages ?? 1000;
	for (let guard = 0; guard < maxPages; guard++) {
		// Everything in the JSON body. Immich's POST /search/metadata reads
		// the body ONLY — the controller route has no @Query decorators, so
		// query-string pagination is silently ignored (every page comes back
		// as page 1). page/size must be real JSON numbers: the runtime's
		// outgoing fetch passes bodies through byte-identical (verified
		// against Fluxbase 2026.9.10 with an echo probe), so Immich's Zod
		// schema sees the types it expects.
		const res = await immichFetch(
			base,
			'/api/search/metadata',
			apiKey,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					page,
					size: opts.pageSize ?? 250,
					withExif: true,
					...(opts.takenAfter ? { takenAfter: opts.takenAfter } : {}),
					...(opts.takenBefore ? { takenBefore: opts.takenBefore } : {})
				})
			}
		);
		if (!res.ok) return { ok: false, assets, error: res.error, errorKind: res.errorKind };

		let payload: any;
		try {
			payload = await res.response.json();
		} catch {
			return { ok: false, assets, error: 'Immich returned an unreadable response.', errorKind: 'other' };
		}
		const items: any[] = payload?.assets?.items ?? [];
		for (const item of items) {
			const lat = item?.exifInfo?.latitude;
			const lon = item?.exifInfo?.longitude;
			const takenAt = item?.exifInfo?.dateTimeOriginal;
			if (typeof lat !== 'number' || typeof lon !== 'number') continue;
			if (!takenAt || typeof item.id !== 'string') continue;
			assets.push({
				id: item.id,
				lat,
				lon,
				takenAt,
				city: item.exifInfo.city ?? undefined,
				state: item.exifInfo.state ?? undefined,
				country: item.exifInfo.country ?? undefined
			});
		}
		const nextPage = payload?.assets?.nextPage;
		if (!nextPage) break;
		page = Number(nextPage) || page + 1;
	}
	return { ok: true, assets };
}

/** GET /api/users/me — connection check. Requires the user.read permission. */
export async function testConnection(
	base: string,
	apiKey: string
): Promise<{ ok: true; user: string } | { ok: false; error: string; errorKind: ImmichErrorKind }> {
	const res = await immichFetch(base, '/api/users/me', apiKey);
	if (!res.ok) return { ok: false, error: res.error, errorKind: res.errorKind };
	try {
		const me = await res.response.json();
		return { ok: true, user: String(me?.name || me?.email || 'user') };
	} catch {
		return { ok: true, user: 'user' };
	}
}

/**
 * GET /api/assets/{id}/thumbnail — raw image Response for streaming.
 * Requires the asset.view permission.
 */
export async function fetchThumbnail(
	base: string,
	apiKey: string,
	assetId: string,
	size: 'thumbnail' | 'preview' = 'thumbnail'
): Promise<{ ok: true; response: Response } | { ok: false; error: string; errorKind: ImmichErrorKind }> {
	return immichFetch(base, `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`, apiKey);
}
