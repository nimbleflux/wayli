/**
 * Client-side runtime configuration
 *
 * This config is safe for use in browser environments.
 * It only exposes the PUBLIC Fluxbase URL (for client access) and the anon key.
 *
 * For server-side/worker configuration (which uses internal URLs), see:
 * - src/shared/config/node-environment.ts
 */

export interface RuntimeConfig {
	fluxbaseUrl: string;
	fluxbaseAnonKey: string;
}

/**
 * Check if a config value is valid (not empty and not an unsubstituted template placeholder).
 * Template placeholders like {{FLUXBASE_PUBLIC_BASE_URL}} are used in app.html and replaced
 * at runtime by startup.sh in production. In development, these remain unsubstituted.
 */
function isValidConfigValue(value: string | undefined): value is string {
	if (!value) return false;
	// Ignore unsubstituted template placeholders (e.g., {{FLUXBASE_PUBLIC_BASE_URL}})
	if (value.startsWith('{{') && value.endsWith('}}')) return false;
	return true;
}

export const config = {
	/**
	 * Get the public Fluxbase URL for client-side access.
	 * This should always be the externally-accessible URL.
	 *
	 * Priority order:
	 * 1. window.WAYLI_CONFIG (production runtime - injected by startup.sh)
	 * 2. process.env (development mode - from Vite)
	 * 3. Fallback default
	 */
	get fluxbaseUrl(): string {
		// In production, check window.WAYLI_CONFIG first (runtime injection takes priority)
		// This must come BEFORE process.env check because Vite replaces process.env at build time
		if (typeof window !== 'undefined') {
			// Check if WAYLI_CONFIG is available (production runtime)
			const runtimeValue = (window as any).WAYLI_CONFIG?.fluxbaseUrl;
			if (isValidConfigValue(runtimeValue)) {
				return runtimeValue;
			}

			// In development, try to get from SvelteKit's dev environment
			const devEnvValue = (window as any).__sveltekit_dev?.env?.FLUXBASE_PUBLIC_BASE_URL;
			if (isValidConfigValue(devEnvValue)) {
				return devEnvValue;
			}
		}

		// In development mode, use environment variables from Vite (replaced at build time)
		if (
			typeof process !== 'undefined' &&
			isValidConfigValue(process.env.FLUXBASE_PUBLIC_BASE_URL)
		) {
			return process.env.FLUXBASE_PUBLIC_BASE_URL;
		}

		// Fallback for development
		return 'http://127.0.0.1:8080';
	},

	/**
	 * Get the Fluxbase anonymous key for client-side access.
	 *
	 * Priority order:
	 * 1. window.WAYLI_CONFIG (production runtime - injected by startup.sh)
	 * 2. process.env (development mode - from Vite)
	 * 3. Fallback default
	 */
	get fluxbaseAnonKey(): string {
		// In production, check window.WAYLI_CONFIG first (runtime injection takes priority)
		// This must come BEFORE process.env check because Vite replaces process.env at build time
		if (typeof window !== 'undefined') {
			// Check if WAYLI_CONFIG is available (production runtime)
			const runtimeValue = (window as any).WAYLI_CONFIG?.fluxbaseAnonKey;
			if (isValidConfigValue(runtimeValue)) {
				return runtimeValue;
			}

			// In development, try to get from SvelteKit's dev environment
			const devEnvValue = (window as any).__sveltekit_dev?.env?.PUBLIC_FLUXBASE_ANON_KEY;
			if (isValidConfigValue(devEnvValue)) {
				return devEnvValue;
			}
		}

		// In development mode, use environment variables from Vite (replaced at build time)
		if (
			typeof process !== 'undefined' &&
			isValidConfigValue(process.env.PUBLIC_FLUXBASE_ANON_KEY)
		) {
			return process.env.PUBLIC_FLUXBASE_ANON_KEY;
		}

		// Fallback for development
		return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImZsdXhiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjE3OTk1MzU2MDB9.iPr9o47ALu9iDLqL9rqq7rlvka9Q8ps2XV049R4l67E';
	}
};

export type Config = typeof config;
