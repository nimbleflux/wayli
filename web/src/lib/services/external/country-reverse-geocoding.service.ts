import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';

import { point, booleanPointInPolygon } from '@turf/turf';

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and cache countries.geojson
let countriesGeoJSON: FeatureCollection<Polygon | MultiPolygon> | null = null;
function loadCountriesGeoJSON(): FeatureCollection<Polygon | MultiPolygon> {
	if (!countriesGeoJSON) {
		let rawGeoJSON: FeatureCollection<Polygon | MultiPolygon>;

		// Try to load embedded compressed data first (for bundled mode)
		try {
			// @ts-ignore - This constant will be injected during bundling via esbuild define
			const compressedData = EMBEDDED_COUNTRIES_GEOJSON;
			const buffer = Buffer.from(compressedData, 'base64');
			const decompressed = gunzipSync(buffer).toString('utf-8');
			rawGeoJSON = JSON.parse(decompressed) as FeatureCollection<Polygon | MultiPolygon>;
			console.log('✅ Loaded countries.geojson from embedded compressed data');
		} catch {
			// Fallback to filesystem (for development mode)
			const filePath = path.resolve(__dirname, '../../data/countries.geojson');
			const data = fs.readFileSync(filePath, 'utf-8');
			rawGeoJSON = JSON.parse(data) as FeatureCollection<Polygon | MultiPolygon>;
		}

		// Normalize properties
		for (const feature of rawGeoJSON.features) {
			const props = feature.properties || {};
			props.ADMIN = props.ADMIN || props.name || null;
			props.NAME = props.NAME || props.name || null;
			props.ISO_A2 = props.ISO_A2 || props['ISO3166-1-Alpha-2'] || null;
			props.ISO_A3 = props.ISO_A3 || props['ISO3166-1-Alpha-3'] || null;
			feature.properties = props;
		}
		countriesGeoJSON = rawGeoJSON;
	}
	return countriesGeoJSON;
}

// Load and cache timezones.geojson
let timezonesGeoJSON: FeatureCollection<Polygon | MultiPolygon> | null = null;
function loadTimezonesGeoJSON(): FeatureCollection<Polygon | MultiPolygon> {
	if (!timezonesGeoJSON) {
		// Try to load embedded compressed data first (for bundled mode)
		try {
			// @ts-ignore - This constant will be injected during bundling via esbuild define
			const compressedData = EMBEDDED_TIMEZONES_GEOJSON;
			const buffer = Buffer.from(compressedData, 'base64');
			const decompressed = gunzipSync(buffer).toString('utf-8');
			timezonesGeoJSON = JSON.parse(decompressed) as FeatureCollection<Polygon | MultiPolygon>;
			console.log('✅ Loaded timezones.geojson from embedded compressed data');
		} catch {
			// Fallback to filesystem (for development mode)
			const possiblePaths = [
				path.resolve(__dirname, '../../data/timezones.geojson'),
				path.resolve(process.cwd(), 'src/lib/data/timezones.geojson'),
				path.resolve(process.cwd(), 'web/src/lib/data/timezones.geojson'),
				'./src/lib/data/timezones.geojson',
				'./web/src/lib/data/timezones.geojson'
			];

			let loaded = false;
			for (const filePath of possiblePaths) {
				try {
					const data = fs.readFileSync(filePath, 'utf-8');
					const parsed = JSON.parse(data) as FeatureCollection<Polygon | MultiPolygon>;
					timezonesGeoJSON = parsed;
					loaded = true;
					break;
				} catch {
					// Continue trying other paths
				}
			}

			if (!loaded) {
				console.error(`❌ [TIMEZONE] Failed to load timezones.geojson from any path`);
				// Return empty feature collection to prevent crashes
				const emptyCollection = {
					type: 'FeatureCollection',
					features: []
				} as FeatureCollection<Polygon | MultiPolygon>;
				timezonesGeoJSON = emptyCollection;
			}
		}
	}
	return timezonesGeoJSON!;
}

/**
 * Returns the country name or code for a given lat/lng, or null if not found.
 */
export function getCountryForPoint(lat: number, lng: number): string | null {
	const geojson = loadCountriesGeoJSON();
	const pt = point([lng, lat]);
	for (const feature of geojson.features) {
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
 * The timezone offset is a string like "-9.5", "-8", "-6", "-4", etc.
 */
export function getTimezoneForPoint(lat: number, lng: number): string | null {
	const geojson = loadTimezonesGeoJSON();
	const pt = point([lng, lat]);

	for (const feature of geojson.features) {
		if (booleanPointInPolygon(pt, feature as Feature<Polygon | MultiPolygon>)) {
			const timezoneOffset = feature.properties?.name || null;
			return timezoneOffset;
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
 * @param timestamp - The raw timestamp (can be Date, number, or string)
 * @param timezoneOffset - The timezone offset string (e.g., "-9.5", "-8", "-6")
 * @returns The corrected timestamp as a Date object with the timezone offset applied
 */
export function applyTimezoneCorrection(
	timestamp: Date | number | string,
	timezoneOffset: string
): Date {
	const date = new Date(timestamp);

	// Parse timezone offset (e.g., "-9.5" -> -9.5 hours, "+2" -> +2 hours)
	const offsetHours = parseFloat(timezoneOffset);
	if (isNaN(offsetHours)) {
		console.log(
			`⚠️ [TIMEZONE] Invalid timezone offset: ${timezoneOffset}, returning original timestamp`
		);
		return date; // Return original if parsing fails
	}

	// Instead of converting to UTC, we want to preserve the local time
	// but ensure the timestamp has the correct timezone offset
	// The timestamp should represent the local time at that location
	// PostgreSQL will handle the timezone-aware timestamp correctly
	return date;
}

/**
 * Applies timezone correction to a timestamp based on geographic coordinates.
 * NOTE: This function now returns UTC timestamps as-is, because PostgreSQL's TIMESTAMPTZ
 * automatically handles timezone conversion when storing. The tz_diff field is used
 * for display purposes to show the correct local time.
 *
 * @param timestamp - The raw timestamp (can be Date, number, or string) - assumed to be UTC
 * @param latitude - The latitude coordinate
 * @param longitude - The longitude coordinate
 * @returns The timestamp in ISO format (UTC)
 */
export function applyTimezoneCorrectionToTimestamp(
	timestamp: Date | number | string,
	latitude: number,
	longitude: number
): string {
	// Convert the timestamp to a Date object and return as UTC ISO string
	// PostgreSQL's TIMESTAMPTZ will store this correctly in UTC
	// Display logic will use tz_diff to show the correct local time
	return new Date(timestamp).toISOString();
}

/**
 * Converts a country name to ISO 3166-1 alpha-2 code, or returns null if not found.
 */
export function getCountryCodeFromName(countryName: string): string | null {
	if (!countryName) return null;

	const geojson = loadCountriesGeoJSON();
	const normalizedName = countryName.toLowerCase().trim();

	for (const feature of geojson.features) {
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

	// If it's already a 2-character code, return it
	if (countryCode.length === 2 && /^[A-Z]{2}$/.test(countryCode.toUpperCase())) {
		return countryCode.toUpperCase();
	}

	// If it's longer than 2 characters, try to convert it from a country name
	if (countryCode.length > 2) {
		return getCountryCodeFromName(countryCode);
	}

	// If it's 1 character or invalid format, return null
	return null;
}
