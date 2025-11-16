import { createClient, type FluxbaseClient } from '@fluxbase/sdk';

import { getFluxbaseConfig } from './config/node-environment';

import type { Database } from './types';

const config = getFluxbaseConfig();

export const fluxbase: FluxbaseClient = createClient(
	config.url,
	config.serviceRoleKey,
	{
		auth: {
			autoRefresh: false,
			persist: false
		}
	}
);
