// /Users/bart/Dev/wayli/fluxbase/jobs/_shared/services/transport-mode/valhalla-mapping.ts
// Mirrors web/src/lib/services/transport-mode/valhalla-mapping.ts. Update both together.
//
import type { ValhallaEdge } from '../external/valhalla.service';
import type { TransportMode } from './states';
import { haversineMeters, meanNearestDistanceMeters } from '../trip-route/trip-route-geometry';

export interface ValhallaModeVerdict {
	mode: TransportMode;
	confidence: number;
	/** Machine-readable evidence for the detection_reason column. */
	evidence: string;
	/** Dominant street name(s) if available — useful for trip enrichment. */
	names?: string[];
}

/** Observed speed statistics for the segment the edges belong to. */
export interface RunSpeedStats {
	/** 90th percentile of observed speeds, km/h. */
	p90Kmh: number;
	/** Distance/duration average (includes dwell time), km/h. Null without timestamps. */
	avgKmh: number | null;
	/** Haversine path length through the raw points, meters. */
	pathMeters: number;
	/** Segment duration in seconds. Null without usable timestamps. */
	durationSec: number | null;
}

/** Use types that indicate human-powered (non-motorized) movement. */
const WALKING_USES = new Set(['footway', 'steps', 'path', 'pedestrian_crossing', 'elevator']);
const CYCLING_USES = new Set(['cycleway', 'mountain_bike_path']);
/** Road classes that clearly indicate motorized traffic. */
const HIGH_SPEED_CLASSES = new Set(['motorway', 'trunk']);

/** Kinematic impossibility gates for edge-derived verdicts (km/h, p90). */
export const WALKING_MAX_P90_KMH = 15;
export const CYCLING_MAX_P90_KMH = 35;
export const CAR_MAX_P90_KMH = 200;

/**
 * Determine the transport mode from the matched edges.
 *
 * The verdict is by weighted majority of edge length (longer edges count more —
 * a 10km motorway stretch outweighs a 50m driveway). Returns null when the
 * evidence is inconclusive (mixed usage, no dominant class) OR when the verdict
 * is kinematically impossible for the observed speeds — the caller keeps the
 * Stage-1 HMM result in both cases.
 *
 * Rules (checked in order of certainty):
 * 1. rail: true on the majority of edge length → train (definitive; only
 *    reachable on tile builds that make rail routable — stock Valhalla never
 *    returns rail edges, see valhalla#972)
 * 2. walking-use majority → walking (rejected above 15 km/h p90)
 * 3. cycling-use majority → cycling (rejected above 35 km/h p90)
 * 4. high-speed road class + speed > 60 km/h majority → car (rejected above
 *    200 km/h p90)
 * 5. otherwise → null (inconclusive, keep Stage-1)
 */
export function modeFromEdges(
	edges: ValhallaEdge[],
	speedStats?: RunSpeedStats
): ValhallaModeVerdict | null {
	const verdict = modeFromEdgesUnchecked(edges);
	if (!verdict || !speedStats) return verdict;

	// Kinematic sanity gates: an edge-derived verdict that contradicts the
	// observed motion is a matching artifact, not ground truth.
	if (verdict.mode === 'walking' && speedStats.p90Kmh > WALKING_MAX_P90_KMH) return null;
	if (verdict.mode === 'cycling' && speedStats.p90Kmh > CYCLING_MAX_P90_KMH) return null;
	if (verdict.mode === 'car' && speedStats.p90Kmh > CAR_MAX_P90_KMH) return null;
	if (verdict.mode === 'boat' && speedStats.p90Kmh > BOAT_MAX_P90_KMH) return null;
	return verdict;
}

function modeFromEdgesUnchecked(edges: ValhallaEdge[]): ValhallaModeVerdict | null {
	if (edges.length === 0) return null;

	// Weight by edge length (km); fall back to 1.0 when length is missing so
	// every edge counts equally.
	const weightOf = (e: ValhallaEdge): number =>
		typeof e.length === 'number' && e.length > 0 ? e.length : 1;
	const totalWeight = edges.reduce((sum, e) => sum + weightOf(e), 0);

	const weightedCount = (predicate: (e: ValhallaEdge) => boolean): number =>
		edges.reduce((sum, e) => (predicate(e) ? sum + weightOf(e) : sum), 0);

	// 1. Rail — definitive.
	const railWeight = weightedCount((e) => e.rail === true);
	if (railWeight / totalWeight > 0.5) {
		return {
			mode: 'train',
			confidence: 0.95,
			evidence: 'valhalla_rail_edge',
			names: dominantNames(edges, (e) => e.rail === true)
		};
	}

	// 2. Walking uses.
	const walkWeight = weightedCount((e) => WALKING_USES.has(e.use));
	if (walkWeight / totalWeight > 0.5) {
		return {
			mode: 'walking',
			confidence: 0.9,
			evidence: 'valhalla_footway_edge',
			names: dominantNames(edges, (e) => WALKING_USES.has(e.use))
		};
	}

	// 3. Cycling uses.
	const cycleWeight = weightedCount((e) => CYCLING_USES.has(e.use));
	if (cycleWeight / totalWeight > 0.5) {
		return {
			mode: 'cycling',
			confidence: 0.9,
			evidence: 'valhalla_cycleway_edge',
			names: dominantNames(edges, (e) => CYCLING_USES.has(e.use))
		};
	}

	// 3.5 Ferry crossings — definitive water (#220). rail_ferry counts too:
	// the vessel is a boat even when it carries rail cars.
	const ferryWeight = weightedCount((e) => e.use === 'ferry' || e.use === 'rail_ferry');
	if (ferryWeight / totalWeight > 0.5) {
		return {
			mode: 'boat',
			confidence: 0.9,
			evidence: 'valhalla_ferry_edge',
			names: dominantNames(edges, (e) => e.use === 'ferry' || e.use === 'rail_ferry')
		};
	}

	// 4. High-speed motorized roads.
	const highSpeedWeight = weightedCount(
		(e) => HIGH_SPEED_CLASSES.has(e.road_class) && (e.speed ?? 0) > 60
	);
	if (highSpeedWeight / totalWeight > 0.5) {
		return {
			mode: 'car',
			confidence: 0.9,
			evidence: 'valhalla_motorway_edge',
			names: dominantNames(edges, (e) => HIGH_SPEED_CLASSES.has(e.road_class))
		};
	}

	// 5. Inconclusive — caller keeps the Stage-1 result.
	return null;
}

// ─── Off-road classification (the "train on rails" rule) ───────────────────
//
// Stock Valhalla has no railway costing: a train trace matched with auto
// costing snaps to scattered nearby roads and the match is terrible. That
// failure is quantifiable and diagnostic:
//   * matched length ≪ raw path length (real intercity trains: 0.02–0.16;
//     a real car drive ≈ 1.0 — it IS on the road network),
//   * raw points sit far from the matched shape,
//   * matched edges are far slower than the observed GPS speeds.
// Combined with a rail-like speed window, that's a train. Sustained speeds
// beyond any ground transport are a plane.

/** Matched/raw length ratio below this counts as a poor road match. */
export const POOR_MATCH_LENGTH_RATIO = 0.7;
/** Mean raw→snapped deviation (m) above this counts as a poor road match. */
export const POOR_MATCH_DEVIATION_M = 100;
/** Rail window: minimum path length (m) for an off-road train verdict. */
export const OFFROAD_TRAIN_MIN_PATH_M = 5000;
/** Rail speed window (km/h, distance/duration average). */
export const OFFROAD_TRAIN_MIN_KMH = 50;
export const OFFROAD_TRAIN_MAX_KMH = 250;
/** Beyond this sustained average it's a plane. */
export const OFFROAD_PLANE_MIN_KMH = 250;
/** Ferry verdicts are rejected beyond this p90 (matches the boat band ceiling). */
export const BOAT_MAX_P90_KMH = 100;
/** Minimum path length (m) before a plane verdict is allowed. */
export const OFFROAD_PLANE_MIN_PATH_M = 20000;
/** Share of matched length on edges slower than half the GPS speed that
 *  counts as an implausible road match. */
export const OFFROAD_SLOW_EDGE_SHARE = 0.5;

export interface OffRoadInput {
	/** Raw GPS points of the segment, in order. */
	raw: Array<{ lat: number; lng: number }>;
	/** Valhalla's snapped shape (may be empty when unmatched). */
	shape: Array<{ lat: number; lng: number }>;
	/** Matched edges (may be empty when unmatched). */
	edges: ValhallaEdge[];
	/** Observed speeds (km/h), aligned with raw (used for the slow-edge check). */
	speedsKmh: number[];
	/** Segment duration in seconds (null when timestamps are unavailable). */
	durationSec: number | null;
}

/**
 * Classify a segment as train/airplane from a failed road match + kinematics.
 * Returns null when the match is plausible (a real car drive), the segment is
 * too short to judge, or timing is unavailable.
 */
export function offRoadClassification(input: OffRoadInput): ValhallaModeVerdict | null {
	const { raw, shape, edges, speedsKmh, durationSec } = input;
	if (raw.length < 2) return null;

	let pathMeters = 0;
	for (let i = 1; i < raw.length; i++) pathMeters += haversineMeters(raw[i - 1], raw[i]);

	const sorted = speedsKmh.filter((s) => Number.isFinite(s)).toSorted((a, b) => a - b);
	const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
	const avgKmh = durationSec && durationSec > 0 ? (pathMeters / durationSec) * 3.6 : null;

	if (avgKmh == null) return null;
	if (avgKmh > OFFROAD_PLANE_MIN_KMH) {
		if (pathMeters < OFFROAD_PLANE_MIN_PATH_M) return null;
		return { mode: 'airplane', confidence: 0.9, evidence: 'valhalla_offroad_air' };
	}
	if (avgKmh < OFFROAD_TRAIN_MIN_KMH || avgKmh > OFFROAD_TRAIN_MAX_KMH) return null;
	if (pathMeters < OFFROAD_TRAIN_MIN_PATH_M) return null;

	// Poor-match criteria — any one of these disqualifies the road hypothesis.
	let poor = false;
	let reasons = '';

	if (shape.length >= 2) {
		const matchedMeters = edges.reduce(
			(sum, e) => sum + (typeof e.length === 'number' ? e.length * 1000 : 0),
			0
		);
		const ratio = pathMeters > 0 ? matchedMeters / pathMeters : 0;
		if (ratio < POOR_MATCH_LENGTH_RATIO) {
			poor = true;
			reasons += ` length_ratio=${ratio.toFixed(2)}`;
		}
		const deviation = meanNearestDistanceMeters(raw, shape);
		if (deviation >= POOR_MATCH_DEVIATION_M) {
			poor = true;
			reasons += ` deviation=${Math.round(deviation)}m`;
		}
	} else {
		// No match at all — the road hypothesis already failed.
		poor = true;
		reasons += ' unmatched';
	}

	if (!poor && edges.length > 0 && p50 > 0) {
		// Implausible speeds: most of the matched length is on edges whose
		// speed is under half of what the tracker observed.
		const slowShare = edges.reduce((sum, e) => {
			const len = typeof e.length === 'number' && e.length > 0 ? e.length : 0;
			return (e.speed ?? 0) < p50 / 2 ? sum + len : sum;
		}, 0);
		const totalLen = edges.reduce(
			(sum, e) => sum + (typeof e.length === 'number' && e.length > 0 ? e.length : 0),
			0
		);
		if (totalLen > 0 && slowShare / totalLen >= OFFROAD_SLOW_EDGE_SHARE) {
			poor = true;
			reasons += ` slow_edge_share=${(slowShare / totalLen).toFixed(2)}`;
		}
	}

	if (!poor) return null;
	if (reasons) {
		console.log(
			`[valhalla-mapping] off-road train verdict:${reasons} (avg ${Math.round(avgKmh)} km/h, path ${(pathMeters / 1000).toFixed(1)} km)`
		);
	}
	return { mode: 'train', confidence: 0.85, evidence: 'valhalla_offroad_rail' };
}

/**
 * Sum of matched edge lengths in meters (edge.length is in km).
 * More accurate than haversine sums over noisy GPS points.
 */
export function matchedDistanceMeters(edges: ValhallaEdge[]): number {
	return edges.reduce((sum, e) => sum + (typeof e.length === 'number' ? e.length * 1000 : 0), 0);
}

/** Collect the most frequent non-empty names from edges matching the predicate. */
function dominantNames(
	edges: ValhallaEdge[],
	predicate: (e: ValhallaEdge) => boolean
): string[] | undefined {
	const counts = new Map<string, number>();
	for (const e of edges) {
		if (!predicate(e)) continue;
		for (const n of e.names ?? []) {
			if (n) counts.set(n, (counts.get(n) ?? 0) + weightOfSafe(e));
		}
	}
	const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
	return sorted.length > 0 ? sorted.slice(0, 2).map(([n]) => n) : undefined;
}

function weightOfSafe(e: ValhallaEdge): number {
	return typeof e.length === 'number' && e.length > 0 ? e.length : 1;
}

// ─── Rail-clone probe (definitive train evidence) ───────────────────────────
//
// Valhalla tilesets built with rail cloning (see the server-deployment repo)
// contain pedestrian-routable clones of every railway=rail way, named with a
// "RAILWAY | " prefix. A pedestrian-costing match whose edges carry that
// prefix means the trace sat ON a rail line — positive identification, no
// heuristics. Wayli probes this for rail-plausible runs; ordinary
// walking/cycling segments never match the clones (they're tagged
// bicycle=no/motor_vehicle=no and geographically on rail corridors).

/** Name prefix of the cloned rail paths in the tileset. */
export const RAIL_CLONE_NAME_PREFIX = 'RAILWAY | ';

/** Weighted share (0..1) of matched length on rail-clone paths. */
export function railCloneShare(edges: ValhallaEdge[]): number {
	const weightOf = (e: ValhallaEdge): number =>
		typeof e.length === 'number' && e.length > 0 ? e.length : 1;
	const total = edges.reduce((sum, e) => sum + weightOf(e), 0);
	if (total === 0) return 0;
	const onClones = edges.reduce((sum, e) => {
		const names = e.names ?? [];
		return names.some((n) => n.startsWith(RAIL_CLONE_NAME_PREFIX)) ? sum + weightOf(e) : sum;
	}, 0);
	return onClones / total;
}

/**
 * Verdict from a pedestrian match onto rail-clone paths. Returns null unless
 * more than `minShare` of the matched length is on clones.
 */
export function railCloneVerdict(
	edges: ValhallaEdge[],
	minShare = 0.5
): ValhallaModeVerdict | null {
	if (edges.length === 0) return null;
	if (railCloneShare(edges) <= minShare) return null;
	return {
		mode: 'train',
		confidence: 0.95,
		evidence: 'valhalla_rail_edge'
	};
}
