import type { GeocodedLocation } from './geocoding.types';

export interface UserProfile {
	id: string;
	email?: string;
	first_name?: string;
	last_name?: string;
	full_name?: string;
	role: 'user' | 'admin';
	avatar_url?: string;
	home_address?: string | GeocodedLocation;
	email_confirmed_at?: string;
	created_at: string;
	updated_at: string;
	// Onboarding tracking fields
	onboarding_completed?: boolean;
	onboarding_dismissed?: boolean;
	home_address_skipped?: boolean;
	first_login_at?: string;
}

export interface UserPreferences {
	id: string; // References auth.users(id)
	theme: 'light' | 'dark';
	language: string;
	notifications_enabled: boolean;
	timezone?: string;
	pexels_api_key?: string;
	owntracks_api_key?: string;
	trip_exclusions?: unknown[];
	preferences?: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export interface UserSecurity {
	lastPasswordChange?: string;
}

export interface UpdateProfileRequest {
	first_name?: string;
	last_name?: string;
	full_name?: string;
	home_address?: string | GeocodedLocation;
	avatar_url?: string;
}

export interface UpdatePreferencesRequest {
	theme?: 'light' | 'dark';
	language?: string;
	notifications_enabled?: boolean;
	timezone?: string;
	pexels_api_key?: string;
}

export interface UpdatePasswordRequest {
	currentPassword: string;
	newPassword: string;
}

export interface UpdatePasswordResponse {
	success: boolean;
	message?: string;
}

export interface TwoFactorSetupResponse {
	qr_code: string;
	secret: string;
	uri: string;
}

export interface TwoFactorEnableRequest {
	code: string;
}

export interface TwoFactorEnableResponse {
	backup_codes: string[];
	message?: string;
}

export interface TwoFactorDisableRequest {
	password: string;
}

export interface TwoFactorDisableResponse {
	success: boolean;
	message?: string;
}

export interface TwoFactorStatusResponse {
	totp_enabled: boolean;
}

/**
 * Metadata for a user's encrypted secret (value is never returned)
 */
export interface UserSecretMetadata {
	key: string;
	description?: string;
	created_at: string;
	updated_at: string;
}

/**
 * User secrets metadata (for displaying configured status)
 */
export interface UserSecretsMetadata {
	pexels_api_key?: UserSecretMetadata;
	owntracks_api_key?: UserSecretMetadata;
}
