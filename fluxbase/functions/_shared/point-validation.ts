/**
 * Raw-point validation + bounded concurrency for the GPS ingest core
 * (points-core.ts). Kept dependency-free so it can be unit-tested directly
 * with `deno test`.
 *
 * The ingest endpoint used to trust every field: a missing/non-numeric `tst`
 * threw inside the per-point mapper and failed the WHOLE batch with a 500
 * (the client then re-sent the same payload forever), and out-of-range
 * coordinates were stored as-is — PostGIS geometry(Point,4326) does not
 * enforce ranges, which poisons distance and visited-country computations.
 */

/** Upper bound on points accepted per request. The app batches 100; imports send more. */
export const MAX_POINTS_PER_REQUEST = 1000;

/** Pelias/timezone work per point is network+CPU bound; this bounds the fan-out. */
export const POINT_CONCURRENCY = 20;

const MIN_TS_MS = Date.UTC(2000, 0, 1);
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * OwnTracks `tst` is epoch seconds; some exporters emit milliseconds. Both
 * accepted, disambiguated by magnitude.
 */
export function rawPointTimestampMs(point: { tst: unknown }): number {
	const tst = Number(point.tst);
	return tst > 1e12 ? tst : tst * 1000;
}

/**
 * Returns null when the point is ingestible, or a human-readable reason when
 * it must be rejected individually (never batch-wide).
 */
export function validateRawPoint(point: any): string | null {
	const lat = Number(point?.lat);
	const lon = Number(point?.lon);
	if (
		!Number.isFinite(lat) ||
		!Number.isFinite(lon) ||
		lat < -90 ||
		lat > 90 ||
		lon < -180 ||
		lon > 180
	) {
		return `invalid coordinates lat=${point?.lat} lon=${point?.lon}`;
	}
	const tst = Number(point?.tst);
	if (!Number.isFinite(tst)) {
		return `invalid tst=${String(point?.tst)}`;
	}
	const tsMs = rawPointTimestampMs(point);
	if (tsMs < MIN_TS_MS) {
		return `timestamp before 2000 (${new Date(tsMs).toISOString()})`;
	}
	if (tsMs > Date.now() + FUTURE_TOLERANCE_MS) {
		return `timestamp too far in the future (${new Date(tsMs).toISOString()})`;
	}
	return null;
}

/**
 * Promise.all over a huge batch fires thousands of concurrent geocode
 * requests and exhausts the edge runtime. This maps with a fixed worker pool,
 * preserving order and the item index.
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}
