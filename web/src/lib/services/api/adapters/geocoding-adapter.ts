/**
 * Geocoding operations adapter.
 * Provides location search functionality using the Pelias geocoding API.
 * @module adapters/geocoding-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * Result from a geocoding search query.
 */
export interface GeocodingResult {
	/** Human-readable full address label */
	display_name: string;
	/** Latitude coordinate */
	lat: number;
	/** Longitude coordinate */
	lon: number;
	/** Place name */
	name?: string;
	/** Layer type (venue, address, street, locality, etc.) */
	layer?: string;
	/** Category (restaurant, hotel, park, etc.) */
	category?: string;
	/** Confidence score (0-1) */
	confidence?: number;
	/** Additional data from the geocoder */
	addendum?: unknown;
	/** Structured address components */
	address: {
		/** City/locality name */
		city?: string;
		/** State/region name */
		state?: string;
		/** Country name */
		country?: string;
		/** ISO country code (2-letter) */
		country_code?: string;
		/** Postal/ZIP code */
		postcode?: string;
		/** Street name */
		road?: string;
		/** House/building number */
		house_number?: string;
	};
}

/**
 * Adapter for geocoding operations.
 * Uses Pelias geocoding API for location search and autocomplete.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const geocodingAdapter = new GeocodingAdapter({ session });
 * const results = await geocodingAdapter.searchGeocode('Amsterdam');
 * console.log(results[0].display_name);
 * ```
 */
export class GeocodingAdapter extends BaseAdapter {
	/**
	 * Creates a new GeocodingAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Searches for locations matching the given query.
	 * Uses Pelias autocomplete API for fast, as-you-type results.
	 *
	 * @param query - Search text (address, place name, etc.)
	 * @returns Promise resolving to array of geocoding results (max 10)
	 * @throws Error if the geocoding request fails
	 *
	 * @example
	 * ```typescript
	 * const results = await geocodingAdapter.searchGeocode('Central Park, NYC');
	 * results.forEach(r => {
	 *   console.log(`${r.display_name} (${r.lat}, ${r.lon})`);
	 * });
	 * ```
	 */
	async searchGeocode(query: string): Promise<GeocodingResult[]> {
		const { getPeliasEndpoint } = await import('../../external/pelias.service');
		const endpoint = await getPeliasEndpoint();
		const url = `${endpoint}/v1/autocomplete?text=${encodeURIComponent(query)}&size=10`;

		const response = await fetch(url, {
			headers: {
				'X-Client-App': 'WayliApp/1.0',
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error('Geocoding search failed');
		}

		const data = await response.json();

		if (data.features && Array.isArray(data.features)) {
			return data.features.map(
				(feature: {
					geometry?: { coordinates?: [number, number] };
					properties?: {
						label?: string;
						name?: string;
						layer?: string;
						category?: string;
						confidence?: number;
						addendum?: unknown;
						locality?: string;
						region?: string;
						country?: string;
						country_a?: string;
						postalcode?: string;
						street?: string;
						housenumber?: string;
					};
				}) => ({
					display_name: feature.properties?.label || '',
					lat: feature.geometry?.coordinates?.[1],
					lon: feature.geometry?.coordinates?.[0],
					name: feature.properties?.name,
					layer: feature.properties?.layer,
					category: feature.properties?.category,
					confidence: feature.properties?.confidence,
					addendum: feature.properties?.addendum,
					address: {
						city: feature.properties?.locality,
						state: feature.properties?.region,
						country: feature.properties?.country,
						country_code: feature.properties?.country_a,
						postcode: feature.properties?.postalcode,
						road: feature.properties?.street,
						house_number: feature.properties?.housenumber
					}
				})
			);
		}

		return [];
	}
}
