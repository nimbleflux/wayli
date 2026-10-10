import { describe, expect, test } from 'vitest';

import { GREEN_MODES, MODE_INDEX, NUM_MODES, TRANSPORT_MODES, normalizeMode } from './states';

describe('transport-mode states registry', () => {
	test('registers boat and swimming as states 7 and 8 (#220)', () => {
		expect(TRANSPORT_MODES).toContain('boat');
		expect(TRANSPORT_MODES).toContain('swimming');
		expect(NUM_MODES).toBe(9);
		// Appending after airplane keeps existing DB values' indices stable.
		expect(MODE_INDEX['airplane']).toBe(5);
		expect(MODE_INDEX['boat']).toBe(6);
		expect(MODE_INDEX['swimming']).toBe(7);
		// #242: running is appended after swimming — never inserted.
		expect(MODE_INDEX['running']).toBe(8);
	});

	test('normalizeMode passes the new modes through', () => {
		expect(normalizeMode('boat')).toBe('boat');
		expect(normalizeMode('swimming')).toBe('swimming');
		expect(normalizeMode('running')).toBe('running');
		expect(normalizeMode('run')).toBe('running');
	});

	test('normalizeMode aliases FIT-style boating spellings to boat', () => {
		expect(normalizeMode('boating')).toBe('boat');
	});

	test('swimming counts as a green mode; boat does not', () => {
		expect(GREEN_MODES.has('swimming')).toBe(true);
		expect(GREEN_MODES.has('boat')).toBe(false);
	});

	test('running counts as a green mode (#242)', () => {
		expect(GREEN_MODES.has('running')).toBe(true);
	});
});
