/**
 * Health Check Edge Function
 * Returns system health status
 * @fluxbase:allow-unauthenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

import type { FluxbaseClient } from '../jobs/types';

interface FluxbaseRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string;
	params: Record<string, string>;
}

async function handler(
	_req: FluxbaseRequest,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient
): Promise<Response> {
	const checks: Record<string, { status: string; message?: string; duration?: number }> = {};
	let overallStatus = 'healthy';

	// Check 1: Database connectivity
	try {
		const start = performance.now();

		// Simple query to check database connectivity using SDK
		const { error } = await fluxbaseService
			.from('user_profiles')
			.select('id', { count: 'exact', head: true });

		const duration = performance.now() - start;

		if (error) {
			checks.database = { status: 'unhealthy', message: error.message, duration };
			overallStatus = 'unhealthy';
		} else {
			checks.database = { status: 'healthy', duration };
		}
	} catch (error: any) {
		checks.database = { status: 'unhealthy', message: error.message };
		overallStatus = 'unhealthy';
	}

	// Check 2: Environment variables
	const requiredEnvVars = ['FLUXBASE_BASE_URL', 'FLUXBASE_SERVICE_ROLE_KEY'];
	const missingVars = requiredEnvVars.filter((v) => !Deno.env.get(v));

	if (missingVars.length > 0) {
		checks.environment = {
			status: 'unhealthy',
			message: `Missing: ${missingVars.join(', ')}`
		};
		overallStatus = 'degraded';
	} else {
		checks.environment = { status: 'healthy' };
	}

	// Check 3: Worker health (check if there's a heartbeat in the last 5 minutes)
	try {
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

		const { data, error } = await fluxbaseService
			.from('workers')
			.select('last_heartbeat')
			.gte('last_heartbeat', fiveMinutesAgo)
			.limit(1);

		if (error) {
			checks.workers = { status: 'degraded', message: 'Unable to check worker status' };
		} else if (!data || data.length === 0) {
			checks.workers = { status: 'degraded', message: 'No active workers detected' };
			overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
		} else {
			checks.workers = { status: 'healthy' };
		}
	} catch (error: any) {
		checks.workers = { status: 'degraded', message: error.message };
	}

	const response = {
		success: overallStatus !== 'unhealthy',
		status: overallStatus,
		timestamp: new Date().toISOString(),
		checks
	};

	const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

	return new Response(JSON.stringify(response, null, 2), {
		status: statusCode,
		headers: { 'Content-Type': 'application/json' }
	});
}

export default handler;
