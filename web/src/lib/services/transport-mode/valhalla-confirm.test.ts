import { describe, test, expect, vi } from 'vitest';
import { confirmWithValhalla, costingForMode, type ValhallaClient } from './valhalla-confirm';
import type { ModeObservation, PointModeDecision } from './types';
import type { ValhallaTraceResult } from './valhalla.service';

const MIN = 60 * 1000;

function obs(i: number, opts: Partial<ModeObservation> = {}): ModeObservation {
	return {
		timestamp: i * 30_000,
		lat: 52 + i * 0.0001,
		lng: 4 + i * 0.0001,
		speed: 90,
		heading: 0,
		accuracy: 15,
		geocode: null,
		...opts
	};
}

function decision(i: number, mode: string, confidence: number): PointModeDecision {
	return {
		timestamp: i * 30_000,
		mode: mode as any,
		reason: 'speed_in_car_range',
		confidence
	};
}

/** Build N observations + decisions as one continuous segment (no gaps). */
function segment(
	n: number,
	mode: string,
	confidence = 0.8,
	obsOpts: Partial<ModeObservation> = {}
) {
	const observations = Array.from({ length: n }, (_, i) => obs(i, obsOpts));
	const decisions = Array.from({ length: n }, (_, i) => decision(i, mode, confidence));
	return { observations, decisions };
}

describe('confirmWithValhalla', () => {
	test('car segment matched to rail edges → overridden to train', async () => {
		const { observations, decisions } = segment(10, 'car', 0.8, { speed: 140 });
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{ road_class: 'primary', use: 'road', rail: true, length: 5, speed: 100 },
					{ road_class: 'primary', use: 'road', rail: true, length: 4 }
				],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		// All points overridden to train with high confidence.
		expect(result.every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].confidence).toBe(0.95);
		expect(result[0].reason).toBe('valhalla_rail_edge');
		// 2 calls: the rail-clone probe (pedestrian, no clone names in this
		// mock) + the per-segment auto probe that returns the rail edges.
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(2);
		expect(mockClient.traceAttributes).toHaveBeenLastCalledWith(expect.anything(), 'auto');
	});

	test('high-confidence slow walking segment → NOT sent to Valhalla', async () => {
		// Slow (p90 < 60 km/h), confident, unambiguous — no probe warranted.
		const { observations, decisions } = segment(10, 'walking', 0.9, { speed: 5 });
		const mockClient: ValhallaClient = { traceAttributes: vi.fn() };

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(mockClient.traceAttributes).not.toHaveBeenCalled();
		expect(result).toEqual(decisions); // unchanged
	});

	test('fast walking-labeled segment → probed with auto costing, absurd verdict rejected', async () => {
		// The Jul-7 failure mode: 30-60 km/h trace on rails labeled walking,
		// pedestrian-matched onto footways → walking @0.9. Now: probed (fast),
		// matched with auto, and the footway verdict is kinematically rejected.
		const { observations, decisions } = segment(10, 'walking', 0.9, { speed: 60 });
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{ road_class: 'residential', use: 'footway', rail: false, length: 3, speed: 20 },
					{ road_class: 'service_other', use: 'footway', rail: false, length: 3, speed: 20 }
				],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		// 2 calls: the rail-clone probe slice (pedestrian; footway mock has no
		// clone names) + the per-segment auto probe (fast run).
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(2);
		expect(mockClient.traceAttributes).toHaveBeenNthCalledWith(1, expect.anything(), 'pedestrian');
		expect(mockClient.traceAttributes).toHaveBeenNthCalledWith(2, expect.anything(), 'auto');
		// Footway verdict rejected (60 km/h ≠ walking) — Stage-1 preserved.
		expect(result.every((d) => d.mode === 'walking')).toBe(true);
		expect(result[0].reason).toBe(decisions[0].reason);
	});

	test('rail-clone probe: pedestrian match on RAILWAY | paths → definitive train, no further probing', async () => {
		// Tilesets built with rail cloning expose rail lines as pedestrian
		// paths named "RAILWAY | …". A rail-speed run whose pedestrian match
		// lands on those paths is a train — period. No auto probing follows.
		const { observations, decisions } = segment(10, 'car', 0.8, { speed: 140 });
		const railNames = {
			edges: [
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 5,
					names: ['RAILWAY | 4701']
				},
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 4,
					names: ['RAILWAY | 4701']
				}
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue(railNames)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].reason).toBe('valhalla_rail_edge');
		expect(result[0].confidence).toBe(0.95);
		// Definitive verdict → the auto probe never happens.
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(1);
		expect(mockClient.traceAttributes).toHaveBeenCalledWith(expect.anything(), 'pedestrian');
	});

	test('rail-clone probe covers sparse runs whose fragments fail the candidate gate (Jul-7 case)', async () => {
		// 3 fragments of 2 pts, 6-min gaps (> 5-min detector gap): every
		// fragment fails the per-segment candidate gate (walking @0.9,
		// p90 < 60). The RUN however is rail-plausible (p90 55) and its
		// pedestrian match lands on RAILWAY | clones -> the whole run is
		// train, including the fragments the gate would have skipped.
		const speeds = [95, 105, 112, 108, 100, 115];
		const observations = speeds.map((speed, i) =>
			obs(i, { timestamp: i * 360_000, speed, lat: 52.39 + i * 0.05 })
		);
		const decisions = observations.map((o, i) => decision(i, 'walking', 0.9));
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{
						road_class: 'service_other',
						use: 'path',
						rail: false,
						length: 5,
						names: ['RAILWAY | 525b']
					},
					{
						road_class: 'service_other',
						use: 'path',
						rail: false,
						length: 4,
						names: ['RAILWAY | 525b']
					}
				],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].reason).toBe('valhalla_rail_edge');
		expect(result[0].confidence).toBe(0.95);
		// Definitive verdict -> exactly one probe, no per-segment follow-up.
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(1);
	});

	test('rail-clone probe: station dwell must not hide a rail-plausible run (moving-points gate)', async () => {
		// Urban train: long dwelling at 1-2 km/h between 45-60 km/h stretches.
		// The whole-run p90 is dominated by dwell only if dwell is >10% of
		// points — here dwell is 50%, so the probe must measure MOVING points
		// (p90 ~55) and still fire.
		const speeds = [1, 105, 2, 110, 1, 108, 2, 112, 1, 115];
		const observations = speeds.map((speed, i) =>
			obs(i, { timestamp: i * 300_000, speed, lat: 52.39 + i * 0.008 })
		);
		const decisions = observations.map((o, i) => decision(i, 'walking', 0.9));
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{
						road_class: 'service_other',
						use: 'path',
						rail: false,
						length: 5,
						names: ['RAILWAY | 525b']
					}
				],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].reason).toBe('valhalla_rail_edge');
	});

	test('poor auto match at rail speed keeps Stage-1 (off-road inference removed)', async () => {
		// Rural car traces with GPS drift fail matching just like trains do,
		// so "unmatched" is not train evidence — the inference produced false
		// trains on rural car days (Jul 12/18). Stage-1 result is kept.
		const { observations, decisions } = segment(10, 'car', 0.7, { speed: 130 });
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{ road_class: 'unclassified', use: 'road', rail: false, length: 0.5, speed: 50 },
					{ road_class: 'residential', use: 'road', rail: false, length: 0.5, speed: 30 }
				],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'car')).toBe(true);
		expect(result[0].reason).toBe('speed_in_car_range');
	});

	test('plausible road match keeps car verdict', async () => {
		// A real car drive: matched length ≈ path length, edges as fast as the
		// observed speeds → the motorway edge verdict stands.
		const n = 10;
		const observations = Array.from({ length: n }, (_, i) =>
			obs(i, { timestamp: i * 240_000, speed: 120, lat: 52 + i * 0.045 })
		);
		const decisions = observations.map((o, i) => decision(i, 'car', 0.7));
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{ road_class: 'motorway', use: 'road', rail: false, length: 20, speed: 120 },
					{ road_class: 'motorway', use: 'road', rail: false, length: 20, speed: 118 }
				],
				// Snapped shape tracks the raw points closely (a real road match).
				shape: observations.map((o) => ({ lat: o.lat, lon: o.lng })),
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'car')).toBe(true);
		expect(result[0].reason).toBe('valhalla_motorway_edge');
	});

	test('fragmented sparse journey: sliced rail probe on clones → train', async () => {
		// A sparse tracker (~6 min between fixes) shatters the ride into
		// fragments below the 5-min detector gap. The run merges them; the
		// sliced rail probe finds clone paths along the corridor → train.
		const speeds = [110, 105, 112, 108, 100, 115];
		const observations = speeds.map((speed, i) =>
			obs(i, { timestamp: i * 360_000, speed, lat: 52 + i * 0.05 })
		);
		const decisions = observations.map((o, i) => decision(i, 'car', 0.7));
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [
					{
						road_class: 'service_other',
						use: 'path',
						rail: false,
						length: 5,
						names: ['RAILWAY | 4701']
					},
					{
						road_class: 'service_other',
						use: 'path',
						rail: false,
						length: 4,
						names: ['RAILWAY | 4701']
					}
				],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		// One slice for the 6-point run; clone names → definitive train.
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(1);
		expect(result.every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].reason).toBe('valhalla_rail_edge');
	});

	test('run-level extension: ambiguous slices of a rail-confirmed run → train', async () => {
		// The Jul-26 Berlin→AMS case: the corridor slice matches clones
		// definitively, but station-approach/urban-canyon slices land in the
		// ambiguous band (0.1–0.5 share) and kept their Stage-1 "car" label.
		// One definitive slice makes the whole journey a train; suppressed
		// slices (0 share) keep their street-level outcome.
		const n = 30;
		// Slices 0-1 move at rail speed; slice 2 is street-level (station area).
		const speeds = [...Array(20).fill(120), ...Array(10).fill(40)];
		const observations = speeds.map((speed, i) => obs(i, { speed }));
		const decisions = observations.map((o, i) => decision(i, 'car', 0.7));
		const mk = (edges: object[]): ValhallaTraceResult =>
			({ edges, shape: [], matched: true }) satisfies ValhallaTraceResult;
		// Slice 0 (pts 0-9): 3 of 10 km on clones → share 0.3 (ambiguous).
		const ambiguous = mk([
			{
				road_class: 'service_other',
				use: 'path',
				rail: false,
				length: 3,
				names: ['RAILWAY | 4701']
			},
			{ road_class: 'residential', use: 'road', rail: false, length: 7, speed: 50 }
		]);
		// Slice 1 (pts 10-19): all clone length → share 1.0 (definitive).
		const clone = mk([
			{
				road_class: 'service_other',
				use: 'path',
				rail: false,
				length: 5,
				names: ['RAILWAY | 4701']
			},
			{
				road_class: 'service_other',
				use: 'path',
				rail: false,
				length: 4,
				names: ['RAILWAY | 4701']
			}
		]);
		// Slice 2 (pts 20-29): plain road match → share 0 (suppressed).
		const road = mk([
			{ road_class: 'residential', use: 'road', rail: false, length: 5, speed: 30 }
		]);
		const responses = [ambiguous, clone, road];
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockImplementation(async () => responses.shift())
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		// Ambiguous slice extended by run context…
		expect(result.slice(0, 10).every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].reason).toBe('valhalla_rail_run_context');
		expect(result[0].confidence).toBe(0.85);
		// …definitive slice keeps its direct evidence…
		expect(result.slice(10, 20).every((d) => d.mode === 'train')).toBe(true);
		expect(result[10].reason).toBe('valhalla_rail_edge');
		expect(result[10].confidence).toBe(0.95);
		// …suppressed slice keeps its street-level Stage-1 outcome.
		expect(result.slice(20).every((d) => d.mode === 'car')).toBe(true);
		expect(result[20].reason).toBe('speed_in_car_range');
		// Rail-confirmed run → Tier 1 never fires; exactly one probe per slice.
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(3);
	});

	test('car day (movingP50 77) with ambiguous slices → NO extension without an anchor', async () => {
		// The Jul-12/18 guard: ambiguous clone share alone proves nothing —
		// only a definitive slice (share > 0.5 + kinematic floor) anchors an
		// extension, and this run never produces one.
		const n = 20;
		const observations = Array.from({ length: n }, (_, i) => obs(i, { speed: 77 }));
		const decisions = observations.map((o, i) => decision(i, 'car', 0.7));
		const ambiguous = {
			edges: [
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 3,
					names: ['RAILWAY | 4701']
				},
				{ road_class: 'residential', use: 'road', rail: false, length: 7, speed: 50 }
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const road = {
			edges: [{ road_class: 'residential', use: 'road', rail: false, length: 5, speed: 30 }],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const responses = [ambiguous, ambiguous, road]; // slice probes + tier-1 auto probe
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockImplementation(async () => responses.shift())
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'car')).toBe(true);
		expect(result.every((d) => d.reason === 'speed_in_car_range')).toBe(true);
	});

	test('walk-to-station slice in a rail-confirmed run → walking verdict, not extended', async () => {
		// A rail-confirmed run skips Tier 1, so the pedestrian-matched street
		// slices get their edge verdict inside the probe: a walking-speed
		// footway match is walking (platform dwell, walk to the station) —
		// even though the rest of the run is a confirmed train.
		const n = 20;
		const speeds = [...Array(10).fill(5), ...Array(10).fill(130)];
		const observations = speeds.map((speed, i) => obs(i, { speed }));
		const decisions = observations.map((o, i) => decision(i, 'car', 0.6));
		const footway = {
			edges: [
				{ road_class: 'residential', use: 'footway', rail: false, length: 1 },
				{ road_class: 'service_other', use: 'path', rail: false, length: 1 }
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const clone = {
			edges: [
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 5,
					names: ['RAILWAY | 4701']
				},
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 4,
					names: ['RAILWAY | 4701']
				}
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const responses = [footway, clone];
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockImplementation(async () => responses.shift())
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.slice(0, 10).every((d) => d.mode === 'walking')).toBe(true);
		expect(result[0].reason).toBe('valhalla_footway_edge');
		expect(result.slice(10).every((d) => d.mode === 'train')).toBe(true);
		expect(result[10].reason).toBe('valhalla_rail_edge');
	});

	test('failed probe slice in a rail-confirmed run → recovered by the extension', async () => {
		// A slice whose probe errored carries no evidence either way; when the
		// rest of the run confirms rail, those points belong to the journey.
		const n = 20;
		const observations = Array.from({ length: n }, (_, i) => obs(i, { speed: 120 }));
		const decisions = observations.map((o, i) => decision(i, 'car', 0.7));
		const clone = {
			edges: [
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 5,
					names: ['RAILWAY | 4701']
				},
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 4,
					names: ['RAILWAY | 4701']
				}
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		let calls = 0;
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockImplementation(async () => {
				calls++;
				return calls === 1 ? Promise.reject(new Error('meili timeout')) : clone;
			})
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.slice(0, 10).every((d) => d.mode === 'train')).toBe(true);
		expect(result[0].reason).toBe('valhalla_rail_run_context');
		expect(result[0].confidence).toBe(0.85);
		expect(result.slice(10).every((d) => d.mode === 'train')).toBe(true);
		expect(result[10].reason).toBe('valhalla_rail_edge');
	});

	test('anchored run recovers rail-speed points from suppressed slices (urban canyon)', async () => {
		// The Jul-26 148 km/h point: pedestrian-matched OFF the clones while
		// moving at rail speed inside a confirmed train journey — an urban-
		// canyon matching artifact, not a street-level vehicle. The extension
		// recovers only the rail-speed points; slow street-level points stay.
		const n = 20;
		const speeds = [...Array(9).fill(40), 148, ...Array(10).fill(130)];
		const observations = speeds.map((speed, i) => obs(i, { speed }));
		const decisions = observations.map((o, i) => decision(i, 'car', 0.7));
		const road = {
			edges: [{ road_class: 'residential', use: 'road', rail: false, length: 5, speed: 30 }],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const clone = {
			edges: [
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 5,
					names: ['RAILWAY | 4701']
				},
				{
					road_class: 'service_other',
					use: 'path',
					rail: false,
					length: 4,
					names: ['RAILWAY | 4701']
				}
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const responses = [road, clone];
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockImplementation(async () => responses.shift())
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		// Slow street-level points keep Stage-1 car; the 148 km/h point (idx 9)
		// is recovered as train by run context.
		expect(result.slice(0, 9).every((d) => d.mode === 'car')).toBe(true);
		expect(result[9].mode).toBe('train');
		expect(result[9].reason).toBe('valhalla_rail_run_context');
		expect(result.slice(10).every((d) => d.mode === 'train')).toBe(true);
	});

	test('unanchored run: suppressed train labels flip to car at ANY speed (false-positive guard)', async () => {
		// Station-context false trains (cars passing stations at highway speed)
		// have no anchored clone slice in their run — suppression must keep
		// flipping them regardless of speed.
		const n = 10;
		const observations = Array.from({ length: n }, (_, i) => obs(i, { speed: 130 }));
		const decisions = observations.map((o, i) => decision(i, 'train', 0.8));
		const road = {
			edges: [{ road_class: 'residential', use: 'road', rail: false, length: 5, speed: 30 }],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue(road)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'car')).toBe(true);
		expect(result.every((d) => d.reason === 'valhalla_pedestrian_not_rail')).toBe(true);
	});

	test('sparse walk slice with glitch speeds → walking verdict via robust average', async () => {
		// The Jul-26 walk-to-station: 5 points ~2 min apart whose speed column
		// carries distance-trigger spikes (122/131 km/h on a real walk). The
		// walking gate must use the path/duration average (~5 km/h), not the
		// glitched p90, for sparse slices.
		const speeds = [13, 122, 131, 57, 4];
		// ~150 m per 2-min step → avg ≈ 4.5 km/h (a genuine walk).
		const observations = speeds.map((speed, i) =>
			obs(i, {
				speed,
				timestamp: i * 125_000,
				lat: 52.52 + i * 0.00135,
				lng: 13.37 + i * 0.00135
			})
		);
		const decisions = observations.map((o, i) => decision(i, 'train', 0.8));
		const footway = {
			edges: [
				{ road_class: 'residential', use: 'footway', rail: false, length: 0.15 },
				{ road_class: 'service_other', use: 'path', rail: false, length: 0.15 }
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue(footway)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'walking')).toBe(true);
		expect(result.every((d) => d.reason === 'valhalla_footway_edge')).toBe(true);
	});

	test('sparse train with GPS dropout: scattered pedestrian match must not suppress Stage-1 train', async () => {
		// The Jul-26 Berlin Hbf departure: 4 points 1-5 km apart (distance
		// triggers), moving ~90-130 km/h westward, then a 56-min GPS gap before
		// the journey reappears. meili matches 1.2 km of scattered footways for
		// a 12 km path — that match (and the glitched speed column) is
		// meaningless; the suppression must not veto the Stage-1 train.
		const pts = [
			{ lat: 52.5363, lng: 13.3444, speed: 13 },
			{ lat: 52.5284, lng: 13.284, speed: 122 },
			{ lat: 52.5323, lng: 13.2097, speed: 131 },
			{ lat: 52.535, lng: 13.1959, speed: 57 }
		];
		const observations = pts.map((p, i) => obs(i, { ...p, timestamp: i * 125_000 }));
		const decisions = observations.map((o, i) => decision(i, 'train', 0.8));
		// Scattered footway match: 1.2 km of edges for a ~12 km path.
		const scattered = {
			edges: [
				{ road_class: 'service_other', use: 'footway', rail: false, length: 0.6 },
				{ road_class: 'tertiary', use: 'road', rail: false, length: 0.6, speed: 50 }
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue(scattered)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		// Suppression skipped: the Stage-1 train labels stand untouched.
		expect(result).toEqual(decisions);
	});

	test('sparse road drive with a GOOD pedestrian-road match → suppression still applies', async () => {
		// Same sparsity, but the match follows the path (ratio >= 0.7): a real
		// sparse road drive. Station-context train labels are still suppressed.
		const pts = [
			{ lat: 52.0, lng: 13.0, speed: 110 },
			{ lat: 52.005, lng: 13.03, speed: 115 },
			{ lat: 52.01, lng: 13.06, speed: 120 },
			{ lat: 52.015, lng: 13.09, speed: 112 }
		];
		const observations = pts.map((p, i) => obs(i, { ...p, timestamp: i * 125_000 }));
		const decisions = observations.map((o, i) => decision(i, 'train', 0.8));
		// ~6.3 km path matched by ~4.6 km of road edges (ratio ≈ 0.73 ≥ 0.7),
		// with per-interval speeds ~60 km/h — the kinematic clause alone would
		// NOT trust this match, the coverage ratio must.
		const wellMatched = {
			edges: [
				{ road_class: 'tertiary', use: 'road', rail: false, length: 2.3, speed: 80 },
				{ road_class: 'tertiary', use: 'road', rail: false, length: 2.3, speed: 80 }
			],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue(wellMatched)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'car')).toBe(true);
		expect(result.every((d) => d.reason === 'valhalla_pedestrian_not_rail')).toBe(true);
	});

	test('gated off-road tier: sustained beyond-rail speed → airplane', async () => {
		// A 500 km run at ~830 km/h average: the gated tier (movingP50 >= 100,
		// path >= 30 km) positively infers airplane even though the auto match
		// itself is meaningless at that speed.
		const n = 10;
		const observations = Array.from({ length: n }, (_, i) =>
			obs(i, { timestamp: i * 240_000, speed: 800, lat: 52 + i * 0.5 })
		);
		const decisions = observations.map((o, i) => decision(i, 'car', 0.55));
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [{ road_class: 'motorway', use: 'road', rail: false, length: 5, speed: 120 }],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result.every((d) => d.mode === 'airplane')).toBe(true);
		expect(result[0].reason).toBe('valhalla_offroad_air');
	});

	test('low-confidence segment → sent and confirmed', async () => {
		const { observations, decisions } = segment(10, 'car', 0.4); // below threshold
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [{ road_class: 'motorway', use: 'road', rail: false, speed: 110, length: 8 }],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(2);
		expect(result.every((d) => d.mode === 'car')).toBe(true);
		expect(result[0].reason).toBe('valhalla_motorway_edge');
	});

	test('Valhalla API failure → Stage-1 results preserved', async () => {
		const { observations, decisions } = segment(10, 'car');
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockRejectedValue(new Error('network timeout'))
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result).toEqual(decisions); // all Stage-1 results unchanged
	});

	test('inconclusive Valhalla match (null verdict) → Stage-1 preserved', async () => {
		const { observations, decisions } = segment(10, 'car');
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [{ road_class: 'residential', use: 'road', rail: false, speed: 30, length: 1 }],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(result).toEqual(decisions);
	});

	test('segments separated by large gaps processed independently', async () => {
		// Two car segments separated by a >30min gap (separate runs); second gets rail verdict.
		const seg1 = segment(5, 'car');
		const seg2obs = Array.from({ length: 5 }, (_, i) =>
			obs(i, { timestamp: 40 * MIN + i * 30_000, speed: 95 })
		);
		const seg2dec = seg2obs.map((o, i) => ({
			timestamp: o.timestamp,
			mode: 'car' as const,
			reason: 'speed_in_car_range',
			confidence: 0.8
		}));

		const observations = [...seg1.observations, ...seg2obs];
		const decisions = [...seg1.decisions, ...seg2dec];

		const motorway = {
			edges: [{ road_class: 'motorway', use: 'road', rail: false, speed: 110, length: 5 }],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const railEdges = {
			edges: [{ road_class: 'primary', use: 'road', rail: true, length: 5 }],
			shape: [],
			matched: true
		} satisfies ValhallaTraceResult;
		const mockClient: ValhallaClient = {
			// Per costing: the rail-clone probe (pedestrian) gets no rail names;
			// the auto probes get answers via a call counter (run1 motorway, run2 rail).
			traceAttributes: vi.fn().mockImplementation(async (_pts: unknown, costing: string) => {
				if (costing === 'pedestrian') return motorway;
				autoCalls += 1;
				return autoCalls === 1 ? motorway : railEdges;
			})
		};
		let autoCalls = 0;

		const result = await confirmWithValhalla(observations, decisions, mockClient);

		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(4);
		// First segment stays car (motorway), second becomes train (rail).
		expect(result.slice(0, 5).every((d) => d.mode === 'car')).toBe(true);
		expect(result.slice(5).every((d) => d.mode === 'train')).toBe(true);
	});

	test('single-point run skipped (<2 points cannot match)', async () => {
		const observations = [obs(0)];
		const decisions = [decision(0, 'car', 0.5)];
		const mockClient: ValhallaClient = { traceAttributes: vi.fn() };

		await confirmWithValhalla(observations, decisions, mockClient);
		expect(mockClient.traceAttributes).not.toHaveBeenCalled();
	});

	test('two-point run is probed (fragments merge into runs)', async () => {
		const observations = [obs(0), obs(1)];
		const decisions = [decision(0, 'car', 0.5), decision(1, 'car', 0.5)];
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [],
				shape: [],
				matched: false
			} satisfies ValhallaTraceResult)
		};

		await confirmWithValhalla(observations, decisions, mockClient);
		// rail-clone probe slice + per-segment probe
		expect(mockClient.traceAttributes).toHaveBeenCalledTimes(2);
	});

	test('empty input → empty output, no API calls', async () => {
		const mockClient: ValhallaClient = { traceAttributes: vi.fn() };
		const result = await confirmWithValhalla([], [], mockClient);
		expect(result).toEqual([]);
		expect(mockClient.traceAttributes).not.toHaveBeenCalled();
	});

	test('walking mode uses pedestrian costing', async () => {
		// Slow segment (p90 < 40 km/h) keeps the Stage-1-mode costing.
		const { observations, decisions } = segment(5, 'walking', 0.5, { speed: 4 }); // low confidence → sent
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [{ road_class: 'residential', use: 'footway', rail: false, length: 1 }],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		await confirmWithValhalla(observations, decisions, mockClient);
		expect(mockClient.traceAttributes).toHaveBeenCalledWith(expect.anything(), 'pedestrian');
	});

	test('cycling mode uses bicycle costing', async () => {
		const { observations, decisions } = segment(5, 'cycling', 0.5, { speed: 20 });
		const mockClient: ValhallaClient = {
			traceAttributes: vi.fn().mockResolvedValue({
				edges: [{ road_class: 'residential', use: 'cycleway', rail: false, length: 1 }],
				shape: [],
				matched: true
			} satisfies ValhallaTraceResult)
		};

		await confirmWithValhalla(observations, decisions, mockClient);
		expect(mockClient.traceAttributes).toHaveBeenCalledWith(expect.anything(), 'bicycle');
	});
});

describe('costingForMode', () => {
	// Mirror parity with fluxbase valhalla-confirm.ts — running must match the
	// pedestrian network, not fall through to the permissive road matcher.
	test('mode → costing matrix covers every canonical mode', () => {
		expect(costingForMode('walking')).toBe('pedestrian');
		expect(costingForMode('running')).toBe('pedestrian');
		expect(costingForMode('stationary')).toBe('pedestrian');
		expect(costingForMode('cycling')).toBe('bicycle');
		expect(costingForMode('car')).toBe('auto');
		expect(costingForMode('train')).toBe('auto');
		expect(costingForMode('airplane')).toBe('auto');
		expect(costingForMode('boat')).toBe('auto');
		expect(costingForMode('swimming')).toBe('auto');
		expect(costingForMode('unknown')).toBe('auto');
	});
});
