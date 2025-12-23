/**
 * Client-side Fluxbase client
 * Safe for use in browser environment
 */

import { createFluxbaseClient } from '../shared/fluxbase-factory';
import { config } from './config';

// Get environment variables from config (supports both dev and production)
const FLUXBASE_BASE_URL = config.fluxbaseUrl;
const FLUXBASE_ANON_KEY = config.fluxbaseAnonKey;

if (!FLUXBASE_ANON_KEY) {
	console.warn(
		'⚠️ PUBLIC_FLUXBASE_ANON_KEY is not set. Please add it to your .env file.'
	);
}

// Create client-side Fluxbase client with browser-safe settings
export const fluxbase = createFluxbaseClient(FLUXBASE_BASE_URL, FLUXBASE_ANON_KEY, {
	persist: true, // Enable session persistence in browser
	autoRefresh: true // Auto-refresh tokens in browser
});
