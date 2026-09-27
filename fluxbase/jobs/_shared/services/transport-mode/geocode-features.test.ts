// Water-evidence mirror test (#220). Mirrors the web-side isOnWaterGeocode
// cases in web/src/lib/utils/transport-mode.test.ts — update both together.
// Run: deno test --no-lock --no-check --sloppy-imports fluxbase/jobs/_shared/services/transport-mode/geocode-features.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { isOnWaterGeocode } = await import('./geocode-features.ts');

function geocode(properties: Record<string, unknown>): any {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [150.67, -35.04] },
		properties
	};
}

test('permanent geocode failure counts as water; retryable does not', () => {
	assert.equal(
		isOnWaterGeocode(geocode({ geocoding_status: 'failed', geocode_error: 'No results found' })),
		true
	);
	assert.equal(isOnWaterGeocode(geocode({ geocoding_status: 'failed', retryable: true })), false);
});

test('marine layer, water categories and OSM water tags count as water', () => {
	assert.equal(isOnWaterGeocode(geocode({ layer: 'marine' })), true);
	assert.equal(isOnWaterGeocode(geocode({ category: ['water:bay'] })), true);
	assert.equal(isOnWaterGeocode(geocode({ addendum: { osm: { waterway: 'river' } } })), true);
	assert.equal(isOnWaterGeocode(geocode({ addendum: { osm: { natural: 'water' } } })), true);
	assert.equal(isOnWaterGeocode(geocode({ addendum: { osm: { 'man_made': 'pier' } } })), true);
});

test('land geocodes and missing geocodes do not count as water', () => {
	assert.equal(
		isOnWaterGeocode(geocode({ layer: 'venue', addendum: { osm: { amenity: 'cafe' } } })),
		false
	);
	assert.equal(isOnWaterGeocode(null), false);
	assert.equal(isOnWaterGeocode(undefined), false);
});
