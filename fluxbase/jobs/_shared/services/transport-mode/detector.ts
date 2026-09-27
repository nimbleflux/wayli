// /Users/bart/Dev/wayli/fluxbase/jobs/_shared/services/transport-mode/detector.ts
// Mirrors web/src/lib/services/transport-mode/detector.ts. Update both together.

import { segmentByGaps } from './segmentation.ts';
import { extractFeatures } from './features.ts';
import { viterbi, confidenceForPoint, emissionScores } from './model.ts';
import { isAtTrainStation, isOnWaterGeocode } from './geocode-features.ts';
import { TRANSPORT_MODES, type TransportMode } from './states.ts';
import type {
	ModeFeatures,
	ModeObservation,
	PointModeDecision,
	DetectionContext,
	SegmentContext
} from './types.ts';

/** Number of trailing observations retained from the previous batch for cross-batch continuity. */
const CONTINUITY_TAIL = 6;

/** Half-decay window for per-point station proximity (ms). */
const STATION_CONTAGION_MS = 3 * 60 * 1000;

/**
 * Compute whole-segment signals that per-point features can't capture. Station
 * anchoring is per-point: each point gets a `stationProximity` weight in [0,1],
 * highest near (in time) a station point WITHIN THE SAME GAP-BOUNDED SEGMENT and
 * decaying with temporal distance — so a long drive that merely passed one
 * station is not boosted as train end-to-end.
 */
function computeSegmentContext(segment: ModeObservation[]): {
	segCtx: SegmentContext;
	proximity: number[];
} {
	const n = segment.length;
	const stationTs: number[] = [];
	for (let i = 0; i < n; i++) {
		if (isAtTrainStation(segment[i].geocode)) stationTs.push(segment[i].timestamp);
	}
	const proximity = new Array(n).fill(0);
	if (stationTs.length > 0) {
		for (let i = 0; i < n; i++) {
			let minDt = Infinity;
			for (const ts of stationTs) {
				const dt = Math.abs(segment[i].timestamp - ts);
				if (dt < minDt) minDt = dt;
			}
			proximity[i] = Math.exp(-minDt / STATION_CONTAGION_MS);
		}
	}
	let intervalSum = 0;
	let intervalCount = 0;
	for (let i = 1; i < n; i++) {
		const dt = (segment[i].timestamp - segment[i - 1].timestamp) / 1000;
		if (dt > 0) {
			intervalSum += dt;
			intervalCount++;
		}
	}
	// Water evidence (#220): fraction of geocoded points on open water; 0 when
	// no point carries a geocode attempt.
	let geocodedCount = 0;
	let waterCount = 0;
	for (let i = 0; i < n; i++) {
		if (segment[i].geocode == null) continue;
		geocodedCount++;
		if (segment[i].geocode && isOnWaterGeocode(segment[i].geocode)) waterCount++;
	}
	return {
		segCtx: {
			meanIntervalSec: intervalCount > 0 ? intervalSum / intervalCount : 0,
			waterFraction: geocodedCount > 0 ? waterCount / geocodedCount : 0
		},
		proximity
	};
}

function reasonFor(mode: TransportMode, speed: number): string {
	switch (mode) {
		case 'stationary':
			return 'speed_below_stationary_threshold';
		case 'walking':
			return 'speed_in_walking_range';
		case 'cycling':
			return 'speed_in_cycling_range';
		case 'car':
			return speed > 110 ? 'speed_in_high_speed_car_range' : 'speed_in_car_range';
		case 'train':
			return 'steady_speed_with_rail_context';
		case 'airplane':
			return 'speed_in_airplane_range';
		case 'boat':
			return 'open_water_no_land_evidence';
		case 'swimming':
			return 'open_water_slow_speed';
		default:
			return 'hmm_decoded';
	}
}

export function detectTransportModes(
	observations: ModeObservation[],
	context: DetectionContext = {}
): PointModeDecision[] {
	if (observations.length === 0) return [];

	// Prepend the previous batch's tail so the first points of this batch get a
	// real Viterbi context instead of being treated as segment starts.
	const tail = context.prevObs ?? [];
	const combined = tail.length > 0 ? [...tail, ...observations] : observations;
	const tailLen = combined.length - observations.length;

	const decisions: PointModeDecision[] = [];
	let segStart = 0;

	const flushSegment = (endExclusive: number) => {
		const segment = combined.slice(segStart, endExclusive);
		if (segment.length === 0) return;
		const features: ModeFeatures[] = extractFeatures(segment);

		// Whole-segment context: per-point station proximity + measurement
		// density. Proximity is injected into the per-point features so the
		// emission model anchors train classification LOCALLY (near a station).
		const { segCtx, proximity } = computeSegmentContext(segment);
		for (let i = 0; i < features.length; i++) features[i].stationProximity = proximity[i];

		if (segment.length === 1) {
			const scores = emissionScores(features[0], segCtx);
			let bestIdx = 0;
			let best = -Infinity;
			for (let m = 0; m < scores.length; m++) {
				if (scores[m] > best) {
					best = scores[m];
					bestIdx = m;
				}
			}
			const mode = TRANSPORT_MODES[bestIdx];
			decisions.push({
				timestamp: segment[0].timestamp,
				mode,
				reason: reasonFor(mode, segment[0].speed),
				confidence: confidenceForPoint(features[0], bestIdx)
			});
			return;
		}

		const { path } = viterbi(features, segCtx);
		for (let i = 0; i < segment.length; i++) {
			const mode = TRANSPORT_MODES[path[i]];
			decisions.push({
				timestamp: segment[i].timestamp,
				mode,
				reason: reasonFor(mode, segment[i].speed),
				confidence: confidenceForPoint(features[i], path[i])
			});
		}
	};

	// Gap-segment using the shared helper (single source of truth for what a
	// "segment" is).
	for (const seg of segmentByGaps(combined)) {
		segStart = seg[0];
		flushSegment(seg[seg.length - 1] + 1);
	}

	// Discard the decisions produced for the context tail — the caller only
	// wants one decision per observation in THIS batch.
	return decisions.slice(tailLen);
}
