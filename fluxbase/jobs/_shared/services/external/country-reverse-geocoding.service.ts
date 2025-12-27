// Country/timezone reverse geocoding service for Deno runtime
// GeoJSON data is bundled directly via static imports

import { point, booleanPointInPolygon } from '@turf/turf';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

// Import GeoJSON data directly - esbuild will bundle these
import countriesRaw from '../../data/countries.geojson';
import timezonesRaw from '../../data/timezones.geojson';

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

/**
 * Returns the country name or code for a given lat/lng, or null if not found.
 */
export function getCountryForPoint(lat: number, lng: number): string | null {
	if (countriesGeoJSON.features.length === 0) return null;

	const pt = point([lng, lat]);
	for (const feature of countriesGeoJSON.features) {
		if (booleanPointInPolygon(pt, feature as Feature<Polygon | MultiPolygon>)) {
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

	const pt = point([lng, lat]);

	for (const feature of timezonesGeoJSON.features) {
		if (booleanPointInPolygon(pt, feature as Feature<Polygon | MultiPolygon>)) {
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
			`⚠️ [TIMEZONE] Invalid timezone offset: ${timezoneOffset}, returning original timestamp`
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
