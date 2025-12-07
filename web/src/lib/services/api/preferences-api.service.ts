// src/lib/services/api/preferences-api.service.ts
// Preferences API Service for handling user preferences-related API operations

import { errorHandler, ErrorCode } from '../error-handler.service';

import type { FluxbaseClient } from '@fluxbase/sdk';

export interface PreferencesApiServiceConfig {
	fluxbase: FluxbaseClient;
}

export interface UserPreferences {
	id: string;
	theme: string;
	language: string;
	notifications_enabled: boolean;
	timezone: string;
	pexels_api_key?: string;
	trip_exclusions?: unknown[];
	created_at: string;
	updated_at: string;
}

export interface UpdatePreferencesRequest {
	language?: string;
	notifications_enabled?: boolean;
	timezone?: string;
	pexels_api_key?: string;
}

export interface GetPreferencesResult {
	preferences: UserPreferences;
	server_pexels_api_key_available: boolean;
}

export interface UpdatePreferencesResult {
	message: string;
	preferences: UserPreferences;
}

export class PreferencesApiService {
	private fluxbase: FluxbaseClient;

	constructor(config: PreferencesApiServiceConfig) {
		this.fluxbase = config.fluxbase;
	}

	/**
	 * Get user preferences
	 */
	async getUserPreferences(userId: string): Promise<GetPreferencesResult> {
		try {
			// Get user preferences from user_preferences table
			const { data: preferences, error: prefError } = await this.fluxbase
				.from('user_preferences')
				.select('*')
				.eq('id', userId)
				.single();

			if (prefError && prefError.code !== 'PGRST116') {
				// PGRST116 is "not found"
				console.error('❌ [PreferencesAPI] Error fetching preferences:', prefError);
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to fetch preferences',
					500,
					prefError,
					{ userId }
				);
			}

			// If preferences don't exist, create them with defaults
			if (!preferences) {
				const { data: newPreferences, error: createError } = await this.fluxbase
					.from('user_preferences')
					.insert({
						id: userId,
						theme: 'light',
						language: 'en',
						notifications_enabled: true,
						timezone: 'UTC+00:00 (London, Dublin)'
					})
					.select()
					.single();

				if (createError) {
					console.error('❌ [PreferencesAPI] Error creating preferences:', createError);
					throw errorHandler.createError(
						ErrorCode.DATABASE_ERROR,
						'Failed to create preferences',
						500,
						createError,
						{ userId }
					);
				}

				return {
					preferences: newPreferences
				};
			}

			return {
				preferences
			};
		} catch (error) {
			console.error('❌ [PreferencesAPI] Get preferences error:', error);
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to fetch preferences',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Update user preferences
	 */
	async updateUserPreferences(
		userId: string,
		request: UpdatePreferencesRequest
	): Promise<UpdatePreferencesResult> {
		try {
			const { language, notifications_enabled, timezone, pexels_api_key } = request;

			// Check if preferences exist
			const { data: existingPreferences } = await this.fluxbase
				.from('user_preferences')
				.select('id')
				.eq('id', userId)
				.single();

			if (existingPreferences) {
				// Update existing preferences
				const { data: updatedPreferences, error: updateError } = await this.fluxbase
					.from('user_preferences')
					.update({
						language,
						notifications_enabled,
						timezone,
						pexels_api_key,
						updated_at: new Date().toISOString()
					})
					.eq('id', userId)
					.select()
					.single();

				if (updateError) {
					console.error('❌ [PreferencesAPI] Error updating preferences:', updateError);
					throw errorHandler.createError(
						ErrorCode.DATABASE_ERROR,
						'Failed to update preferences',
						500,
						updateError,
						{ userId }
					);
				}

				return {
					message: 'Preferences updated successfully',
					preferences: updatedPreferences
				};
			} else {
				// Create new preferences
				const { data: newPreferences, error: createError } = await this.fluxbase
					.from('user_preferences')
					.insert({
						id: userId,
						language,
						notifications_enabled,
						timezone,
						pexels_api_key,
						theme: 'light'
					})
					.select()
					.single();

				if (createError) {
					console.error('❌ [PreferencesAPI] Error creating preferences:', createError);
					throw errorHandler.createError(
						ErrorCode.DATABASE_ERROR,
						'Failed to create preferences',
						500,
						createError,
						{ userId }
					);
				}

				return {
					message: 'Preferences created successfully',
					preferences: newPreferences
				};
			}
		} catch (error) {
			console.error('❌ [PreferencesAPI] Update preferences error:', error);
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to update preferences',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Validate update request
	 */
	validateUpdateRequest(request: UpdatePreferencesRequest): void {
		const { language, notifications_enabled, timezone } = request;

		if (language && typeof language !== 'string') {
			throw errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Language must be a string', 400, {
				field: 'language'
			});
		}

		if (notifications_enabled !== undefined && typeof notifications_enabled !== 'boolean') {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Notifications enabled must be a boolean',
				400,
				{ field: 'notifications_enabled' }
			);
		}

		if (timezone && typeof timezone !== 'string') {
			throw errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Timezone must be a string', 400, {
				field: 'timezone'
			});
		}
	}
}
