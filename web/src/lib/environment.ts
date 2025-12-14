// 🖥️ CLIENT ENVIRONMENT CONFIGURATION
// This file contains environment variables and configuration that are safe
// to use in client-side code (browser)

import { ENVIRONMENT } from '../shared/environment';

export const CLIENT_ENVIRONMENT = {
	...ENVIRONMENT,

	// Client-specific overrides
	IS_CLIENT: true,
	IS_SERVER: false,
	IS_WORKER: false,

	// Fluxbase URLs (safe for client-side)
	FLUXBASE_BASE_URL: process.env.FLUXBASE_BASE_URL || '',
	PUBLIC_FLUXBASE_BASE_URL: process.env.PUBLIC_FLUXBASE_BASE_URL || '',

	// Client-side feature flags
	ENABLE_ANALYTICS: process.env.NODE_ENV === 'production',
	ENABLE_DEBUG_TOOLS: process.env.NODE_ENV === 'development',

	// Client-side timeouts
	API_TIMEOUT: 10000, // 10 seconds for client API calls
	ANIMATION_DURATION: 300, // 300ms for UI animations

	// Client-side limits
	MAX_FILE_SIZE: 1024 * 1024 * 1024, // 1GB (chunked uploads support large files)
	MAX_UPLOAD_FILES: 5
} as const;

// Client-safe logging (no sensitive data)
export function logClient(message: string, level: 'info' | 'warn' | 'error' = 'info') {
	if (CLIENT_ENVIRONMENT.ENABLE_DEBUG_LOGGING) {
		const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
		console.log(`${emoji} [CLIENT] ${message}`);
	}
}
