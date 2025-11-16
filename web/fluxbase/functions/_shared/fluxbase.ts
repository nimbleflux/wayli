import { createClient, type FluxbaseClient } from 'https://esm.sh/@fluxbase/sdk@0.0.1-rc.11';

const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
const fluxbaseServiceKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');
const fluxbaseAnonKey = Deno.env.get('FLUXBASE_ANON_KEY');

// Validate environment variables
if (!fluxbaseUrl) {
	console.error('❌ FLUXBASE_BASE_URL environment variable is not set');
	throw new Error('FLUXBASE_BASE_URL environment variable is required');
}

if (!fluxbaseServiceKey) {
	console.error('❌ FLUXBASE_SERVICE_ROLE_KEY environment variable is not set');
	throw new Error('FLUXBASE_SERVICE_ROLE_KEY environment variable is required');
}

if (!fluxbaseAnonKey) {
	console.error('❌ FLUXBASE_ANON_KEY environment variable is not set');
	throw new Error('FLUXBASE_ANON_KEY environment variable is required');
}

let fluxbase: FluxbaseClient;
try {
	fluxbase = createClient({
		url: fluxbaseUrl,
		apiKey: fluxbaseServiceKey,
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});
} catch (error) {
	console.error('❌ [FLUXBASE] Failed to create client:', error);
	throw error;
}

export { fluxbase };

export function createAuthenticatedClient(authToken: string) {
	try {
		// Create a client that can verify JWT tokens
		const client = createClient({
			url: fluxbaseUrl!,
			apiKey: fluxbaseServiceKey!,
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		});
		return client;
	} catch (error) {
		console.error('❌ [FLUXBASE] Failed to create authenticated client:', error);
		throw error;
	}
}

// Create a client that uses the user's token for database access
export function createUserClient(authToken: string) {
	try {
		// Create a client that uses the user's JWT token for authentication
		// This ensures RLS policies are respected
		const client = createClient({
			url: fluxbaseUrl!,
			apiKey: fluxbaseAnonKey!,
			global: {
				headers: {
					Authorization: `Bearer ${authToken}`
				}
			},
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		});
		return client;
	} catch (error) {
		console.error('❌ [FLUXBASE] Failed to create user client:', error);
		throw error;
	}
}

// Create a management client with admin capabilities
export function createManagementClient() {
	try {
		return createClient({
			url: fluxbaseUrl!,
			apiKey: fluxbaseServiceKey!,
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		});
	} catch (error) {
		console.error('❌ [FLUXBASE] Failed to create management client:', error);
		throw error;
	}
}
