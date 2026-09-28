// web/src/lib/services/transport-mode/valhalla-confirm.ts
// Mirrors fluxbase/jobs/_shared/services/transport-mode/valhalla-confirm.ts. Update both together.
//
import { segmentByGaps, SEGMENT_GAP_MS } from './segmentation';
import type { ModeObservation, PointModeDecision } from './types';
import type { TransportMode } from './states';
import type {
	ValhallaCosting,
	ValhallaTracePoint,
	ValhallaTraceResult
} from '../external/valhalla.service';
import {
	modeFromEdges,
	OFFROAD_TRAIN_MIN_KMH,
	offRoadClassification,
	POOR_MATCH_LENGTH_RATIO,
	railCloneVerdict,
	type RunSpeedStats
} from './valhalla-mapping';
import { meanNearestDistanceMeters } from '../trip-route/trip-route-geometry';
import { haversineMeters } from '../trip-route/trip-route-geometry';

/** Injectable Valhalla client (for tests). */
export interface ValhallaClient {
	traceAttributes(
		points: ValhallaTracePoint[],
		costing: ValhallaCosting
	): Promise<ValhallaTraceResult>;
}

/** Stage-1 modes in the ambiguous overlap zone that benefit from map matching. */
const AMBIGUOUS_MODES = new Set<TransportMode>(['car', 'train']);

/** Stage-1 confidence below this → send to Valhalla for confirmation. */
const CONFIDENCE_THRESHOLD = 0.6;

/** Observed p90 speed (km/h) at or above which a segment is always probed. */
const FAST_SEGMENT_P90_KMH = 60;

/** Observed p90 speed (km/h) at or above which matching always uses `auto`. */
const AUTO_COSTING_P90_KMH = 40;

/** Max probing API calls per job batch (bounds Valhalla load + duration). */
const MAX_SEGMENTS_PER_CALL = 150;

/** Max gap (ms) between consecutive segments still treated as one journey. */
const RUN_MERGE_GAP_MS = 30 * 60 * 1000;

/** Rail-clone probe window (km/h, p90 of MOVING points). */
const RAIL_PROBE_MIN_P90_KMH = 25;
const RAIL_PROBE_MAX_P90_KMH = 250;

/** Max points per rail-clone probe slice (bounds meili per-request work). */
const RAIL_PROBE_SLICE_POINTS = 10;

/** A positive rail verdict requires the run's moving-point median at or
 *  above this speed — clones make rails matchable, so a match alone proves
 *  nothing without rail-like kinematics. */
const RAIL_POSITIVE_MIN_MOVING_P50_KMH = 100;

/** Confidence for slices labeled train by run context (no direct clone match
 *  of their own — station approaches, urban canyons of a confirmed journey). */
const RAIL_RUN_CONTEXT_CONFIDENCE = 0.85;

/** Median inter-point interval above this marks a slice as sparse — the
 *  distance-trigger recording regime, whose speed column carries haversine
 *  glitch spikes unusable for kinematic gating. */
const SPARSE_SLICE_MEDIAN_INTERVAL_MS = 120_000;

/** True when the slice's points are so far apart that the recorded speeds are
 *  distance-trigger artifacts rather than GPS Doppler speeds. */
function isSparseSlice(slice: ModeObservation[]): boolean {
	const intervals: number[] = [];
	for (let i = 1; i < slice.length; i++) {
		intervals.push(slice[i].timestamp - slice[i - 1].timestamp);
	}
	if (intervals.length === 0) return false;
	intervals.sort((a, b) => a - b);
	return intervals[Math.floor(intervals.length / 2)] > SPARSE_SLICE_MEDIAN_INTERVAL_MS;
}

/** Median per-interval speed (haversine distance / elapsed time) in km/h — the
 *  kinematic truth for sparse slices, whose speed column is garbage. */
function intervalMedianKmh(slice: ModeObservation[]): number {
	const speeds: number[] = [];
	for (let i = 1; i < slice.length; i++) {
		const dt = (slice[i].timestamp - slice[i - 1].timestamp) / 1000;
		if (dt <= 0) continue;
		speeds.push((haversineMeters(slice[i - 1], slice[i]) / dt) * 3.6);
	}
	if (speeds.length === 0) return 0;
	speeds.sort((a, b) => a - b);
	return speeds[Math.floor(speeds.length / 2)];
}

/** Map a Stage-1 mode to the Valhalla costing that matches it. */
function costingForMode(mode: TransportMode): ValhallaCosting {
	switch (mode) {
		case 'walking':
		case 'stationary':
			return 'pedestrian';
		case 'cycling':
			return 'bicycle';
		default:
			// car, train, airplane, unknown — auto is the most permissive road matcher.
			return 'auto';
	}
}

/** Percentile of observed speeds (km/h), ignoring missing values. */
function p90Speed(observations: ModeObservation[]): number {
	const speeds = observations
		.map((o) => o.speed)
		.filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
		.toSorted((a, b) => a - b);
	if (speeds.length === 0) return 0;
	const idx = Math.min(speeds.length - 1, Math.floor(speeds.length * 0.9));
	return speeds[idx];
}

function speedStatsFor(observations: ModeObservation[]): RunSpeedStats | null {
	const speeds = observations
		.map((o) => o.speed)
		.filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
	const p90Kmh = p90Speed(observations);
	const durationSec =
		observations.length >= 2
			? (observations[observations.length - 1].timestamp - observations[0].timestamp) / 1000
			: null;
	let pathMeters = 0;
	for (let i = 1; i < observations.length; i++) {
		pathMeters += haversineMeters(observations[i - 1], observations[i]);
	}
	if (speeds.length === 0) return null;
	return {
		p90Kmh,
		avgKmh: durationSec && durationSec > 0 ? (pathMeters / durationSec) * 3.6 : null,
		pathMeters,
		durationSec
	};
}

function tracePoints(observations: ModeObservation[]): ValhallaTracePoint[] {
	return observations.map((o) => ({ lat: o.lat, lon: o.lng, timestamp: o.timestamp }));
}

/** Split a run into probe slices of ≤ RAIL_PROBE_SLICE_POINTS points (≥ 2 each). */
function sliceRun(observations: ModeObservation[]): ModeObservation[][] {
	const slices: ModeObservation[][] = [];
	let cur: ModeObservation[] = [];
	for (const o of observations) {
		cur.push(o);
		if (cur.length >= RAIL_PROBE_SLICE_POINTS) {
			slices.push(cur);
			cur = [];
		}
	}
	if (cur.length > 0) {
		if (cur.length < 2 && slices.length > 0) {
			slices[slices.length - 1].push(...cur); // don't leave a 1-point slice
		} else {
			slices.push(cur);
		}
	}
	return slices;
}

/**
 * Send uncertain segments to Valhalla and merge the confirmed modes back into
 * the decisions. Everything that isn't overridden passes through untouched.
 * Valhalla failures are logged and swallowed — Stage-1 results are always
 * preserved as the fallback (graceful degradation).
 */
export async function confirmWithValhalla(
	observations: ModeObservation[],
	decisions: PointModeDecision[],
	valhalla: ValhallaClient,
	disabledModes?: ReadonlySet<string>
): Promise<PointModeDecision[]> {
	if (observations.length === 0 || decisions.length === 0) return decisions;
	if (observations.length !== decisions.length) {
		console.warn(
			`[valhalla-confirm] observations (${observations.length}) != decisions (${decisions.length}); skipping`
		);
		return decisions;
	}

	const segmentIdxGroups = segmentByGaps(observations, SEGMENT_GAP_MS);

	// Per-segment candidate gate: which fragments get individual auto probes.
	const isCandidate = (idxs: number[]): boolean => {
		const first = decisions[idxs[0]];
		const p90 = p90Speed(idxs.map((i) => observations[i]));
		return (
			AMBIGUOUS_MODES.has(first.mode) ||
			first.confidence < CONFIDENCE_THRESHOLD ||
			p90 >= FAST_SEGMENT_P90_KMH
		);
	};

	// Merge consecutive segments into runs (30-min gap): a journey's fragments
	// — including sparse slow ones — are evaluated together by the rail probe.
	const runs: number[][] = [];
	for (const idxs of segmentIdxGroups) {
		const run = runs[runs.length - 1];
		if (
			run &&
			observations[idxs[0]].timestamp - observations[run[run.length - 1]].timestamp <
				RUN_MERGE_GAP_MS
		) {
			run.push(...idxs);
		} else {
			runs.push([...idxs]);
		}
	}

	let apiCalls = 0;
	const overCap = () => apiCalls >= MAX_SEGMENTS_PER_CALL;

	const result = [...decisions];
	let confirmed = 0;
	let overridden = 0;
	const apply = (idxs: number[], mode: string, evidence: string, confidence: number) => {
		// #220: a user-disabled mode can never be (re)assigned by Stage 2.
		if (disabledModes?.has(mode)) return;
		for (const i of idxs) {
			result[i] = {
				...result[i],
				mode: mode as PointModeDecision['mode'],
				reason: evidence,
				confidence
			};
		}
	};

	for (const runIdxs of runs) {
		const runObs = runIdxs.map((i) => observations[i]);
		if (runObs.length < 2) continue; // a single point cannot be matched
		const runP90 = p90Speed(runObs);
		const movingSpeeds = runObs
			.map((o) => o.speed)
			.filter((s): s is number => typeof s === 'number' && s >= 5)
			.toSorted((a, b) => a - b);
		const runMovingP50 =
			movingSpeeds.length > 0 ? movingSpeeds[Math.floor(movingSpeeds.length / 2)] : 0;
		let railConfirmed = false;

		// ─── Tier 0: rail-clone probe ────────────────────────────────────────
		// Rail-plausible = the MOVING points' p90 sits in the rail window.
		// Station dwells (walking-speed points) must not hide a rail run.
		const movingObs = runObs.filter((o) => (o.speed ?? 0) >= 5);
		const probeP90 = movingObs.length >= 2 ? p90Speed(movingObs) : runP90;
		const railPlausible = probeP90 >= RAIL_PROBE_MIN_P90_KMH && probeP90 <= RAIL_PROBE_MAX_P90_KMH;

		if (railPlausible && !overCap()) {
			// Each slice is judged on its OWN evidence first: slices along a rail
			// corridor match clones at high share (train), slices through station
			// areas or streets match footways (not train). Afterwards, a single
			// definitive slice anchors a run-level extension (below) that recovers
			// the ambiguous slices of the SAME journey.
			type SliceVerdict = { idxs: number[]; share: number | null; sparse: boolean };
			const sliceVerdicts: SliceVerdict[] = [];
			const slices = sliceRun(runObs);
			for (const slice of slices) {
				if (overCap()) break;
				const sliceStart = slice[0].timestamp;
				const sliceEnd = slice[slice.length - 1].timestamp;
				const sliceIdxs = runIdxs.filter(
					(i) => observations[i].timestamp >= sliceStart && observations[i].timestamp <= sliceEnd
				);
				if (sliceIdxs.length === 0) continue;
				const sparse = isSparseSlice(slice);
				try {
					// eslint-disable-next-line no-await-in-loop -- slices are probed sequentially by design (bounded by MAX_SEGMENTS_PER_CALL)
					const trace = await valhalla.traceAttributes(tracePoints(slice), 'pedestrian');
					apiCalls++;

					let sliceLenM = 0;
					let sliceCloneM = 0;
					for (const e of trace.edges) {
						const len = typeof e.length === 'number' && e.length > 0 ? e.length * 1000 : 0;
						sliceLenM += len;
						if ((e.names ?? []).some((n) => n.startsWith('RAILWAY | '))) {
							sliceCloneM += len;
						}
					}

					const share = sliceLenM > 0 ? sliceCloneM / sliceLenM : 0;
					sliceVerdicts.push({ idxs: sliceIdxs, share, sparse });

					// Positive verdict needs rail-like kinematics too: a car
					// corridor slice can pick up clones, but a real train's
					// moving-point median sits at motorway speeds.
					if (share > 0.5 && runMovingP50 >= RAIL_POSITIVE_MIN_MOVING_P50_KMH) {
						confirmed++;
						railConfirmed = true;
						if (decisions[runIdxs[0]].mode !== 'train') overridden++;
						apply(sliceIdxs, 'train', 'valhalla_rail_edge', 0.95);
					} else if (share < 0.1) {
						// Followed the pedestrian network, not rails — UNLESS the
						// match itself is untrustworthy. On a sparse slice (GPS
						// dropout between distance triggers — common on trains) a
						// pedestrian match covering a small fraction of the path is
						// meaningless: meili cannot follow a train through scattered
						// fixes. The speed column is equally untrustworthy there
						// (glitch spikes), so sparse kinematics come from the
						// per-interval path/duration speeds.
						const sliceStats = speedStatsFor(slice);
						const matchTrusted =
							!sparse ||
							intervalMedianKmh(slice) < OFFROAD_TRAIN_MIN_KMH ||
							(sliceStats != null &&
								sliceStats.pathMeters > 0 &&
								sliceLenM / sliceStats.pathMeters >= POOR_MATCH_LENGTH_RATIO);
						// Trusted matches suppress station-context train labels
						// (cars passing stations at street level).
						let flipped = 0;
						if (matchTrusted) {
							for (const i of sliceIdxs) {
								if (result[i].mode === 'train') {
									result[i] = {
										...result[i],
										mode: 'car',
										reason: 'valhalla_pedestrian_not_rail',
										confidence: 0.6
									};
									flipped++;
								}
							}
							if (flipped > 0) confirmed++;
						}
						// A rail-confirmed run skips Tier 1 entirely, so street-level
						// slices get their edge verdict HERE: a walk-to-station or
						// platform-dwell slice matches footways at walking speed.
						// modeFromEdges' kinematic gates keep fast slices (and
						// plain road matches, which are inconclusive) on Stage-1.
						if (trace.edges.length > 0) {
							if (sliceStats && sliceStats.avgKmh != null && isSparseSlice(slice)) {
								// Sparse (distance-trigger) slices carry haversine
								// glitch speeds — a real walk shows 100+ km/h spikes —
								// so the gates use the path/duration average instead.
								sliceStats.p90Kmh = Math.min(sliceStats.p90Kmh, sliceStats.avgKmh);
							}
							const verdict = modeFromEdges(trace.edges, sliceStats ?? undefined);
							if (verdict) {
								confirmed++;
								if (verdict.mode !== decisions[sliceIdxs[0]].mode) overridden++;
								apply(sliceIdxs, verdict.mode, verdict.evidence, verdict.confidence);
							}
						}
					}
					// 0.1 ≤ share ≤ 0.5: ambiguous — resolved by the run-level
					// extension below when the run has a positive anchor slice.
				} catch (err) {
					// A failed probe carries no evidence for or against rail; if
					// the rest of the run confirms rail, the extension recovers
					// these points, otherwise Stage-1 stands.
					console.warn(
						`[valhalla-confirm] rail probe slice failed (${slice[0].timestamp}):`,
						err instanceof Error ? err.message : err
					);
					sliceVerdicts.push({ idxs: sliceIdxs, share: null, sparse });
				}
			}

			// ─── Run-level extension ────────────────────────────────────────
			// One definitive clone match makes the whole run a train journey:
			// the ambiguous slices (0.1–0.5 share) and failed probes are station
			// approaches and urban canyons of that journey, not separate car
			// legs. Suppressed slices keep their street-level outcome for slow
			// points (drive-to-station, platform dwells) — but a point moving
			// at rail speed on a "pedestrian" match is a canyon artifact, not
			// a car, and is recovered here too.
			if (railConfirmed) {
				for (const { idxs, share, sparse } of sliceVerdicts) {
					if (share !== null && share > 0.5) continue; // already train @0.95
					if (share !== null && share < 0.1) {
						// Sparse slices' speed columns are untrustworthy — only a
						// dense pedestrian match carries the canyon-artifact signal.
						if (sparse) continue;
						const fastIdxs = idxs.filter(
							(i) => (observations[i].speed ?? 0) >= RAIL_POSITIVE_MIN_MOVING_P50_KMH
						);
						if (fastIdxs.length === 0) continue;
						confirmed++;
						overridden += fastIdxs.filter((i) => decisions[i].mode !== 'train').length;
						apply(fastIdxs, 'train', 'valhalla_rail_run_context', RAIL_RUN_CONTEXT_CONFIDENCE);
						continue;
					}
					confirmed++;
					if (decisions[idxs[0]].mode !== 'train') overridden++;
					apply(idxs, 'train', 'valhalla_rail_run_context', RAIL_RUN_CONTEXT_CONFIDENCE);
				}
			}
		}

		// Positive clone evidence on the corridor makes the tier-1.5
		// off-road fallback unnecessary for this run.
		if (!railConfirmed) {
			// ─── Tier 1: per-segment auto probes + sanity-gated edge verdicts ───
			for (const idxs of segmentIdxGroups) {
				// Only candidate segments get individual probes (cost control) —
				// non-candidate points keep their Stage-1 result.
				if (idxs.length < 2 || !isCandidate(idxs) || !idxs.some((i) => runIdxs.includes(i)))
					continue;
				if (overCap()) break;
				const segmentObs = idxs.map((i) => observations[i]);
				const segP90 = p90Speed(segmentObs);
				const segCosting: ValhallaCosting =
					segP90 >= AUTO_COSTING_P90_KMH ? 'auto' : costingForMode(decisions[idxs[0]].mode);
				try {
					// eslint-disable-next-line no-await-in-loop -- segments are matched sequentially by design (bounded by MAX_SEGMENTS_PER_CALL)
					const trace = await valhalla.traceAttributes(tracePoints(segmentObs), segCosting);
					apiCalls++;

					const segStats = speedStatsFor(segmentObs);
					const verdict =
						trace.edges.length > 0 ? modeFromEdges(trace.edges, segStats ?? undefined) : null;
					if (verdict) {
						confirmed++;
						if (verdict.mode !== decisions[idxs[0]].mode) overridden++;
						apply(idxs, verdict.mode, verdict.evidence, verdict.confidence);
					}
				} catch (err) {
					// Non-fatal: log and keep Stage-1 for this segment.
					console.warn(
						`[valhalla-confirm] trace_attributes failed for segment (${segmentObs[0].timestamp}):`,
						err instanceof Error ? err.message : err
					);
				}
			}

			// ─── Tier 1.5: gated off-road inference for sparse long runs ────────
			// Only for runs the rail probe could not positively identify (and
			// that are demonstrably FAST long journeys: moving-point median
			// >= 100 km/h, >= 30 km traveled). Sparse intercity trains have
			// point gaps that break meili, so their auto matches fail — that
			// alone is not evidence, but combined with the kinematic floor it
			// recovers them. Ordinary car days sit at movingP50 ~77 and are
			// excluded.
			if (!railConfirmed && runP90 >= AUTO_COSTING_P90_KMH && !overCap()) {
				const movingSpeeds = runObs
					.map((o) => o.speed)
					.filter((s): s is number => typeof s === 'number' && s >= 5)
					.toSorted((a, b) => a - b);
				const movingP50 =
					movingSpeeds.length > 0 ? movingSpeeds[Math.floor(movingSpeeds.length / 2)] : 0;
				let pathMeters = 0;
				for (let i = 1; i < runObs.length; i++) {
					pathMeters += haversineMeters(runObs[i - 1], runObs[i]);
				}
				if (movingP50 >= 100 && pathMeters >= 30_000) {
					try {
						// eslint-disable-next-line no-await-in-loop -- one bounded probe per run
						const trace = await valhalla.traceAttributes(tracePoints(runObs), 'auto');
						apiCalls++;
						const offRoad = offRoadClassification({
							raw: runObs,
							shape: trace.shape.map((s) => ({ lat: s.lat, lng: s.lon })),
							edges: trace.edges,
							speedsKmh: runObs
								.map((o) => o.speed)
								.filter((s): s is number => typeof s === 'number'),
							durationSec:
								runObs.length >= 2
									? (runObs[runObs.length - 1].timestamp - runObs[0].timestamp) / 1000
									: null
						});
						if (offRoad) {
							confirmed++;
							if (offRoad.mode !== decisions[runIdxs[0]].mode) overridden++;
							apply(runIdxs, offRoad.mode, offRoad.evidence, offRoad.confidence);
						}
					} catch (err) {
						// Non-fatal: probe failures carry no inference.
						console.warn(
							`[valhalla-confirm] gated off-road probe failed for run (${runObs[0].timestamp}):`,
							err instanceof Error ? err.message : err
						);
					}
				}
			}
		}
	}

	if (confirmed > 0) {
		console.log(`[valhalla-confirm] ${confirmed} verdicts applied, ${overridden} overridden`);
	}

	return result;
}
