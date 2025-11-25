/**
 * Health Check Edge Function
 * Returns system health status
 * @fluxbase:allow-unauthenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

async function handler(req) {

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

		// Simple query to check database connectivity using REST API
		const response = await fetch(`${fluxbaseUrl}/rest/v1/user_profiles?select=count`, {
			method: 'HEAD',
			headers: {
				'apikey': fluxbaseKey,
				'Authorization': `Bearer ${fluxbaseKey}`
			}
		});

		const duration = performance.now() - start;

		if (!response.ok) {
			checks.database = { status: 'unhealthy', message: `HTTP ${response.status}`, duration };
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

		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

		const response = await fetch(
			`${fluxbaseUrl}/rest/v1/workers?select=last_heartbeat&last_heartbeat=gte.${fiveMinutesAgo}&limit=1`,
			{
				headers: {
					'apikey': fluxbaseKey,
					'Authorization': `Bearer ${fluxbaseKey}`
				}
			}
		);

		if (!response.ok) {
			checks.workers = { status: 'degraded', message: 'Unable to check worker status' };
		} else {
			const data = await response.json();
			if (!data || data.length === 0) {
				checks.workers = { status: 'degraded', message: 'No active workers detected' };
				overallStatus = overallStatus === 'unhealthy' ? 'unhealthy' : 'degraded';
			} else {
				checks.workers = { status: 'healthy' };
			}
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

	return new Response(JSON.stringify(response, null, 2), {
		status: statusCode,
		headers: { 'Content-Type': 'application/json' }
	});
}

export default handler;
