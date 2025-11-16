import { createClient } from '@fluxbase/sdk';

import { getWorkerFluxbaseConfig } from '../shared/config/node-environment';

/**
 * Create a Fluxbase client for worker processes
 */
export function createWorkerClient() {
	const config = getWorkerFluxbaseConfig();

	console.log('🔗 Creating worker Fluxbase client with URL:', config.url);

	return createClient(
		config.url,
		config.serviceRoleKey,
		{
			auth: {
				autoRefresh: false,
				persist: false
			}
		}
	);
}
