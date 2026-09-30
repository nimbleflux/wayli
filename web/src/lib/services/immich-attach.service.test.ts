import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Immich service (proxy blob fetch) and the trip-media pipeline
// (storage upload + createMedia). The attach pipeline orchestrates them.
const thumbBlobs: Record<string, Blob> = {};
const previewBlobs: Record<string, Blob> = {};

vi.mock('$lib/services/immich.service', () => ({
	// Thumbnails flow through getThumbBlob (cache-first); previews through the
	// proxy. Both resolve to the same test blobs.
	getThumbBlob: vi.fn(async (assetId: string) => {
		const blob = thumbBlobs[assetId];
		return blob ? { ok: true, blob } : { ok: false, blob: null };
	}),
	proxyThumbBlob: vi.fn(async (assetId: string, size: string) => {
		const blob = size === 'preview' ? previewBlobs[assetId] : thumbBlobs[assetId];
		return blob ? { ok: true, blob } : { ok: false, blob: null };
	})
}));

const uploads: Array<{ path: string; size: number }> = [];
const created: any[] = [];
const existingRows: any[] = [];

vi.mock('$lib/services/trip-media.service', () => ({
	uploadMedia: vi.fn(async (_userId: string, _tripId: string, blob: Blob, filename: string) => {
		uploads.push({ path: `${_userId}/${_tripId}/${filename}`, size: blob.size });
		return `${_userId}/${_tripId}/${filename}`;
	}),
	createMedia: vi.fn(async (input: any) => {
		created.push(input);
		return { id: `media-${created.length}`, ...input };
	}),
	listMedia: vi.fn(async () => existingRows)
}));

import { attachPhotosToEntry, attachedAssetIds } from './immich-attach.service';

const ASSETS = [
	{
		asset_id: 'a1',
		latitude: -35,
		longitude: 150,
		taken_at: '2026-09-05T10:00:00Z',
		city: 'Huskisson',
		state: 'NSW',
		country: 'Australia'
	},
	{
		asset_id: 'a2',
		latitude: -35.1,
		longitude: 150.1,
		taken_at: '2026-09-05T15:00:00Z',
		city: null,
		state: null,
		country: null
	}
];

describe('attachPhotosToEntry', () => {
	beforeEach(() => {
		uploads.length = 0;
		created.length = 0;
		existingRows.length = 0;
		thumbBlobs['a1'] = new Blob(['t1'], { type: 'image/webp' });
		previewBlobs['a1'] = new Blob(['p1'], { type: 'image/webp' });
		thumbBlobs['a2'] = new Blob(['t2'], { type: 'image/webp' });
		previewBlobs['a2'] = new Blob(['p2'], { type: 'image/webp' });
	});

	it('uploads thumbnail + preview per photo and creates an immich-sourced row', async () => {
		const result = await attachPhotosToEntry({
			userId: 'u1',
			tripId: 'trip-1',
			entryId: 'entry-1',
			assets: ASSETS
		});
		expect(result.added).toBe(2);
		// two bucket uploads per photo (thumbnail + preview)
		expect(uploads.length).toBe(4);
		// row shape: immich provenance + exif + taken_at
		expect(created[0].source).toBe('immich');
		expect(created[0].immich_asset_id).toBe('a1');
		expect(created[0].entry_id).toBe('entry-1');
		expect(created[0].taken_at).toBe('2026-09-05T10:00:00Z');
		expect(created[0].exif).toMatchObject({ latitude: -35, longitude: 150, city: 'Huskisson' });
	});

	it('skips assets already attached to this trip', async () => {
		existingRows.push({ immich_asset_id: 'a1' });
		const result = await attachPhotosToEntry({
			userId: 'u1',
			tripId: 'trip-1',
			entryId: 'entry-1',
			assets: ASSETS
		});
		expect(result.added).toBe(1);
		expect(created[0].immich_asset_id).toBe('a2');
	});

	it('continues past a failing photo and reports partial success', async () => {
		delete thumbBlobs['a1']; // getThumbBlob/proxy return ok:false for a1
		const result = await attachPhotosToEntry({
			userId: 'u1',
			tripId: 'trip-1',
			entryId: 'entry-1',
			assets: ASSETS
		});
		expect(result.added).toBe(1);
		expect(result.failed).toBe(1);
		expect(created[0].immich_asset_id).toBe('a2');
	});

	it('attaches a larger batch than the concurrency limit', async () => {
		const batch = Array.from({ length: 8 }, (_, i) => ({
			asset_id: `b${i}`,
			latitude: -35,
			longitude: 150,
			taken_at: `2026-09-05T1${i}:00:00Z`
		}));
		for (const a of batch) {
			thumbBlobs[a.asset_id] = new Blob(['t'], { type: 'image/webp' });
			previewBlobs[a.asset_id] = new Blob(['p'], { type: 'image/webp' });
		}
		const result = await attachPhotosToEntry({
			userId: 'u1',
			tripId: 'trip-1',
			assets: batch
		});
		expect(result.added).toBe(8);
		expect(result.failed).toBe(0);
		expect(created.length).toBe(8);
		expect(uploads.length).toBe(16);
	});
});

describe('attachedAssetIds', () => {
	beforeEach(() => {
		existingRows.length = 0;
	});

	it('collects non-null immich_asset_ids from trip media', () => {
		existingRows.push(
			{ immich_asset_id: 'a1' },
			{ immich_asset_id: null },
			{ immich_asset_id: 'b9' }
		);
		expect(attachedAssetIds(existingRows)).toEqual(new Set(['a1', 'b9']));
	});
});
