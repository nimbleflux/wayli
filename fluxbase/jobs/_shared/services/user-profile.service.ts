// User profile service for Deno runtime

import type { UserProfile } from '../types/user.types';

// Flexible type for Fluxbase client that works with both SDK and job runtime
type FluxbaseClientLike = {
	from(table: string): any;
	auth: any;
	rpc(fn: string, params?: Record<string, unknown>): Promise<any>;
};

// Supports both SvelteKit and Node/worker environments.
// For job workers, call setFluxbaseClient() with the client passed to the handler.

export class UserProfileService {
	private static _fluxbase: FluxbaseClientLike | null = null;

	// Lazy-load client - throws if not configured
	private static get fluxbase(): FluxbaseClientLike {
		if (!this._fluxbase) {
			throw new Error(
				'UserProfileService not configured. Call setFluxbaseClient() first.'
			);
		}
		return this._fluxbase;
	}

	// Allow override for test/worker/Node.js - use this in job handlers
	static setFluxbaseClient(client: FluxbaseClientLike) {
		this._fluxbase = client;
	}

	/**
	 * Get basic user profile from user_profiles table only (works in job context)
	 * Use this in jobs where auth.admin is not available
	 */
	static async getUserProfileBasic(
		userId: string
	): Promise<{ home_address?: any; [key: string]: any } | null> {
		try {
			const { data: profile, error } = await this.fluxbase
				.from('user_profiles')
				.select('*')
				.eq('id', userId)
				.single();

			if (error || !profile) {
				console.error('Error fetching user profile:', error);
				return null;
			}

			return profile;
		} catch (error) {
			console.error('Error in getUserProfileBasic:', error);
			return null;
		}
	}

	/**
	 * Get user profile by ID from user_profiles table, joining auth.users for email fields
	 */
	static async getUserProfile(userId: string): Promise<UserProfile | null> {
		try {
			// Fetch from user_profiles
			const { data: profileData, error: profileError } = await this.fluxbase
				.from('user_profiles')
				.select('*')
				.eq('id', userId)
				.single();

			let profile = profileData;

			// If profile doesn't exist, create one from user_metadata
			if (profileError && profileError.code === 'PGRST116') {
				console.log('User profile not found, creating from user_metadata...');
				const created = await this.createUserProfileFromMetadata(userId);
				if (!created) {
					console.error('Failed to create user profile from metadata');
					return null;
				}
				// Fetch the newly created profile
				const { data: newProfile, error: newProfileError } = await this.fluxbase
					.from('user_profiles')
					.select('*')
					.eq('id', userId)
					.single();
				if (newProfileError || !newProfile) {
					console.error('Error fetching newly created profile:', newProfileError);
					return null;
				}
				profile = newProfile;
			} else if (profileError || !profile) {
				console.error('Error fetching user profile from user_profiles:', profileError);
				return null;
			}

			// Fetch from auth.users for email, confirmation, created_at
			const { data: userData, error: userError } =
				await this.fluxbase.auth.admin.getUserById(userId);
			if (userError || !userData.user) {
				console.error('Error fetching user from auth.users:', userError);
				return null;
			}
			const user = userData.user;
			return {
				id: user.id,
				email: user.email ?? '',
				first_name: profile.first_name || '',
				last_name: profile.last_name || '',
				full_name:
					profile.full_name ||
					`${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
					'',
				role: (profile.role as 'user' | 'admin') || 'user',
				avatar_url: profile.avatar_url,
				home_address: profile.home_address,
				email_confirmed_at: user.email_confirmed_at,
				created_at: user.created_at,
				updated_at: profile.updated_at || user.created_at
			};
		} catch (error) {
			console.error('Error in getUserProfile:', error);
			return null;
		}
	}

	/**
	 * Create user profile from user_metadata (fallback for existing users)
	 */
	private static async createUserProfileFromMetadata(userId: string): Promise<boolean> {
		try {
			const { data: userData, error: userError } =
				await this.fluxbase.auth.admin.getUserById(userId);
			if (userError || !userData.user) {
				console.error('Error fetching user for profile creation:', userError);
				return false;
			}

			const user = userData.user;
			const metadata = user.user_metadata || {};

			const { error: insertError } = await this.fluxbase.from('user_profiles').insert({
				id: userId,
				first_name: metadata.first_name || '',
				last_name: metadata.last_name || '',
				full_name:
					metadata.full_name ||
					`${metadata.first_name || ''} ${metadata.last_name || ''}`.trim() ||
					'',
				role: (metadata.role as 'user' | 'admin') || 'user',
				avatar_url: metadata.avatar_url,
				home_address: metadata.home_address
			});

			if (insertError) {
				console.error('Error creating user profile:', insertError);
				return false;
			}

			return true;
		} catch (error) {
			console.error('Error in createUserProfileFromMetadata:', error);
			return false;
		}
	}

	/**
	 * Check if a user is an admin
	 */
	static async isUserAdmin(userId: string): Promise<boolean> {
		try {
			const { data, error } = await this.fluxbase.rpc('is_user_admin', { user_uuid: userId });

			if (error) {
				console.error('Error checking admin status:', error);
				return false;
			}

			return data || false;
		} catch (error) {
			console.error('Error in isUserAdmin:', error);
			return false;
		}
	}

	/**
	 * Update user role (admin only)
	 */
	static async updateUserRole(userId: string, newRole: 'user' | 'admin'): Promise<boolean> {
		try {
			// Get current user data
			const { data: currentUser, error: fetchError } =
				await this.fluxbase.auth.admin.getUserById(userId);

			if (fetchError || !currentUser.user) {
				console.error('Error fetching user for role update:', fetchError);
				return false;
			}

			// Update user metadata with new role
			const updatedMetadata = {
				...currentUser.user.user_metadata,
				role: newRole
			};

			const { error: updateError } = await this.fluxbase.auth.admin.updateUserById(userId, {
				user_metadata: updatedMetadata
			});

			if (updateError) {
				console.error('Error updating user role:', updateError);
				return false;
			}

			return true;
		} catch (error) {
			console.error('Error in updateUserRole:', error);
			return false;
		}
	}

	/**
	 * Update user profile in user_profiles table
	 */
	static async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<boolean> {
		try {
			const { error } = await this.fluxbase.from('user_profiles').eq('id', userId).update(updates);
			if (error) {
				console.error('Error updating user profile:', error);
				return false;
			}
			return true;
		} catch (error) {
			console.error('Error in updateUserProfile:', error);
			return false;
		}
	}

	/**
	 * Get all users (admin only)
	 */
	static async getAllUsers(): Promise<UserProfile[]> {
		try {
			const { data, error } = await this.fluxbase.auth.admin.listUsers();

			if (error) {
				console.error('Error fetching all users:', error);
				return [];
			}

			return (data.users || []).map((user: any) => {
				const metadata = user.user_metadata || {};
				return {
					id: user.id,
					email: user.email,
					first_name: metadata.first_name || '',
					last_name: metadata.last_name || '',
					full_name:
						metadata.full_name ||
						`${metadata.first_name || ''} ${metadata.last_name || ''}`.trim() ||
						'',
					role: (metadata.role as 'user' | 'admin') || 'user',
					avatar_url: metadata.avatar_url || user.user_metadata?.avatar_url,
					home_address: metadata.home_address,
					email_confirmed_at: user.email_confirmed_at,
					created_at: user.created_at,
					updated_at: user.updated_at || user.created_at
				};
			});
		} catch (error) {
			console.error('Error in getAllUsers:', error);
			return [];
		}
	}

	/**
	 * Count total users
	 */
	static async getUserCount(): Promise<number> {
		try {
			const { data, error } = await this.fluxbase.auth.admin.listUsers();

			if (error) {
				console.error('Error counting users:', error);
				return 0;
			}

			return data.users?.length || 0;
		} catch (error) {
			console.error('Error in getUserCount:', error);
			return 0;
		}
	}

	/**
	 * Check if this is the first user in the system
	 */
	static async isFirstUser(): Promise<boolean> {
		const count = await this.getUserCount();
		return count === 0;
	}
}
