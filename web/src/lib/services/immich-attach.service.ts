// Attach Immich photos to journal entries / trips (#13).
//
// Attaching COPIES the display images (thumbnail + preview) from Immich into
// the public-read trip-images bucket and creates ordinary trip_media rows —
// so every existing render path (entry blocks, private page, public page)
// works unchanged, including anonymous visitors. Originals stay in Immich.

import type { ImmichAssetRow } from '$lib/types/immich.types';
import { listMedia, uploadMedia, createMedia } from './trip-media.service';
import { proxyThumbBlob } from './immich.service';

export interface AttachResult {
	added: number;
	failed: number;
	/** Rows created by this call. */
	created: Array<{ id: string; immich_asset_id: string }>;
}

/** The set of Immich asset ids already attached to a trip's media. */
export function attachedAssetIds(
	tripMedia: Array<{ immich_asset_id?: string | null }>
): Set<string> {
	return new Set(tripMedia.map((m) => m.immich_asset_id).filter((id): id is string => !!id));
}

/**
 * Copy the given Immich assets into the trip's media (thumbnail + preview
 * uploads) and create trip_media rows attached to `entryId` (optional).
 * Skips assets already attached to this trip; per-asset failures don't abort
 * the rest.
 */
export async function attachPhotosToEntry(opts: {
	userId: string;
	tripId: string;
	entryId?: string;
	assets: ImmichAssetRow[];
}): Promise<AttachResult> {
	const { userId, tripId, entryId, assets } = opts;

	const existing = attachedAssetIds(await listMedia(tripId));
	const result: AttachResult = { added: 0, failed: 0, created: [] };

	for (const asset of assets) {
		if (existing.has(asset.asset_id)) continue;
		try {
			// oxlint-disable-next-line eslint/no-await-in-loop -- ordered on purpose: bounded proxy/storage load, deterministic failure isolation
			const thumb = await proxyThumbBlob(asset.asset_id, 'thumbnail');
			// oxlint-disable-next-line eslint/no-await-in-loop -- ordered on purpose: bounded proxy/storage load, deterministic failure isolation
			const preview = await proxyThumbBlob(asset.asset_id, 'preview');
			if (!thumb.ok || !preview.ok) {
				result.failed++;
				continue;
			}

			const base = `${userId}/${tripId}/immich-${asset.asset_id}`;
			// oxlint-disable-next-line eslint/no-await-in-loop -- ordered on purpose: bounded proxy/storage load, deterministic failure isolation
			const storagePath = await uploadMedia(
				userId,
				tripId,
				preview.blob,
				`immich-${asset.asset_id}.webp`
			);
			// oxlint-disable-next-line eslint/no-await-in-loop -- ordered on purpose: bounded proxy/storage load, deterministic failure isolation
			const thumbPath = await uploadMedia(
				userId,
				tripId,
				thumb.blob,
				`immich-${asset.asset_id}-thumb.webp`
			);
			void base;

			// oxlint-disable-next-line eslint/no-await-in-loop -- ordered on purpose: bounded proxy/storage load, deterministic failure isolation
			const created = await createMedia({
				trip_id: tripId,
				entry_id: entryId,
				storage_path: storagePath,
				thumbnail_path: thumbPath,
				media_type: 'image',
				taken_at: asset.taken_at,
				exif: {
					latitude: asset.latitude,
					longitude: asset.longitude,
					...(asset.city ? { city: asset.city } : {}),
					...(asset.country ? { country: asset.country } : {})
				},
				source: 'immich',
				immich_asset_id: asset.asset_id,
				user_id: userId
			});

			result.created.push({ id: created.id, immich_asset_id: asset.asset_id });
			result.added++;
		} catch (error) {
			console.error('[immich-attach] failed for asset:', asset.asset_id, error);
			result.failed++;
		}
	}
	return result;
}
