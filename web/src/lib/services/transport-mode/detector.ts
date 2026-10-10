// /Users/bart/Dev/wayli/web/src/lib/services/transport-mode/detector.ts
//
// High-level detector: takes a chronologically-ordered list of observations,
// gap-segments them, runs the HMM per segment, and returns one mode decision
// per point. This is the single entry point shared by the browser (Location
// Data page) and the Deno background job (persistence).

import { segmentByGaps } from './segmentation';
import { extractFeatures } from './features';
import { viterbi, confidenceForPoint, emissionScores } from './model';
import { isAtTrainStation, isOnWaterGeocode } from '../../utils/transport-mode';
import { TRANSPORT_MODES, type TransportMode } from './states';
import type {
	ModeFeatures,
	ModeObservation,
	PointModeDecision,
	DetectionContext,
	SegmentContext
} from './types';

/** Number of trailing observations retained from the previous batch for cross-batch continuity. */
const CONTINUITY_TAIL = 6;

/**
 * Compute whole-segment signals that per-point features can't capture.
 *
 * Station anchoring is per-point (not whole-segment): each point gets a
 * `stationProximity` weight in [0,1] that is highest near (in time) a station
 * point WITHIN THE SAME GAP-BOUNDED SEGMENT and decays with temporal distance.
 * This anchors train classification LOCALLY around a station visit — a long
 * drive that merely passes one station is not boosted as train end-to-end.
 * `STATION_CONTAGION_MS` is the half-decay window.
 */
const STATION_CONTAGION_MS = 3 * 60 * 1000; // 3 min half-decay

function computeSegmentContext(segment: ModeObservation[]): {
	segCtx: SegmentContext;
	proximity: number[];
} {
	const n = segment.length;
	// Temporal distance from each point to the nearest station point in the segment.
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
			// Exponential decay: 1.0 at a station, ~0.5 at STATION_CONTAGION_MS,
			// ~0.13 at 2x. Clamps to 0 beyond ~6x (effectively out of contagion).
			proximity[i] = Math.exp(-minDt / STATION_CONTAGION_MS);
		}
	}

	let intervalSum = 0;
	let intervalCount = 0;
	let speedSum = 0;
	for (let i = 0; i < n; i++) speedSum += segment[i].speed;
	for (let i = 1; i < n; i++) {
		const dt = (segment[i].timestamp - segment[i - 1].timestamp) / 1000;
		if (dt > 0) {
			intervalSum += dt;
			intervalCount++;
		}
	}

	// Water evidence (#220): fraction of geocoded points on open water.
	// Points without a geocode attempt count toward neither side — an
	// un-geocoded segment gets fraction 0 and can never trigger boat/swimming.
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
			waterFraction: geocodedCount > 0 ? waterCount / geocodedCount : 0,
			// #242: single-point segments keep 0 — the running/cycling
			// discriminators gate on >0 to stay neutral there.
			meanSpeedKmh: n > 0 ? speedSum / n : 0
		},
		proximity
	};
}

function reasonFor(mode: TransportMode, speed: number): string {
	// Human-readable reason string stored in detection_reason. Kept aligned with
	// the TransportDetectionReason enum vocabulary the UI already labels.
	switch (mode) {
		case 'stationary':
			return 'speed_below_stationary_threshold';
		case 'walking':
			return 'speed_in_walking_range';
		case 'running':
			return 'speed_in_running_range';
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

/**
 * Decode an ordered list of observations into per-point transport-mode decisions.
 *
 * The caller MUST pass observations sorted ascending by timestamp. Points are
 * grouped into segments wherever the gap to the previous point exceeds
 * SEGMENT_GAP_MS (5 min) — each segment is decoded independently with Viterbi,
 * which is exactly the boundary where prior context (a tunnel, a flight) should
 * no longer influence the current mode.
 *
 * `context` lets the caller carry over the tail of the previous batch so a
 * journey that spans a page/batch boundary is decoded as one Viterbi segment
 * rather than two independent halves. The returned decisions are always 1:1
 * with `observations` (the context tail is prepended for context only and then
 * trimmed from the output). A >SEGMENT_GAP_MS gap between the tail and the
 * current batch splits them naturally. `prevObs` in the returned context is the
 * trailing observations of the combined sequence, ready to thread to the next
 * call.
 *
 * Returns one PointModeDecision per input observation, index-aligned.
 */
export function detectTransportModes(
	observations: ModeObservation[],
	context: DetectionContext = {}
): PointModeDecision[] {
	if (observations.length === 0) return [];

	const disabledSet: ReadonlySet<TransportMode> = new Set(context.disabledModes ?? []);

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
		// density. Station proximity is injected into the per-point features so
		// the emission model can anchor train classification LOCALLY (near a
		// station) rather than across an entire long segment.
		const { segCtx, proximity } = computeSegmentContext(segment);
		for (let i = 0; i < features.length; i++) features[i].stationProximity = proximity[i];

		// Single-point segment: no temporal context, score on emission alone.
		if (segment.length === 1) {
			const scores = emissionScores(features[0], segCtx, disabledSet);
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

		// Multi-point: HMM + Viterbi over the segment.
		const { path } = viterbi(features, segCtx, disabledSet);
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
	// "segment" is — the map editor reuses the same boundaries).
	for (const seg of segmentByGaps(combined)) {
		segStart = seg[0];
		flushSegment(seg[seg.length - 1] + 1);
	}

	// Discard the decisions produced for the context tail — the caller only
	// wants one decision per observation in THIS batch.
	return decisions.slice(tailLen);
}
