// translateServer runs inside the job sandbox, where Deno.env.get THROWS
// NotCapable for names outside the explicit env allowlist (#243 pattern).
// Its NODE_ENV read (debug-log toggle) used to crash trip detection mid-run
// when generateTripTitle translated its first title. These tests pin that
// translation works with env access unavailable.
// Run: deno test --no-lock fluxbase/jobs/_shared/utils/server-translations.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { translateServer, getCountryNameServer, getPluralSuffix } = await import(
	'./server-translations.ts'
);

test('translateServer translates without crashing on the env allowlist', () => {
	assert.equal(translateServer('tripDetection.tripToCity', { city: 'Berlin' }, 'en'), 'Trip to Berlin');
	assert.equal(translateServer('tripDetection.tripToCity', { city: 'Berlijn' }, 'nl'), 'Reis naar Berlijn');
	assert.equal(
		translateServer('tripDetection.tripToCountry', { country: 'Germany' }, 'en'),
		'Trip to Germany'
	);
});

test('unknown keys fall back to the key itself', () => {
	assert.equal(translateServer('tripDetection.nonexistent', {}, 'en'), 'tripDetection.nonexistent');
});

test('country names fall back to Intl.DisplayNames when translation files are absent', () => {
	assert.equal(getCountryNameServer('DE', 'en'), 'Germany');
	assert.equal(getCountryNameServer('de', 'nl'), 'Duitsland');
});

test('invalid country codes pass through', () => {
	assert.equal(getCountryNameServer('', 'en'), '');
	assert.equal(getCountryNameServer('XYZ', 'en'), 'XYZ');
});

test('plural suffix', () => {
	assert.equal(getPluralSuffix(1, 'en'), '');
	assert.equal(getPluralSuffix(3, 'en'), 's');
});
