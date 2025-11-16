// src/lib/fluxbase.ts
// Client-side Fluxbase client. Uses runtime configuration from WAYLI_CONFIG.
// Never import secrets or private env vars here.
// This is the SINGLE source of truth for the Fluxbase client in the browser.

import { createClient } from '@fluxbase/sdk';
import { browser } from '$app/environment';
import { config } from './config';
import type { Database } from './types';

/**
 * The client-side Fluxbase instance for browser use.
 * Configured with local storage persistence for JWT tokens.
 * The URL and API key are determined at runtime from WAYLI_CONFIG.
 *
 * IMPORTANT: This is the ONLY Fluxbase client instance that should be used
 * in client-side code to avoid multiple auth client instances.
 */
export const fluxbase = createClient(
	config.fluxbaseUrl,
	config.fluxbaseAnonKey,
	{
		auth: {
			autoRefresh: browser,
			persist: browser
		}
	}
);

// Export the config for components that need it
export { config };
