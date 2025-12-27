import { point, booleanPointInPolygon } from '@turf/turf';

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

// Deno type declaration for cross-runtime compatibility
declare const Deno:
	| {
			env: { get(key: string): string | undefined };
			readTextFileSync(path: string): string;
	  }
	| undefined;

// Cross-runtime gunzip function
function decompressGzip(base64Data: string): string {
	// Decode base64 to binary
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	// Use DecompressionStream (available in both Node.js 18+ and Deno)
	// But since this runs at module initialization (sync), we need a sync approach
	// In Deno, we can use the built-in pako-like functionality or fall back

	// For Node.js, try to use zlib
	if (typeof process !== 'undefined' && process.versions?.node) {
		try {
			// Dynamic import to avoid issues in Deno
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const zlib = require('zlib');
			const buffer = Buffer.from(base64Data, 'base64');
			return zlib.gunzipSync(buffer).toString('utf-8');
		} catch {
			// Fall through to other methods
		}
	}

	// For Deno, use the built-in decompression
	if (typeof Deno !== 'undefined') {
		try {
			// Deno has fflate available or we can use DecompressionStream
			// Since we need sync, try using the Compression Streams API with sync wrapper
			// Actually, Deno doesn't have a sync gunzip - the bundler should handle this
			// If we get here in Deno, the embedded data approach failed
			throw new Error('Deno sync gunzip not available - embedded data required');
		} catch {
			throw new Error('Decompression failed in Deno runtime');
		}
	}

	throw new Error('No compatible decompression method available');
}

// Cross-runtime file reading
function readFileSync(filePath: string): string | null {
	// Try Node.js fs
	if (typeof process !== 'undefined' && process.versions?.node) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const fs = require('fs');
			return fs.readFileSync(filePath, 'utf-8');
		} catch {
			return null;
		}
	}

	// Try Deno
	if (typeof Deno !== 'undefined') {
		try {
			return Deno.readTextFileSync(filePath);
		} catch {
			return null;
		}
	}

	return null;
}

// Cross-runtime path resolution
function resolvePath(...segments: string[]): string {
	// Simple path join - works for both runtimes
	return segments
		.join('/')
		.replace(/\/+/g, '/')
		.replace(/\/$/, '');
}

// Get current working directory cross-runtime
function getCwd(): string {
	if (typeof process !== 'undefined' && process.cwd) {
		return process.cwd();
	}
	if (typeof Deno !== 'undefined') {
		try {
			return (Deno as any).cwd();
		} catch {
			return '/app';
		}
	}
	return '/app';
}

// Load GeoJSON data with fallbacks
function loadGeoJSON(
	embeddedConstantName: string,
	fileName: string
): FeatureCollection<Polygon | MultiPolygon> {
	// Try to load embedded compressed data first (for bundled mode)
	try {
		// These constants are injected by esbuild during bundling
		let compressedData: string | undefined;

		if (embeddedConstantName === 'EMBEDDED_COUNTRIES_GEOJSON') {
			// @ts-ignore - This constant will be injected during bundling via esbuild define
			compressedData = typeof EMBEDDED_COUNTRIES_GEOJSON !== 'undefined' ? EMBEDDED_COUNTRIES_GEOJSON : undefined;
		} else if (embeddedConstantName === 'EMBEDDED_TIMEZONES_GEOJSON') {
			// @ts-ignore - This constant will be injected during bundling via esbuild define
			compressedData = typeof EMBEDDED_TIMEZONES_GEOJSON !== 'undefined' ? EMBEDDED_TIMEZONES_GEOJSON : undefined;
		}

		if (compressedData) {
			const decompressed = decompressGzip(compressedData);
			console.log(`✅ Loaded ${fileName} from embedded compressed data`);
			return JSON.parse(decompressed) as FeatureCollection<Polygon | MultiPolygon>;
		}
	} catch (e) {
		// Embedded data not available or decompression failed, try filesystem
		console.log(`ℹ️ Embedded ${fileName} not available, trying filesystem...`);
	}

	// Fallback to filesystem (for development mode)
	const cwd = getCwd();
	const possiblePaths = [
		resolvePath(cwd, 'src/lib/data', fileName),
		resolvePath(cwd, 'web/src/lib/data', fileName),
		resolvePath('/app/web/src/lib/data', fileName),
		resolvePath('/data', fileName)
	];

	for (const filePath of possiblePaths) {
		const data = readFileSync(filePath);
		if (data) {
			console.log(`✅ Loaded ${fileName} from ${filePath}`);
			return JSON.parse(data) as FeatureCollection<Polygon | MultiPolygon>;
		}
	}

	console.error(`❌ [GEOJSON] Failed to load ${fileName} from any path`);
	// Return empty feature collection to prevent crashes
	return {
		type: 'FeatureCollection',
		features: []
	} as FeatureCollection<Polygon | MultiPolygon>;
}

// Eager load countries.geojson at module initialization
const countriesGeoJSON: FeatureCollection<Polygon | MultiPolygon> = (() => {
	const rawGeoJSON = loadGeoJSON('EMBEDDED_COUNTRIES_GEOJSON', 'countries.geojson');

	// Normalize properties
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

// Eager load timezones.geojson at module initialization
const timezonesGeoJSON: FeatureCollection<Polygon | MultiPolygon> = loadGeoJSON(
	'EMBEDDED_TIMEZONES_GEOJSON',
	'timezones.geojson'
);

/**
 * Returns the country name or code for a given lat/lng, or null if not found.
 */
export function getCountryForPoint(lat: number, lng: number): string | null {
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
 * The timezone offset is a string like "-9.5", "-8", "-6", "-4", etc.
 */
export function getTimezoneForPoint(lat: number, lng: number): string | null {
	const pt = point([lng, lat]);

	for (const feature of timezonesGeoJSON.features) {
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
