//
// Vendored, dependency-light copy of the geocode-parsing helpers used by the
// transport-mode detector. This mirrors web/src/lib/utils/transport-mode.ts
// (isAtTrainStation / isAtAirport / isOnHighwayOrMotorway / getVenueType) so the
// Deno job parses OSM tags identically to the browser. Kept self-contained (no
// imports from web/) because the job runtime cannot reach the web app source.
//
// If the web-side parsing logic changes, update this file to match.

import type { GeocodeGeoJSONFeature } from '../../utils/geojson-converter.ts';

function getOsmDataFromAddendum(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): Record<string, unknown> | null {
	if (!reverseGeocode?.properties?.addendum) return null;
	const addendum = reverseGeocode.properties.addendum as Record<string, unknown>;
	const osm = addendum.osm;
	if (!osm || typeof osm !== 'object') return null;
	return osm as Record<string, unknown>;
}

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

export function isAtTrainStation(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;
	const props = reverseGeocode.properties;

	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		if (
			category.some(
				(c) =>
					c === 'transport:station' ||
					c === 'transport:rail' ||
					c.startsWith('transport:rail:')
			)
		) {
			return true;
		}
	}

	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		const railway = osm.railway as string | undefined;
		const publicTransport = osm.public_transport as string | undefined;
		const building = osm.building as string | undefined;

		const railwayStationTypes = ['station', 'halt', 'platform', 'stop', 'subway_entrance', 'tram_stop'];
		if (railway && railwayStationTypes.includes(railway)) return true;

		const publicTransportTypes = ['station', 'platform', 'stop_position', 'stop_area'];
		if (publicTransport && publicTransportTypes.includes(publicTransport)) return true;

		if (building === 'train_station' || building === 'transportation') return true;
	}
	return false;
}

export function isAtAirport(reverseGeocode: GeocodeGeoJSONFeature | null | undefined): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;
	const props = reverseGeocode.properties;

	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		if (category.some((c) => c.startsWith('aviation:') || c === 'aviation:aerodrome')) {
			return true;
		}
	}

	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		const aeroway = osm.aeroway as string | undefined;
		if (aeroway && ['aerodrome', 'helipad', 'terminal', 'gate', 'apron'].includes(aeroway)) {
			return true;
		}
		const building = osm.building as string | undefined;
		if (building === 'aerodrome' || aeroway) return true;
	}
	return false;
}

export function isOnHighwayOrMotorway(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		const highway = osm.highway as string | undefined;
		if (highway && ['motorway', 'trunk', 'motorway_link', 'trunk_link'].includes(highway)) {
			return true;
		}
	}

	const category = reverseGeocode.properties.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		if (category.some((c) => c.includes('motorway') || c.includes('highway:motorway'))) {
			return true;
		}
	}
	return false;
}

/**
 * Water evidence for the boat/swimming states (#220). Mirrors
 * web/src/lib/utils/transport-mode.ts isOnWaterGeocode — update both together.
 * Signals: permanent reverse-geocode failures (no land record; retryable
 * failures like rate limits do NOT count), the Pelias marine layer / water
 * categories, and OSM water tags in the addendum.
 */
export function isOnWaterGeocode(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || typeof reverseGeocode !== 'object' || !reverseGeocode.properties) {
		return false;
	}

	const props = reverseGeocode.properties as Record<string, unknown>;

	if (
		props.geocoding_status === 'failed' &&
		props.retryable !== true &&
		/no results/i.test(String(props.geocode_error ?? ''))
	) {
		return true;
	}

	if (props.layer === 'marine') return true;
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category) && category.some((c) => String(c).includes('water'))) {
		return true;
	}

	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		if (typeof osm.waterway === 'string' && osm.waterway.length > 0) return true;
		if (['water', 'coastline', 'bay'].includes(osm.natural as string)) return true;
		if (['pier', 'breakwater', 'groyne'].includes(osm['man_made'] as string)) return true;
		if (typeof osm['seamark:type'] === 'string' && osm['seamark:type'].length > 0) return true;
	}

	return false;
}
