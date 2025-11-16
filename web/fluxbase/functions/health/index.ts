import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@fluxbase/sdk@0.0.1-rc.11';

async function handler(req) {
	// Handle CORS preflight requests
	if (req.method === 'OPTIONS') {
		return {
			status: 200,
			headers: corsHeaders,
			body: 'ok'
		};
	}

	const checks: Record<string, { status: string; message?: string; duration?: number }> = {};
	let overallStatus = 'healthy';

	// Check 1: Database connectivity
	try {
		const start = performance.now();
		const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL') ?? '';
		const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY') ?? '';

		if (!fluxbaseUrl || !fluxbaseKey) {
			throw new Error('Missing Fluxbase credentials');
		}

		const fluxbase = createClient({ url: fluxbaseUrl, apiKey: fluxbaseKey });

		// Simple query to check database connectivity
		const { error } = await fluxbase
			.from('user_profiles')
			.select('count', { count: 'exact', head: true });

		const duration = performance.now() - start;

		if (error) {
			checks.database = { status: 'unhealthy', message: error.message, duration };
			overallStatus = 'unhealthy';
		} else {
			checks.database = { status: 'healthy', duration };
		}
	} catch (error) {
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
		const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL') ?? '';
		const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY') ?? '';
		const fluxbase = createClient({ url: fluxbaseUrl, apiKey: fluxbaseKey });

		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		const { data, error } = await fluxbase
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
	} catch (error) {
		checks.workers = { status: 'degraded', message: error.message };
	}

	const response = {
		success: overallStatus !== 'unhealthy',
		status: overallStatus,
		timestamp: new Date().toISOString(),
		checks
	};

	const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

	return {
		status: statusCode,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		body: JSON.stringify(response, null, 2)
	};
}

export default handler;
