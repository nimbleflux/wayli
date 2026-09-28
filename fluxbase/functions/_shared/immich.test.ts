// Deno tests for the Immich proxy validators (#13).
// Run: deno test --no-lock --no-check --sloppy-imports fluxbase/functions/_shared/immich.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { authorizeThumb, thumbSize, THUMB_CACHE_CONTROL } = await import('./immich.ts');

test('authorizeThumb: happy path allows', () => {
	assert.deepEqual(
		authorizeThumb({ adminEnabled: true, userEnabled: true, hasAssetRow: true }),
		{ allowed: true }
	);
});

test('authorizeThumb: admin toggle off denies first (even when user enabled)', () => {
	assert.deepEqual(authorizeThumb({ adminEnabled: false, userEnabled: true, hasAssetRow: true }), {
		allowed: false,
		status: 403,
		reason: 'admin-disabled'
	});
});

test('authorizeThumb: user toggle off denies 403', () => {
	assert.deepEqual(authorizeThumb({ adminEnabled: true, userEnabled: false, hasAssetRow: true }), {
		allowed: false,
		status: 403,
		reason: 'user-disabled'
	});
});

test('authorizeThumb: asset not synced by this user denies 404 (no generic gateway)', () => {
	assert.deepEqual(authorizeThumb({ adminEnabled: true, userEnabled: true, hasAssetRow: false }), {
		allowed: false,
		status: 404,
		reason: 'asset-not-synced'
	});
});

test('thumbSize accepts thumbnail (default) and preview', () => {
	assert.equal(thumbSize(null), 'thumbnail');
	assert.equal(thumbSize(undefined), 'thumbnail');
	assert.equal(thumbSize('thumbnail'), 'thumbnail');
	assert.equal(thumbSize('preview'), 'preview');
	assert.equal(thumbSize('original'), 'thumbnail'); // never proxy originals
});

test('thumbnails cache privately and immutably', () => {
	assert.equal(THUMB_CACHE_CONTROL, 'private, max-age=604800, immutable');
});
