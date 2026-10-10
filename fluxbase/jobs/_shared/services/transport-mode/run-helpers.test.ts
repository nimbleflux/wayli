// Checkpoint math for the transport-mode watermark (#261). The detector
// persists a batch, then checkpoints the watermark to (last batch timestamp
// − lookback) so a run killed mid-window resumes near where it stopped
// instead of re-decoding the whole (up to 3-year) window.
// Run: deno test --no-lock --sloppy-imports run-helpers.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { checkpointFrom } = await import('./run-helpers.ts');

test('checkpoint is the last batch timestamp minus the 1h lookback', () => {
  const cp = checkpointFrom('2026-06-01T12:00:00.000Z');
  assert.ok(cp instanceof Date);
  assert.equal(cp.toISOString(), '2026-06-01T11:00:00.000Z');
});

test('checkpoint lands exactly one lookback before, preserving ordering', () => {
  const a = checkpointFrom('2026-06-01T00:30:00.000Z')!.getTime();
  const b = checkpointFrom('2026-06-01T01:30:00.000Z')!.getTime();
  assert.ok(a < b, 'later batch must checkpoint later');
});

test('null batch timestamp yields null (caller keeps the current watermark)', () => {
  assert.equal(checkpointFrom(null), null);
});
