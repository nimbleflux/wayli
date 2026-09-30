import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fluxbase table query chain (RLS-scoped select) and global fetch
// (thumbnail blob proxy). Object URLs are created via URL.createObjectURL.
const selectChain = {
	select: vi.fn(() => selectChain),
	gte: vi.fn(() => selectChain),
	lt: vi.fn(() => selectChain),
	order: vi.fn(() => Promise.resolve({ data: [], error: null }))
};

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		from: vi.fn(() => selectChain),
		functions: { invoke: (...args: unknown[]) => invokeMock(...(args as [string, object?])) },
		auth: {
			getSession: vi.fn(() =>
				Promise.resolve({ data: { session: { access_token: 'test-token' } } })
			)
		}
	}
}));

// Thumbnails go through fluxbase.functions.invoke('immich-thumb') so the
// SDK builds the URL against the Fluxbase host (never a same-origin URL).
let bytesByAsset: Record<string, Uint8Array> = {};
const contentTypeByAsset: Record<string, string> = {};
const invokeMock = vi.fn(
	(name: string, options?: { body?: { assetId?: string; size?: string }; namespace?: string }) => {
		if (name !== 'immich-thumb') {
			return Promise.resolve({ data: null, error: new Error(`unexpected fn ${name}`) });
		}
		if (options?.namespace !== 'wayli') {
			return Promise.resolve({ data: null, error: new Error('namespace missing') });
		}
		const assetId = options?.body?.assetId ?? '';
		const bytes = bytesByAsset[assetId];
		if (!bytes) return Promise.reject(new Error('upstream 404'));
		return Promise.resolve({
			data: {
				ok: true,
				contentType: contentTypeByAsset[assetId] ?? 'image/webp',
				base64: Buffer.from(bytes).toString('base64')
			},
			error: null
		});
	}
);
const objectUrls: string[] = [];
vi.stubGlobal('URL', {
	...URL,
	createObjectURL: vi.fn((blob: Blob) => {
		const url = `blob:mock-${objectUrls.length}`;
		objectUrls.push(url);
		blobByUrl.set(url, blob);
		return url;
	}),
	revokeObjectURL: vi.fn((url: string) => {
		blobByUrl.delete(url);
	})
});
const blobByUrl = new Map<string, Blob>();

import { loadPhotosForRange, getThumbUrl, clearThumbCache } from './immich.service';

describe('immich photo service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectChain.order.mockResolvedValue({ data: [], error: null });
		bytesByAsset = {} as Record<string, Uint8Array>;
		clearThumbCache();
	});

	it('loadPhotosForRange filters by the taken_at range and orders ascending', async () => {
		selectChain.order.mockResolvedValueOnce({
			data: [
				{
					asset_id: 'a1',
					latitude: -35,
					longitude: 150,
					taken_at: '2026-09-05T10:00:00Z',
					city: 'Huskisson',
					state: null,
					country: 'Australia'
				}
			],
			error: null
		});
		const photos = await loadPhotosForRange('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z');
		expect(selectChain.gte).toHaveBeenCalledWith('taken_at', '2026-09-01T00:00:00Z');
		expect(selectChain.lt).toHaveBeenCalledWith('taken_at', '2026-10-01T00:00:00Z');
		expect(selectChain.order).toHaveBeenCalledWith('taken_at');
		expect(photos).toHaveLength(1);
		expect(photos[0].asset_id).toBe('a1');
	});

	it('returns [] on query error instead of throwing', async () => {
		selectChain.order.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
		expect(await loadPhotosForRange('2026-09-01', '2026-10-01')).toEqual([]);
	});

	it('getThumbUrl fetches through the proxy and caches by asset id', async () => {
		bytesByAsset['a1'] = new TextEncoder().encode('img');
		const url1 = await getThumbUrl('a1');
		const url2 = await getThumbUrl('a1');
		expect(url1).toBe(url2);
		objectUrls.length = 0;
	});

	it('clearThumbCache revokes object URLs and forces refetch', async () => {
		bytesByAsset['a2'] = new TextEncoder().encode('img2');
		await getThumbUrl('a2');
		clearThumbCache();
		const again = await getThumbUrl('a2');
		expect(again).toBe('blob:mock-1'); // new object URL issued
	});

	it('returns null when the proxy fails', async () => {
		expect(await getThumbUrl('missing-asset')).toBeNull();
	});
});
