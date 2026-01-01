// Pelias geocoding service for Deno runtime

import type { PeliasResponse, PeliasFeature, PeliasAddress } from '../../types/geocoding.types';
import { convertCountryCode3to2 } from '../../types/geocoding.types';

/**
 * Nearby POI extracted from Pelias response
 */
export interface NearbyPOI {
	name: string;
	layer: string;
	distance_meters?: number;
	category?: string[];
	osm_id?: string;
	confidence?: number;
	addendum?: {
		osm?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

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
	address: PeliasAddress;
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
	// Nearby POIs (venues only, max 5, sorted by distance)
	nearby_pois?: NearbyPOI[];
	[key: string]: unknown;
}

/**
 * Pelias search response (for forward geocoding)
 */
export interface PeliasSearchResponse {
	display_name: string;
	lat: number;
	lon: number;
	address: PeliasAddress;
	name?: string;
	confidence?: number;
	layer?: string;
	category?: string[];
	// OSM addendum data (contains venue type, amenity info, etc.)
	addendum?: Record<string, unknown>;
	[key: string]: unknown;
}

// Get environment variable in Deno
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

function getEnv(key: string): string | undefined {
	if (typeof Deno !== 'undefined') {
		return Deno.env.get(key);
	}
	if (typeof process !== 'undefined' && process.env) {
		return process.env[key];
	}
	return undefined;
}

// Get configuration - prioritize environment variables, fallback to default
const config = {
	endpoint: getEnv('PELIAS_ENDPOINT') || 'https://pelias.wayli.app',
	rateLimit: parseInt(getEnv('PELIAS_RATE_LIMIT') || '1000', 10)
};

// Rate limiting configuration
const MIN_INTERVAL = config.rateLimit > 0 ? 1000 / config.rateLimit : 0;
const RATE_LIMIT_ENABLED = config.rateLimit > 0;

let lastRequestTime = 0;

/**
 * Maximum radius in meters to consider a POI as "nearby"
 */
const NEARBY_POI_RADIUS_METERS = 100;

/**
 * Maximum number of nearby POIs to store
 */
const MAX_NEARBY_POIS = 5;

/**
 * Layers that represent venues/POIs (not addresses or administrative boundaries)
 */
const VENUE_LAYERS = ['venue', 'address'];

/**
 * Extracts nearby POIs from Pelias features.
 */
function extractNearbyPOIs(features: PeliasFeature[]): NearbyPOI[] {
	const pois: NearbyPOI[] = [];

	for (const feature of features) {
		const props = feature.properties;

		if (!props.name || !VENUE_LAYERS.includes(props.layer || '')) {
			continue;
		}

		const distanceMeters = props.distance ? props.distance * 1000 : undefined;
		if (distanceMeters !== undefined && distanceMeters > NEARBY_POI_RADIUS_METERS) {
			continue;
		}

		let osmId: string | undefined;
		if (props.gid) {
			const match = props.gid.match(/(node|way|relation)\/(\d+)/);
			if (match) {
				osmId = `${match[1]}/${match[2]}`;
			}
		}

		pois.push({
			name: props.name,
			layer: props.layer || 'unknown',
			distance_meters: distanceMeters,
			category: props.category,
			osm_id: osmId,
			confidence: props.confidence,
			addendum: props.addendum
		});

		if (pois.length >= MAX_NEARBY_POIS) {
			break;
		}
	}

	return pois.sort((a, b) => {
		if (a.distance_meters === undefined && b.distance_meters === undefined) return 0;
		if (a.distance_meters === undefined) return 1;
		if (b.distance_meters === undefined) return -1;
		return a.distance_meters - b.distance_meters;
	});
}

/**
 * Merges addendum data from all Pelias features into a single object.
 */
function mergeAddendumFromFeatures(features: PeliasFeature[]): Record<string, unknown> | undefined {
	const merged: Record<string, unknown> = {};

	for (const feature of features) {
		const addendum = feature.properties.addendum;
		if (addendum && typeof addendum === 'object') {
			for (const [key, value] of Object.entries(addendum)) {
				if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
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
	mergedAddendum?: Record<string, unknown>,
	nearbyPois?: NearbyPOI[]
): PeliasReverseResponse {
	const props = feature.properties;

	const address: PeliasAddress = {};
	if (props.locality) address.city = props.locality;
	if (props.region) address.state = props.region;
	if (props.country) address.country = props.country;
	if (props.neighbourhood) address.neighbourhood = props.neighbourhood;
	if (props.borough) address.borough = props.borough;
	if (props.street) address.road = props.street;
	if (props.housenumber) address.house_number = props.housenumber;
	if (props.postalcode) address.postcode = props.postalcode;
	if (props.county) address.county = props.county;

	// Pelias returns country_code as 2-letter ISO (e.g., 'NL') and country_a as 3-letter (e.g., 'NLD')
	if (props.country_code) {
		address.country_code = props.country_code.toUpperCase();
	} else if (props.country_a) {
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
		locality: props.locality,
		region: props.region,
		region_a: props.region_a,
		country: props.country,
		country_a: props.country_a,
		neighbourhood: props.neighbourhood,
		borough: props.borough,
		addendum: mergedAddendum ?? props.addendum,
		nearby_pois: nearbyPois
	};
}

/**
 * Reverse geocode coordinates to get location information
 */
export async function reverseGeocode(lat: number, lon: number): Promise<PeliasReverseResponse> {
	if (RATE_LIMIT_ENABLED) {
		const now = Date.now();
		const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now);
		if (wait > 0 && isFinite(wait)) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastRequestTime = Date.now();
	}

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

	const endpoints = [config.endpoint, 'https://pelias.wayli.app'];

	for (const endpoint of endpoints) {
		try {
			// instead of just address-level data which lacks country information
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

				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error(`Pelias error: ${response.status} - ${errorText}`);
			}

			const data: PeliasResponse = await response.json();

			if (!data.features || data.features.length === 0) {
				console.error(`Pelias returned no results from ${endpoint}`);

				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error('Pelias returned no results');
			}

			const mergedAddendum = mergeAddendumFromFeatures(data.features);
			const nearbyPois = extractNearbyPOIs(data.features);
			return transformPeliasFeature(data.features[0], mergedAddendum, nearbyPois);
		} catch (error) {
			if (endpoint === config.endpoint && endpoints.length > 1) {
				continue;
			}
			throw error;
		}
	}

	throw new Error('All Pelias endpoints failed');
}

/**
 * Forward geocode an address query to get coordinates
 */
export async function forwardGeocode(query: string): Promise<PeliasSearchResponse | null> {
	if (RATE_LIMIT_ENABLED) {
		const now = Date.now();
		const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now);
		if (wait > 0 && isFinite(wait)) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastRequestTime = Date.now();
	}

	if (!query || typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('Invalid address query');
	}

	const endpoints = [config.endpoint, 'https://pelias.wayli.app'];

	for (const endpoint of endpoints) {
		try {
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

				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error(`Pelias error: ${response.status} - ${errorText}`);
			}

			const data: PeliasResponse = await response.json();

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
			if (endpoint === config.endpoint && endpoints.length > 1) {
				continue;
			}
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
	if (RATE_LIMIT_ENABLED) {
		const now = Date.now();
		const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now);
		if (wait > 0 && isFinite(wait)) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastRequestTime = Date.now();
	}

	if (!query || typeof query !== 'string' || query.trim().length === 0) {
		throw new Error('Invalid address query');
	}

	const endpoints = [config.endpoint, 'https://pelias.wayli.app'];

	for (const endpoint of endpoints) {
		try {
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

				if (endpoint === config.endpoint && endpoints.length > 1) {
					continue;
				}

				throw new Error(`Pelias error: ${response.status} - ${errorText}`);
			}

			const data: PeliasResponse = await response.json();

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
			if (endpoint === config.endpoint && endpoints.length > 1) {
				continue;
			}
			throw error;
		}
	}

	throw new Error('All Pelias endpoints failed');
}
