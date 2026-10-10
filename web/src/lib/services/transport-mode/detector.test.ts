// /Users/bart/Dev/wayli/web/src/lib/services/transport-mode/detector.test.ts

import { describe, test, expect } from 'vitest';
import { detectTransportModes } from './detector';
import { SEGMENT_GAP_MS, segmentByGaps } from './segmentation';
import type { ModeObservation } from './types';

const SEC = 1000;
const MIN = 60 * SEC;

/**
 * Build a run of evenly-spaced observations at the given speeds (km/h).
 * Headings optional; defaults to a straight line (bearing 0).
 */
function run(
	speeds: number[],
	opts: { spacingMs?: number; headings?: (number | null)[]; startTs?: number } = {}
): ModeObservation[] {
	const spacing = opts.spacingMs ?? 10 * SEC;
	const startTs = opts.startTs ?? 0;
	const headings = opts.headings ?? speeds.map(() => 0);
	return speeds.map((speed, i) => ({
		timestamp: startTs + i * spacing,
		lat: 52 + i * 0.0001,
		lng: 4 + i * 0.0001,
		speed,
		heading: headings[i],
		accuracy: 15,
		geocode: null
	}));
}

/**
 * A geocode feature whose addendum marks it as a train station (matches the
 * `osm.railway = 'station'` tag isAtTrainStation checks for).
 */
function stationGeocode() {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [4, 52] },
		properties: { addendum: { osm: { railway: 'station' } } }
	} as ModeObservation['geocode'];
}

/**
 * A geocode marking open water: a permanent reverse-geocode failure (Pelias
 * has no land record for the coordinate) — the #220 water signal.
 */
function waterGeocode() {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [150.72, -35.05] },
		properties: { geocoding_status: 'failed', geocode_error: 'No results found' }
	} as ModeObservation['geocode'];
}

/** A plain land address geocode (opposite evidence of waterGeocode). */
function landGeocode() {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [4, 52] },
		properties: { layer: 'address', locality: 'Huskisson' }
	} as ModeObservation['geocode'];
}

/** Attach a geocode to every observation in a run. */
function withGeocode(obs: ModeObservation[], geocode: ModeObservation['geocode']) {
	return obs.map((o) => ({ ...o, geocode }));
}

describe('detectTransportModes', () => {
	test('steady walking speed decodes to walking end-to-end (no flicker)', () => {
		const obs = run([5, 5, 5, 5, 5, 4.5, 5, 5]);
		const decisions = detectTransportModes(obs);
		expect(decisions).toHaveLength(obs.length);
		// Every point should be walking — a single steady signal must not flicker.
		expect(decisions.every((d) => d.mode === 'walking')).toBe(true);
	});

	test('a single noisy high-speed fix among walking does not flip the whole run', () => {
		// The legacy rule engine flipped here (one 95 km/h GPS blip → train).
		// The HMM's transition matrix + temporal coherence should absorb it.
		const obs = run([5, 5, 5, 95, 5, 5, 5]);
		const decisions = detectTransportModes(obs);
		const modes = decisions.map((d) => d.mode);
		// The majority must stay walking; the lone blip should NOT become a
		// sustained train/airplane journey.
		const walking = modes.filter((m) => m === 'walking').length;
		expect(walking).toBeGreaterThanOrEqual(5);
		expect(modes.some((m) => m === 'airplane')).toBe(false);
	});

	test('highway car journey with realistic speed variation decodes to car', () => {
		// Real highway driving has CV > 0.15 (traffic, braking, overtaking) —
		// the signal that separates it from a train. Steady overlap-band speeds
		// legitimately lean train now (Stage-2 arbitrates with map matching),
		// so this fixture varies hard enough to sit clearly in car territory.
		const obs = run([65, 108, 80, 118, 72, 100, 95, 85, 112, 78]);
		const decisions = detectTransportModes(obs);
		expect(decisions.every((d) => d.mode === 'car' || d.mode === 'train')).toBe(true);
		const car = decisions.filter((d) => d.mode === 'car').length;
		expect(car).toBeGreaterThanOrEqual(4);
	});

	test('perfectly steady overlap speed without context may read as train (documented)', () => {
		// A perfectly steady 90–100 km/h run with zero variation is genuinely
		// train-like — speed and CV cannot distinguish it from rail. This test
		// pins that the model is allowed to decode train here; geocode context
		// (station tags) is what resolves the ambiguity in production.
		const obs = run([90, 95, 100, 98, 92, 88, 95]);
		const decisions = detectTransportModes(obs);
		expect(decisions.every((d) => d.mode === 'car' || d.mode === 'train')).toBe(true);
	});

	test('low coefficient-of-variation + straight heading without station context is a balanced call', () => {
		// Rock-steady 100 km/h, dead-straight heading. Pure speed-steadiness is
		// NOT a reliable train signal on its own (cruise-control highway driving
		// is equally steady), so without station/rail context the model no longer
		// confidently calls train here — it's a car/train coin-flip. The strong
		// train signal requires corroborating rail context (see the contagion
		// test). This pins that the run resolves cleanly to car or train (never
		// walking/airplane) and stays coherent, without over-claiming train.
		const obs = run(Array(10).fill(100), {
			headings: Array(10).fill(0) // perfectly straight
		});
		const decisions = detectTransportModes(obs);
		const modes = decisions.map((d) => d.mode);
		// Every point is car or train — never an unrelated mode.
		expect(modes.every((m) => m === 'car' || m === 'train')).toBe(true);
		// No oscillation within the steady run: it settles on one mode.
		const distinct = new Set(modes);
		expect(distinct.size).toBe(1);
	});

	test('stationary points decode to stationary', () => {
		const obs = run([0, 0, 0, 0, 0.5, 0, 0]);
		const decisions = detectTransportModes(obs);
		expect(decisions.every((d) => d.mode === 'stationary')).toBe(true);
	});

	test('flight speed decodes to airplane', () => {
		const obs = run([0, 250, 400, 500, 450, 300, 0], { spacingMs: 60 * SEC });
		const decisions = detectTransportModes(obs);
		const plane = decisions.filter((d) => d.mode === 'airplane').length;
		expect(plane).toBeGreaterThanOrEqual(4);
	});

	test('a >5min gap splits into independent segments', () => {
		// First segment: walking. Then a long gap. Then driving.
		const walk = run([5, 5, 5, 5], { startTs: 0 });
		const drive = run([60, 65, 60, 62], { startTs: 10 * MIN + SEGMENT_GAP_MS + 1 });
		const obs = [...walk, ...drive];
		const decisions = detectTransportModes(obs);
		expect(decisions.slice(0, 4).every((d) => d.mode === 'walking')).toBe(true);
		expect(decisions.slice(4).every((d) => d.mode === 'car' || d.mode === 'train')).toBe(true);
	});

	test('returns one decision per input observation, timestamp-aligned', () => {
		const obs = run([0, 10, 50, 120]);
		const decisions = detectTransportModes(obs);
		expect(decisions).toHaveLength(4);
		expect(decisions.map((d) => d.timestamp)).toEqual(obs.map((o) => o.timestamp));
	});

	test('confidence is always within [0, 1]', () => {
		const obs = run([0, 5, 30, 80, 200, 5, 0]);
		const decisions = detectTransportModes(obs);
		expect(decisions.every((d) => d.confidence >= 0 && d.confidence <= 1)).toBe(true);
	});

	test('empty input returns empty', () => {
		expect(detectTransportModes([])).toEqual([]);
	});

	test('single observation decodes via emission-only path', () => {
		const decisions = detectTransportModes(run([5]));
		expect(decisions).toHaveLength(1);
		expect(decisions[0].mode).toBe('walking');
		expect(decisions[0].confidence).toBeGreaterThan(0);
	});

	// ─── Regression tests for the anti-flipping / rework work ────────────────

	test('a garbage 481,402 km/h speed spike is clamped and does not flip the run', () => {
		// The DB has recorded values up to 481402.9 km/h. Feature extraction
		// clamps to MAX_PLAUSIBLE_SPEED_KMH; a single such spike must not poison
		// the CV window or flip a steady walking run.
		const obs = run([5, 5, 5, 481402, 5, 5, 5]);
		const decisions = detectTransportModes(obs);
		const walking = decisions.filter((d) => d.mode === 'walking').length;
		expect(walking).toBeGreaterThanOrEqual(5);
		expect(decisions.some((d) => d.mode === 'airplane')).toBe(false);
	});

	test('a station visit mid-journey makes the whole moving segment lean train (contagion)', () => {
		// Overlap-band speed (95 km/h) that speed alone would call car. The single
		// station point (index 3) used to boost only that point; segment contagion
		// should now pull the whole moving leg toward train.
		const obs = run([95, 95, 95, 95, 95, 95, 95]);
		obs[3].geocode = stationGeocode();
		const decisions = detectTransportModes(obs);
		const train = decisions.filter((d) => d.mode === 'train').length;
		const car = decisions.filter((d) => d.mode === 'car').length;
		// Without contagion the per-point station boost alone isn't enough to
		// dominate; with contagion the segment should resolve to train.
		expect(train).toBeGreaterThan(car);
		expect(train).toBeGreaterThanOrEqual(4);
	});

	test('sparse sampling in the overlap band biases toward train (density feature)', () => {
		// Two identical steady 90 km/h runs; one dense (10s), one sparse (45s).
		// The sparse one should have at least as strong a train presence as the
		// dense one — density is the car signal here.
		const dense = run([90, 90, 90, 90, 90, 90, 90], { spacingMs: 10 * SEC });
		const sparse = run([90, 90, 90, 90, 90, 90, 90], { spacingMs: 45 * SEC });
		const denseTrain = detectTransportModes(dense).filter((d) => d.mode === 'train').length;
		const sparseTrain = detectTransportModes(sparse).filter((d) => d.mode === 'train').length;
		expect(sparseTrain).toBeGreaterThanOrEqual(denseTrain);
	});

	test('cross-batch continuity keeps one journey coherent across a page boundary', () => {
		// A steady overlap-band journey split into two "pages". Without context,
		// each page decodes independently and the seam can disagree. With the
		// context tail threaded, the second page is decoded with the first page's
		// tail prepended so the whole journey decodes as one segment.
		const page1 = run([90, 90, 90, 90], { startTs: 0 });
		const page2 = run([90, 90, 90, 90], { startTs: 4 * 10 * SEC });
		const combined = detectTransportModes([...page1, ...page2]);

		// Now simulate the paged decode: page1 alone, then page2 with page1's tail.
		const dec1 = detectTransportModes(page1);
		const dec2 = detectTransportModes(page2, { prevObs: page1.slice(-6) });

		// The stitched result must match the combined decode for page2's points.
		const combinedPage2 = combined.slice(page1.length);
		expect(dec2.map((d) => d.mode)).toEqual(combinedPage2.map((d) => d.mode));
		expect(dec1).toHaveLength(page1.length);
		expect(dec2).toHaveLength(page2.length);
	});

	test('a sustained steady overlap journey with a blip and page break does not oscillate', () => {
		// A long steady 100 km/h run, straight heading, split across two pages
		// with a single speed blip. Speed/CV/heading alone can't tell steady
		// highway from steady rail, so the mode is allowed to settle to either
		// car OR train — but the anti-flip guarantees are: (1) it must NOT
		// oscillate car->train->car within the run, (2) the lone blip must NOT
		// escalate the journey to airplane, and (3) the page seam must stay
		// coherent (no isolated different mode at the boundary).
		const speeds1 = [100, 100, 100, 100, 100, 100, 130]; // long steady, then a blip
		const speeds2 = [100, 100, 100, 100, 100, 100, 100];
		const page1 = run(speeds1, { headings: speeds1.map(() => 0), startTs: 0 });
		const page2 = run(speeds2, {
			headings: speeds2.map(() => 0),
			startTs: speeds1.length * 10 * SEC
		});
		const dec1 = detectTransportModes(page1);
		const dec2 = detectTransportModes(page2, { prevObs: page1.slice(-6) });
		const modes = [...dec1, ...dec2].map((d) => d.mode);

		// (1) No oscillation: only car and/or train appear, and the dominant
		// mode covers the large majority of the run.
		const distinct = new Set(modes);
		for (const m of distinct) expect(['car', 'train']).toContain(m);
		const car = modes.filter((m) => m === 'car').length;
		const train = modes.filter((m) => m === 'train').length;
		expect(Math.max(car, train)).toBeGreaterThanOrEqual(11);
		// (2) A 130 km/h blip must never become airplane.
		expect(modes.some((m) => m === 'airplane')).toBe(false);
		// (3) The seam (last point of page1 vs first of page2) is coherent:
		// they don't differ wildly just because they were decoded separately.
		expect(dec1.at(-1)?.mode).toBe(dec2[0]?.mode);
	});
});

describe('segmentByGaps', () => {
	/** Minimal timestamped item for segmentByGaps (it only needs `timestamp`). */
	function tsAt(ms: number[]): { timestamp: number }[] {
		return ms.map((m) => ({ timestamp: m }));
	}

	test('a single contiguous run is one segment', () => {
		const segs = segmentByGaps(tsAt([0, 10, 20, 30]));
		expect(segs).toEqual([[0, 1, 2, 3]]);
	});

	test('a >SEGMENT_GAP_MS gap splits into separate segments', () => {
		// 0..30 contiguous, then a 10-min gap, then 70..90 contiguous.
		const segs = segmentByGaps(tsAt([0, 10, 20, 30, 30 + SEGMENT_GAP_MS + 1, 70, 90]));
		expect(segs).toEqual([
			[0, 1, 2, 3],
			[4, 5, 6]
		]);
	});

	test('a gap of exactly SEGMENT_GAP_MS does NOT split (split is strict >)', () => {
		const segs = segmentByGaps(tsAt([0, SEGMENT_GAP_MS]));
		expect(segs).toEqual([[0, 1]]);
	});

	test('returns the same boundaries the detector uses', () => {
		// Two walking segments separated by a >5min gap must decode as two
		// independent segments — segmentByGaps must report exactly that split,
		// matching detectTransportModes' internal segmentation.
		const walk1 = run([5, 5, 5, 5], { startTs: 0 });
		const walk2 = run([5, 5, 5, 5], { startTs: 10 * MIN + SEGMENT_GAP_MS + 1 });
		const obs = [...walk1, ...walk2];
		const segs = segmentByGaps(obs);
		expect(segs).toHaveLength(2);
		expect(segs[0]).toEqual([0, 1, 2, 3]);
		expect(segs[1]).toEqual([4, 5, 6, 7]);
	});

	test('empty input returns no segments', () => {
		expect(segmentByGaps([])).toEqual([]);
	});

	test('a single item is a single one-element segment', () => {
		expect(segmentByGaps(tsAt([42]))).toEqual([[0]]);
	});
});

// The Jul-24/26 failure mode: a train cruising 120-160 km/h with no
// station geocode used to decode as car (the old train/car special case
// stopped at 115 km/h and the 0.5 prior lost every tie).
function steadyRun(speeds: number[]) {
	return speeds.map((speed, i) => ({
		timestamp: i * 60_000,
		lat: 52 + i * 0.05, // ~5.5 km/min ≈ 130-160 km/h ground truth
		lng: 5 + i * 0.01,
		speed,
		heading: 20,
		accuracy: 12,
		geocode: null
	}));
}

describe('v2: intercity train detection (no geocode context)', () => {
	test('sustained 130-150 km/h with low CV decodes to train without any station context', () => {
		const decisions = detectTransportModes(
			steadyRun([135, 142, 138, 148, 140, 133, 145, 150, 139, 144])
		);
		const train = decisions.filter((d) => d.mode === 'train').length;
		expect(train).toBeGreaterThanOrEqual(7);
	});

	test('variable 90-130 km/h traffic stays car', () => {
		const decisions = detectTransportModes(
			steadyRun([65, 128, 88, 135, 70, 118, 95, 122, 80, 110])
		);
		const car = decisions.filter((d) => d.mode === 'car').length;
		expect(car).toBeGreaterThanOrEqual(5);
	});
});

describe('#220: water modes (boat / swimming)', () => {
	test('20 km/h over open water decodes to boat, not cycling', () => {
		const obs = withGeocode(run([18, 22, 20, 24, 19, 21, 23, 18, 20, 22, 21, 19]), waterGeocode());
		const decisions = detectTransportModes(obs);
		const boat = decisions.filter((d) => d.mode === 'boat').length;
		const cycling = decisions.filter((d) => d.mode === 'cycling').length;
		expect(boat).toBeGreaterThanOrEqual(8);
		expect(cycling).toBe(0);
	});

	test('3 km/h over open water decodes to swimming, not walking', () => {
		const obs = withGeocode(
			run([2.5, 3, 3.5, 2.8, 3.2, 2.6, 3.4, 3, 2.9, 3.1, 3.3, 2.7]),
			waterGeocode()
		);
		const decisions = detectTransportModes(obs);
		const swimming = decisions.filter((d) => d.mode === 'swimming').length;
		const walking = decisions.filter((d) => d.mode === 'walking').length;
		expect(swimming).toBeGreaterThanOrEqual(8);
		expect(walking).toBe(0);
	});

	test('the same speeds on land never decode to boat or swimming (backward compat)', () => {
		// Cycling-band speeds with land geocodes → cycling, zero boat/swimming.
		const landRide = detectTransportModes(
			withGeocode(run([18, 22, 20, 24, 19, 21, 23, 18, 20, 22, 21, 19]), waterGeocode()).map(
				(o) => ({
					...o,
					geocode: {
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [4, 52] },
						properties: { layer: 'address', locality: 'Huskisson' }
					} as ModeObservation['geocode']
				})
			)
		);
		expect(landRide.some((d) => d.mode === 'boat' || d.mode === 'swimming')).toBe(false);

		// Same speeds with NO geocode at all → zero boat/swimming.
		const noGeocode = detectTransportModes(run([18, 22, 20, 24, 19, 21, 23, 18, 20, 22, 21, 19]));
		expect(noGeocode.some((d) => d.mode === 'boat' || d.mode === 'swimming')).toBe(false);

		// Walking-band speeds, no geocode → walking/stationary, zero swimming.
		const walk = detectTransportModes(run([4, 5, 4.5, 5, 4.8, 5.2, 4.6, 5]));
		expect(walk.some((d) => d.mode === 'swimming' || d.mode === 'boat')).toBe(false);
	});

	test('a partially-water segment (30% evidence) does not trigger boat', () => {
		const base = run([18, 22, 20, 24, 19, 21, 23, 18, 20, 22]);
		const obs = base.map((o, i) => ({ ...o, geocode: i < 3 ? waterGeocode() : null }));
		const decisions = detectTransportModes(obs);
		expect(decisions.some((d) => d.mode === 'boat' || d.mode === 'swimming')).toBe(false);
	});
});

describe('#242: running detection', () => {
	test('a steady 9-12 km/h segment decodes to running, not walking', () => {
		const decisions = detectTransportModes(
			run([9.5, 10.5, 11, 10, 9.8, 11.2, 10.4, 9.6, 10.8, 10.2])
		);
		const running = decisions.filter((d) => d.mode === 'running').length;
		const walking = decisions.filter((d) => d.mode === 'walking').length;
		expect(running).toBeGreaterThanOrEqual(8);
		expect(walking).toBe(0);
		expect(
			decisions.every((d) => d.reason !== 'speed_in_walking_range' || d.mode !== 'running')
		).toBe(true);
	});

	test('a steady 4-6 km/h segment stays walking (no running bleed)', () => {
		const decisions = detectTransportModes(run([4.5, 5.5, 5, 4.8, 5.2, 4.6, 5.4, 5, 4.9, 5.1]));
		const walking = decisions.filter((d) => d.mode === 'walking').length;
		const running = decisions.filter((d) => d.mode === 'running').length;
		expect(walking).toBeGreaterThanOrEqual(8);
		expect(running).toBe(0);
	});

	test('a steady 16-20 km/h segment stays cycling (running loses the contested middle)', () => {
		const decisions = detectTransportModes(run([17, 19, 18, 20, 16.5, 18.5, 19.5, 17.5, 18, 19]));
		const cycling = decisions.filter((d) => d.mode === 'cycling').length;
		const running = decisions.filter((d) => d.mode === 'running').length;
		expect(cycling).toBeGreaterThanOrEqual(8);
		expect(running).toBe(0);
	});

	test('a run with brief walking pauses keeps the majority running (no flicker collapse)', () => {
		// Interval-average speeds dip at road crossings — the segment mean
		// (~8.9 km/h) must hold the run together.
		const decisions = detectTransportModes(
			run([10, 9.5, 2, 10.5, 10, 3, 9.8, 10.2, 9.6, 10.4, 2.5, 10, 9.9, 10.1])
		);
		const running = decisions.filter((d) => d.mode === 'running').length;
		expect(running).toBeGreaterThanOrEqual(8);
	});

	test('7.5-8 km/h sits in the deliberate overlap (walking or running, never cycling)', () => {
		const decisions = detectTransportModes(run([7.4, 7.8, 7.6, 8, 7.2, 7.9, 7.5, 7.7]));
		expect(decisions.every((d) => d.mode === 'walking' || d.mode === 'running')).toBe(true);
	});
});

describe('#255: activity-recognition hint', () => {
	// The hint anchors the mode like station/airport geocodes: strong boost for
	// the hinted mode, damping for its nearest competitor — and total neutrality
	// when absent (OwnTracks, foss builds, historical data).
	test('a running hint resolves the 6.5-8 overlap toward running', () => {
		// Slow-jog territory where the bands overlap and speed alone leans
		// walking — exactly what the AR hint exists to disambiguate.
		const obs = run([7.2, 7.5, 6.8, 7.4, 7, 7.6, 6.9, 7.3, 7.1, 7.5]).map((o) => ({
			...o,
			activityType: 'running'
		}));
		const decisions = detectTransportModes(obs);
		const running = decisions.filter((d) => d.mode === 'running').length;
		expect(running).toBeGreaterThanOrEqual(8);
	});

	test('the hint cannot conjure running out of walking-pace data (conservative anchor)', () => {
		const obs = run([4.5, 5.5, 5, 4.8, 5.2, 4.6, 5.4, 5, 4.9, 5.1]).map((o) => ({
			...o,
			activityType: 'running'
		}));
		const walking = (decisions) => decisions.filter((d) => d.mode === 'walking').length;
		expect(walking(detectTransportModes(obs))).toBeGreaterThanOrEqual(6);
	});

	test('without the hint the same overlap stretch stays walking (neutrality)', () => {
		const decisions = detectTransportModes(run([7.2, 7.5, 6.8, 7.4, 7, 7.6, 6.9, 7.3, 7.1, 7.5]));
		const running = decisions.filter((d) => d.mode === 'running').length;
		expect(running).toBe(0);
	});

	test('a running hint steadies a genuine run with noisy dips', () => {
		const obs = run([10, 9.5, 2, 10.5, 10, 3, 9.8, 10.2, 9.6, 10.4, 2.5, 10, 9.9, 10.1]).map(
			(o) => ({ ...o, activityType: 'running' })
		);
		const decisions = detectTransportModes(obs);
		const running = decisions.filter((d) => d.mode === 'running').length;
		expect(running).toBeGreaterThanOrEqual(10);
	});
});

describe('#220: per-user disabled modes', () => {
	test('a disabled mode is never chosen even on a perfect fixture', () => {
		const obs = run([18, 22, 20, 24, 19, 21, 23, 18, 20, 22]);
		const decisions = detectTransportModes(obs, { disabledModes: ['cycling'] });
		expect(decisions.some((d) => d.mode === 'cycling')).toBe(false);
		// The run still decodes to something plausible (car or walking fallback).
		expect(decisions.length).toBe(obs.length);
	});

	test('empty disabledModes behaves exactly like before', () => {
		const obs = run([5, 5, 5, 5, 5, 5]);
		const decisions = detectTransportModes(obs, { disabledModes: [] });
		expect(decisions.every((d) => d.mode === 'walking')).toBe(true);
	});
});

describe('#220: mixed water/land geocode evidence', () => {
	test('any genuine land geocode in the segment keeps the conservative land call', () => {
		// Viterbi mode persistence + no land suppression on land points means a
		// segment containing even a few land geocodes stays on the land mode —
		// the conservative direction. (Boat requires unanimous-ish water.)
		const mixed = withGeocode(
			run([18, 22, 20, 24, 19, 21, 23, 18, 20, 22, 21]),
			waterGeocode()
		).map((o, i) => (i >= 6 ? { ...o, geocode: landGeocode() } : o));
		const decisions = detectTransportModes(mixed);
		expect(decisions.some((d) => d.mode === 'swimming')).toBe(false);
		expect(decisions.every((d) => d.mode !== 'unknown')).toBe(true);
	});
});
