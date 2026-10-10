// Mirrors web/src/lib/services/transport-mode/segmentation.ts. Update both together.

export const SEGMENT_GAP_MS = 5 * 60 * 1000;
export const LOOKBACK_MS = 60 * 60 * 1000;

/**
 * Split a chronologically-ordered list into gap-bounded segments, returning the
 * index groups. A new segment starts wherever the gap between consecutive
 * items exceeds `gapMs` (default SEGMENT_GAP_MS). Single source of truth for
 * what a "segment" is — the detector uses it internally.
 *
 * Items need only carry a numeric `timestamp` (epoch ms). Input MUST be sorted
 * ascending. Returns an array of segments, each an array of indices.
 */
export function segmentByGaps<T extends { timestamp: number }>(
	items: T[],
	gapMs: number = SEGMENT_GAP_MS
): number[][] {
	const segments: number[][] = [];
	if (items.length === 0) return segments;
	let current: number[] = [0];
	for (let i = 1; i < items.length; i++) {
		const gap = items[i].timestamp - items[i - 1].timestamp;
		if (gap > gapMs) {
			segments.push(current);
			current = [];
		}
		current.push(i);
	}
	segments.push(current);
	return segments;
}
