import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

// The picker queries the synced photo table via the immich service and
// attaches through the attach pipeline — both mocked.
const photosInRange: any[][] = [];
let attachResult: { added: number; failed: number; created: any[] } = {
	added: 0,
	failed: 0,
	created: []
};

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: {
			getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } }))
		}
	}
}));

vi.mock('$lib/services/immich.service', () => ({
	loadPhotosForRange: vi.fn(() => Promise.resolve(photosInRange[photosInRange.length - 1] ?? [])),
	searchPhotosLive: vi.fn(() => Promise.resolve(photosInRange[photosInRange.length - 1] ?? [])),
	getThumbUrl: vi.fn(() => Promise.resolve('blob:mock-thumb'))
}));

vi.mock('$lib/services/immich-attach.service', () => ({
	attachPhotosToEntry: vi.fn(() => Promise.resolve(attachResult))
}));

vi.mock('$lib/stores/immich.svelte', () => ({
	immichSettings: vi.fn(() => ({ enabled: true, server_url: 'http://immich:2283' }))
}));

vi.mock('$lib/i18n', () => ({
	t: vi.fn((key: string, params?: Record<string, string | number>) => {
		let out = key;
		if (params)
			for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
		return out;
	})
}));

import ImmichPhotoPicker from '$lib/components/ImmichPhotoPicker.svelte';
import { searchPhotosLive } from '$lib/services/immich.service';
import { attachPhotosToEntry } from '$lib/services/immich-attach.service';

const PHOTO = {
	asset_id: 'a1',
	latitude: -35,
	longitude: 150,
	taken_at: '2026-09-05T10:00:00Z',
	city: 'Huskisson',
	state: null,
	country: 'Australia'
};

describe('ImmichPhotoPicker', () => {
	beforeEach(() => {
		photosInRange.length = 0;
		attachResult = { added: 0, failed: 0, created: [] };
		vi.clearAllMocks();
	});

	it('renders nothing when closed', () => {
		const { container } = render(ImmichPhotoPicker, {
			props: { open: false, tripId: 'trip-1', entryId: 'entry-1', initialDate: '2026-09-05' }
		});
		expect(container.textContent).toBe('');
	});

	it('shows the photo grid for the initial date range when opened', async () => {
		photosInRange.push([PHOTO]);
		render(ImmichPhotoPicker, {
			props: { open: true, tripId: 'trip-1', entryId: 'entry-1', initialDate: '2026-09-05' }
		});
		// The picker live-queries first; loadPhotosForRange is the cache fallback.
		// The 300ms minimum loader display means the grid appears after it.
		await waitFor(() => expect(searchPhotosLive).toHaveBeenCalled());
		await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument(), {
			timeout: 3000
		});
	});

	it('attaches selected photos on Add and dispatches added', async () => {
		photosInRange.push([PHOTO]);
		attachResult = {
			added: 1,
			failed: 0,
			created: [{ id: 'm1', immich_asset_id: 'a1' }]
		};
		const { container } = render(ImmichPhotoPicker, {
			props: { open: true, tripId: 'trip-1', entryId: 'entry-1', initialDate: '2026-09-05' }
		});
		await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('checkbox'));
		fireEvent.click(screen.getByRole('button', { name: /pickerAdd/i }));

		await waitFor(() => expect(attachPhotosToEntry).toHaveBeenCalled());
		expect(attachPhotosToEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-1',
				tripId: 'trip-1',
				entryId: 'entry-1',
				assets: [PHOTO]
			})
		);
		await waitFor(() => {
			expect(container.textContent).toContain('connections.immich.pickerAddedCount');
		});
	});

	it('shows zero-state when the range has no photos', async () => {
		photosInRange.push([]);
		render(ImmichPhotoPicker, {
			props: { open: true, tripId: 'trip-1', entryId: 'entry-1', initialDate: '2026-09-05' }
		});
		// Live returns empty → cache fallback also runs → both settle before
		// the empty state renders (loading must finish first).
		await waitFor(() => expect(searchPhotosLive).toHaveBeenCalled());
		await waitFor(
			() => expect(screen.getByText('connections.immich.pickerEmpty')).toBeInTheDocument(),
			{ timeout: 3000 }
		);
	});
});
