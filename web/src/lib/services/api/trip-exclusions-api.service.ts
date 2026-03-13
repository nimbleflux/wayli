// src/lib/services/api/trip-exclusions-api.service.ts
// Trip Exclusions API Service for handling trip exclusion-related API operations

import { errorHandler, ErrorCode } from '../error-handler.service';

import type { GeocodedLocation } from '$lib/types/geocoding.types';
import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

export interface TripExclusionsApiServiceConfig {
	fluxbase: FluxbaseClient;
}

export interface TripExclusion {
	id: string;
	name: string;
	location: GeocodedLocation;
	created_at: string;
	updated_at: string;
}

export interface CreateTripExclusionRequest {
	name: string;
	location: GeocodedLocation;
}

export interface UpdateTripExclusionRequest {
	id: string;
	name: string;
	location: GeocodedLocation;
}

export interface DeleteTripExclusionRequest {
	id: string;
}

export interface GetTripExclusionsResult {
	exclusions: TripExclusion[];
}

export interface CreateTripExclusionResult {
	exclusion: TripExclusion;
}

export interface UpdateTripExclusionResult {
	exclusion: TripExclusion;
}

export interface DeleteTripExclusionResult {
	message: string;
}

export class TripExclusionsApiService {
	private fluxbase: FluxbaseClient;

	constructor(config: TripExclusionsApiServiceConfig) {
		this.fluxbase = config.fluxbase;
	}

	/**
	 * Get trip exclusions for a user
	 */
	async getTripExclusions(userId: string): Promise<GetTripExclusionsResult> {
		try {
			// Get trip exclusions from user preferences
			const { data: userPreferences, error: userPreferencesError } = await this.fluxbase
				.from('user_preferences')
				.select('trip_exclusions')
				.eq('id', userId)
				.maybeSingle();

			if (userPreferencesError) {
				console.error(
					'❌ [TripExclusionsAPI] Error fetching user preferences:',
					userPreferencesError
				);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to fetch user preferences',
					500,
					userPreferencesError,
					{ userId }
				);
			}

			const exclusions: TripExclusion[] = userPreferences?.trip_exclusions || [];

			return { exclusions };
		} catch (error) {
			if (errorHandler.isStructuredError(error)) {
				throw error;
			}

			console.error('❌ [TripExclusionsAPI] Get exclusions error:', error);
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to get trip exclusions',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Create a new trip exclusion
	 */
	async createTripExclusion(
		userId: string,
		request: CreateTripExclusionRequest
	): Promise<CreateTripExclusionResult> {
		try {
			const { name, location } = request;

			// Validate required fields
			this.validateCreateRequest(request);

			// Get current trip exclusions from user preferences
			const { data: userPreferences, error: preferencesError } = await this.fluxbase
				.from('user_preferences')
				.select('trip_exclusions')
				.eq('id', userId)
				.maybeSingle();

			if (preferencesError) {
				console.error('❌ [TripExclusionsAPI] Error fetching user preferences:', preferencesError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to fetch user preferences',
					500,
					preferencesError,
					{ userId }
				);
			}

			const currentExclusions: TripExclusion[] = userPreferences?.trip_exclusions || [];

			// Check if user already has 10 exclusions (maximum limit)
			if (currentExclusions.length >= 10) {
				throw errorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					'Maximum of 10 trip exclusions allowed',
					400,
					{ maxExclusions: 10, currentCount: currentExclusions.length }
				);
			}

			// Check if name already exists
			const existingExclusion = currentExclusions.find((ex) => ex.name === name);
			if (existingExclusion) {
				throw errorHandler.createError(
					ErrorCode.CONFLICT_ERROR,
					'An exclusion with this name already exists',
					409,
					{ name }
				);
			}

			// Create new exclusion
			const newExclusion: TripExclusion = {
				id: crypto.randomUUID(),
				name,
				location,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			};

			// Add to exclusions array
			const updatedExclusions = [...currentExclusions, newExclusion];

			// Update user preferences with new exclusions
			const { error: updateError } = await this.fluxbase
				.from('user_preferences')
				.update({
					trip_exclusions: updatedExclusions,
					updated_at: new Date().toISOString()
				})
				.eq('id', userId);

			if (updateError) {
				console.error('❌ [TripExclusionsAPI] Error updating user preferences:', updateError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to save trip exclusion',
					500,
					updateError,
					{ userId }
				);
			}

			return { exclusion: newExclusion };
		} catch (error) {
			if (errorHandler.isStructuredError(error)) {
				throw error;
			}

			console.error('❌ [TripExclusionsAPI] Create exclusion error:', error);
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to create trip exclusion',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Update an existing trip exclusion
	 */
	async updateTripExclusion(
		userId: string,
		request: UpdateTripExclusionRequest
	): Promise<UpdateTripExclusionResult> {
		try {
			const { id, name, location } = request;

			// Validate required fields
			this.validateUpdateRequest(request);

			// Get current trip exclusions from user preferences
			const { data: userPreferences, error: preferencesError } = await this.fluxbase
				.from('user_preferences')
				.select('trip_exclusions')
				.eq('id', userId)
				.maybeSingle();

			if (preferencesError) {
				console.error('❌ [TripExclusionsAPI] Error fetching user preferences:', preferencesError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to fetch user preferences',
					500,
					preferencesError,
					{ userId }
				);
			}

			const currentExclusions: TripExclusion[] = userPreferences?.trip_exclusions || [];

			// Find the exclusion to update
			const exclusionIndex = currentExclusions.findIndex((ex) => ex.id === id);
			if (exclusionIndex === -1) {
				throw errorHandler.createError(
					ErrorCode.RECORD_NOT_FOUND,
					'Trip exclusion not found',
					404,
					{ exclusionId: id }
				);
			}

			// Check if name already exists (excluding current exclusion)
			const nameConflict = currentExclusions.find((ex) => ex.name === name && ex.id !== id);
			if (nameConflict) {
				throw errorHandler.createError(
					ErrorCode.CONFLICT_ERROR,
					'An exclusion with this name already exists',
					409,
					{ name }
				);
			}

			// Update the exclusion
			const updatedExclusion: TripExclusion = {
				...currentExclusions[exclusionIndex],
				name,
				location,
				updated_at: new Date().toISOString()
			};

			currentExclusions[exclusionIndex] = updatedExclusion;

			// Update user preferences with updated exclusions
			const { error: updateError } = await this.fluxbase
				.from('user_preferences')
				.update({
					trip_exclusions: currentExclusions,
					updated_at: new Date().toISOString()
				})
				.eq('id', userId);

			if (updateError) {
				console.error('❌ [TripExclusionsAPI] Error updating user preferences:', updateError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to update trip exclusion',
					500,
					updateError,
					{ userId }
				);
			}

			return { exclusion: updatedExclusion };
		} catch (error) {
			if (errorHandler.isStructuredError(error)) {
				throw error;
			}

			console.error('❌ [TripExclusionsAPI] Update exclusion error:', error);
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to update trip exclusion',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Delete a trip exclusion
	 */
	async deleteTripExclusion(
		userId: string,
		request: DeleteTripExclusionRequest
	): Promise<DeleteTripExclusionResult> {
		try {
			const { id } = request;

			// Validate required fields
			this.validateDeleteRequest(request);

			// Get current trip exclusions from user preferences
			const { data: userPreferences, error: preferencesError } = await this.fluxbase
				.from('user_preferences')
				.select('trip_exclusions')
				.eq('id', userId)
				.maybeSingle();

			if (preferencesError) {
				console.error('❌ [TripExclusionsAPI] Error fetching user preferences:', preferencesError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to fetch user preferences',
					500,
					preferencesError,
					{ userId }
				);
			}

			const currentExclusions: TripExclusion[] = userPreferences?.trip_exclusions || [];

			// Find and remove the exclusion
			const updatedExclusions = currentExclusions.filter((ex) => ex.id !== id);

			if (updatedExclusions.length === currentExclusions.length) {
				throw errorHandler.createError(
					ErrorCode.RECORD_NOT_FOUND,
					'Trip exclusion not found',
					404,
					{ exclusionId: id }
				);
			}

			// Update user preferences with updated exclusions
			const { error: updateError } = await this.fluxbase
				.from('user_preferences')
				.update({
					trip_exclusions: updatedExclusions,
					updated_at: new Date().toISOString()
				})
				.eq('id', userId);

			if (updateError) {
				console.error('❌ [TripExclusionsAPI] Error updating user preferences:', updateError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to delete trip exclusion',
					500,
					updateError,
					{ userId }
				);
			}

			return { message: 'Trip exclusion deleted successfully' };
		} catch (error) {
			if (errorHandler.isStructuredError(error)) {
				throw error;
			}

			console.error('❌ [TripExclusionsAPI] Delete exclusion error:', error);
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to delete trip exclusion',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Validate create request
	 */
	private validateCreateRequest(request: CreateTripExclusionRequest): void {
		const { name, location } = request;

		if (!name) {
			throw errorHandler.createError(ErrorCode.MISSING_REQUIRED_FIELD, 'Name is required', 400, {
				field: 'name'
			});
		}

		if (!location) {
			throw errorHandler.createError(
				ErrorCode.MISSING_REQUIRED_FIELD,
				'Location is required',
				400,
				{ field: 'location' }
			);
		}

		if (!location.display_name || !location.coordinates) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Location must have display_name and coordinates',
				400,
				{ field: 'location' }
			);
		}
	}

	/**
	 * Validate update request
	 */
	private validateUpdateRequest(request: UpdateTripExclusionRequest): void {
		const { id, name, location } = request;

		if (!id) {
			throw errorHandler.createError(ErrorCode.MISSING_REQUIRED_FIELD, 'ID is required', 400, {
				field: 'id'
			});
		}

		if (!name) {
			throw errorHandler.createError(ErrorCode.MISSING_REQUIRED_FIELD, 'Name is required', 400, {
				field: 'name'
			});
		}

		if (!location) {
			throw errorHandler.createError(
				ErrorCode.MISSING_REQUIRED_FIELD,
				'Location is required',
				400,
				{ field: 'location' }
			);
		}

		if (!location.display_name || !location.coordinates) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Location must have display_name and coordinates',
				400,
				{ field: 'location' }
			);
		}
	}

	/**
	 * Validate delete request
	 */
	private validateDeleteRequest(request: DeleteTripExclusionRequest): void {
		const { id } = request;

		if (!id) {
			throw errorHandler.createError(
				ErrorCode.MISSING_REQUIRED_FIELD,
				'Exclusion ID is required',
				400,
				{ field: 'id' }
			);
		}
	}
}
