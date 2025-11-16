// ⚙️ WORKER FLUXBASE CLIENT
// This file provides a Fluxbase client configured for worker processes
// Do not import this in client or server code

import { createClient, type FluxbaseClient } from '@fluxbase/sdk';
import WebSocket from 'ws';
import { getWorkerFluxbaseConfig } from '../shared/config/node-environment';
import type { Database } from '../shared/types';

// Lazy initialization of Fluxbase client
let fluxbaseClient: FluxbaseClient | null = null;

function getFluxbaseClient(): FluxbaseClient {
	if (!fluxbaseClient) {
		const config = getWorkerFluxbaseConfig();

		console.log('🔧 Creating Fluxbase client:');
		console.log('  - URL:', config.url);
		console.log('  - Service role key length:', config.serviceRoleKey.length);
		console.log('  - Anon key length:', (config as any).anonKey?.length || 0);

		fluxbaseClient = createClient(
			config.url,
			config.serviceRoleKey,
			{
				headers: {
					'User-Agent': 'Wayli-Worker/1.0'
				},
				auth: {
					autoRefresh: false,
					persist: false
				}
			}
		);

		console.log('🔧 Fluxbase client created with URL:', config.url);
		console.log('🔧 Fluxbase client service role key length:', config.serviceRoleKey.length);

		// Set the service role key as auth for Realtime
		// This ensures WebSocket connections are properly authenticated
		console.log('🔐 Setting service role key for Realtime authentication');
		fluxbaseClient.realtime.setAuth(config.serviceRoleKey);
	}

	return fluxbaseClient;
}

export const fluxbase = getFluxbaseClient();
