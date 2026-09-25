// Day-window computation for watermark-based daily aggregation jobs.
//
// The consumer (scheduled-refresh-daily-activity) upserts — i.e. OVERWRITES —
// per-day totals, so its lookback window must start at 00:00Z: a window that
// begins mid-day re-aggregates only the post-window portion of the earlier
// affected day and clobbers the rest. This is the test for the bug that
// silently erased ~5/24 of every day's totals on the 05:00 UTC schedule.
//
// Run: deno test --no-lock fluxbase/jobs/_shared/day-window.test.ts

import assert from 'node:assert/strict';
import { dayWindowSince } from './day-window.ts';

const { test } = await import('node:test');

test('window starts at 00:00Z of the lookback day, not mid-day', () => {
	// Watermark 05:00Z, 1-day lookback → raw 23rd 05:00Z → floored to 23rd 00:00Z
	assert.equal(dayWindowSince('2026-09-24T05:00:00Z', false, 1), '2026-09-23T00:00:00.000Z');
});

test('multi-day lookback still floors to UTC midnight', () => {
	assert.equal(dayWindowSince('2026-09-24T05:00:00Z', false, 7), '2026-09-17T00:00:00.000Z');
});

test('exact-midnight watermark stays put', () => {
	assert.equal(dayWindowSince('2026-09-24T00:00:00Z', false, 1), '2026-09-23T00:00:00.000Z');
});

test('null watermark or full rebuild → null (scan everything)', () => {
	assert.equal(dayWindowSince(null, false, 1), null);
	assert.equal(dayWindowSince('2026-09-24T05:00:00Z', true, 1), null);
});

console.log('day-window: all assertions passed');
