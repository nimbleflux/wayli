// Mirrors web/src/lib/services/transport-mode/states.ts. Update both together.

export const TRANSPORT_MODES = [
	'stationary',
	'walking',
	'cycling',
	'car',
	'train',
	'airplane',
	'boat',
	'swimming',
	// #242: appended (never inserted) so indices of the original states — and
	// any persisted assumptions about them — stay put.
	'running'
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const MODE_INDEX: Record<TransportMode, number> = TRANSPORT_MODES.reduce(
	(acc, mode, i) => {
		acc[mode] = i;
		return acc;
	},
	{} as Record<TransportMode, number>
);

export const NUM_MODES = TRANSPORT_MODES.length;
