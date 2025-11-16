// Settings type definitions for Fluxbase AppSettingsManager

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
}

/**
 * Email settings from Fluxbase AppSettingsManager
 */
export interface EmailSettings {
	enabled: boolean;
	provider: 'smtp' | 'sendgrid' | 'mailgun' | 'ses';
	smtp?: {
		host: string;
		port: number;
		username: string;
		use_tls: boolean;
		from_address: string;
		from_name: string;
		reply_to_address?: string;
	};
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
 * Complete app settings from Fluxbase AppSettingsManager
 */
export interface AppSettings {
	authentication: AuthenticationSettings;
	email: EmailSettings;
	features: FeatureSettings;
	security: SecuritySettings;
}

/**
 * Custom Wayli settings stored in system settings
 */
export interface WayliCustomSettings {
	'wayli.server_name'?: {
		value: string;
		description?: string;
	};
	'wayli.server_pexels_api_key'?: {
		value: string;
		description?: string;
	};
}

/**
 * Complete admin settings response
 */
export interface AdminSettingsResponse {
	app: AppSettings;
	custom: WayliCustomSettings;
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
