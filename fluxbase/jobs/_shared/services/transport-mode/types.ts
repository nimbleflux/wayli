// /Users/bart/Dev/wayli/fluxbase/jobs/_shared/services/transport-mode/types.ts
// Mirrors web/src/lib/services/transport-mode/types.ts. Update both together.

import type { GeocodeGeoJSONFeature } from '../../utils/geojson-converter.ts';
import type { TransportMode } from './states.ts';

export interface ModeObservation {
	timestamp: number;
	lat: number;
	lng: number;
	speed: number; // km/h
	heading: number | null; // degrees [0,360)
	accuracy: number | null; // meters
	geocode?: GeocodeGeoJSONFeature | null;
}

export interface ModeFeatures {
	speed: number;
	speedCV: number;
	headingTurnRate: number;
	atTrainStation: boolean;
	atAirport: boolean;
	onHighway: boolean;
	atVenue: boolean;
	accuracyWeight: number;
	/** Per-point water evidence (#220), see web types.ts. */
	onWater: boolean;
}

/**
 * Segment-level signals computed once per Viterbi segment (not per point) and
 * threaded into the emission model. These give every point in a segment access
 * to whole-journey context that per-point features can't capture:
 *
 *  - `touchesStation`: true if ANY point in this movement segment was at a train
 *    station. Made segment-contagious (the whole moving segment leans train)
 *    rather than boosting only the single station point — this is what lets a
 *    station visit at the start/end anchor the whole train journey.
 *  - `meanIntervalSec`: mean inter-point interval for the segment. Empirically,
 *    car trips (phone navigation on) produce dense fixes while train trips
 *    (phone idle) produce sparse ones; this is a weak-but-free discriminator
 *    derived from the already-computed time_spent.
 */
export interface SegmentContext {
	touchesStation: boolean;
	meanIntervalSec: number;
	/** Fraction [0,1] of geocoded points with water evidence (#220); 0 when none attempted. */
	waterFraction: number;
}

export interface PointModeDecision {
	timestamp: number;
	mode: TransportMode;
	reason: string;
	confidence: number;
}

/**
 * Optional context threaded between successive `detectTransportModes` calls so a
 * journey spanning a page/batch boundary is decoded as one Viterbi segment
 * instead of two independent halves that can disagree at the seam.
 *
 * `prevObs` should be the last N observations of the previous batch (most-recent
 * last). They are prepended for feature extraction + Viterbi context and then
 * trimmed from the returned decisions, so the output stays 1:1 with the current
 * batch's observations. A >SEGMENT_GAP_MS gap between the tail and the current
 * batch splits them naturally (the tail's recomputed decisions are discarded).
 */
export interface DetectionContext {
	prevObs?: ModeObservation[];
	/**
	 * Modes the user has switched off (#220). Disabled modes get zero emission
	 * probability — a hard exclusion. Empty/undefined keeps prior behavior.
	 */
	disabledModes?: TransportMode[];
}
