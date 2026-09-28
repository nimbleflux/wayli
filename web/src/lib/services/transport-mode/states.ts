// /Users/bart/Dev/wayli/web/src/lib/services/transport-mode/states.ts
//
// HMM transport-mode states. The 8 canonical transport modes we decode into.
// These align with the modes produced by the legacy rule engine so the map
// colouring, statistics, and DB column all use the same vocabulary.
// (#220: boat and swimming are appended after airplane so indices of the
// original six states — and any persisted assumptions about them — stay put.)

export const TRANSPORT_MODES = [
	'stationary',
	'walking',
	'cycling',
	'car',
	'train',
	'airplane',
	'boat',
	'swimming'
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** All non-moving modes that count as "staying put". */
export const STATIONARY_MODES: ReadonlySet<TransportMode> = new Set(['stationary']);

/** Modes that count as green/human-powered, used by the statistics page. */
export const GREEN_MODES: ReadonlySet<TransportMode> = new Set(['walking', 'cycling', 'swimming']);

export const MODE_INDEX: Record<TransportMode, number> = TRANSPORT_MODES.reduce(
	(acc, mode, i) => {
		acc[mode] = i;
		return acc;
	},
	{} as Record<TransportMode, number>
);

export const NUM_MODES = TRANSPORT_MODES.length;

/**
 * Coerce an arbitrary mode string (from the DB or legacy detector) into a
 * canonical TransportMode. Unknown values map to 'stationary' as the safest
 * default — better to under-report movement than to fabricate a train journey.
 */
export function normalizeMode(mode: string | null | undefined): TransportMode {
	if (!mode) return 'stationary';
	const lower = mode.toLowerCase().trim();
	if (lower === 'stationary' || lower === 'still' || lower === 'unknown') return 'stationary';
	if (lower === 'walking' || lower === 'walk' || lower === 'running' || lower === 'run')
		return 'walking';
	if (lower === 'cycling' || lower === 'cycle' || lower === 'bicycle' || lower === 'bike')
		return 'cycling';
	if (lower === 'car' || lower === 'driving' || lower === 'auto' || lower === 'automotive')
		return 'car';
	if (lower === 'train' || lower === 'rail') return 'train';
	if (lower === 'airplane' || lower === 'plane' || lower === 'flight' || lower === 'flying')
		return 'airplane';
	// #220 water modes ('boating' is the FIT sport spelling, see fit-decoder)
	if (lower === 'boat' || lower === 'boating') return 'boat';
	if (lower === 'swimming' || lower === 'swim') return 'swimming';
	// Default to stationary rather than guessing a moving mode.
	return 'stationary';
}
