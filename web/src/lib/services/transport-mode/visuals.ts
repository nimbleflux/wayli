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

/** Color per mode, used for map lines, markers, mode buttons and the legend. */
export const TRANSPORT_MODE_COLORS: Record<string, string> = {
	walking: '#16a34a', // Green
	cycling: '#ea580c', // Orange
	car: '#dc2626', // Red
	train: '#7c3aed', // Purple
	airplane: '#000000', // Black
	boat: '#0369a1', // Deep teal-blue (#220 water modes)
	swimming: '#06b6d4', // Cyan
	stationary: '#2563eb', // Blue
	unknown: '#6b7280' // Grey
};

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
