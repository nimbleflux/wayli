// Mirrors web/src/lib/services/trip-route/trip-route-geometry.ts and
// functions/_shared/services/trip-route/trip-route-geometry.ts. Update ALL together.
//
// Pure geometry helpers for Valhalla-snapped trip routes. No I/O — everything
// here is unit-testable and shared between the fluxbase job (which builds the
// stored shape) and the web client (which only re-exports/decodes it).
//
// The stored route shape lives in trips.metadata.routeShape:
//   { v: 1, segments: [[lat,lng],...][], source: 'valhalla', generated_at }
// `segments` is a list of polylines: movement is split into a new segment at
// every privacy-zone crossing (and at transport-mode run boundaries), so no
// stored vertex — and no rendered line endpoint — sits inside the owner's
// home/trip-exclusion zones. Coordinates are rounded to 5 decimals (~1 m).

export interface LatLng {
	lat: number;
	lng: number;
}

export interface PrivacyZone {
	lat: number;
	lng: number;
	radius_m: number;
}

/** Stored (compact) form: segments of [lat, lng] pairs. */
export type StoredSegments = Array<Array<[number, number]>>;

export interface RouteShape {
	v: 1;
	segments: StoredSegments;
	source: 'valhalla';
	generated_at: string;
}

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in meters (mirrors PostGIS ST_DWithin on geography). */
export function haversineMeters(a: LatLng, b: LatLng): number {
	const toRad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * toRad;
	const dLng = (b.lng - a.lng) * toRad;
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h = sinLat * sinLat + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * sinLng * sinLng;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** True when the point lies within radius_m of any privacy zone. */
export function isInsideZone(p: LatLng, zones: PrivacyZone[]): boolean {
	for (const z of zones) {
		if (haversineMeters(p, z) <= z.radius_m) return true;
	}
	return false;
}

/**
 * Split a polyline at privacy-zone crossings: only runs of ≥2 consecutive
 * points OUTSIDE every zone are kept. This is the JS mirror of the
 * ST_DWithin clipping in get_public_trip_track() — a shared trip must never
 * reveal where the user lives, and the stored shape is readable by anyone who
 * can read the trip row.
 */
export function clipPolylineToZones<T extends LatLng>(polyline: T[], zones: PrivacyZone[]): T[][] {
	if (zones.length === 0) return polyline.length >= 2 ? [polyline] : [];
	const segments: T[][] = [];
	let current: T[] = [];
	for (const p of polyline) {
		if (isInsideZone(p, zones)) {
			if (current.length >= 2) segments.push(current);
			current = [];
		} else {
			current.push(p);
		}
	}
	if (current.length >= 2) segments.push(current);
	return segments;
}

export interface ModeRun<T> {
	mode: string | null;
	points: T[];
}

/**
 * Split a time-ordered point list into consecutive runs of the same
 * transport_mode. Stationary runs are dropped (a parked cluster adds noise,
 * not route), runs shorter than minRunLength are dropped, and null/unknown
 * modes are kept (matched with the permissive 'auto' costing).
 */
export function splitIntoModeRuns<T extends { transport_mode?: string | null }>(
	points: T[],
	minRunLength = 2
): ModeRun<T>[] {
	const runs: ModeRun<T>[] = [];
	let current: ModeRun<T> | null = null;
	for (const p of points) {
		const mode = p.transport_mode ?? null;
		if (!current || current.mode !== mode) {
			current = { mode, points: [] };
			runs.push(current);
		}
		current.points.push(p);
	}
	return runs.filter(
		(r) => r.mode !== 'stationary' && r.points.length >= Math.max(2, minRunLength)
	);
}

/**
 * Costing for a transport-mode run. Mirrors costingForMode() in
 * transport-mode/valhalla-confirm.ts — pedestrian network for walking,
 * cycleways for cycling, and the permissive road matcher for everything else
 * (car, train, airplane, unknown).
 */
export function costingForRunMode(mode: string | null): 'auto' | 'pedestrian' | 'bicycle' {
	switch (mode) {
		case 'walking':
			return 'pedestrian';
		case 'cycling':
			return 'bicycle';
		default:
			return 'auto';
	}
}

/** Round a coordinate to 5 decimals (~1 m) — keeps the stored JSON compact. */
export function roundCoord(n: number): number {
	return Math.round(n * 100000) / 100000;
}

export function toStoredSegments(segments: LatLng[][]): StoredSegments {
	return segments.map((seg) => seg.map((p) => [roundCoord(p.lat), roundCoord(p.lng)]));
}

/** Decode the stored compact form back into renderable points. */
export function fromStoredSegments(segments: StoredSegments): LatLng[][] {
	return segments.map((seg) => seg.map(([lat, lng]) => ({ lat, lng })));
}

/**
 * Proportionally thin segments so the TOTAL point count stays within
 * maxTotalPoints. Always keeps the first and last point of every segment.
 */
export function downsampleSegments<T extends LatLng>(
	segments: T[][],
	maxTotalPoints = 1500
): T[][] {
	const total = segments.reduce((n, s) => n + s.length, 0);
	if (total <= maxTotalPoints) return segments;
	return segments.map((seg) => {
		const budget = Math.max(2, Math.round((seg.length / total) * maxTotalPoints));
		if (seg.length <= budget) return seg;
		const stride = Math.ceil(seg.length / budget);
		const kept = seg.filter((_, i) => i % stride === 0 || i === seg.length - 1);
		return kept;
	});
}

// ─── Off-road (train/plane) classification ──────────────────────────────────
//
// Road snapping failing over long distances is itself a signal: if a run
// covers a long distance at rail-like speed while its points sit far from any
// matched road, the user was almost certainly on a train (or a plane). These
// pure rules label such runs so they render as raw, correctly-colored track
// instead of a failed road snap. Classification only affects the segment
// label/geometry choice — tracker_data is never modified.

export interface RunKinematics {
	distanceMeters: number;
	durationSeconds: number;
	avgSpeedKmh: number;
}

/**
 * Distance + duration + average speed over a run. Returns null when the
 * points carry no usable timestamps (classification then stays off).
 */
export function runKinematics(points: Array<LatLng & { t?: number }>): RunKinematics | null {
	if (points.length < 2) return null;
	let distance = 0;
	for (let i = 1; i < points.length; i++) {
		distance += haversineMeters(points[i - 1], points[i]);
	}
	const t0 = points[0].t;
	const t1 = points[points.length - 1].t;
	if (t0 == null || t1 == null || t1 <= t0) return null;
	const duration = (t1 - t0) / 1000;
	return {
		distanceMeters: distance,
		durationSeconds: duration,
		avgSpeedKmh: (distance / duration) * 3.6
	};
}

/**
 * Mean distance (m) from each raw point to the nearest vertex of the snapped
 * shape. Both sequences are ordered along the route, so a two-pointer walk is
 * O(n+m) instead of O(n·m) — plenty for a threshold check.
 */
export function meanNearestDistanceMeters(raw: LatLng[], snapped: LatLng[]): number {
	if (raw.length === 0 || snapped.length === 0) return Infinity;
	let total = 0;
	let j = 0;
	for (const p of raw) {
		// Advance while the next snapped vertex is closer.
		while (
			j + 1 < snapped.length &&
			haversineMeters(p, snapped[j + 1]) < haversineMeters(p, snapped[j])
		) {
			j++;
		}
		total += haversineMeters(p, snapped[j]);
	}
	return total / raw.length;
}

/** A run whose road match is this far off (mean, meters) counts as poor. */
export const POOR_MATCH_METERS = 100;

/** Rail/plane kinematic windows for classifyOffRoadRun. */
export const TRAIN_MIN_DISTANCE_M = 8000;
export const TRAIN_MIN_KMH = 50;
export const TRAIN_MAX_KMH = 250;
export const PLANE_MIN_KMH = 250;

export type OffRoadClass = 'train' | 'airplane' | null;

/**
 * Rule-based off-road classification:
 *   airplane — sustained speed beyond any ground transport;
 *   train    — long distance at rail speed WHILE the road match is poor
 *              (a well-matched motorway run at 120 km/h stays a car).
 * Timing unavailable → null (no classification).
 */
export function classifyOffRoadRun(
	kin: RunKinematics | null,
	poorlyMatched: boolean
): OffRoadClass {
	if (!kin) return null;
	if (kin.avgSpeedKmh > PLANE_MIN_KMH) return 'airplane';
	if (
		poorlyMatched &&
		kin.distanceMeters >= TRAIN_MIN_DISTANCE_M &&
		kin.avgSpeedKmh >= TRAIN_MIN_KMH &&
		kin.avgSpeedKmh <= TRAIN_MAX_KMH
	) {
		return 'train';
	}
	return null;
}

// ─── Segment assembly with boundary bridging ────────────────────────────────
//
// Runs snap independently, so consecutive segments never share endpoints and
// the route looks broken at every mode change / failed-match junction. The
// assembler inserts explicit 2-point bridge segments (end of one segment →
// start of the next) so no movement is visually lost. Bridges are skipped
// when they would cross a privacy zone (a straight connector over the home
// zone would defeat the clipping), and zone-crossing gaps inside a single
// run's clipped polyline are deliberately left open.

export interface AssembledSegment<T extends LatLng> {
	points: T[];
	/** True for an inserted connector segment (render dashed/neutral). */
	bridge: boolean;
}

function lerpPoint(a: LatLng, b: LatLng, t: number): LatLng {
	return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Would the straight connector a→b pass through (or touch) a zone? */
function bridgeCrossesZone(a: LatLng, b: LatLng, zones: PrivacyZone[]): boolean {
	if (zones.length === 0) return false;
	for (const t of [0.25, 0.5, 0.75]) {
		if (isInsideZone(lerpPoint(a, b, t), zones)) return true;
	}
	return isInsideZone(a, zones) || isInsideZone(b, zones);
}

/**
 * Assemble per-run (already privacy-clipped where applicable) polylines into a
 * continuous segment list: each run's pieces stay separate (zone gaps remain),
 * but the LAST piece of one run is bridged to the FIRST piece of the next
 * unless the bridge would cross a zone.
 */
export function assembleRouteSegments<T extends LatLng>(
	runPolylines: T[][][],
	zones: PrivacyZone[] = []
): AssembledSegment<T>[] {
	const out: AssembledSegment<T>[] = [];
	let prevTail: T | null = null;
	for (const piecesOfRun of runPolylines) {
		for (let i = 0; i < piecesOfRun.length; i++) {
			const piece = piecesOfRun[i];
			if (piece.length < 2) continue;
			if (i === 0 && prevTail && !bridgeCrossesZone(prevTail, piece[0], zones)) {
				out.push({ points: [prevTail, piece[0]], bridge: true });
			}
			out.push({ points: piece, bridge: false });
			prevTail = piece[piece.length - 1];
		}
	}
	return out;
}
