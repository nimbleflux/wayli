/**
 * Profile and preferences management adapter.
 * Handles user profile data, preferences, and password management.
 * @module adapters/profile-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * Adapter for managing user profiles and preferences.
 * Combines data from Fluxbase auth and the user_profiles table.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const profileAdapter = new ProfileAdapter({ session });
 * const profile = await profileAdapter.getProfile();
 * ```
 */
export class ProfileAdapter extends BaseAdapter {
	/**
	 * Creates a new ProfileAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Retrieves the current user's profile, combining data from
	 * Fluxbase auth metadata and the user_profiles database table.
	 *
	 * @returns Promise resolving to the user profile with email, names, and custom fields
	 * @throws Error if user is not authenticated or profile fetch fails
	 *
	 * @example
	 * ```typescript
	 * const profile = await profileAdapter.getProfile();
	 * console.log(`Hello, ${profile.first_name}!`);
	 * ```
	 */
	async getProfile() {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const userMetadata = userData.user.user_metadata || {};

		const { data: profile, error } = await fluxbase
			.from('user_profiles')
			.select('*')
			.eq('id', userData.user.id)
			.single();

		if (error) {
			throw new Error(error.message || 'Failed to fetch profile');
		}

		return {
			...profile,
			email: userData.user.email,
			first_name: profile?.first_name || userMetadata.first_name || '',
			last_name: profile?.last_name || userMetadata.last_name || '',
			full_name: profile?.full_name || userMetadata.full_name || ''
		};
	}

	/**
	 * Updates the user's profile information.
	 * Can update both auth-level fields (like email) and profile table fields.
	 *
	 * @param profile - Object containing profile fields to update
	 * @param profile.email - Optional new email address (triggers Fluxbase auth update)
	 * @returns Promise resolving to success message
	 * @throws Error if user is not authenticated or update fails
	 *
	 * @example
	 * ```typescript
	 * await profileAdapter.updateProfile({
	 *   first_name: 'John',
	 *   last_name: 'Doe',
	 *   email: 'john@example.com'
	 * });
	 * ```
	 */
	async updateProfile(profile: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { email, ...profileFields } = profile;

		if (email && typeof email === 'string') {
			const { error: emailError } = await fluxbase.auth.updateUser({ email });
			if (emailError) {
				throw new Error(`Failed to update email: ${emailError.message}`);
			}
		}

		if (Object.keys(profileFields).length > 0) {
			const { error: profileError } = await fluxbase
				.from('user_profiles')
				.eq('id', userData.user.id)
				.update(profileFields);

			if (profileError) {
				throw new Error(`Failed to update profile: ${profileError.message}`);
			}
		}

		return { message: 'Profile updated successfully' };
	}

	/**
	 * Retrieves the user's application preferences.
	 *
	 * @returns Promise resolving to the user's preferences object
	 * @throws Error if user is not authenticated or fetch fails
	 *
	 * @example
	 * ```typescript
	 * const prefs = await profileAdapter.getPreferences();
	 * console.log(`Distance unit: ${prefs.distance_unit}`);
	 * ```
	 */
	async getPreferences() {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: preferences, error } = await fluxbase
			.from('user_preferences')
			.select('*')
			.eq('id', userData.user.id)
			.single();

		if (error) {
			throw new Error(error.message || 'Failed to fetch preferences');
		}

		return preferences;
	}

	/**
	 * Updates the user's application preferences.
	 *
	 * @param preferences - Object containing preference fields to update
	 * @returns Promise resolving to success message
	 * @throws Error if user is not authenticated or update fails
	 *
	 * @example
	 * ```typescript
	 * await profileAdapter.updatePreferences({
	 *   distance_unit: 'km',
	 *   theme: 'dark',
	 *   notifications_enabled: true
	 * });
	 * ```
	 */
	async updatePreferences(preferences: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { error } = await fluxbase
			.from('user_preferences')
			.eq('id', userData.user.id)
			.update({
				...preferences,
				updated_at: new Date().toISOString()
			});

		if (error) {
			throw new Error(error.message || 'Failed to update preferences');
		}

		return { message: 'Preferences updated successfully' };
	}

	/**
	 * Updates the user's password.
	 *
	 * @param password - The new password to set
	 * @returns Promise resolving to success message
	 * @throws Error if password update fails
	 *
	 * @example
	 * ```typescript
	 * await profileAdapter.updatePassword('newSecurePassword123');
	 * ```
	 */
	async updatePassword(password: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { error } = await fluxbase.auth.updateUser({ password } as { password: string });

		if (error) {
			throw new Error(error.message || 'Failed to update password');
		}

		return { message: 'Password updated successfully' };
	}
}
