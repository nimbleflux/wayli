import { describe, it, expect, vi, beforeEach } from 'vitest';

// The settings store is a .svelte.ts module with module-level reactive state
// and a browser guard; test the pure decision surface by mocking the fluxbase
// batch read and asserting the exposed getters resolve Immich keys correctly.

const batchResponse: Record<string, unknown> = {};

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		settings: {
			getMany: vi.fn(() => Promise.resolve(batchResponse))
		}
	}
}));

vi.mock('$app/environment', () => ({ browser: true }));

import { getSetting, loadPublicSettings } from './settings.svelte';

describe('settings store — Immich keys', () => {
	beforeEach(() => {
		for (const k of Object.keys(batchResponse)) delete batchResponse[k];
	});

	it('resolves immich_enabled=false by default when the key is absent', async () => {
		await loadPublicSettings(true);
		expect(getSetting('wayli.immich_enabled', false)).toBe(false);
	});

	it('resolves immich_enabled=true when the server sets it', async () => {
		batchResponse['wayli.immich_enabled'] = true;
		await loadPublicSettings(true);
		expect(getSetting('wayli.immich_enabled', false)).toBe(true);
	});

	it('exposes immich_endpoint with an empty-string default', async () => {
		await loadPublicSettings(true);
		expect(getSetting('wayli.immich_endpoint', '')).toBe('');
		batchResponse['wayli.immich_endpoint'] = 'http://immich:2283';
		await loadPublicSettings(true);
		expect(getSetting('wayli.immich_endpoint', '')).toBe('http://immich:2283');
	});
});
