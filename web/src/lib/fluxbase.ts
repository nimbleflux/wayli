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
import { isDefinitiveAuthError } from './utils/auth-error';

// Get public URL and anon key from client config (supports both dev and production)
const FLUXBASE_PUBLIC_URL = config.fluxbaseUrl;
const FLUXBASE_ANON_KEY = config.fluxbaseAnonKey;

if (!FLUXBASE_ANON_KEY) {
	console.warn('⚠️ PUBLIC_FLUXBASE_ANON_KEY is not set. Please add it to your .env file.');
}

// Create client-side Fluxbase client with browser-safe settings
export const fluxbase = createFluxbaseClient(FLUXBASE_PUBLIC_URL, FLUXBASE_ANON_KEY, {
	persist: true, // Enable session persistence in browser
	// The SDK timer clears the whole session after 3 failed refresh retries
	// regardless of WHY the refresh failed — going offline for a few seconds
	// while a token was near expiry used to sign the user out. SessionManager
	// refreshes proactively instead (see session-manager.service.ts).
	autoRefresh: false
});

// The SDK's built-in refresh callback also clears the session on ANY refresh
// error (including transport failures). Replace it so only a definitive
// rejection from the auth server signs the user out; transient failures keep
// the session. Classification matches Android's SessionArbiter.
fluxbase.fetch.setRefreshTokenCallback(async () => {
	const { error } = await fluxbase.auth.refreshSession();
	if (!error) return true;
	if (isDefinitiveAuthError(error)) {
		// Refresh token rejected by the server — clear locally even if the
		// signout API call fails (signOut always clears in its finally).
		await fluxbase.auth.signOut();
	}
	return false;
});
