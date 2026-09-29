// Shared Immich sync logic — callable from both the authenticated
// immich-sync job and the scheduled-immich-sync admin job (#13).
//
// Keeps a single code path for config resolution, fetching, upserts, and
// watermark advancement. The scheduled job calls this directly with each
// enabled user's id (the Deno job runtime has no auth.admin for the
// onBehalfOf email lookup — that path crashed in production).

import type { FluxbaseClient } from '../../types';
import {
	fetchGeotaggedAssets,
	resolveImmichBase,
	type ImmichAsset
} from './external/immich.service.ts';
import {
	maxTakenAt,
	summarizeSync,
	takenAfterFor,
	toAssetRows
} from './external/immich-sync-core.ts';
import { getAdminSetting } from './immich-settings.ts';

const IMMICH_API_KEY = 'immich_api_key';

export interface SyncUserPayload {
	fullResync?: boolean;
	wipe?: boolean;
}

/**
 * Sync one user's Immich photos into immich_assets.
 * `writeDb` must be a client allowed to write immich_assets/user_preferences
 * rows for `userId` (the user's own client, or an admin/service client).
 */
export async function syncUserImmich(
	writeDb: FluxbaseClient,
	serviceDb: FluxbaseClient,
	userId: string,
	payload: SyncUserPayload,
	reportProgress: (pct: number, msg: string) => void
): Promise<Record<string, unknown>> {
	reportProgress(5, 'Resolving Immich connection...');

	// Disconnect: wipe synced rows and disable (jsonb merge keeps siblings).
	if (payload.wipe) {
		await writeDb.from('immich_assets').delete().eq('user_id', userId);
		const { data: wipeRow } = await serviceDb
			.from('user_preferences')
			.select('preferences')
			.eq('id', userId)
			.maybeSingle();
		const wipePrefs = (wipeRow?.preferences ?? {}) as Record<string, unknown>;
		await serviceDb
			.from('user_preferences')
			.update({
				preferences: { ...wipePrefs, immich: { enabled: false } },
				updated_at: new Date().toISOString()
			})
			.eq('id', userId);
		reportProgress(100, 'Immich disconnected');
		return { success: true, wiped: true };
	}

	// Resolve config (service DB: admin toggle + prefs + secret decryption).
	const { data: prefRow } = await serviceDb
		.from('user_preferences')
		.select('preferences')
		.eq('id', userId)
		.maybeSingle();
	const prefs = (prefRow?.preferences ?? {}) as Record<string, any>;
	const immichPrefs = (prefs.immich ?? {}) as Record<string, any>;
	if (immichPrefs.enabled !== true) {
		return { success: true, synced: 0, skipped: 'immich not enabled for this user' };
	}

	const adminSetting = await getAdminSetting<boolean>(serviceDb, 'wayli.immich_enabled');
	if (adminSetting.error) {
		console.error('immich-sync: admin settings read failed:', adminSetting.error);
		return { success: true, synced: 0, skipped: 'admin settings unreadable' };
	}
	if (adminSetting.value !== true) {
		return { success: true, synced: 0, skipped: 'immich integration disabled by administrator' };
	}

	let apiKey: string;
	try {
		apiKey = await serviceDb.admin.settings.app.getUserSecretValue(userId, IMMICH_API_KEY);
	} catch (secretError) {
		console.warn(
			'immich-sync: could not read the Immich API key:',
			secretError instanceof Error ? secretError.message : 'unknown error'
		);
		return { success: true, synced: 0, skipped: 'no Immich API key configured' };
	}
	if (!apiKey) {
		return { success: true, synced: 0, skipped: 'no Immich API key configured' };
	}

	const endpointSetting = await getAdminSetting<string>(serviceDb, 'wayli.immich_endpoint');
	const base = resolveImmichBase(
		typeof immichPrefs.server_url === 'string' ? immichPrefs.server_url : undefined,
		endpointSetting.value
	);
	if (!base) {
		return { success: true, synced: 0, skipped: 'no Immich server URL configured' };
	}

	// Full resync: replace the user's rows (delete first, no takenAfter filter).
	if (payload.fullResync) {
		await writeDb.from('immich_assets').delete().eq('user_id', userId);
	}

	const takenAfter = payload.fullResync ? undefined : takenAfterFor(immichPrefs.last_sync_at);
	reportProgress(15, 'Fetching geotagged photos from Immich...');

	const result = await fetchGeotaggedAssets(base, apiKey, { takenAfter });
	if (!result.ok) {
		const outcome = summarizeSync(result, result.assets.length);
		reportProgress(100, outcome.permissionError ? 'Permission error' : 'Sync failed');
		return {
			success: outcome.ok,
			synced: outcome.synced,
			permissionError: outcome.permissionError,
			error: outcome.permissionError ? undefined : result.error
		};
	}

	const assets: ImmichAsset[] = result.assets;
	reportProgress(60, `Upserting ${assets.length} photos...`);

	// Upsert in chunks to stay well under statement size limits.
	const rows = toAssetRows(userId, assets);
	for (let i = 0; i < rows.length; i += 500) {
		const { error } = await writeDb
			.from('immich_assets')
			.upsert(rows.slice(i, i + 500), { onConflict: 'user_id,asset_id' });
		if (error) {
			console.error('immich-sync upsert error:', (error as any)?.message);
			return { success: false, error: 'Failed to store synced photo metadata' };
		}
	}

	// Advance the watermark to the newest synced taken_at, clamped to now — a
	// future-dated camera clock would otherwise make every incremental sync
	// silently empty.
	const newest = maxTakenAt(assets);
	const nowIso = new Date().toISOString();
	const watermark =
		newest && Date.parse(newest) <= Date.parse(nowIso)
			? newest
			: immichPrefs.last_sync_at ?? nowIso;
	const mergedPrefs = {
		...(prefs as Record<string, unknown>),
		immich: { ...immichPrefs, last_sync_at: watermark }
	};
	await serviceDb
		.from('user_preferences')
		.update({ preferences: mergedPrefs, updated_at: new Date().toISOString() })
		.eq('id', userId);

	const outcome = summarizeSync(undefined, rows.length);
	reportProgress(100, `Synced ${rows.length} photos`);
	return { success: outcome.ok, synced: outcome.synced, permissionError: outcome.permissionError };
}
