// src/lib/services/api/geocoding-api.service.ts
// Geocoding API Service for handling geocoding-related API operations

import { errorHandler, ErrorCode } from '../error-handler.service';
import { forwardGeocode } from '../external/pelias.service';

import type { FluxbaseClient } from '@fluxbase/sdk';

export interface GeocodingApiServiceConfig {
	fluxbase: FluxbaseClient;
}

export interface GeocodeSearchRequest {
	query: string;
	limit?: number;
}

export interface GeocodeSearchResult {
	results: Array<{
		display_name: string;
		coordinates: {
			lat: number;
			lng: number;
		};
		lat: number;
		lon: number;
		address: Record<string, unknown>;
	}>;
}

export class GeocodingApiService {
	private fluxbase: FluxbaseClient;

	constructor(config: GeocodingApiServiceConfig) {
		this.fluxbase = config.fluxbase;
	}

	/**
	 * Search for addresses using forward geocoding
	 */
	async searchAddresses(request: GeocodeSearchRequest): Promise<GeocodeSearchResult> {
		try {
			const { query } = request;

			// Validate query
			if (!query || query.trim().length === 0) {
				throw errorHandler.createError(
					ErrorCode.MISSING_REQUIRED_FIELD,
					'Query parameter is required',
					400,
					{ field: 'query' }
				);
			}

			if (query.trim().length < 3) {
				throw errorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					'Query must be at least 3 characters long',
					400,
					{ field: 'query', minLength: 3 }
				);
			}

			// Search for addresses using forward geocoding
			const results = [];
			const searchResult = await forwardGeocode(query.trim());

			if (searchResult) {
				results.push({
					display_name: searchResult.display_name,
					coordinates: {
						lat: searchResult.lat,
						lng: searchResult.lon
					},
					lat: searchResult.lat,
					lon: searchResult.lon,
					address: searchResult.address || {}
				});
			}

			return { results };
		} catch (error) {
			// Log the error for debugging
			console.error('❌ [GeocodingAPI] Search error:', error);

			// Convert to structured error
			throw errorHandler.createError(
				ErrorCode.EXTERNAL_SERVICE_ERROR,
				'Failed to search addresses',
				500,
				error,
				{ query: request.query }
			);
		}
	}

	/**
	 * Validate search request
	 */
	validateSearchRequest(request: GeocodeSearchRequest): void {
		const { query, limit } = request;

		if (!query) {
			throw errorHandler.createError(ErrorCode.MISSING_REQUIRED_FIELD, 'Query is required', 400, {
				field: 'query'
			});
		}

		if (query.trim().length < 3) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Query must be at least 3 characters long',
				400,
				{ field: 'query', minLength: 3 }
			);
		}

		if (limit !== undefined && (limit < 1 || limit > 10)) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Limit must be between 1 and 10',
				400,
				{ field: 'limit', min: 1, max: 10 }
			);
		}
	}
}
