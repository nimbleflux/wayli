// src/lib/core/config/worker-environment.ts
// Worker environment configuration using process.env
// This file is specifically for Node.js workers and uses process.env instead of SvelteKit imports
// Never import this in client-side or SvelteKit server code.

export interface WorkerEnvironmentConfig {
	fluxbase: {
		url: string;
		serviceRoleKey: string;
	};
	nominatim: {
		endpoint: string;
		rateLimit: number;
	};
}

// Default fallback values for development
const DEFAULT_FLUXBASE_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_SERVICE_ROLE_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * Get the appropriate Fluxbase URL for workers
 * In production, workers should prefer internal URLs if available
 */
function getWorkerFluxbaseUrl(): string {
	// Check for worker-specific internal URL first (for production)
	const internalUrl = process.env.WORKER_FLUXBASE_BASE_URL || process.env.INTERNAL_FLUXBASE_BASE_URL;
	if (internalUrl) {
		console.log('🔗 Using internal Fluxbase URL for worker:', internalUrl);
		return internalUrl;
	}

	// Fall back to public URL
	const publicUrl = process.env.PUBLIC_FLUXBASE_BASE_URL || DEFAULT_FLUXBASE_BASE_URL;
	console.log('🔗 Using public Fluxbase URL for worker:', publicUrl);
	return publicUrl;
}

/**
 * Validate and return the worker environment config.
 * Throws in strict mode if required variables are missing.
 * @param strict - If true, throw on missing/invalid config
 * @returns {WorkerEnvironmentConfig}
 */
export function validateWorkerEnvironmentConfig(strict: boolean = false): WorkerEnvironmentConfig {
	// Add debugging information
	if (process.env.NODE_ENV === 'development') {
		console.log('[WorkerEnvironment] Validating configuration...', {
			strict,
			isServer: typeof window === 'undefined',
			hasPublicUrl: !!process.env.PUBLIC_FLUXBASE_BASE_URL,
			hasInternalUrl: !!process.env.WORKER_FLUXBASE_BASE_URL || !!process.env.INTERNAL_FLUXBASE_BASE_URL,
			hasServiceKey: !!process.env.FLUXBASE_SERVICE_ROLE_KEY
		});
	}

	const errors: string[] = [];

	// Get the appropriate Fluxbase URL for workers
	const fluxbaseUrl = getWorkerFluxbaseUrl();
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY || DEFAULT_SERVICE_ROLE_KEY;

	// Validate environment variables
	if (!fluxbaseUrl) {
		errors.push(
			'No valid Fluxbase URL found (checked WORKER_FLUXBASE_BASE_URL, INTERNAL_FLUXBASE_BASE_URL, PUBLIC_FLUXBASE_BASE_URL)'
		);
	} else if (!fluxbaseUrl.startsWith('http')) {
		errors.push('Fluxbase URL must be a valid URL starting with http:// or https://');
	}

	if (!serviceRoleKey) {
		errors.push('FLUXBASE_SERVICE_ROLE_KEY is not defined');
	} else if (serviceRoleKey.length < 20 && strict) {
		errors.push('FLUXBASE_SERVICE_ROLE_KEY appears to be invalid (too short)');
	}

	// Report all errors
	if (errors.length > 0) {
		console.error('Worker environment configuration errors:');
		errors.forEach((error) => console.error(`- ${error}`));

		if (strict) {
			throw new Error(`Worker environment configuration errors: ${errors.join(', ')}`);
		} else {
			console.warn(
				'⚠️  Worker environment configuration has issues. Some features may not work correctly.'
			);
		}
	}

	const config = {
		fluxbase: {
			url: fluxbaseUrl,
			serviceRoleKey: serviceRoleKey
		},
		nominatim: {
			endpoint: process.env.NOMINATIM_ENDPOINT || 'https://nominatim.wayli.app',
			rateLimit: parseInt(process.env.NOMINATIM_RATE_LIMIT || '100', 10) || 100
		}
	};

	if (process.env.NODE_ENV === 'development') {
		const hasInternalUrl = !!(process.env.WORKER_FLUXBASE_BASE_URL || process.env.INTERNAL_FLUXBASE_BASE_URL);
		console.log('[WorkerEnvironment] Configuration validated successfully:', {
			url: config.fluxbase.url,
			urlType: hasInternalUrl ? 'internal' : 'public',
			serviceKeyLength: config.fluxbase.serviceRoleKey.length
		});
	}

	return config;
}

// Export a singleton instance with non-strict validation for development
export const workerEnv = validateWorkerEnvironmentConfig(false);

// Helper function
export function getWorkerFluxbaseConfig() {
	return workerEnv.fluxbase;
}

// Helper function for strict validation when needed
export function getWorkerFluxbaseConfigStrict() {
	return validateWorkerEnvironmentConfig(true).fluxbase;
}

// Helper function to get Nominatim configuration for workers
export function getWorkerNominatimConfig() {
	return workerEnv.nominatim;
}
