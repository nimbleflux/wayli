// /Users/bart/Dev/wayli/web/src/lib/services/transport-mode/visuals.ts
//
// Browser-only visual mapping for transport modes: icons, colors and picker
// order. Not exported from index.ts — the Deno jobs mirror the other modules
// in this folder, and lucide icons are a web concern only.

import {
	Footprints,
	Bike,
	Car,
	TrainFront,
	Plane,
	Sailboat,
	Waves,
	Pause,
	CircleHelp
} from 'lucide-svelte';
import { TRANSPORT_MODE_COLORS } from '$lib/utils/colors';
import type { TransportMode } from './states';

// lucide-svelte v1 still ships legacy SvelteComponentTyped class components,
// whose constructors don't match Svelte 5's `Component`/`SvelteComponent`
// types. They render fine as dynamic tags, so type them loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = any;

/** Icon per canonical mode; 'unknown' is the fallback for anything else. */
export const TRANSPORT_MODE_ICONS: Record<string, IconComponent> = {
	walking: Footprints,
	cycling: Bike,
	car: Car,
	train: TrainFront,
	airplane: Plane,
	boat: Sailboat,
	swimming: Waves,
	stationary: Pause,
	unknown: CircleHelp
};

/**
 * Color per mode, used for map lines, markers, mode buttons and the legend.
 * The palette lives in `$lib/utils/colors` (single source of truth, mirrored
 * by Android's TransportModeColors.kt) — re-exported here for the pages that
 * import colors alongside the icon helpers.
 */
export { TRANSPORT_MODE_COLORS };

/** Display order for mode pickers (most common movement modes first). */
export const TRANSPORT_MODE_PICKER_ORDER: TransportMode[] = [
	'walking',
	'cycling',
	'car',
	'train',
	'airplane',
	'boat',
	'swimming',
	'stationary'
];

export function transportModeIcon(mode: string): IconComponent {
	return TRANSPORT_MODE_ICONS[mode.replace('transport.', '')] ?? TRANSPORT_MODE_ICONS.unknown;
}

export function transportModeColor(mode: string): string {
	return TRANSPORT_MODE_COLORS[mode.replace('transport.', '')] ?? TRANSPORT_MODE_COLORS.unknown;
}
