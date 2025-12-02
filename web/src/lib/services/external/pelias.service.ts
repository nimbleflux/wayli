// web/src/lib/services/external/pelias.service.ts
// Pelias geocoding service for both client and worker use

import type { PeliasResponse, PeliasFeature, NormalizedAddress } from '../../types/geocoding.types';
import { convertCountryCode3to2 } from '../../types/geocoding.types';

/**
 * Pelias reverse geocode response (normalized for internal use)
 */
export interface PeliasReverseResponse {
	display_name: string;
	label: string;
	name?: string;
	confidence?: number;
	accuracy?: string;
	layer?: string;
	source?: string;
	// Pelias properties for transport mode detection
	category?: string[];
	// Normalized address for compatibility
	address: NormalizedAddress;
	// Original Pelias properties (for direct access)
	locality?: string;
	region?: string;
	region_a?: string;
	country?: string;
	country_a?: string;
	neighbourhood?: string;
	borough?: string;
	// OSM addendum data (merged from all features, first value wins)
	addendum?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Pelias search response (for forward geocoding)
 */
export interface PeliasSearchResponse {
	display_name: string;
	lat: number;
	lon: number;
	address: NormalizedAddress;
	name?: string;
	confidence?: number;
	layer?: string;
	category?: string[];
	// OSM addendum data (contains venue type, amenity info, etc.)
	addendum?: Record<string, unknown>;
	[key: string]: unknown;
}

// Get configuration - prioritize environment variables, fallback to default
const config = {
	endpoint: process.env?.PELIAS_ENDPOINT || 'https://pelias.wayli.app',
	rateLimit: parseInt(process.env?.PELIAS_RATE_LIMIT || '1000', 10)
};

// Rate limiting configuration
const MIN_INTERVAL = config.rateLimit > 0 ? 1000 / config.rateLimit : 0;
const RATE_LIMIT_ENABLED = config.rateLimit > 0;

let lastRequestTime = 0;

/**
 * Merges addendum data from all Pelias features into a single object.
 * First value wins on conflicts (features are ordered by relevance).
 */
function mergeAddendumFromFeatures(features: PeliasFeature[]): Record<string, unknown> | undefined {
	const merged: Record<string, unknown> = {};

	for (const feature of features) {
		const addendum = feature.properties.addendum;
		if (addendum && typeof addendum === 'object') {
			for (const [key, value] of Object.entries(addendum)) {
				if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
					// For nested objects like 'osm', merge recursively (first value wins)
					if (!(key in merged)) {
						merged[key] = {};
					}
					const targetObj = merged[key] as Record<string, unknown>;
					for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
						if (!(subKey in targetObj)) {
							targetObj[subKey] = subValue;
						}
					}
				} else if (!(key in merged)) {
					// First value wins for non-object values
					merged[key] = value;
				}
			}
		}
	}

	return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Transform a Pelias feature to our internal response format
 */
function transformPeliasFeature(
	feature: PeliasFeature,
	mergedAddendum?: Record<string, unknown>
): PeliasReverseResponse {
	const props = feature.properties;

	// Build normalized address for compatibility with existing code
	const address: NormalizedAddress = {};
	if (props.locality) address.city = props.locality;
	if (props.region) address.state = props.region;
	if (props.country) address.country = props.country;
	if (props.neighbourhood) address.neighbourhood = props.neighbourhood;
	if (props.borough) address.borough = props.borough;
	if (props.street) address.road = props.street;
	if (props.housenumber) address.house_number = props.housenumber;
	if (props.postalcode) address.postcode = props.postalcode;
	if (props.county) address.county = props.county;

	// Convert 3-letter to 2-letter country code
	if (props.country_a) {
		address.country_code = convertCountryCode3to2(props.country_a);
	}

	return {
		display_name: props.label || '',
		label: props.label || '',
		name: props.name,
		confidence: props.confidence,
		accuracy: props.accuracy,
		layer: props.layer,
		source: props.source,
		category: props.category,
		address,
		// Include original Pelias properties for direct access
		locality: props.locality,
		region: props.region,
		region_a: props.region_a,
		country: props.country,
		country_a: props.country_a,
		neighbourhood: props.neighbourhood,
		borough: props.borough,
		// Include merged addendum data (or from single feature if not merged)
		addendum: mergedAddendum ?? props.addendum
	};
}

/**
 * Reverse geocode coordinates to get location information
 */
export async function reverseGeocode(lat: number, lon: number): Promise<PeliasReverseResponse> {
	// Rate limiting (only if enabled and rate limit > 0)
	if (RATE_LIMIT_ENABLED) {
		const now = Date.now();
		const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now);
		if (wait > 0 && isFinite(wait)) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastRequestTime = Date.now();
	}

	// Validate coordinates before making request
	if (
		typeof lat !== 'number' ||
		typeof lon !== 'number' ||
		isNaN(lat) ||
		isNaN(lon) ||
		lat < -90 ||
		lat > 90 ||
		lon < -180 ||
		lon > 180
	) {
		throw new Error(`Invalid coordinates: lat=${lat}, lon=${lon}`);
	}

	// Try the configured endpoint first, then fallback to public Pelias
	const endpoints = [config.endpoint, 'https://pelias.wayli.app'];

	for (const endpoint of endpoints) {
		try {
			// Pelias reverse geocoding endpoint (no size limit to get all features for addendum merging)
			const url = `${endpoint}/v1/reverse?point.lat=${encodeURIComponent(lat)}&point.lon=${encodeURIComponent(lon)}`;

			const response = await fetch(url, {
				headers: {
					'X-Client-App': 'WayliApp/1.0',
					Accept: 'application/json'
				}
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`Pelias HTTP error ${response.status} from ${endpoint}: ${errorText}`);

				// If this is the first endpoint and it failed, try the next one
				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error(`Pelias error: ${response.status} - ${errorText}`);
			}

			const data: PeliasResponse = await response.json();

			// Check if Pelias returned any results
			if (!data.features || data.features.length === 0) {
				console.error(`Pelias returned no results from ${endpoint}`);

				// If this is the first endpoint and it failed, try the next one
				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error('Pelias returned no results');
			}

			// Merge addendum from all features (first value wins)
			const mergedAddendum = mergeAddendumFromFeatures(data.features);
			return transformPeliasFeature(data.features[0], mergedAddendum);
		} catch (error) {
			// If this is the first endpoint and it failed, try the next one
			if (endpoint === config.endpoint && endpoints.length > 1) {
				continue;
			}

			// If we've tried all endpoints or this is the last one, throw the error
			throw error;
		}
	}

	throw new Error('All Pelias endpoints failed');
}

/**
 * Forward geocode an address query to get coordinates
 */
export async function forwardGeocode(query: string): Promise<PeliasSearchResponse | null> {
	// Rate limiting (only if enabled and rate limit > 0)
	if (RATE_LIMIT_ENABLED) {
		const now = Date.now();
		const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now);
		if (wait > 0 && isFinite(wait)) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastRequestTime = Date.now();
	}

	// Validate query
	if (!query || typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('Invalid address query');
	}

	// Try the configured endpoint first, then fallback to public Pelias
	const endpoints = [config.endpoint, 'https://pelias.wayli.app'];

	for (const endpoint of endpoints) {
		try {
			// Pelias search endpoint
			const url = `${endpoint}/v1/search?text=${encodeURIComponent(query.trim())}&size=1`;

			const response = await fetch(url, {
				headers: {
					'X-Client-App': 'WayliApp/1.0',
					Accept: 'application/json'
				}
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`Pelias HTTP error ${response.status} from ${endpoint}: ${errorText}`);

				// If this is the first endpoint and it failed, try the next one
				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error(`Pelias error: ${response.status} - ${errorText}`);
			}

			const data: PeliasResponse = await response.json();

			// Return null if no results
			if (!data.features || data.features.length === 0) {
				return null;
			}

			const feature = data.features[0];
			const [lon, lat] = feature.geometry.coordinates;
			const transformed = transformPeliasFeature(feature);

			return {
				display_name: transformed.display_name,
				lat,
				lon,
				address: transformed.address,
				name: transformed.name,
				confidence: transformed.confidence,
				layer: transformed.layer,
				category: transformed.category,
				addendum: transformed.addendum
			};
		} catch (error) {
			// If this is the first endpoint and it failed, try the next one
			if (endpoint === config.endpoint && endpoints.length > 1) {
				continue;
			}

			// If we've tried all endpoints or this is the last one, throw the error
			throw error;
		}
	}

	throw new Error('All Pelias endpoints failed');
}

/**
 * Search for multiple address results (autocomplete-style)
 */
export async function searchAddresses(
	query: string,
	limit: number = 10
): Promise<PeliasSearchResponse[]> {
	// Rate limiting (only if enabled and rate limit > 0)
	if (RATE_LIMIT_ENABLED) {
		const now = Date.now();
		const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now);
		if (wait > 0 && isFinite(wait)) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastRequestTime = Date.now();
	}

	// Validate query
	if (!query || typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('Invalid address query');
	}

	// Try the configured endpoint first, then fallback to public Pelias
	const endpoints = [config.endpoint, 'https://pelias.wayli.app'];

	for (const endpoint of endpoints) {
		try {
			// Pelias autocomplete endpoint for faster results
			const url = `${endpoint}/v1/autocomplete?text=${encodeURIComponent(query.trim())}&size=${limit}`;

			const response = await fetch(url, {
				headers: {
					'X-Client-App': 'WayliApp/1.0',
					Accept: 'application/json'
				}
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`Pelias HTTP error ${response.status} from ${endpoint}: ${errorText}`);

				// If this is the first endpoint and it failed, try the next one
				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error(`Pelias error: ${response.status} - ${errorText}`);
			}

			const data: PeliasResponse = await response.json();

			// Return empty array if no results
			if (!data.features || data.features.length === 0) {
				return [];
			}

			return data.features.map((feature) => {
				const [lon, lat] = feature.geometry.coordinates;
				const transformed = transformPeliasFeature(feature);

				return {
					display_name: transformed.display_name,
					lat,
					lon,
					address: transformed.address,
					name: transformed.name,
					confidence: transformed.confidence,
					layer: transformed.layer,
					category: transformed.category,
					addendum: transformed.addendum
				};
			});
		} catch (error) {
			// If this is the first endpoint and it failed, try the next one
			if (endpoint === config.endpoint && endpoints.length > 1) {
				continue;
			}

			// If we've tried all endpoints or this is the last one, throw the error
			throw error;
		}
	}

	throw new Error('All Pelias endpoints failed');
}
