import { describe, test, expect } from 'vitest';
import { modeFromEdges, matchedDistanceMeters, offRoadClassification } from './valhalla-mapping';
import type { ValhallaEdge } from './valhalla.service';

const edge = (overrides: Partial<ValhallaEdge> = {}): ValhallaEdge => ({
	road_class: 'residential',
	use: 'road',
	rail: false,
	speed: 50,
	length: 1,
	...overrides
});

describe('modeFromEdges', () => {
	test('majority rail edges → train (definitive)', () => {
		const edges = [
			edge({ rail: true, length: 8, use: 'road', road_class: 'primary' }),
			edge({ rail: true, length: 6 }),
			edge({ rail: false, length: 2 }) // small non-rail portion
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('train');
		expect(verdict?.confidence).toBe(0.95);
		expect(verdict?.evidence).toBe('valhalla_rail_edge');
	});

	test('majority cycleway use → cycling', () => {
		const edges = [
			edge({ use: 'cycleway', length: 3 }),
			edge({ use: 'cycleway', length: 2 }),
			edge({ use: 'road', length: 1 })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('cycling');
		expect(verdict?.evidence).toBe('valhalla_cycleway_edge');
	});

	test('majority footway/steps/path use → walking', () => {
		const edges = [
			edge({ use: 'footway', length: 2 }),
			edge({ use: 'steps', length: 1 }),
			edge({ use: 'road', length: 1 })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('walking');
		expect(verdict?.evidence).toBe('valhalla_footway_edge');
	});

	test('majority ferry use → boat (#220)', () => {
		const edges = [
			edge({ use: 'ferry', length: 20, speed: 35 }),
			edge({ use: 'ferry', length: 10, speed: 35 }),
			edge({ use: 'road', length: 1 })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('boat');
		expect(verdict?.evidence).toBe('valhalla_ferry_edge');
	});

	test('boat verdict rejected beyond plausible vessel speed (p90 gate)', () => {
		const edges = [edge({ use: 'ferry', length: 5 })];
		const verdict = modeFromEdges(edges, { p90Kmh: 160, avgKmh: null, pathMeters: 0 });
		expect(verdict).toBeNull();
	});

	test('one ferry edge in a motorway run stays car (#220)', () => {
		const edges = [
			edge({ road_class: 'motorway', speed: 110, length: 10 }),
			edge({ use: 'ferry', length: 0.5, speed: 30 })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('car');
	});

	test('motorway + high speed → car', () => {
		const edges = [
			edge({ road_class: 'motorway', speed: 110, length: 10 }),
			edge({ road_class: 'trunk', speed: 90, length: 5 })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('car');
		expect(verdict?.evidence).toBe('valhalla_motorway_edge');
	});

	test('mixed residential roads with moderate speed → null (inconclusive)', () => {
		const edges = [
			edge({ road_class: 'residential', speed: 30 }),
			edge({ road_class: 'service_other', speed: 20 }),
			edge({ road_class: 'unclassified', speed: 40 })
		];
		expect(modeFromEdges(edges)).toBeNull();
	});

	test('empty edges → null', () => {
		expect(modeFromEdges([])).toBeNull();
	});

	test('longer edges outweigh many short ones (length weighting)', () => {
		// One 10km motorway vs five 100m driveways — motorway should win.
		const edges = [
			edge({ road_class: 'motorway', speed: 100, length: 10 }),
			...Array.from({ length: 5 }, () => edge({ use: 'driveway', length: 0.1, speed: 10 }))
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('car');
	});

	test('missing length defaults to weight 1 per edge', () => {
		const edges = [
			edge({ rail: true, length: undefined as any }),
			edge({ rail: true, length: undefined as any }),
			edge({ rail: false, length: undefined as any })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.mode).toBe('train');
	});

	test('names extracted from dominant edges', () => {
		const edges = [
			edge({ rail: true, length: 5, names: ['Amsterdam–Utrecht line'] }),
			edge({ rail: true, length: 3, names: ['Amsterdam–Utrecht line'] })
		];
		const verdict = modeFromEdges(edges);
		expect(verdict?.names).toContain('Amsterdam–Utrecht line');
	});
});

describe('matchedDistanceMeters', () => {
	test('sums edge lengths (km → meters)', () => {
		const edges = [
			edge({ length: 2.5 }),
			edge({ length: 1.5 }),
			edge({ length: undefined as any })
		];
		expect(matchedDistanceMeters(edges)).toBe(4000);
	});

	test('empty → 0', () => {
		expect(matchedDistanceMeters([])).toBe(0);
	});
});

describe('modeFromEdges kinematic sanity gates (v2)', () => {
	const footwayEdges = [edge({ use: 'footway', road_class: 'service_other', speed: 5, length: 5 })];

	test('walking verdict rejected above 15 km/h p90 (the Jul-7 failure)', () => {
		expect(
			modeFromEdges(footwayEdges, { p90Kmh: 63, avgKmh: 20, pathMeters: 8900, durationSec: 1600 })
		).toBeNull();
		expect(
			modeFromEdges(footwayEdges, { p90Kmh: 10, avgKmh: 5, pathMeters: 800, durationSec: 600 })
				?.mode
		).toBe('walking');
	});

	test('cycling verdict rejected above 35 km/h p90', () => {
		const edges = [edge({ use: 'cycleway', speed: 20, length: 4 })];
		expect(
			modeFromEdges(edges, { p90Kmh: 60, avgKmh: 50, pathMeters: 3000, durationSec: 220 })
		).toBeNull();
		expect(
			modeFromEdges(edges, { p90Kmh: 25, avgKmh: 20, pathMeters: 2000, durationSec: 360 })?.mode
		).toBe('cycling');
	});

	test('car verdict rejected above 200 km/h p90', () => {
		const edges = [edge({ road_class: 'motorway', speed: 150, length: 10 })];
		expect(
			modeFromEdges(edges, { p90Kmh: 230, avgKmh: 220, pathMeters: 20000, durationSec: 330 })
		).toBeNull();
		expect(
			modeFromEdges(edges, { p90Kmh: 150, avgKmh: 140, pathMeters: 20000, durationSec: 510 })?.mode
		).toBe('car');
	});

	test('rail verdict is NOT speed-gated (definitive when present)', () => {
		const edges = [edge({ rail: true, length: 5, road_class: 'primary' })];
		expect(
			modeFromEdges(edges, { p90Kmh: 160, avgKmh: 150, pathMeters: 20000, durationSec: 480 })?.mode
		).toBe('train');
	});
});

describe('offRoadClassification', () => {
	// Simulates an intercity train: ~55 km path, ~36 min, 130 km/h cruise —
	// the shape of the Jul 24 / Jul 26 traces.
	const trainRaw = Array.from({ length: 12 }, (_, i) => ({
		lat: 52 + i * 0.05,
		lng: 5 + i * 0.01
	}));
	const trainSpeeds = Array.from({ length: 12 }, () => 140);
	const trainDuration = 11 * 240; // seconds

	test('poor match (short matched length) at rail speed → train', () => {
		const v = offRoadClassification({
			raw: trainRaw,
			shape: [],
			edges: [edge({ length: 0.5, speed: 50 }), edge({ length: 0.5, speed: 30 })],
			speedsKmh: trainSpeeds,
			durationSec: trainDuration
		});
		expect(v?.mode).toBe('train');
		expect(v?.evidence).toBe('valhalla_offroad_rail');
		expect(v?.confidence).toBe(0.85);
	});

	test('plausible match (full-length fast motorway) → null (stays car)', () => {
		const shape = trainRaw.map((p) => ({ lat: p.lat, lon: p.lng }));
		const v = offRoadClassification({
			raw: trainRaw,
			shape,
			edges: [
				edge({ road_class: 'motorway', length: 30, speed: 130 }),
				edge({ road_class: 'motorway', length: 25, speed: 125 })
			],
			speedsKmh: trainSpeeds,
			durationSec: trainDuration
		});
		expect(v).toBeNull();
	});

	test('slow shared-edge check: most matched edges far slower than GPS → train', () => {
		const shape = trainRaw.map((p) => ({ lat: p.lat + 0.001, lon: p.lng }));
		const v = offRoadClassification({
			raw: trainRaw,
			shape,
			edges: [
				edge({ length: 20, speed: 50 }),
				edge({ length: 20, speed: 50 }),
				edge({ length: 10, speed: 120 })
			],
			speedsKmh: trainSpeeds,
			durationSec: trainDuration
		});
		expect(v?.mode).toBe('train');
	});

	test('below rail speed (city tram-like ~28 km/h avg) → null (no train claim)', () => {
		// avg = path/duration: 61 km over 8000 s ≈ 28 km/h — under the train window.
		const v = offRoadClassification({
			raw: trainRaw,
			shape: [],
			edges: [],
			speedsKmh: trainSpeeds,
			durationSec: 8000
		});
		expect(v).toBeNull();
	});

	test('sustained beyond-rail speed over long path → airplane', () => {
		// avg = path/duration: 61 km over 700 s ≈ 315 km/h — above the rail window.
		const v = offRoadClassification({
			raw: trainRaw,
			shape: [],
			edges: [],
			speedsKmh: trainSpeeds,
			durationSec: 700
		});
		expect(v?.mode).toBe('airplane');
		expect(v?.evidence).toBe('valhalla_offroad_air');
	});

	test('no timing information → null', () => {
		expect(
			offRoadClassification({
				raw: trainRaw,
				shape: [],
				edges: [],
				speedsKmh: trainSpeeds,
				durationSec: null
			})
		).toBeNull();
	});
});
