// safeGetEnv must never throw: the job sandbox throws NotCapable for env
// names outside the explicit allowlist (#243 pattern), which is equivalent
// to the variable being unset.
// Run: deno test --no-lock fluxbase/jobs/_shared/utils/env.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { safeGetEnv } = await import('./env.ts');

test('returns the value when the env read succeeds', () => {
	assert.equal(safeGetEnv('X', () => 'hello'), 'hello');
});

test('returns undefined when the variable is unset', () => {
	assert.equal(safeGetEnv('X', () => undefined), undefined);
});

test('swallows the NotCapable permission error as unset', () => {
	const notCapable = () => {
		throw new Error('PermissionDenied: Requires env access to "X"');
	};
	assert.equal(safeGetEnv('X', notCapable), undefined);
});

test('swallows non-Error throwables as unset', () => {
	assert.equal(
		safeGetEnv('X', () => {
			throw 'NotCapable' as unknown as Error;
		}),
		undefined
	);
});

test('reads through the real runtime getter without throwing', () => {
	// Whatever this sandbox allows or denies, the call must return a value
	// (string | undefined), never throw.
	const value = safeGetEnv('WAYLI_ENV_TEST_PROBE');
	assert.ok(value === undefined || typeof value === 'string');
});
