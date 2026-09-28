import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fluxbase table client: capture the read-modify-write sequence so we
// can assert the preferences.immich jsonb merge never clobbers sibling keys.
type PrefRow = { id: string; preferences: Record<string, unknown> } | null;
let prefRow: PrefRow;
let written: { row: Record<string, unknown> } | { insert: Record<string, unknown> } | null = null;

const chain = {
	select: vi.fn(() => chain),
	eq: vi.fn(() => chain),
	maybeSingle: vi.fn(() => Promise.resolve({ data: prefRow, error: null })),
	update: vi.fn((row: Record<string, unknown>) => {
		written = { row };
		return chain;
	}),
	insert: vi.fn((row: Record<string, unknown>) => {
		written = { insert: row };
		return chain;
	})
};

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: {
			getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } }))
		},
		from: vi.fn(() => chain)
	}
}));

vi.mock('$app/environment', () => ({ browser: true }));

import { loadImmichSettings, saveImmichSettings } from './immich.svelte';

describe('immich settings store', () => {
	beforeEach(() => {
		prefRow = null;
		written = null;
		vi.clearAllMocks();
	});

	it('returns null settings when no preferences row exists', async () => {
		expect(await loadImmichSettings()).toBeNull();
	});

	it('reads settings from preferences.immich', async () => {
		prefRow = {
			id: 'user-1',
			preferences: {
				units: 'metric',
				immich: {
					enabled: true,
					server_url: 'http://immich:2283',
					last_sync_at: '2026-09-28T00:00:00Z'
				}
			}
		};
		const settings = await loadImmichSettings();
		expect(settings?.enabled).toBe(true);
		expect(settings?.server_url).toBe('http://immich:2283');
		expect(settings?.last_sync_at).toBe('2026-09-28T00:00:00Z');
	});

	it('save merges into preferences.immich without clobbering sibling keys', async () => {
		prefRow = {
			id: 'user-1',
			preferences: {
				units: 'metric',
				use_valhalla_transport: true,
				immich: { enabled: false, server_url: 'http://old' }
			}
		};
		await saveImmichSettings({ enabled: true });
		expect(written).not.toBeNull();
		const prefs = (written as { row: { preferences: Record<string, unknown> } }).row.preferences;
		// sibling keys preserved
		expect(prefs.units).toBe('metric');
		expect(prefs.use_valhalla_transport).toBe(true);
		// immich merged, not replaced
		expect(prefs.immich).toEqual({ enabled: true, server_url: 'http://old' });
		// write targets the user's row
		expect((written as { row: { id?: string } }).row.id).toBeUndefined(); // update path uses .eq('id')
	});

	it('save inserts a new row when none exists (race-safe)', async () => {
		prefRow = null;
		await saveImmichSettings({ enabled: true, server_url: 'http://x' });
		expect(written).not.toBeNull();
		const insert = (written as { insert: { id: string; preferences: Record<string, unknown> } })
			.insert;
		expect(insert.id).toBe('user-1');
		expect(insert.preferences.immich).toEqual({ enabled: true, server_url: 'http://x' });
	});
});
