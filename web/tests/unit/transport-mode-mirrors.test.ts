import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TRANSPORT_MODES } from '$lib/services/transport-mode/states';
import { MODE_PHYSICAL_LIMITS, MODE_CONTINUITY_LIMITS } from '$lib/utils/transport-mode.config';
import { costingForMode } from '$lib/services/transport-mode/valhalla-confirm';

// The transport-mode detector exists as two mirrored trees — fluxbase/jobs/
// _shared/services/transport-mode/ (Deno, the batch detector) and web/src/
// lib/services/transport-mode/ (the same logic for the browser) — kept in
// sync by convention only. They have drifted before (a costing case landed
// on one side only), so this test pins the canonical blocks together at the
// text level: any edit to one tree without the other fails here.

// vitest runs with cwd = web/, so the repo root is one level up.
const repoRoot = resolve(process.cwd(), '..');
const fluxbase = (p: string) =>
	readFileSync(resolve(repoRoot, 'fluxbase/jobs/_shared/services/transport-mode', p), 'utf8');
const webSrc = (p: string) => readFileSync(resolve(repoRoot, 'web/src', p), 'utf8');

function extractStringArray(src: string, name: string): string[] {
	const m = src.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`, 's'));
	return (m?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
}

describe('transport-mode mirror parity (fluxbase ↔ web)', () => {
	test('TRANSPORT_MODES arrays are identical, in order', () => {
		const fluxModes = extractStringArray(fluxbase('states.ts'), 'TRANSPORT_MODES');
		expect(fluxModes).toEqual([...TRANSPORT_MODES]);
		// Order matters: indices are persisted assumptions (#220/#242).
		expect(fluxModes).toEqual([
			'stationary',
			'walking',
			'cycling',
			'car',
			'train',
			'airplane',
			'boat',
			'swimming',
			'running'
		]);
	});

	test('every mode has physical and continuity limits on BOTH sides', () => {
		const fluxConfig = fluxbase('config.ts');
		for (const mode of TRANSPORT_MODES) {
			expect(fluxConfig).toContain(`${mode}: { min:`);
			expect(MODE_PHYSICAL_LIMITS[mode]).toBeDefined();
			expect(MODE_CONTINUITY_LIMITS[mode]).toBeDefined();
		}
	});

	test('detector mirrors know about the same modes', () => {
		const fluxDetector = fluxbase('detector.ts');
		const webDetector = webSrc('lib/services/transport-mode/detector.ts');
		// reasonFor() writes one case per mode; both trees must know running.
		expect(fluxDetector).toContain("case 'running':");
		expect(webDetector).toContain("case 'running':");
	});

	test('running maps to pedestrian costing in BOTH valhalla-confirm mirrors', () => {
		// Text-level (not runtime): the costing switch falls through, so a
		// deleted case line can be behavior-neutral while still being drift.
		const flux = fluxbase('valhalla-confirm.ts');
		expect(flux).toMatch(/case 'running':\s*\n\s*case 'stationary':/);
		const webValhalla = webSrc('lib/services/transport-mode/valhalla-confirm.ts');
		expect(webValhalla).toMatch(/case 'running':\s*\n\s*case 'stationary':/);
		expect(costingForMode('running')).toBe('pedestrian');
	});
});
