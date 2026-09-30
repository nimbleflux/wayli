// Attach Immich photos to journal entries / trips (#13).
//
// Attaching COPIES the display images (thumbnail + preview) from Immich into
// the public-read trip-images bucket and creates ordinary trip_media rows —
// so every existing render path (entry blocks, private page, public page)
// works unchanged, including anonymous visitors. Originals stay in Immich.

import type { ImmichAssetRow } from '$lib/types/immich.types';
import { listMedia, uploadMedia, createMedia } from './trip-media.service';
import { proxyThumbBlob, getThumbBlob } from './immich.service';

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

/** Assets uploaded in parallel — enough to hide latency, not enough to
 * hammer the Fluxbase runtime (each invoke spawns a Deno sandbox) or Immich. */
const ATTACH_CONCURRENCY = 3;

/**
 * Copy the given Immich assets into the trip's media (thumbnail + preview
 * uploads) and create trip_media rows attached to `entryId` (optional).
 * Skips assets already attached to this trip; per-asset failures don't abort
 * the rest. Thumbnails already shown in the picker grid are reused from the
 * session cache instead of a second proxy round trip.
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
	const todo = assets.filter((a) => !existing.has(a.asset_id));

	const attachOne = async (asset: ImmichAssetRow): Promise<void> => {
		try {
			// The picker grid already downloaded the thumbnail — reuse it when
			// the cache is warm (one proxy round trip instead of two).
			// oxlint-disable-next-line eslint/no-await-in-loop -- worker pool: bounded parallelism is the point
			const thumb = await getThumbBlob(asset.asset_id, 'thumbnail');
			// oxlint-disable-next-line eslint/no-await-in-loop -- worker pool: bounded parallelism is the point
			const preview = await proxyThumbBlob(asset.asset_id, 'preview');
			if (!thumb.ok || !preview.ok) {
				result.failed++;
				return;
			}

			// oxlint-disable-next-line eslint/no-await-in-loop -- worker pool: bounded parallelism is the point
			const storagePath = await uploadMedia(
				userId,
				tripId,
				preview.blob,
				`immich-${asset.asset_id}.webp`
			);
			// oxlint-disable-next-line eslint/no-await-in-loop -- worker pool: bounded parallelism is the point
			const thumbPath = await uploadMedia(
				userId,
				tripId,
				thumb.blob,
				`immich-${asset.asset_id}-thumb.webp`
			);

			// oxlint-disable-next-line eslint/no-await-in-loop -- worker pool: bounded parallelism is the point
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
	};

	// Shared-cursor worker pool: a slow asset (30s SDK request timeout) no
	// longer stalls the whole batch behind it.
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < todo.length) {
			const asset = todo[cursor++];
			await attachOne(asset);
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(ATTACH_CONCURRENCY, todo.length)) }, worker)
	);
	return result;
}
