/**
 * Normalize a job payload date bound to a string Postgres can compare against
 * a timestamptz column.
 *
 * Clients have shipped epoch-millis numbers here (date pickers that serialize
 * their bound state as timestamps). Raw millis in a `recorded_at` filter fail
 * with SQLSTATE 22008, which fluxbase surfaces as PGRST000 "Failed to fetch
 * records" — and because the trip-detection service only logged count errors,
 * the job then reported success with 0 trips.
 */
export function normalizeDateBound(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
		const date = new Date(Number(value));
		if (isNaN(date.getTime())) return undefined;
		return date.toISOString();
	}
	return String(value);
}
