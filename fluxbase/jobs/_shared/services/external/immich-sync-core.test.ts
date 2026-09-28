// Deno tests for the immich-sync core (#13): watermark math, asset mapping,
// and the sync outcome (including permission-error surfacing).
// Run: deno test --no-lock --no-check --sloppy-imports fluxbase/jobs/_shared/services/external/immich-sync-core.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const {
	takenAfterFor,
	toAssetRows,
	maxTakenAt,
	summarizeSync
} = await import('./immich-sync-core.ts');

test('takenAfterFor: no watermark → undefined (full sync)', () => {
	assert.equal(takenAfterFor(undefined), undefined);
	assert.equal(takenAfterFor(''), undefined);
});

test('takenAfterFor: watermark minus 24h overlap', () => {
	assert.equal(takenAfterFor('2026-09-20T10:00:00Z'), '2026-09-19T10:00:00.000Z');
});

test('takenAfterFor: invalid watermark → undefined', () => {
	assert.equal(takenAfterFor('not-a-date'), undefined);
});

test('toAssetRows maps Immich assets to table rows under the user', () => {
	const rows = toAssetRows('user-1', [
		{
			id: 'a1',
			lat: -35.04,
			lon: 150.67,
			takenAt: '2026-09-05T10:00:00.000Z',
			city: 'Huskisson',
			state: 'NSW',
			country: 'Australia'
		}
	]);
	assert.deepEqual(rows, [
		{
			user_id: 'user-1',
			asset_id: 'a1',
			latitude: -35.04,
			longitude: 150.67,
			taken_at: '2026-09-05T10:00:00.000Z',
			city: 'Huskisson',
			state: 'NSW',
			country: 'Australia',
			synced_at: rows[0].synced_at
		}
	]);
	assert.ok(typeof rows[0].synced_at === 'string');
});

test('maxTakenAt returns the newest takenAt', () => {
	assert.equal(
		maxTakenAt([
			{ id: 'a', lat: 0, lon: 0, takenAt: '2026-09-05T10:00:00Z' },
			{ id: 'b', lat: 0, lon: 0, takenAt: '2026-09-09T10:00:00Z' },
			{ id: 'c', lat: 0, lon: 0, takenAt: '2026-09-07T10:00:00Z' }
		]),
		'2026-09-09T10:00:00Z'
	);
	assert.equal(maxTakenAt([]), undefined);
});

test('summarizeSync surfaces permission errors without leaking details', () => {
	const outcome = summarizeSync({ errorKind: 'permission', error: 'missing asset.read for key xyz' }, 40);
	assert.equal(outcome.permissionError, true);
	assert.equal(outcome.synced, 0);
	assert.ok(!JSON.stringify(outcome).includes('xyz'), 'upstream error detail must not leak');
});

test('summarizeSync passes through successful counts', () => {
	const outcome = summarizeSync(undefined, 123);
	assert.equal(outcome.permissionError, false);
	assert.equal(outcome.synced, 123);
	assert.equal(outcome.ok, true);
});
