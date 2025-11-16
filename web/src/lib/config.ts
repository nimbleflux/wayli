export interface RuntimeConfig {
	fluxbaseUrl: string;
	fluxbaseAnonKey: string;
	fluxbaseServiceKey: string;
}

export const config = {
	get fluxbaseUrl(): string {
		// In development mode, use environment variables from Vite
		if (typeof process !== 'undefined' && process.env.PUBLIC_FLUXBASE_BASE_URL) {
			return process.env.PUBLIC_FLUXBASE_BASE_URL;
		}

		// In production, check if we're in a browser environment
		if (typeof window !== 'undefined') {
			// Check if WAYLI_CONFIG is available (production)
			if ((window as any).WAYLI_CONFIG?.fluxbaseUrl) {
				return (window as any).WAYLI_CONFIG.fluxbaseUrl;
			}

			// In development, try to get from SvelteKit's dev environment
			if ((window as any).__sveltekit_dev?.env?.PUBLIC_FLUXBASE_BASE_URL) {
				return (window as any).__sveltekit_dev.env.PUBLIC_FLUXBASE_BASE_URL;
			}
		}

		// Fallback for server-side or when config not loaded
		return 'http://127.0.0.1:8080';
	},
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

		// Fallback for server-side or when config not loaded
		return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE';
	},
	get fluxbaseServiceKey(): string {
		// In development mode, use environment variables from Vite
		if (typeof process !== 'undefined' && process.env.FLUXBASE_SERVICE_ROLE_KEY) {
			return process.env.FLUXBASE_SERVICE_ROLE_KEY;
		}

		// In production, check if we're in a browser environment
		if (typeof window !== 'undefined') {
			// Check if WAYLI_CONFIG is available (production)
			if ((window as any).WAYLI_CONFIG?.fluxbaseServiceKey) {
				return (window as any).WAYLI_CONFIG.fluxbaseServiceKey;
			}

			// In development, try to get from SvelteKit's dev environment
			if ((window as any).__sveltekit_dev?.env?.FLUXBASE_SERVICE_ROLE_KEY) {
				return (window as any).__sveltekit_dev.env.FLUXBASE_SERVICE_ROLE_KEY;
			}
		}

		// Fallback for server-side or when config not loaded
		return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';
	}
};

export type Config = typeof config;
