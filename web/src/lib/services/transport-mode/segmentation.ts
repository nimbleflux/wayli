//
// Gap-based segmentation shared by the detector and the persistence job.

/**
 * Split continuity after this long without a fix (tunnels, phone off, flights).
 */
export const SEGMENT_GAP_MS = 5 * 60 * 1000;

/**
 * Lookback applied to the incremental watermark: when the job resumes from
 * `last_processed_at`, it re-reads points from `last_processed_at - LOOKBACK`
 * so the tail of the previously-decoded segment is re-decoded in full. Modes
 * depend on the whole segment (Viterbi is global), so the last few points of a
 * segment can change once their neighbours arrive. 1 hour comfortably covers a
 * typical commute segment.
 */
export const LOOKBACK_MS = 60 * 60 * 1000;

/**
 * Split a chronologically-ordered list into gap-bounded segments, returning the
 * index groups. A new segment starts wherever the gap between consecutive
 * items exceeds `gapMs` (default SEGMENT_GAP_MS). This is the single source of
 * truth for what a "segment" is — the HMM detector uses it internally, and the
 * Location Data map editor uses it to derive editable segment groups.
 *
 * Items need only carry a numeric `timestamp` (epoch ms). The input MUST be
 * sorted ascending by timestamp; an empty/short input yields an empty result.
 *
 * Returns an array of segments, each an array of indices into the input.
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
