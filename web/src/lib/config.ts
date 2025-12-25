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

export const config = {
	/**
	 * Get the public Fluxbase URL for client-side access.
	 * This should always be the externally-accessible URL.
	 */
	get fluxbaseUrl(): string {
		// In development mode, use environment variables from Vite
		if (typeof process !== 'undefined' && process.env.FLUXBASE_PUBLIC_BASE_URL) {
			return process.env.FLUXBASE_PUBLIC_BASE_URL;
		}

		// In production, check if we're in a browser environment
		if (typeof window !== 'undefined') {
			// Check if WAYLI_CONFIG is available (production)
			if ((window as any).WAYLI_CONFIG?.fluxbaseUrl) {
				return (window as any).WAYLI_CONFIG.fluxbaseUrl;
			}

			// In development, try to get from SvelteKit's dev environment
			if ((window as any).__sveltekit_dev?.env?.FLUXBASE_PUBLIC_BASE_URL) {
				return (window as any).__sveltekit_dev.env.FLUXBASE_PUBLIC_BASE_URL;
			}
		}

		// Fallback for development
		return 'http://127.0.0.1:8080';
	},

	/**
	 * Get the Fluxbase anonymous key for client-side access.
	 */
	get fluxbaseAnonKey(): string {
		// In development mode, use environment variables from Vite
		if (typeof process !== 'undefined' && process.env.PUBLIC_FLUXBASE_ANON_KEY) {
			return process.env.PUBLIC_FLUXBASE_ANON_KEY;
		}

		// In production, check if we're in a browser environment
		if (typeof window !== 'undefined') {
			// Check if WAYLI_CONFIG is available (production)
			if ((window as any).WAYLI_CONFIG?.fluxbaseAnonKey) {
				return (window as any).WAYLI_CONFIG.fluxbaseAnonKey;
			}

			// In development, try to get from SvelteKit's dev environment
			if ((window as any).__sveltekit_dev?.env?.PUBLIC_FLUXBASE_ANON_KEY) {
				return (window as any).__sveltekit_dev.env.PUBLIC_FLUXBASE_ANON_KEY;
			}
		}

		// Fallback for development
		return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImZsdXhiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjE3OTk1MzU2MDB9.iPr9o47ALu9iDLqL9rqq7rlvka9Q8ps2XV049R4l67E';
	}
};

export type Config = typeof config;
