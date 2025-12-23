import { createClient, type FluxbaseClient } from '@fluxbase/sdk';

export function createFluxbaseClient(
	url: string,
	key: string,
	options?: { persist?: boolean; autoRefresh?: boolean }
): FluxbaseClient {
	const { persist = false, autoRefresh = false } = options || {};

	return createClient(
		url,
		key,
		{
			auth: {
				autoRefresh,
				persist
			}
		}
	);
}
