// Settings type definitions for Fluxbase AppSettingsManager

import type { EmailProviderSettings } from '@fluxbase/sdk';

// Re-export SDK email types for use in the app
export type { EmailProviderSettings, UpdateEmailProviderSettingsRequest } from '@fluxbase/sdk';

/**
 * Public server settings - returned by server-settings endpoint
 * Safe for unauthenticated users
 */
export interface PublicServerSettings {
	// Wayli custom settings
	server_name: string;
	is_setup_complete: boolean;
	server_pexels_api_key_available: boolean;

	// App-level settings (from AppSettingsManager)
	signup_enabled: boolean;
	email_verification_required: boolean;
	email_enabled: boolean;

	// Password requirements (for signup page)
	password_min_length: number;
	password_requirements: {
		require_uppercase: boolean;
		require_lowercase: boolean;
		require_number: boolean;
		require_special: boolean;
	};
}

/**
 * Authentication settings from Fluxbase AppSettingsManager
 */
export interface AuthenticationSettings {
	enable_signup: boolean;
	enable_magic_link: boolean;
	password_min_length: number;
	require_email_verification: boolean;
	password_complexity?: {
		require_uppercase?: boolean;
		require_lowercase?: boolean;
		require_number?: boolean;
		require_special?: boolean;
	};
	read_only?: boolean; // True if configured via env/yaml
}

/**
 * Feature toggles from Fluxbase AppSettingsManager
 */
export interface FeatureSettings {
	enable_realtime: boolean;
	enable_storage: boolean;
	enable_functions: boolean;
}

/**
 * Security settings from Fluxbase AppSettingsManager
 */
export interface SecuritySettings {
	enable_global_rate_limit: boolean;
	session_timeout_minutes?: number;
	max_sessions_per_user?: number;
}

/**
 * AI Provider from FluxbaseAdmin SDK
 */
export interface AIProvider {
	id: string;
	name: string;
	display_name: string;
	provider_type: 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'azure' | 'custom';
	is_default: boolean;
	enabled: boolean;
	config?: {
		api_key?: string;
		model?: string;
		api_endpoint?: string;
		max_tokens?: number;
		temperature?: number;
	};
	read_only?: boolean; // True if provider is read-only (configured via env/yaml)
	created_at?: string;
	updated_at?: string;
}

/**
 * AI settings from FluxbaseAdmin SDK
 */
export interface AISettings {
	enabled: boolean;
	allow_user_provider_override: boolean;
	default_provider?: AIProvider;
	providers: AIProvider[];
	read_only?: boolean; // True if configured via env/yaml (applies to global AI settings)
}

/**
 * Complete app settings from Fluxbase AppSettingsManager
 */
export interface AppSettings {
	authentication: AuthenticationSettings;
	email: EmailProviderSettings;
	features: FeatureSettings;
	security: SecuritySettings;
	ai?: AISettings;
}

/**
 * Custom Wayli settings stored in system settings
 */
export interface WayliCustomSettings {
	'wayli.server_name'?: {
		value: string;
		description?: string;
	};
	'wayli.pexels_rate_limit'?: {
		value: number; // Requests per hour, 0 = unlimited
		description?: string;
	};
	'wayli.pelias_endpoint'?: {
		value: string;
		description?: string;
	};
}

/**
 * Metadata for an encrypted secret (value is never returned)
 */
export interface SecretMetadata {
	key: string;
	description?: string;
	created_at: string;
	updated_at: string;
}

/**
 * System-level secrets metadata (admin only)
 */
export interface SystemSecretsMetadata {
	pexels_api_key?: SecretMetadata;
}

/**
 * Complete admin settings response
 */
export interface AdminSettingsResponse {
	app: AppSettings;
	custom: WayliCustomSettings;
	secrets?: SystemSecretsMetadata;
}

/**
 * Update settings request body
 */
export interface UpdateSettingsRequest {
	type: 'app' | 'custom';
	action?: string; // For app settings
	key?: string; // For custom settings
	value?: unknown;
	description?: string;
	[key: string]: unknown; // Additional params based on action
}
