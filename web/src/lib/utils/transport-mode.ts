import { TransportDetectionReason } from '../types/transport-mode.types';
import type { GeocodeGeoJSONFeature } from './geojson-converter';

import { SPEED_BRACKETS } from './transport-mode.config';

// =============================================================================
// Addendum/OSM Tag Extraction Helpers
// =============================================================================

/**
 * Extracts OSM data from the addendum field of a geocode feature.
 * Returns the osm object or null if not available.
 */
function getOsmDataFromAddendum(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): Record<string, unknown> | null {
	if (!reverseGeocode?.properties?.addendum) return null;

	const addendum = reverseGeocode.properties.addendum as Record<string, unknown>;
	const osm = addendum.osm;

	if (!osm || typeof osm !== 'object') return null;
	return osm as Record<string, unknown>;
}

/**
 * Gets the venue type from addendum OSM data.
 * Checks leisure, amenity, tourism, shop, sport tags in priority order.
 */
export function getVenueTypeFromAddendum(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): string | null {
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (!osm) return null;

	return (
		(osm.leisure as string) ||
		(osm.amenity as string) ||
		(osm.tourism as string) ||
		(osm.shop as string) ||
		(osm.sport as string) ||
		null
	);
}

/**
 * Checks if the geocode evidence suggests the point is on (or immediately at)
 * open water (#220). Three signal classes:
 *   1. A permanent reverse-geocode failure — Pelias had no land record for the
 *      coordinate. Rate-limit and transport failures are flagged `retryable`
 *      and must NOT count (a missing lookup is not evidence of water).
 *   2. Pelias marine layer / water categories.
 *   3. OSM water tags in the addendum (waterway, natural=water|coastline|bay,
 *      man_made=pier|breakwater|groyne, seamark:type).
 */
export function isOnWaterGeocode(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || typeof reverseGeocode !== 'object' || !reverseGeocode.properties) {
		return false;
	}

	const props = reverseGeocode.properties as Record<string, unknown>;

	// Signal 1: permanent NO-RESULT failures (open water has no land record).
	// Only no-result-class errors count — infra failures ("All Pelias endpoints
	// failed", 5xx) are also non-retryable but are NOT evidence of water.
	if (
		props.geocoding_status === 'failed' &&
		props.retryable !== true &&
		/no results/i.test(String(props.geocode_error ?? ''))
	) {
		return true;
	}

	// Signal 2: Pelias marine layer / water categories
	if (props.layer === 'marine') return true;
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category) && category.some((c) => String(c).includes('water'))) {
		return true;
	}

	// Signal 3: OSM water tags
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		if (typeof osm.waterway === 'string' && osm.waterway.length > 0) return true;
		if (['water', 'coastline', 'bay'].includes(osm.natural as string)) return true;
		if (['pier', 'breakwater', 'groyne'].includes(osm['man_made'] as string)) return true;
		if (typeof osm['seamark:type'] === 'string' && osm['seamark:type'].length > 0) return true;
	}

	return false;
}

// ponytail: haversine consolidated into multi-point-speed.ts; re-exported here for back-compat.
export { haversine } from './multi-point-speed';
import { haversine } from './multi-point-speed';

// Speed brackets for transport modes (km/h)
export const MIN_STOP_DURATION = 300; // 5 minutes

// Enhanced Context object to track transport mode state with airport support

// Get speed bracket for a given speed

// Check if a point is at a train station
export function isAtTrainStation(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const props = reverseGeocode.properties;

	// Pelias category-based detection
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		// Check for train/rail related categories
		if (
			category.some(
				(c) =>
					c === 'transport:station' || c === 'transport:rail' || c.startsWith('transport:rail:')
			)
		) {
			return true;
		}
	}

	// Addendum/OSM-based detection (merged from all Pelias features)
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		// Check for railway-related OSM tags
		const railway = osm.railway as string | undefined;
		const publicTransport = osm.public_transport as string | undefined;
		const building = osm.building as string | undefined;

		// Railway station types
		const railwayStationTypes = [
			'station',
			'halt',
			'platform',
			'stop',
			'subway_entrance',
			'tram_stop'
		];
		if (railway && railwayStationTypes.includes(railway)) {
			return true;
		}

		// Public transport station types
		const publicTransportTypes = ['station', 'platform', 'stop_position', 'stop_area'];
		if (publicTransport && publicTransportTypes.includes(publicTransport)) {
			return true;
		}

		// Building is a train station or transportation building
		if (building === 'train_station' || building === 'transportation') {
			return true;
		}
	}

	return false;
}

// Get train station name from reverse geocode
export function getTrainStationName(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): string | null {
	if (!reverseGeocode || !reverseGeocode.properties) return null;

	const props = reverseGeocode.properties;

	// Pelias properties (preferred)
	const name = (props.name as string) || props.label || props.display_name || '';
	const city = props.locality || props.address?.city || '';

	if (city && name && name !== city) {
		return `${city} - ${name}`;
	}
	return name || city || null;
}

// Phase 1: Airport Detection Functions

// Check if a point is at an airport
export function isAtAirport(reverseGeocode: GeocodeGeoJSONFeature | null | undefined): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const props = reverseGeocode.properties;

	// Pelias category-based detection
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		// Check for air transport related categories
		if (category.some((c) => c.startsWith('transport:air'))) {
			return true;
		}
	}

	// Addendum/OSM-based detection (merged from all Pelias features)
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		// Check for aeroway-related OSM tags
		const aeroway = osm.aeroway as string | undefined;
		const building = osm.building as string | undefined;

		// Aeroway types that indicate airport
		const aerowayTypes = [
			'aerodrome',
			'terminal',
			'gate',
			'helipad',
			'heliport',
			'runway',
			'taxiway',
			'apron'
		];
		if (aeroway && aerowayTypes.includes(aeroway)) {
			return true;
		}

		// Building is an airport terminal
		if (building === 'terminal' || building === 'airport' || building === 'airport_terminal') {
			return true;
		}
	}

	return false;
}

// Get airport name from reverse geocode
export function getAirportName(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): string | null {
	if (!reverseGeocode || !reverseGeocode.properties) return null;

	const props = reverseGeocode.properties;

	// Pelias properties (preferred)
	const name = (props.name as string) || props.label || props.display_name || '';
	const city = props.locality || props.address?.city || '';

	if (city && name && name !== city) {
		return `${city} - ${name}`;
	}
	return name || city || null;
}

// Calculate significant distance threshold for airplane detection

// Check if distance traveled indicates airplane journey (>50km)

// Phase 2: Calculate rolling average speed to handle traffic jams and station stops

// Phase 2: Analyze measurement frequency for transport mode detection with rolling average

// Phase 2: Analyze mode history for better continuity decisions

// Phase 2: Check if location is on highway/motorway
export function isOnHighwayOrMotorway(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const props = reverseGeocode.properties;

	// OSM highway types that indicate major roads (motorways, trunk roads, primary roads)
	const majorHighwayTypes = [
		'motorway',
		'motorway_link',
		'trunk',
		'trunk_link',
		'primary',
		'primary_link'
	];

	// Pelias addendum/OSM-based detection
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		const highway = osm.highway as string | undefined;
		if (highway && majorHighwayTypes.includes(highway)) {
			return true;
		}
	}

	return false;
}

// Phase 2: Enhanced car vs train distinction based on geographic context, measurement frequency, and road type

// Phase 2: Check for physically impossible speed/mode combinations

// Phase 2: Enhanced mode switch validation with speed-based rules
