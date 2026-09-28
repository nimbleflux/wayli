// /Users/bart/Dev/wayli/fluxbase/jobs/_shared/services/transport-mode/features.ts
// Mirrors web/src/lib/services/transport-mode/features.ts. Update both together.

import type { ModeFeatures, ModeObservation } from './types.ts';
import {
	isAtTrainStation,
	isAtAirport,
	isOnHighwayOrMotorway,
	getVenueTypeFromAddendum,
	isOnWaterGeocode
} from './geocode-features.ts';
import { MAX_PLAUSIBLE_SPEED_KMH } from './config.ts';

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

function headingDelta(a: number, b: number): number {
	let d = ((a - b + 540) % 360) - 180;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}

function coefficientOfVariation(speeds: number[]): number {
	const n = speeds.length;
	if (n === 0) return 0;
	const mean = speeds.reduce((s, v) => s + v, 0) / n;
	if (mean < 0.5) return 0;
	let sqSum = 0;
	for (const v of speeds) sqSum += (v - mean) * (v - mean);
	const std = Math.sqrt(sqSum / n);
	return std / mean;
}

function turnRateDegPerSec(prev: ModeObservation, curr: ModeObservation): number {
	if (prev.heading == null || curr.heading == null) return 0;
	const dt = (curr.timestamp - prev.timestamp) / 1000;
	if (dt <= 0) return 0;
	return Math.abs(headingDelta(curr.heading, prev.heading)) / dt;
}

function accuracyWeight(accuracy: number | null): number {
	if (accuracy == null) return 1;
	if (accuracy > 100) return 0;
	if (accuracy > 50) return 0.5;
	return 1;
}

export function extractFeatures(observations: ModeObservation[], cvWindow = 5): ModeFeatures[] {
	const n = observations.length;
	const features: ModeFeatures[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const obs = observations[i];
		const half = Math.floor(cvWindow / 2);
		const lo = Math.max(0, i - half);
		const hi = Math.min(n, i + half + 1);
		const window = observations.slice(lo, hi).map((o) => clampSpeed(o.speed));
		const speedCV = coefficientOfVariation(window);
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
			stationProximity: 0
		};
	}
	return features;
}
