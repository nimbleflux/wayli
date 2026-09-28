// Registry + limits parity test for the Deno transport-mode tree (#220).
// Mirrors web/src/lib/services/transport-mode/states.test.ts semantics.
// Run: deno test --no-lock --sloppy-imports fluxbase/jobs/_shared/services/transport-mode/states.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { MODE_INDEX, NUM_MODES, TRANSPORT_MODES } = await import('./states.ts');
const { MODE_CONTINUITY_LIMITS, MODE_PHYSICAL_LIMITS } = await import('./config.ts');

test('registers boat and swimming after airplane (#220)', () => {
	assert.equal(NUM_MODES, 8);
	assert.equal(MODE_INDEX['airplane'], 5);
	assert.equal(MODE_INDEX['boat'], 6);
	assert.equal(MODE_INDEX['swimming'], 7);
});

test('every registered mode has physical and continuity limits', () => {
	for (const mode of TRANSPORT_MODES) {
		assert.ok(MODE_PHYSICAL_LIMITS[mode], `missing physical limits for ${mode}`);
		assert.ok(MODE_CONTINUITY_LIMITS[mode], `missing continuity limits for ${mode}`);
	}
	assert.equal(MODE_PHYSICAL_LIMITS['boat'].max, 100);
	assert.equal(MODE_PHYSICAL_LIMITS['swimming'].max, 8);
});
