/**
 * Lookback-window computation for watermark-based daily aggregation jobs.
 *
 * The consumers upsert — i.e. OVERWRITE — per-day totals, so the window must
 * begin at 00:00Z: a window starting mid-day re-aggregates only the
 * post-window portion of the earlier affected day and permanently clobbers the
 * rest (~5/24 of every day's totals on the 05:00 UTC schedule). Flooring to
 * UTC midnight makes every touched day complete again, at the cost of
 * re-reading at most one extra day's points.
 */
export function dayWindowSince(
	lastProcessedAt: string | null,
	fullRebuild: boolean,
	lookbackDays: number
): string | null {
	if (fullRebuild || !lastProcessedAt) return null;
	const start = new Date(new Date(lastProcessedAt).getTime() - lookbackDays * 24 * 60 * 60 * 1000);
	start.setUTCHours(0, 0, 0, 0);
	return start.toISOString();
}
