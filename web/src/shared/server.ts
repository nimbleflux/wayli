import { createFluxbaseClient } from './fluxbase-factory';

// Use process.env with fallbacks for build-time compatibility
const FLUXBASE_BASE_URL = process.env.FLUXBASE_BASE_URL || 'http://127.0.0.1:8080';
const FLUXBASE_SERVICE_ROLE_KEY = process.env.FLUXBASE_SERVICE_ROLE_KEY || '';

// Create a lazy function to avoid creating the client during build time
function createServerFluxbaseClient() {
	if (!FLUXBASE_SERVICE_ROLE_KEY) {
		throw new Error('FLUXBASE_SERVICE_ROLE_KEY is required for server operations');
	}
	return createFluxbaseClient(FLUXBASE_BASE_URL, FLUXBASE_SERVICE_ROLE_KEY);
}

// Export a getter function instead of the client directly
export function getFluxbase() {
	return createServerFluxbaseClient();
}

// For backward compatibility, export the client as a property that gets created on first access
export const fluxbase = new Proxy({} as any, {
	get(target, prop) {
		if (!target._client) {
			target._client = createServerFluxbaseClient();
		}
		return target._client[prop];
	}
});
