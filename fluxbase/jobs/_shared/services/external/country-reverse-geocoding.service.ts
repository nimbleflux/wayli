// Country/timezone reverse geocoding service for Deno runtime
// GeoJSON data is bundled directly via static imports
// Uses custom point-in-polygon algorithm (no @turf dependency)

import type { FeatureCollection, Feature, Polygon, MultiPolygon, Position } from 'geojson';

// Import GeoJSON data directly - esbuild will bundle these
import countriesRaw from '../../data/countries.geojson';
import timezonesRaw from '../../data/timezones.geojson';

// ============================================================================
// Custom Point-in-Polygon Algorithm (Ray Casting)
// ============================================================================

/**
 * Check if a point is inside a linear ring using ray casting algorithm.
 * Ring is an array of [lng, lat] coordinates.
 */
function pointInRing(lng: number, lat: number, ring: Position[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0], yi = ring[i][1];
		const xj = ring[j][0], yj = ring[j][1];

		const intersect = ((yi > lat) !== (yj > lat)) &&
			(lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);

		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * Check if a point is inside a Polygon (handles holes).
 * Polygon coordinates: first ring is outer boundary, subsequent rings are holes.
 */
function pointInPolygon(lng: number, lat: number, coordinates: Position[][]): boolean {
	// Must be inside outer ring
	if (!pointInRing(lng, lat, coordinates[0])) {
		return false;
	}
	// Must NOT be inside any hole
	for (let i = 1; i < coordinates.length; i++) {
		if (pointInRing(lng, lat, coordinates[i])) {
			return false;
		}
	}
	return true;
}

/**
 * Check if a point is inside a MultiPolygon.
 */
function pointInMultiPolygon(lng: number, lat: number, coordinates: Position[][][]): boolean {
	for (const polygon of coordinates) {
		if (pointInPolygon(lng, lat, polygon)) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a point [lng, lat] is inside a Feature<Polygon | MultiPolygon>.
 */
function pointInFeature(lng: number, lat: number, feature: Feature<Polygon | MultiPolygon>): boolean {
	const geometry = feature.geometry;
	if (geometry.type === 'Polygon') {
		return pointInPolygon(lng, lat, geometry.coordinates);
	} else if (geometry.type === 'MultiPolygon') {
		return pointInMultiPolygon(lng, lat, geometry.coordinates);
	}
	return false;
}

// ============================================================================
// GeoJSON Data Initialization
// ============================================================================

// Normalize countries GeoJSON at module initialization
const countriesGeoJSON: FeatureCollection<Polygon | MultiPolygon> = (() => {
	const rawGeoJSON = countriesRaw as FeatureCollection<Polygon | MultiPolygon>;

	for (const feature of rawGeoJSON.features) {
		const props = feature.properties || {};
		props.ADMIN = props.ADMIN || props.name || null;
		props.NAME = props.NAME || props.name || null;
		props.ISO_A2 = props.ISO_A2 || props['ISO3166-1-Alpha-2'] || null;
		props.ISO_A3 = props.ISO_A3 || props['ISO3166-1-Alpha-3'] || null;
		feature.properties = props;
	}

	return rawGeoJSON;
})();

// Load timezones GeoJSON at module initialization
const timezonesGeoJSON = timezonesRaw as FeatureCollection<Polygon | MultiPolygon>;

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the country name or code for a given lat/lng, or null if not found.
 */
export function getCountryForPoint(lat: number, lng: number): string | null {
	if (countriesGeoJSON.features.length === 0) return null;

	for (const feature of countriesGeoJSON.features) {
		if (pointInFeature(lng, lat, feature)) {
			return (
				feature.properties?.ISO_A2 || feature.properties?.ADMIN || feature.properties?.NAME || null
			);
		}
	}
	return null;
}

/**
 * Returns the timezone offset for a given lat/lng, or null if not found.
 */
export function getTimezoneForPoint(lat: number, lng: number): string | null {
	if (timezonesGeoJSON.features.length === 0) return null;

	for (const feature of timezonesGeoJSON.features) {
		if (pointInFeature(lng, lat, feature)) {
			return feature.properties?.name || null;
		}
	}

	return null;
}

export function getTimezoneDifferenceForPoint(lat: number, lng: number): number | null {
	const timezoneOffset = getTimezoneForPoint(lat, lng);
	if (timezoneOffset) {
		const offsetHours = parseFloat(timezoneOffset);
		if (!isNaN(offsetHours)) {
			return offsetHours;
		}
	}
	return null;
}

/**
 * Applies timezone correction to a timestamp.
 */
export function applyTimezoneCorrection(
	timestamp: Date | number | string,
	timezoneOffset: string
): Date {
	const date = new Date(timestamp);

	const offsetHours = parseFloat(timezoneOffset);
	if (isNaN(offsetHours)) {
		console.log(
			`[TIMEZONE] Invalid timezone offset: ${timezoneOffset}, returning original timestamp`
		);
		return date;
	}

	return date;
}

/**
 * Applies timezone correction to a timestamp based on geographic coordinates.
 */
export function applyTimezoneCorrectionToTimestamp(
	timestamp: Date | number | string,
	latitude: number,
	longitude: number
): string {
	return new Date(timestamp).toISOString();
}

/**
 * Converts a country name to ISO 3166-1 alpha-2 code, or returns null if not found.
 */
export function getCountryCodeFromName(countryName: string): string | null {
	if (!countryName) return null;
	if (countriesGeoJSON.features.length === 0) return null;

	const normalizedName = countryName.toLowerCase().trim();

	for (const feature of countriesGeoJSON.features) {
		const props = feature.properties || {};
		const adminName = props.ADMIN?.toLowerCase();
		const name = props.NAME?.toLowerCase();
		const altName = props.ALTNAME?.toLowerCase();

		if (adminName === normalizedName || name === normalizedName || altName === normalizedName) {
			return props.ISO_A2 || null;
		}
	}

	return null;
}

/**
 * Ensures a country code is valid (2 characters max) and converts country names to codes if needed.
 */
export function normalizeCountryCode(countryCode: string | null): string | null {
	if (!countryCode) return null;

	if (countryCode.length === 2 && /^[A-Z]{2}$/.test(countryCode.toUpperCase())) {
		return countryCode.toUpperCase();
	}

	if (countryCode.length > 2) {
		return getCountryCodeFromName(countryCode);
	}

	return null;
}
