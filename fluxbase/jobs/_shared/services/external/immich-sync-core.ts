// Pure helpers for the immich-sync job (#13). No I/O — the job wires these
// into fluxbase DB calls and the Immich client so the logic stays testable.

import type { ImmichAsset, ImmichErrorKind } from './immich.service.ts';

export interface ImmichAssetRow {
	user_id: string;
	asset_id: string;
	latitude: number;
	longitude: number;
	taken_at: string;
	city: string | null;
	state: string | null;
	country: string | null;
	synced_at: string;
}

/**
 * The `takenAfter` cutoff for an incremental sync: the watermark minus a 24h
 * overlap, so points whose EXIF timestamps arrive late (or drift) are picked
 * up; upserts make the overlap idempotent. No watermark → full sync.
 */
export function takenAfterFor(lastSyncAt: string | undefined | null): string | undefined {
	if (!lastSyncAt) return undefined;
	const t = Date.parse(lastSyncAt);
	if (Number.isNaN(t)) return undefined;
	return new Date(t - 24 * 60 * 60 * 1000).toISOString();
}

/** Map client assets to `immich_assets` rows for the given user. */
export function toAssetRows(userId: string, assets: ImmichAsset[]): ImmichAssetRow[] {
	const syncedAt = new Date().toISOString();
	return assets.map((a) => ({
		user_id: userId,
		asset_id: a.id,
		latitude: a.lat,
		longitude: a.lon,
		taken_at: a.takenAt,
		city: a.city ?? null,
		state: a.state ?? null,
		country: a.country ?? null,
		synced_at: syncedAt
	}));
}

/** Newest takenAt across the synced batch (the next watermark). */
export function maxTakenAt(assets: ImmichAsset[]): string | undefined {
	let max: string | undefined;
	for (const a of assets) {
		if (!max || Date.parse(a.takenAt) > Date.parse(max)) max = a.takenAt;
	}
	return max;
}

export interface SyncOutcome {
	ok: boolean;
	synced: number;
	/** True when Immich rejected the key for missing permissions — the UI shows the three-scope hint. */
	permissionError: boolean;
}

/** Fold a client error (if any) plus a synced count into the job outcome. */
export function summarizeSync(
	error: { error: string; errorKind: ImmichErrorKind } | undefined,
	synced: number
): SyncOutcome {
	if (error?.errorKind === 'permission') {
		return { ok: true, synced: 0, permissionError: true };
	}
	return { ok: true, synced, permissionError: false };
}
