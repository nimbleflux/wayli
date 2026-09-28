import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

// The strip renders localized labels via $lib/i18n; component tests mock it.
vi.mock('$lib/i18n', () => ({
	t: vi.fn((key: string, params?: Record<string, string | number>) => {
		let out = key;
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				out = out.replaceAll(`{${k}}`, String(v));
			}
		}
		return out;
	})
}));

const photosByCall: any[][] = [];

vi.mock('$lib/services/immich.service', () => ({
	loadPhotosForRange: vi.fn(() => Promise.resolve(photosByCall[photosByCall.length - 1] ?? [])),
	getThumbUrl: vi.fn(() => Promise.resolve('blob:mock-thumb')),
	clearThumbCache: vi.fn()
}));

vi.mock('$lib/stores/immich.svelte', () => ({
	immichSettings: vi.fn(() => ({
		enabled: true,
		server_url: 'http://immich:2283',
		last_sync_at: '2026-09-28T00:00:00Z'
	}))
}));

import ImmichPhotoStrip from '$lib/components/ImmichPhotoStrip.svelte';
import { loadPhotosForRange } from '$lib/services/immich.service';

describe('ImmichPhotoStrip', () => {
	beforeEach(() => {
		photosByCall.length = 0;
		vi.clearAllMocks();
	});

	it('renders nothing when the day has no photos', async () => {
		photosByCall.push([]);
		const { container } = render(ImmichPhotoStrip, { props: { date: '2026-09-05' } });
		await waitFor(() => expect(loadPhotosForRange).toHaveBeenCalled());
		expect(container.querySelector('img')).toBeNull();
	});

	it('renders a thumbnail per photo taken that day and opens the preview', async () => {
		photosByCall.push([
			{
				asset_id: 'a1',
				latitude: -35,
				longitude: 150,
				taken_at: '2026-09-05T10:00:00Z',
				city: 'Huskisson',
				state: null,
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
		]);
		const { container } = render(ImmichPhotoStrip, { props: { date: '2026-09-05' } });
		await waitFor(() => {
			expect(container.querySelectorAll('img').length).toBe(2);
		});
		const first = container.querySelectorAll('img')[0];
		first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await waitFor(() => {
			expect(container.textContent).toContain('Huskisson');
		});
		expect(container.textContent).toContain('travel.immichPhotosTakenOn');
		expect(container.textContent).toContain('9/5/2026');
	});

	it('queries exactly the given day [date, date+1day)', async () => {
		photosByCall.push([]);
		render(ImmichPhotoStrip, { props: { date: '2026-09-05' } });
		await waitFor(() => expect(loadPhotosForRange).toHaveBeenCalled());
		expect(loadPhotosForRange).toHaveBeenCalledWith(
			'2026-09-05T00:00:00.000Z',
			'2026-09-06T00:00:00.000Z'
		);
	});
});
