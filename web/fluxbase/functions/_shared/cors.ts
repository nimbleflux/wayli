// Fluxbase Request/Response type definitions
export interface FluxbaseRequest {
	method: string; // GET, POST, etc.
	url: string;
	headers: Record<string, string>;
	body: string; // Raw body (use JSON.parse for JSON)
	params: Record<string, string>; // Query parameters
}

export interface FluxbaseResponse {
	status: number;
	headers?: Record<string, string>;
	body?: string;
}

// CORS configuration with environment variable support
// SECURITY: In production, set FLUXBASE_CORS_ALLOW_ORIGIN to your specific domain(s)
// Example: 'https://yourdomain.com' or comma-separated list
const corsAllowOrigin = Deno.env.get('FLUXBASE_CORS_ALLOW_ORIGIN') || '*';
const corsAllowHeaders =
	Deno.env.get('FLUXBASE_CORS_ALLOW_HEADERS') ||
	'authorization, x-client-info, apikey, content-type';
const corsAllowMethods =
	Deno.env.get('FLUXBASE_CORS_ALLOW_METHODS') || 'GET, POST, PUT, DELETE, OPTIONS';
const corsMaxAge = Deno.env.get('FLUXBASE_CORS_MAX_AGE') || '86400';

// Warn if using wildcard CORS in production
const isProduction = Deno.env.get('NODE_ENV') === 'production' || Deno.env.get('FLUXBASE_ENVIRONMENT') === 'production';
if (corsAllowOrigin === '*' && isProduction) {
	console.warn(
		'⚠️ WARNING: CORS is configured to allow all origins (*). This is a security risk in production.'
	);
	console.warn('⚠️ Set FLUXBASE_CORS_ALLOW_ORIGIN environment variable to your specific domain.');
}

export const corsHeaders = {
	'Access-Control-Allow-Origin': corsAllowOrigin,
	'Access-Control-Allow-Headers': corsAllowHeaders,
	'Access-Control-Allow-Methods': corsAllowMethods,
	'Access-Control-Max-Age': corsMaxAge
};

// Return plain object for Fluxbase handler pattern
export function handleCors(request: FluxbaseRequest): FluxbaseResponse | null {
	if (request.method === 'OPTIONS') {
		return {
			status: 200,
			headers: corsHeaders,
			body: 'ok'
		};
	}
	return null;
}
