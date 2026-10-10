import { describe, it, expect } from 'vitest';

import { TRANSPORT_MODE_COLORS } from './colors';
import { TRANSPORT_MODE_COLORS as VISUAL_MODE_COLORS } from '$lib/services/transport-mode/visuals';
import { TRANSPORT_MODES } from '$lib/services/transport-mode/states';

describe('TRANSPORT_MODE_COLORS', () => {
	it('has an entry for every canonical transport mode', () => {
		for (const mode of TRANSPORT_MODES) {
			expect(TRANSPORT_MODE_COLORS[mode], `missing color for ${mode}`).toBeTruthy();
		}
	});

	it('is the single source of truth — the visuals re-export matches exactly', () => {
		expect(VISUAL_MODE_COLORS).toEqual(TRANSPORT_MODE_COLORS);
	});

	// #241: black airplane polylines were invisible on dark map tiles.
	it('uses colors visible on dark tiles (no #000000)', () => {
		for (const [mode, color] of Object.entries(TRANSPORT_MODE_COLORS)) {
			expect(color.toLowerCase(), `${mode} is black`).not.toBe('#000000');
		}
	});

	it('keeps airplane sky blue and stationary distinct from unknown grey', () => {
		expect(TRANSPORT_MODE_COLORS.airplane).toBe('#0ea5e9');
		expect(TRANSPORT_MODE_COLORS.stationary).not.toBe(TRANSPORT_MODE_COLORS.unknown);
	});
});
