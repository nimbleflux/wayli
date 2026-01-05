/**
 * Client-side Fluxbase client
 * Safe for use in browser environment
 *
 * This client uses the PUBLIC Fluxbase URL (FLUXBASE_PUBLIC_BASE_URL) which is
 * accessible from the browser. For server-side operations that need internal
 * URLs (workers, edge functions), use process.env.FLUXBASE_BASE_URL directly.
 */

import { createFluxbaseClient } from '../shared/fluxbase-factory';
import { config } from './config';

// Get public URL and anon key from client config (supports both dev and production)
const FLUXBASE_PUBLIC_URL = config.fluxbaseUrl;
const FLUXBASE_ANON_KEY = config.fluxbaseAnonKey;

if (!FLUXBASE_ANON_KEY) {
	console.warn('⚠️ PUBLIC_FLUXBASE_ANON_KEY is not set. Please add it to your .env file.');
}

// Create client-side Fluxbase client with browser-safe settings
export const fluxbase = createFluxbaseClient(FLUXBASE_PUBLIC_URL, FLUXBASE_ANON_KEY, {
	persist: true, // Enable session persistence in browser
	autoRefresh: true // Auto-refresh tokens in browser
});
