// Threshold logic for the geocode-health monitor — see geocode-health.ts for
// the outage this guards against.
// Run: deno test --no-lock fluxbase/jobs/_shared/utils/geocode-health.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { shouldFlagGeocodeBacklog } = await import('./geocode-health.ts');

test('flags a real outage: many points missing, high ratio', () => {
	assert.equal(shouldFlagGeocodeBacklog(19092, 19092), true);
	assert.equal(shouldFlagGeocodeBacklog(1000, 300), true);
});

test('does not flag when the absolute count is below the floor', () => {
	// 100% missing but tiny — a fresh import racing the geocoder.
	assert.equal(shouldFlagGeocodeBacklog(30, 30), false);
});

test('does not flag when the ratio is below the floor', () => {
	// 10% of a large window — normal geocoding lag, not an outage.
	assert.equal(shouldFlagGeocodeBacklog(10000, 999), false);
});

test('boundary values are inclusive', () => {
	assert.equal(shouldFlagGeocodeBacklog(250, 50), true); // exactly 50 and 20%
	assert.equal(shouldFlagGeocodeBacklog(249, 50), true); // ratio over floor
	assert.equal(shouldFlagGeocodeBacklog(251, 50), false); // ratio under floor
});

test('no points or no missing points never flags', () => {
	assert.equal(shouldFlagGeocodeBacklog(0, 0), false);
	assert.equal(shouldFlagGeocodeBacklog(1000, 0), false);
});

test('custom thresholds are honored', () => {
	const strict = { minMissingCount: 5, minMissingRatio: 0.5 };
	assert.equal(shouldFlagGeocodeBacklog(10, 5, strict), true);
	assert.equal(shouldFlagGeocodeBacklog(100, 10, strict), false);
});
