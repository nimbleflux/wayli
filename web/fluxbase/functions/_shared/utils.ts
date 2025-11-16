import { corsHeaders, handleCors } from './cors.ts';
import { fluxbase, createUserClient } from './fluxbase.ts';
import { createClient } from 'https://esm.sh/@fluxbase/sdk@0.0.1-rc.11';

// Define the FluxbaseClient type locally to avoid import issues
interface FluxbaseClient {
	from: (table: string) => any;
	auth: any;
	// Add other methods as needed
}

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

export interface AuthenticatedContext {
	user: {
		id: string;
		email?: string;
		user_metadata?: Record<string, unknown>;
		app_metadata?: Record<string, unknown>;
		aud?: string;
		created_at?: string;
		updated_at?: string;
		role?: string;
	};
	fluxbase: FluxbaseClient;
}

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

/**
 * Authenticate the request and return user context
 * Production-ready with proper JWT verification
 */
export async function authenticateRequest(req: FluxbaseRequest): Promise<AuthenticatedContext> {
	const authHeader = req.headers['Authorization'] || req.headers['authorization'];
	if (!authHeader) {
		console.error('❌ [AUTH] No authorization header found');
		throw new Error('No authorization header');
	}

	const token = authHeader.replace('Bearer ', '');

	// Basic token format validation
	if (!token || token.length < 10) {
		console.error('❌ [AUTH] Invalid token format');
		throw new Error('Invalid token format');
	}

	// Check for common attack patterns
	if (token.includes('..') || token.includes('javascript:') || token.includes('<script>')) {
		console.error('❌ [AUTH] Malicious token pattern detected');
		throw new Error('Invalid token format');
	}

	try {
		// Verify the JWT token using Fluxbase's built-in verification
		const {
			data: { user },
			error
		} = await fluxbase.auth.getUser(token);

		if (error || !user) {
			console.error('❌ [AUTH] JWT verification failed:', error);
			throw new Error('Invalid or expired JWT token');
		}

		// Additional security checks
		if (!user.id || typeof user.id !== 'string') {
			console.error('❌ [AUTH] Invalid user ID in token');
			throw new Error('Invalid user ID in token');
		}

		if (user.aud !== 'authenticated') {
			console.error('❌ [AUTH] Invalid token audience:', user.aud);
			throw new Error('Invalid token audience');
		}

		// Validate UUID format for user ID
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(user.id)) {
			console.error('❌ [AUTH] Invalid user ID format:', user.id);
			throw new Error('Invalid user ID format');
		}

		// Create user context with verified user data
		const userInfo = {
			id: user.id,
			email: user.email,
			user_metadata: user.user_metadata || {},
			app_metadata: user.app_metadata || {},
			aud: user.aud,
			created_at: user.created_at,
			updated_at: user.updated_at
		};

		// Create a user-specific client that respects RLS policies
		const userClient = createUserClient(token);
		return {
			user: userInfo,
			fluxbase: userClient
		};
	} catch (error) {
		console.error('❌ [AUTH] Authentication failed:', error);
		throw new Error('Authentication failed');
	}
}

/**
 * Authenticate request using API key + User ID from query parameters
 * Used for OwnTracks integration where authentication happens via API key + User ID in query params
 */
export async function authenticateRequestWithApiKey(req: FluxbaseRequest): Promise<AuthenticatedContext> {
	const apiKey = req.params.api_key;
	const userId = req.params.user_id;

	if (!userId) {
		console.error('❌ [AUTH] No user_id found in query parameters');
		throw new Error('user_id required in query parameters');
	}

	if (!apiKey) {
		console.error('❌ [AUTH] No api_key found in query parameters');
		throw new Error('api_key required in query parameters');
	}

	// Validate UUID format for user ID
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	if (!uuidRegex.test(userId)) {
		console.error('❌ [AUTH] Invalid user ID format:', userId);
		throw new Error('Invalid user ID format');
	}

	// Validate API key format (32 character hex string)
	if (!apiKey || apiKey.length !== 32) {
		console.error('❌ [AUTH] Invalid API key format');
		throw new Error('Invalid API key format');
	}

	try {
		// Create service role client to verify API key
		const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
		const fluxbaseServiceKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');

		if (!fluxbaseUrl || !fluxbaseServiceKey) {
			console.error('❌ [AUTH] Missing environment variables for API key verification');
			throw new Error('Server configuration error');
		}

		const serviceClient = createClient({
			url: fluxbaseUrl,
			apiKey: fluxbaseServiceKey,
			auth: { autoRefreshToken: false, persistSession: false }
		});

		// Get user by ID and verify API key
		const {
			data: { user },
			error
		} = await serviceClient.auth.admin.getUserById(userId);

		if (error || !user) {
			console.error('❌ [AUTH] User not found:', userId);
			throw new Error('User not found');
		}

		// Check if API key matches
		const userMetadata = (user.user_metadata as Record<string, unknown>) || {};
		const storedApiKey = userMetadata.owntracks_api_key as string;

		if (!storedApiKey || storedApiKey !== apiKey) {
			console.error('❌ [AUTH] Invalid API key for user:', userId);
			throw new Error('Invalid API key');
		}

		console.log(`✅ [AUTH] API key authentication successful for user: ${userId}`);

		// Create user context
		const userInfo = {
			id: user.id,
			email: user.email,
			user_metadata: user.user_metadata || {},
			app_metadata: user.app_metadata || {},
			aud: user.aud,
			created_at: user.created_at,
			updated_at: user.updated_at
		};

		// Use the service role client since we've already verified the API key
		// This client can bypass RLS policies and insert data on behalf of the user
		return {
			user: userInfo,
			fluxbase: serviceClient
		};
	} catch (error) {
		console.error('❌ [AUTH] API key authentication failed:', error);
		throw new Error('API key authentication failed');
	}
}

/**
 * Optionally authenticate the request (for public endpoints that can work with or without auth)
 * Returns null if no valid token is provided, but doesn't throw an error
 */
export async function authenticateRequestOptional(
	req: FluxbaseRequest
): Promise<AuthenticatedContext | null> {
	const authHeader = req.headers['Authorization'] || req.headers['authorization'];
	if (!authHeader) {
		return null; // No auth header, but that's okay for optional auth
	}

	const token = authHeader.replace('Bearer ', '');
	if (!token || token.length < 10) {
		return null; // Invalid token format, but that's okay for optional auth
	}

	try {
		const {
			data: { user },
			error
		} = await fluxbase.auth.getUser(token);

		if (error || !user || user.aud !== 'authenticated') {
			return null; // Invalid token, but that's okay for optional auth
		}

		const userInfo = {
			id: user.id,
			email: user.email,
			user_metadata: user.user_metadata || {},
			app_metadata: user.app_metadata || {},
			aud: user.aud,
			created_at: user.created_at,
			updated_at: user.updated_at
		};

		const userClient = createUserClient(token);
		return { user: userInfo, fluxbase: userClient };
	} catch {
		return null; // Any error means no valid auth, but that's okay
	}
}

/**
 * Validate that the authenticated user has admin privileges
 * Throws an error if user is not an admin
 */
export function validateAdminRole(user: AuthenticatedContext['user']): void {
	const role = user.role || (user.app_metadata?.role as string);

	if (role !== 'admin') {
		console.error('❌ [AUTH] Admin access denied for user:', user.id);
		throw new Error('Admin access required');
	}

	console.log(`✅ [AUTH] Admin access granted for user: ${user.id}`);
}

/**
 * Validate that the authenticated user has a specific role
 * Throws an error if user doesn't have the required role
 */
export function validateUserRole(user: AuthenticatedContext['user'], requiredRole: string): void {
	const role = user.role || (user.app_metadata?.role as string);

	if (role !== requiredRole) {
		console.error(`❌ [AUTH] Role '${requiredRole}' required, user has: ${role}`);
		throw new Error(`Role '${requiredRole}' required`);
	}

	console.log(`✅ [AUTH] Role '${requiredRole}' access granted for user: ${user.id}`);
}

/**
 * Simple rate limiting helper (in-memory, not suitable for distributed systems)
 * For production, consider using Redis or similar for distributed rate limiting
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(identifier: string, maxRequests: number, windowMs: number): boolean {
	const now = Date.now();
	const key = identifier;
	const record = rateLimitStore.get(key);

	if (!record || now > record.resetTime) {
		// First request or window expired
		rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
		return true;
	}

	if (record.count >= maxRequests) {
		return false; // Rate limit exceeded
	}

	record.count++;
	return true;
}

/**
 * Get client IP address from request headers
 * Note: In production, ensure proper proxy configuration
 */
export function getClientIP(req: FluxbaseRequest): string {
	const forwarded = req.headers['X-Forwarded-For'] || req.headers['x-forwarded-for'];
	const realIP = req.headers['X-Real-IP'] || req.headers['x-real-ip'];
	const cfConnectingIP = req.headers['CF-Connecting-IP'] || req.headers['cf-connecting-ip'];

	return cfConnectingIP || realIP || forwarded?.split(',')[0] || 'unknown';
}

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
	return input
		.replace(/[<>]/g, '') // Remove < and >
		.replace(/javascript:/gi, '') // Remove javascript: protocol
		.replace(/on\w+=/gi, '') // Remove event handlers
		.trim();
}

/**
 * Create a success response (Fluxbase handler format)
 */
export function successResponse<T>(data: T, status = 200): FluxbaseResponse {
	const response: ApiResponse<T> = {
		success: true,
		data
	};

	return {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		body: JSON.stringify(response)
	};
}

/**
 * Create an error response (Fluxbase handler format)
 */
export function errorResponse(message: string, status = 400): FluxbaseResponse {
	const response: ApiResponse = {
		success: false,
		error: message
	};

	return {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		body: JSON.stringify(response)
	};
}

/**
 * Create a message response (Fluxbase handler format)
 */
export function messageResponse(message: string, status = 200): FluxbaseResponse {
	const response: ApiResponse = {
		success: true,
		message
	};

	return {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		body: JSON.stringify(response)
	};
}

/**
 * Handle CORS and common request setup (Fluxbase handler format)
 */
export function setupRequest(req: FluxbaseRequest): FluxbaseResponse | null {
	return handleCors(req);
}

/**
 * Parse JSON body with error handling
 */
export async function parseJsonBody<T>(req: FluxbaseRequest): Promise<T> {
	try {
		return JSON.parse(req.body);
	} catch {
		throw new Error('Invalid JSON body');
	}
}

/**
 * Get query parameters from URL
 */
export function getQueryParams(url: string): URLSearchParams {
	return new URL(url).searchParams;
}

/**
 * Extract path parameters from URL
 */
export function getPathParams(url: string, pattern: string): Record<string, string> {
	const urlObj = new URL(url);
	const pathParts = urlObj.pathname.split('/').filter(Boolean);
	const patternParts = pattern.split('/').filter(Boolean);

	const params: Record<string, string> = {};

	for (let i = 0; i < patternParts.length; i++) {
		if (patternParts[i].startsWith('[') && patternParts[i].endsWith(']')) {
			const paramName = patternParts[i].slice(1, -1);
			params[paramName] = pathParts[i] || '';
		}
	}

	return params;
}

/**
 * Validate required fields in an object
 */
export function validateRequiredFields(obj: Record<string, unknown>, fields: string[]): string[] {
	const missing: string[] = [];

	for (const field of fields) {
		if (!obj || obj[field] === undefined || obj[field] === null || obj[field] === '') {
			missing.push(field);
		}
	}

	return missing;
}

/**
 * Log error with context
 */
export function logError(error: unknown, context: string): void {
	console.error(`❌ [${context}] Error:`, error);
}

/**
 * Log info with context
 */
export function logInfo(message: string, context: string, data?: unknown): void {
	console.log(`ℹ️ [${context}] ${message}`, data || '');
}

/**
 * Log success with context
 */
export function logSuccess(message: string, context: string, data?: unknown): void {
	console.log(`✅ [${context}] ${message}`, data || '');
}
