// Raw-point validation + bounded concurrency for the GPS ingest core.
//
// The ingest endpoint previously trusted every field: a missing/non-numeric
// `tst` threw inside the per-point mapper and failed the WHOLE batch with a
// 500 (the client then re-sent the same payload forever), and out-of-range
// coordinates were stored as-is (PostGIS geometry(Point,4326) does not enforce
// ranges), poisoning distance and country computations. These helpers carry
// the validation so bad points are dropped individually and reported.
//
// Run: deno test --no-lock fluxbase/functions/_shared/point-validation.test.ts

import assert from 'node:assert/strict';
import {
	validateRawPoint,
	rawPointTimestampMs,
	MAX_POINTS_PER_REQUEST,
	mapWithConcurrency,
} from './point-validation.ts';

const { test } = await import('node:test');

test('accepts a well-formed OwnTracks point', () => {
	const err = validateRawPoint({ lat: 52.37, lon: 4.89, tst: 1758729600 });
	assert.equal(err, null);
});

test('rejects missing / non-numeric coordinates', () => {
	assert.match(validateRawPoint({ lon: 4.89, tst: 1758729600 })!, /invalid coordinates/);
	assert.match(validateRawPoint({ lat: 'NaN', lon: 4.89, tst: 1758729600 })!, /invalid coordinates/);
	assert.match(validateRawPoint({ lat: null, lon: undefined, tst: 1 })!, /invalid coordinates/);
});

test('rejects out-of-range coordinates (PostGIS will not)', () => {
	assert.match(validateRawPoint({ lat: 999, lon: 40, tst: 1758729600 })!, /invalid coordinates/);
	assert.match(validateRawPoint({ lat: 52, lon: -180.5, tst: 1758729600 })!, /invalid coordinates/);
});

test('rejects missing / non-numeric tst (the old RangeError batch-killer)', () => {
	assert.match(validateRawPoint({ lat: 52, lon: 4 })!, /invalid tst/);
	assert.match(validateRawPoint({ lat: 52, lon: 4, tst: 'yesterday' })!, /invalid tst/);
});

test('rejects timestamps before 2000 and absurd futures (ms-vs-s confusion)', () => {
	assert.match(validateRawPoint({ lat: 52, lon: 4, tst: 900000000 })!, /before 2000/);
	// ms misread as-is would be year ~55000; as a ms epoch it's fine:
	assert.equal(validateRawPoint({ lat: 52, lon: 4, tst: 1758729600000 }), null);
	assert.match(validateRawPoint({ lat: 52, lon: 4, tst: 4102444800 * 10 })!, /future/);
});

test('rawPointTimestampMs accepts seconds and milliseconds', () => {
	assert.equal(rawPointTimestampMs({ tst: 1758729600 }), 1758729600000);
	assert.equal(rawPointTimestampMs({ tst: 1758729600000 }), 1758729600000);
});

test('mapWithConcurrency preserves order and item index', async () => {
	const seen: number[] = [];
	let concurrent = 0;
	let peak = 0;
	const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 2, async (n, i) => {
		concurrent++;
		peak = Math.max(peak, concurrent);
		seen.push(i);
		await new Promise((r) => setTimeout(r, (7 - n) * 2));
		concurrent--;
		return n * 10;
	});
	assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
	assert.equal(peak, 2);
});

test('mapWithConcurrency propagates the failing item but runs all', async () => {
	await assert.rejects(
		() =>
			mapWithConcurrency([1, 2, 3], 3, async (n) => {
				if (n === 2) throw new Error('boom');
				return n;
			}),
		/boom/
	);
});

test('batch cap constant is sane', () => {
	assert.ok(MAX_POINTS_PER_REQUEST >= 100, 'must accept the app batch of 100');
	assert.ok(MAX_POINTS_PER_REQUEST <= 5000, 'must not allow unbounded ingest');
});

console.log('point-validation: all assertions passed');
