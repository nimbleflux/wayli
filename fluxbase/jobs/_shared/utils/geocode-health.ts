// Geocode-health thresholds for the scheduled monitor.
//
// Reverse geocoding fills tracker_data.geocode. When the geocoder (Pelias)
// or the geocoding job silently stops working, points stay NULL and
// downstream features degrade quietly — sleep-based trip detection only
// processes points that carry a city, so a geocode outage made recent trips
// undetectable while every job still "succeeded" (2026-11 Pelias outage).

export interface GeocodeBacklogThresholds {
	/** Flag a user when at least this many window points lack geocode. */
	minMissingCount: number;
	/** Flag a user when missing points are at least this share of the window. */
	minMissingRatio: number;
}

export const DEFAULT_GEOCODE_BACKLOG_THRESHOLDS: GeocodeBacklogThresholds = {
	minMissingCount: 50,
	minMissingRatio: 0.2
};

/**
 * Decide whether a user's missing-geocode count is significant enough to
 * alert on. Both bounds must be met (inclusive), so a handful of un-geocoded
 * points — a fresh import racing the geocoder, a brand-new user — doesn't
 * fire, while a real outage of any decent size does.
 */
export function shouldFlagGeocodeBacklog(
	totalPoints: number,
	missingCount: number,
	thresholds: GeocodeBacklogThresholds = DEFAULT_GEOCODE_BACKLOG_THRESHOLDS
): boolean {
	if (totalPoints <= 0) return false;
	if (missingCount < thresholds.minMissingCount) return false;
	return missingCount / totalPoints >= thresholds.minMissingRatio;
}
