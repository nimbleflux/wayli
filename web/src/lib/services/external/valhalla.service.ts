// /Users/bart/Dev/wayli/fluxbase/jobs/_shared/services/external/valhalla.service.ts
//
// Client for the self-hosted Valhalla routing engine (https://valhalla.wayli.app).
// Provides GPS trace map-matching via the /trace_attributes endpoint — Valhalla's
// HMM matcher snaps raw GPS points to the OSM road/rail network and returns the
// matched edges with road class, use type (cycleway/footway), and rail flags.
// This is the definitive signal for transport-mode detection (a rail edge IS a
// train; no speed heuristic can beat it).
//
// Endpoint resolution follows the Pelias pattern: DB setting
// `wayli.valhalla_endpoint` → env `VALHALLA_ENDPOINT` → hardcoded default.
// Whether Valhalla is USED at all is a per-user preference (opt-in, default
// off) — read by the transport-mode job, not this service.

// ponytail: cross-runtime env access — Deno-first in jobs, process-first in web.
declare const Deno: { env: { get(name: string): string | undefined } } | undefined;

function getEnv(name: string): string | undefined {
	try {
		if (typeof Deno !== 'undefined') return Deno.env.get(name);
	} catch {
		/* not in Deno */
	}
	try {
		if (typeof process !== 'undefined') return process.env?.[name];
	} catch {
		/* not in Node */
	}
	return undefined;
}

interface FluxbaseClient {
	from(table: string): any;
	schema(schemaName: string): { from(table: string): any };
}

let cachedEndpoint: string | null = null;

/**
 * Resolve the Valhalla endpoint URL. Order: DB setting → env → default.
 * Cached at module level after first resolution.
 */
export async function getValhallaEndpoint(fluxbase?: FluxbaseClient): Promise<string> {
	if (cachedEndpoint) return cachedEndpoint;

	// 1. DB setting (admin-configurable in the server settings UI).
	if (fluxbase) {
		try {
			const { data, error } = await fluxbase
				.schema('app')
				.from('settings')
				.select('value')
				.eq('key', 'wayli.valhalla_endpoint')
				.single();
			if (!error && data?.value?.value) {
				cachedEndpoint = String(data.value.value).replace(/\/$/, '');
				return cachedEndpoint;
			}
		} catch {
			/* setting may not exist — fall through */
		}
	}

	// 2. Env var → 3. Default.
	cachedEndpoint = (getEnv('VALHALLA_ENDPOINT') || 'https://valhalla.wayli.app').replace(/\/$/, '');
	return cachedEndpoint;
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Valhalla costing models relevant to transport-mode matching. */
export type ValhallaCosting = 'auto' | 'pedestrian' | 'bicycle';

/** A GPS point to be matched. Timestamp is optional but improves matching. */
export interface ValhallaTracePoint {
	lat: number;
	lon: number;
	/** Epoch milliseconds (optional — Valhalla can derive speeds from these). */
	timestamp?: number;
}

/**
 * A matched edge from /trace_attributes. Only the fields we request via the
 * filters parameter are populated.
 */
export interface ValhallaEdge {
	road_class:
		| 'motorway'
		| 'trunk'
		| 'primary'
		| 'secondary'
		| 'tertiary'
		| 'unclassified'
		| 'residential'
		| 'service_other';
	use:
		| 'road'
		| 'ramp'
		| 'turn_channel'
		| 'track'
		| 'driveway'
		| 'alley'
		| 'parking_aisle'
		| 'emergency_bay'
		| 'drive_thru'
		| 'culdesac'
		| 'living_street'
		| 'service_drive'
		| 'cycleway'
		| 'mountain_bike_path'
		| 'footway'
		| 'steps'
		| 'path'
		| 'pedestrian_crossing'
		| 'elevator'
		| 'rail_ferry'
		| 'ferry';
	/** True when the edge is a rail line (train tracks). */
	rail?: boolean;
	/** Posted/estimated speed in km/h. */
	speed?: number;
	/** Edge length in km. */
	length?: number;
	/** Street names, if named. */
	names?: string[];
}

export interface ValhallaTraceResult {
	/** Matched edges in traversal order. */
	edges: ValhallaEdge[];
	/** The snapped GPS points (the matched path). */
	shape: Array<{ lat: number; lon: number }>;
	/** True when the response indicates a confident match. */
	matched: boolean;
}

// ─── API client ─────────────────────────────────────────────────────────────

/** Attributes we want from trace_attributes — the minimum for mode detection. */
const EDGE_ATTRIBUTES = [
	'edge.names',
	'edge.speed',
	'edge.road_class',
	'edge.use',
	'edge.length',
	'edge.begin_shape_index',
	'edge.end_shape_index'
];

/** Valhalla caps trace_attributes at 16,000 shape points per request. */
const MAX_SHAPE_POINTS = 16000;

/**
 * Match a GPS trace to the road network via POST /trace_attributes.
 *
 * The `costing` determines which edges are traversable and biases matching:
 * 'auto' snaps to roads (ignores footways), 'pedestrian' matches footpaths,
 * 'bicycle' matches cycleways. Callers pick the costing that matches the
 * Stage-1 candidate mode.
 *
 * Traces longer than 16k points are chunked with a 1-point overlap and the
 * edge results are concatenated.
 */
export async function traceAttributes(
	points: ValhallaTracePoint[],
	costing: ValhallaCosting,
	fluxbase?: FluxbaseClient
): Promise<ValhallaTraceResult> {
	if (points.length < 2) {
		return { edges: [], shape: [], matched: false };
	}

	const endpoint = await getValhallaEndpoint(fluxbase);
	// A self-hosted endpoint must NOT silently fail over to the hosted one —
	// that would send raw GPS traces to a third-party server on every outage.
	// The hosted default is only ever paired with itself.
	const DEFAULT_VALHALLA_ENDPOINT = 'https://valhalla.wayli.app';
	const endpoints =
		!endpoint || endpoint === DEFAULT_VALHALLA_ENDPOINT ? [DEFAULT_VALHALLA_ENDPOINT] : [endpoint];

	// Chunk long traces (Valhalla caps at 16k shape points).
	const chunks: ValhallaTracePoint[][] = [];
	for (let i = 0; i < points.length; i += MAX_SHAPE_POINTS - 1) {
		chunks.push(points.slice(i, i + MAX_SHAPE_POINTS));
	}

	const allEdges: ValhallaEdge[] = [];
	const allShape: Array<{ lat: number; lon: number }> = [];
	let anyMatched = false;

	for (const chunk of chunks) {
		const body = {
			shape: chunk.map((p) => ({
				lat: p.lat,
				lon: p.lon,
				type: 'through' as const,
				...(p.timestamp !== undefined ? { timestamp: p.timestamp } : {})
			})),
			costing,
			shape_match: 'map_snap',
			use_timestamps: true,
			filters: {
				attributes: EDGE_ATTRIBUTES,
				action: 'include'
			}
		};

		let lastError: Error | null = null;
		/* oxlint-disable no-await-in-loop -- endpoint failover is inherently sequential:
		   try each endpoint in turn until one succeeds. */
		for (const ep of endpoints) {
			try {
				const response = await fetch(`${ep}/trace_attributes`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: 'application/json',
						'X-Client-App': 'WayliApp/1.0'
					},
					body: JSON.stringify(body)
				});

				if (!response.ok) {
					const text = await response.text();
					throw new Error(`Valhalla error: ${response.status} - ${text.slice(0, 200)}`);
				}

				const json = (await response.json()) as any;
				const edges: ValhallaEdge[] = (json?.edges ?? []).map((e: any) => ({
					road_class: e.road_class,
					use: e.use,
					rail: e.rail ?? e['rail'] ?? false,
					speed: e.speed,
					length: e.length,
					names: e.names
				}));
				const shape: Array<{ lat: number; lon: number }> = (json?.shape ?? []).map((s: any) => ({
					lat: s.lat,
					lon: s.lon
				}));

				allEdges.push(...edges);
				allShape.push(...shape);
				if (edges.length > 0) anyMatched = true;
				lastError = null;
				break; // success — stop failover loop
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				continue; // try next endpoint
			}
		}
		/* oxlint-enable no-await-in-loop */
		if (lastError) throw lastError;
	}

	return { edges: allEdges, shape: allShape, matched: anyMatched };
}

/** Test-only: reset the endpoint cache (for unit tests). */
// oxlint-disable-next-line no-underscore-dangle -- underscore marks this export as test-only
export function _resetEndpointCache(): void {
	cachedEndpoint = null;
}
