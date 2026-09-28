// /Users/bart/Dev/wayli/web/src/lib/services/transport-mode/features.ts
//
// Feature extraction for the HMM transport-mode detector. Pure functions,
// no I/O. Wraps the existing geocode helpers so we keep a single source of
// truth for train-station / airport / highway detection.

import type { ModeFeatures, ModeObservation } from './types';
import {
	isAtTrainStation,
	isAtAirport,
	isOnHighwayOrMotorway,
	getVenueTypeFromAddendum,
	isOnWaterGeocode
} from '../../utils/transport-mode';
import { MAX_PLAUSIBLE_SPEED_KMH } from '../../utils/transport-mode.config';

/**
 * Clamp a raw speed to a plausible range. Negative speeds and absurd outliers
 * (the DB has recorded up to ~481000 km/h from the distance trigger) are pulled
 * to the airplane band ceiling so a single glitch can't poison a CV window or
 * dominate an emission. See MAX_PLAUSIBLE_SPEED_KMH.
 */
function clampSpeed(speed: number): number {
	if (!Number.isFinite(speed) || speed < 0) return 0;
	return Math.min(speed, MAX_PLAUSIBLE_SPEED_KMH);
}

/**
 * Angular difference between two headings, wrapped to [-180, 180].
 * e.g. 350° → 10° is a +20° turn, not -340°.
 */
function headingDelta(a: number, b: number): number {
	let d = ((a - b + 540) % 360) - 180;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}

/** Coefficient of variation (std/mean) of a speed window. 0 when degenerate. */
function coefficientOfVariation(speeds: number[]): number {
	const n = speeds.length;
	if (n === 0) return 0;
	const mean = speeds.reduce((s, v) => s + v, 0) / n;
	if (mean < 0.5) return 0; // near-stationary: CV is noise
	let sqSum = 0;
	for (const v of speeds) sqSum += (v - mean) * (v - mean);
	const std = Math.sqrt(sqSum / n);
	return std / mean;
}

/**
 * Turn rate (degrees per second) between three points, using the bearing change
 * at the middle point over the elapsed time. Returns 0 at segment edges or when
 * headings are missing. Trains maintain low turn rates; cars turn far more in
 * urban driving — this is the strongest train-vs-car discriminator we have
 * without map matching.
 */
function turnRateDegPerSec(prev: ModeObservation, curr: ModeObservation): number {
	if (prev.heading == null || curr.heading == null) return 0;
	const dt = (curr.timestamp - prev.timestamp) / 1000;
	if (dt <= 0) return 0;
	return Math.abs(headingDelta(curr.heading, prev.heading)) / dt;
}

/**
 * Map GPS accuracy to an emission weight in [0, 1]. Fixes worse than 100m are
 * heavily discounted (>100m excluded entirely → weight 0), 50–100m half-weight,
 * <50m full. This matches the existing multi-point-speed weighting policy so
 * the HMM and legacy detector treat noisy fixes the same way.
 */
function accuracyWeight(accuracy: number | null): number {
	if (accuracy == null) return 1; // unknown accuracy → assume decent
	if (accuracy > 100) return 0;
	if (accuracy > 50) return 0.5;
	return 1;
}

/**
 * Extract features for every observation in a segment, using the provided
 * rolling window sizes for the speed-CV signal. The window is centred (clamped
 * at the edges) so each point's CV reflects its local neighbourhood.
 *
 * `cvWindow` defaults to 5 — large enough to measure "is the speed steady?"
 * (the train-vs-car signal) but small enough to react within a stop-start
 * urban segment.
 */
export function extractFeatures(observations: ModeObservation[], cvWindow = 5): ModeFeatures[] {
	const n = observations.length;
	const features: ModeFeatures[] = new Array(n);

	for (let i = 0; i < n; i++) {
		const obs = observations[i];

		// Speed window for CV: centred, clamped to bounds.
		const half = Math.floor(cvWindow / 2);
		const lo = Math.max(0, i - half);
		const hi = Math.min(n, i + half + 1);
		const window = observations.slice(lo, hi).map((o) => clampSpeed(o.speed));
		const speedCV = coefficientOfVariation(window);

		// Turn rate relative to the previous point (0 at i=0).
		const prev = i > 0 ? observations[i - 1] : obs;
		const headingTurnRate = turnRateDegPerSec(prev, obs);

		features[i] = {
			speed: clampSpeed(obs.speed),
			speedCV,
			headingTurnRate,
			atTrainStation: isAtTrainStation(obs.geocode),
			atAirport: isAtAirport(obs.geocode),
			onHighway: isOnHighwayOrMotorway(obs.geocode),
			atVenue: getVenueTypeFromAddendum(obs.geocode) !== null,
			accuracyWeight: accuracyWeight(obs.accuracy),
			onWater: isOnWaterGeocode(obs.geocode),
			stationProximity: 0 // injected by the detector per-segment after extraction
		};
	}

	return features;
}
