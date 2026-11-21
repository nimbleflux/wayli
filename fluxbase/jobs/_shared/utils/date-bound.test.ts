// Characterization test for normalizeDateBound — see date-bound.ts for the
// failure it prevents (epoch-millis bounds → SQLSTATE 22008 → PGRST000).
// Run: deno test --no-lock fluxbase/jobs/_shared/utils/date-bound.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { normalizeDateBound } = await import('./date-bound.ts');

test('epoch-millis numbers become ISO 8601 strings', () => {
	const result = normalizeDateBound(1787570863558);
	assert.equal(result, new Date(1787570863558).toISOString());
	assert.match(result!, /^\d{4}-\d{2}-\d{2}T/);
});

test('epoch-millis numeric strings become ISO 8601 strings', () => {
	assert.equal(normalizeDateBound('1787570863558'), new Date(1787570863558).toISOString());
});

test('ISO date strings pass through unchanged', () => {
	assert.equal(normalizeDateBound('2026-08-21'), '2026-08-21');
	assert.equal(normalizeDateBound('2026-08-21T11:27:43.558Z'), '2026-08-21T11:27:43.558Z');
});

test('empty and missing bounds stay empty', () => {
	assert.equal(normalizeDateBound(undefined), undefined);
	assert.equal(normalizeDateBound(null), undefined);
	assert.equal(normalizeDateBound(''), undefined);
});

test('non-numeric strings pass through unchanged', () => {
	assert.equal(normalizeDateBound('not-a-date'), 'not-a-date');
});

test('invalid epoch values normalize to undefined so the job can reject them', () => {
	assert.equal(normalizeDateBound(Number.NaN), undefined);
});
