// src/lib/services/api/auth-api.service.ts
// Auth API service layer - extracts business logic from auth API routes

import { errorHandler, ErrorCode } from '../error-handler.service';
import { UserProfileService } from '../user-profile.service';

import type { UserProfile, UserPreferences } from '$lib/types/user.types';
import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

export interface AuthApiServiceConfig {
	fluxbase: FluxbaseClient;
}

export interface GetUserProfileResult {
	profile: UserProfile;
	preferences: UserPreferences;
	two_factor_enabled: boolean;
	isAdmin: boolean;
	user: {
		id: string;
		email: string;
		email_confirmed_at: string | null;
		created_at: string | null;
	};
}

export interface UpdateProfileRequest {
	first_name?: string;
	last_name?: string;
	full_name?: string;
	avatar_url?: string;
	home_address?: string;
}

export interface UpdateProfileResult {
	message: string;
	profile: UserProfile;
}

export class AuthApiService {
	private fluxbase: FluxbaseClient;

	constructor(config: AuthApiServiceConfig) {
		this.fluxbase = config.fluxbase;
	}

	/**
	 * Get user profile and preferences
	 */
	async getUserProfile(userId: string): Promise<GetUserProfileResult> {
		try {
			// Get user profile from user_profiles
			const profile = await UserProfileService.getUserProfile(userId);
			if (!profile) {
				throw errorHandler.createError(ErrorCode.RECORD_NOT_FOUND, 'User profile not found', 404, {
					userId
				});
			}

			// Check if user is admin
			const isAdmin = await UserProfileService.isUserAdmin(userId);

			// Get user preferences from user_preferences table
			const { data: preferences, error: prefError } = await this.fluxbase
				.from('user_preferences')
				.select('*')
				.eq('id', userId)
				.single();

			if (prefError || !preferences) {
				throw errorHandler.createError(
					ErrorCode.RECORD_NOT_FOUND,
					'User preferences not found',
					404,
					{ userId, error: prefError }
				);
			}

			// Get user data to check 2FA status
			const {
				data: { user },
				error: userError
			} = await this.fluxbase.auth.admin.getUserById(userId);
			if (userError) {
				throw errorHandler.createError(
					ErrorCode.DATABASE_ERROR,
					'Failed to get user data',
					500,
					userError,
					{ userId }
				);
			}

			// Check if 2FA is enabled
			const two_factor_enabled = !!user?.user_metadata?.totp_enabled;

			return {
				profile,
				preferences,
				two_factor_enabled,
				isAdmin,
				user: {
					id: user!.id,
					email: user!.email || '',
					email_confirmed_at: user!.email_confirmed_at || null,
					created_at: user!.created_at
				}
			};
		} catch (error) {
			if (error instanceof Error && error.message.includes('not found')) {
				throw error;
			}
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to fetch user profile',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Update user profile
	 */
	async updateUserProfile(
		userId: string,
		request: UpdateProfileRequest
	): Promise<UpdateProfileResult> {
		try {
			// Validate request
			this.validateUpdateProfileRequest(request);

			// Update user profile
			const updated = await UserProfileService.updateUserProfile(userId, request);
			if (!updated) {
				throw errorHandler.createError(ErrorCode.DATABASE_ERROR, 'Failed to update profile', 500, {
					userId,
					request
				});
			}

			// Get updated profile
			const updatedProfile = await UserProfileService.getUserProfile(userId);
			if (!updatedProfile) {
				throw errorHandler.createError(
					ErrorCode.RECORD_NOT_FOUND,
					'Updated profile not found',
					404,
					{ userId }
				);
			}

			return {
				message: 'Profile updated successfully',
				profile: updatedProfile
			};
		} catch (error) {
			if (error instanceof Error && error.message.includes('not found')) {
				throw error;
			}
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to update profile',
				500,
				error,
				{ userId, request }
			);
		}
	}

	/**
	 * Validate update profile request
	 */
	validateUpdateProfileRequest(request: UpdateProfileRequest): void {
		const { first_name, last_name, full_name, avatar_url, home_address } = request;

		// Validate first name
		if (first_name !== undefined && (typeof first_name !== 'string' || first_name.length > 100)) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'First name must be a string with maximum 100 characters',
				400,
				{ field: 'first_name', value: first_name }
			);
		}

		// Validate last name
		if (last_name !== undefined && (typeof last_name !== 'string' || last_name.length > 100)) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Last name must be a string with maximum 100 characters',
				400,
				{ field: 'last_name', value: last_name }
			);
		}

		// Validate full name
		if (full_name !== undefined && (typeof full_name !== 'string' || full_name.length > 200)) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Full name must be a string with maximum 200 characters',
				400,
				{ field: 'full_name', value: full_name }
			);
		}

		// Validate avatar URL
		if (
			avatar_url !== undefined &&
			(typeof avatar_url !== 'string' || !this.isValidUrl(avatar_url))
		) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Avatar URL must be a valid URL',
				400,
				{ field: 'avatar_url', value: avatar_url }
			);
		}

		// Validate home address
		if (
			home_address !== undefined &&
			(typeof home_address !== 'string' || home_address.length > 500)
		) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Home address must be a string with maximum 500 characters',
				400,
				{ field: 'home_address', value: home_address }
			);
		}
	}

	/**
	 * Check if a string is a valid URL
	 */
	private isValidUrl(url: string): boolean {
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	}
}
