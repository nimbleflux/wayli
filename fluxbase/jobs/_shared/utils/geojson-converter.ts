// GeoJSON converter utilities for Deno runtime

import type { Feature, Point } from 'geojson';
import type { PeliasReverseResponse, NearbyPOI } from '../services/external/pelias.service';

/**
 * GeoJSON Feature type for geocoded data
 */
export interface GeocodeGeoJSONFeature extends Feature<Point> {
	properties: {
		// Common geocode fields
		display_name?: string;
		address?: Record<string, string>;
		// Extracted location fields for direct access
		city?: string | null;
		country?: string | null;
		// Pelias-specific fields
		label?: string;
		layer?: string;
		category?: string[];
		confidence?: number;
		locality?: string;
		region?: string;
		borough?: string;
		neighbourhood?: string;
		// OSM addendum data (merged from all features, contains venue type, amenity info, etc.)
		addendum?: Record<string, unknown>;
		// Nearby POIs for visit detection (venues only, max 5, sorted by distance)
		nearby_pois?: NearbyPOI[];
		// Metadata fields
		geocoded_at: string;
		geocoding_provider: string;
		// Error fields (for failed geocoding)
		geocode_error?: string;
		geocoding_error?: string; // Legacy field for backward compatibility
		geocoding_status?: 'success' | 'failed';
		retryable?: boolean;
		permanent?: boolean;
		// Allow additional properties
		[key: string]: unknown;
	};
}

/**
 * Converts a Pelias response to a proper GeoJSON Feature
 */
export function convertPeliasToGeoJSON(
	lat: number,
	lon: number,
	peliasResponse: PeliasReverseResponse
): GeocodeGeoJSONFeature {
	const extractedCity: string | null =
		peliasResponse.locality ||
		peliasResponse.address?.city ||
		peliasResponse.neighbourhood ||
		peliasResponse.borough ||
		null;

	const extractedCountry: string | null = peliasResponse.country || peliasResponse.address?.country || null;

	return {
		type: 'Feature',
		geometry: {
			type: 'Point',
			coordinates: [lon, lat]
		},
		properties: {
			display_name: peliasResponse.display_name || peliasResponse.label,
			label: peliasResponse.label,
			address: peliasResponse.address as Record<string, string>,
			layer: peliasResponse.layer,
			category: peliasResponse.category,
			confidence: peliasResponse.confidence,
			locality: peliasResponse.locality,
			region: peliasResponse.region,
			borough: peliasResponse.borough,
			neighbourhood: peliasResponse.neighbourhood,
			addendum: peliasResponse.addendum,
			nearby_pois: peliasResponse.nearby_pois,
			city: extractedCity,
			country: extractedCountry,
			geocoded_at: new Date().toISOString(),
			geocoding_provider: 'pelias'
		}
	} as GeocodeGeoJSONFeature;
}

/**
 * Creates an error GeoJSON feature for failed geocoding attempts
 */
export function createGeocodeErrorGeoJSON(
	lat: number,
	lon: number,
	error: string
): GeocodeGeoJSONFeature {
	return {
		type: 'Feature',
		geometry: {
			type: 'Point',
			coordinates: [lon, lat]
		},
		properties: {
			geocode_error: error,
			geocoding_error: error,
			geocoded_at: new Date().toISOString(),
			geocoding_provider: 'pelias',
			geocoding_status: 'failed'
		}
	} as GeocodeGeoJSONFeature;
}

/**
 * Checks if a geocode object is in the new GeoJSON format
 */
export function isGeoJSONGeocode(geocode: unknown): geocode is GeocodeGeoJSONFeature {
	if (!geocode || typeof geocode !== 'object') {
		return false;
	}

	const geo = geocode as Record<string, unknown>;
	const geometry = geo.geometry as Record<string, unknown> | undefined;

	return (
		geo.type === 'Feature' &&
		!!geometry &&
		typeof geometry === 'object' &&
		geometry.type === 'Point' &&
		Array.isArray(geometry.coordinates)
	);
}

/**
 * Extracts the display name from a GeoJSON geocode feature
 */
export function getDisplayNameFromGeoJSON(geocode: unknown): string | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	return geocode.properties.display_name || geocode.properties.label || null;
}

/**
 * Extracts the address object from a GeoJSON geocode feature
 */
export function getAddressFromGeoJSON(geocode: unknown): Record<string, string> | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	return geocode.properties.address || null;
}

/**
 * Extracts the category array from a GeoJSON geocode feature (Pelias-specific)
 */
export function getCategoryFromGeoJSON(geocode: unknown): string[] | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	return geocode.properties.category || null;
}

/**
 * Extracts the layer from a GeoJSON geocode feature (Pelias-specific)
 */
export function getLayerFromGeoJSON(geocode: unknown): string | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	return geocode.properties.layer || null;
}

/**
 * Extracts the venue type from a GeoJSON geocode feature's addendum (Pelias-specific).
 */
export function getVenueTypeFromGeoJSON(geocode: unknown): string | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	const addendum = geocode.properties.addendum;
	if (!addendum || typeof addendum !== 'object') {
		return null;
	}

	const osm = (addendum as Record<string, unknown>).osm;
	if (!osm || typeof osm !== 'object') {
		return null;
	}

	const osmData = osm as Record<string, unknown>;

	return (
		(osmData.leisure as string) ||
		(osmData.amenity as string) ||
		(osmData.tourism as string) ||
		(osmData.shop as string) ||
		(osmData.sport as string) ||
		null
	);
}

/**
 * Extracts the full addendum object from a GeoJSON geocode feature (Pelias-specific)
 */
export function getAddendumFromGeoJSON(geocode: unknown): Record<string, unknown> | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	return (geocode.properties.addendum as Record<string, unknown>) || null;
}

/**
 * Extracts nearby POIs from a GeoJSON geocode feature (Pelias-specific)
 */
export function getNearbyPOIsFromGeoJSON(geocode: unknown): NearbyPOI[] | null {
	if (!isGeoJSONGeocode(geocode)) {
		return null;
	}

	return geocode.properties.nearby_pois || null;
}

/**
 * Merges new geocoding data with existing geocode properties
 */
export function mergeGeocodingWithExisting(
	existingGeocode: unknown,
	lat: number,
	lon: number,
	peliasResponse: PeliasReverseResponse
): GeocodeGeoJSONFeature {
	const newGeocodeGeoJSON = convertPeliasToGeoJSON(lat, lon, peliasResponse);

	const extractedCity: string | null =
		peliasResponse.locality ||
		peliasResponse.address?.city ||
		peliasResponse.neighbourhood ||
		peliasResponse.borough ||
		null;

	const extractedCountry: string | null = peliasResponse.country || peliasResponse.address?.country || null;

	if (!existingGeocode || typeof existingGeocode !== 'object') {
		const properties = {
			...newGeocodeGeoJSON.properties,
			city: extractedCity,
			country: extractedCountry
		};

		return {
			...newGeocodeGeoJSON,
			properties
		} as GeocodeGeoJSONFeature;
	}

	const existing = existingGeocode as Record<string, unknown>;

	if (existing.type !== 'Feature' || !existing.properties) {
		const properties = {
			...newGeocodeGeoJSON.properties,
			city: extractedCity,
			country: extractedCountry
		};

		return {
			...newGeocodeGeoJSON,
			properties
		} as GeocodeGeoJSONFeature;
	}

	const existingProperties = existing.properties as Record<string, unknown>;
	const wasProperlyGeocoded = !!existingProperties.geocoded_at;

	let mergedProperties: Record<string, unknown>;

	if (wasProperlyGeocoded) {
		mergedProperties = {
			...existingProperties,
			...newGeocodeGeoJSON.properties,
			city: extractedCity,
			country: extractedCountry,
			imported_at: existingProperties.imported_at,
			import_source: existingProperties.import_source,
			geocoded_at: newGeocodeGeoJSON.properties.geocoded_at,
			geocoding_provider: newGeocodeGeoJSON.properties.geocoding_provider,
			addendum: newGeocodeGeoJSON.properties.addendum,
			nearby_pois: newGeocodeGeoJSON.properties.nearby_pois
		};
	} else {
		mergedProperties = {
			...newGeocodeGeoJSON.properties,
			city: extractedCity,
			country: extractedCountry,
			imported_at: existingProperties.imported_at,
			import_source: existingProperties.import_source
		};
	}

	return {
		type: 'Feature',
		geometry: {
			type: 'Point',
			coordinates: [lon, lat]
		},
		properties: mergedProperties
	} as GeocodeGeoJSONFeature;
}
