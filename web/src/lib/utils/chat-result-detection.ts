/**
 * Chat Result Detection Utility
 *
 * Detects the type of query results from the chatbot to determine
 * the appropriate visualization (cards vs table).
 */

export type ChatResultType = 'trip' | 'place_visit' | 'tracker_data' | 'aggregate' | 'generic';

export type SuggestedView = 'cards' | 'table';

export interface ResultTypeDetection {
	type: ChatResultType;
	suggestedView: SuggestedView;
	confidence: number;
}

// Field signatures for each result type
const TRIP_FIELDS = ['title', 'start_date', 'end_date', 'image_url', 'visited_country_codes', 'labels'];
const PLACE_VISIT_FIELDS = [
	'poi_name',
	'poi_amenity',
	'poi_category',
	'started_at',
	'duration_minutes'
];
const TRACKER_DATA_FIELDS = ['recorded_at', 'geocode', 'accuracy'];

// Maximum results to show as cards
const MAX_CARDS = 6;

/**
 * Detect the result type from a SQL query string
 */
function detectFromQuery(query: string): ChatResultType | null {
	const normalizedQuery = query.toLowerCase();

	// Check for aggregate functions first
	if (/\b(count|sum|avg|min|max)\s*\(/i.test(normalizedQuery)) {
		// If it's just aggregates without raw data, it's an aggregate result
		if (!/select\s+\*|select\s+\w+\s*,/i.test(normalizedQuery)) {
			return 'aggregate';
		}
	}

	// Check which view is being queried
	if (/\bfrom\s+my_trips\b/i.test(normalizedQuery)) {
		return 'trip';
	}

	if (/\bfrom\s+my_place_visits\b/i.test(normalizedQuery)) {
		return 'place_visit';
	}

	if (/\bfrom\s+my_tracker_data\b/i.test(normalizedQuery)) {
		return 'tracker_data';
	}

	return null;
}

/**
 * Detect the result type from data fields (fallback)
 */
function detectFromFields(data: Record<string, unknown>[]): ChatResultType {
	if (data.length === 0) {
		return 'generic';
	}

	const sampleRow = data[0];
	const keys = Object.keys(sampleRow);

	// Score each type based on field matches
	const tripScore = TRIP_FIELDS.filter((f) => keys.includes(f)).length / TRIP_FIELDS.length;
	const placeScore =
		PLACE_VISIT_FIELDS.filter((f) => keys.includes(f)).length / PLACE_VISIT_FIELDS.length;
	const trackerScore =
		TRACKER_DATA_FIELDS.filter((f) => keys.includes(f)).length / TRACKER_DATA_FIELDS.length;

	// Need at least 40% match to be confident
	const threshold = 0.4;

	if (tripScore >= threshold && tripScore >= placeScore && tripScore >= trackerScore) {
		return 'trip';
	}

	if (placeScore >= threshold && placeScore >= tripScore && placeScore >= trackerScore) {
		return 'place_visit';
	}

	if (trackerScore >= threshold && trackerScore >= tripScore && trackerScore >= placeScore) {
		return 'tracker_data';
	}

	return 'generic';
}

/**
 * Determine the suggested view based on result type and count
 */
function getSuggestedView(type: ChatResultType, rowCount: number): SuggestedView {
	// Always use table for aggregates, tracker data, or generic results
	if (type === 'aggregate' || type === 'tracker_data' || type === 'generic') {
		return 'table';
	}

	// Use cards for trips and place visits if count is small enough
	if (rowCount <= MAX_CARDS) {
		return 'cards';
	}

	return 'table';
}

/**
 * Detect the result type and suggested view for query results
 */
export function detectResultType(
	query: string,
	data: Record<string, unknown>[],
	rowCount: number
): ResultTypeDetection {
	// Try to detect from query first (more reliable)
	let type = detectFromQuery(query);
	let confidence = type ? 0.9 : 0;

	// Fall back to field detection if query parsing failed
	if (!type) {
		type = detectFromFields(data);
		confidence = type !== 'generic' ? 0.7 : 0.3;
	}

	const suggestedView = getSuggestedView(type, rowCount);

	return {
		type,
		suggestedView,
		confidence
	};
}

/**
 * Check if results should be displayed as cards
 */
export function shouldShowAsCards(
	query: string,
	data: Record<string, unknown>[],
	rowCount: number
): boolean {
	const detection = detectResultType(query, data, rowCount);
	return detection.suggestedView === 'cards';
}
