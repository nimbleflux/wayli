/**
 * Worker environment configuration for Node.js processes
 *
 * This module provides validated access to environment variables for
 * background workers and standalone Node.js processes using process.env.
 *
 * Unlike server-environment.ts which uses SvelteKit's $env/static/private,
 * this module is designed for use in Node.js workers that run outside
 * the SvelteKit context.
 *
 * Usage:
 * ```typescript
 * import { validateWorkerEnvironmentConfig } from '$lib/core/config/worker-environment';
 *
 * const config = validateWorkerEnvironmentConfig();
 * // Use config.fluxbase.url, config.worker.pollInterval, etc.
 * ```
 *
 * @module worker-environment
 */

import { z } from 'zod';

/**
 * Schema for worker environment variables
 */
const workerEnvironmentSchema = z.object({
	fluxbase: z.object({
		/** Internal Fluxbase URL for server-to-server communication */
		url: z.string().url('FLUXBASE_BASE_URL must be a valid URL'),
		/** Public Fluxbase URL for client-compatible operations */
		publicUrl: z.string().url('FLUXBASE_PUBLIC_BASE_URL must be a valid URL'),
		/** Service role key for privileged operations */
		serviceRoleKey: z.string().min(1, 'FLUXBASE_SERVICE_ROLE_KEY is required'),
		/** Anonymous key for client-compatible operations */
		anonKey: z.string().min(1, 'FLUXBASE_ANON_KEY is required')
	}),
	worker: z.object({
		/** Polling interval in milliseconds for job queue */
		pollInterval: z.number().int().positive().default(5000),
		/** Maximum job execution timeout in milliseconds */
		jobTimeout: z.number().int().positive().default(300000),
		/** Number of retry attempts for failed jobs */
		retryAttempts: z.number().int().nonnegative().default(3),
		/** Delay between retries in milliseconds */
		retryDelay: z.number().int().positive().default(1000)
	}),
	app: z.object({
		/** Node environment: development, production, or test */
		nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
		/** Application mode: web or worker */
		mode: z.enum(['web', 'worker', 'workers']).default('worker'),
		/** Server port */
		port: z.number().int().positive().default(4000)
	})
});

export type WorkerEnvironmentConfig = z.infer<typeof workerEnvironmentSchema>;

/**
 * Cached configuration to avoid repeated validation
 */
let cachedConfig: WorkerEnvironmentConfig | null = null;

/**
 * Parses an integer from environment variable with a default value
 */
function parseEnvInt(value: string | undefined, defaultValue: number): number {
	if (!value) return defaultValue;
	const parsed = parseInt(value, 10);
	return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Validates and returns the worker environment configuration.
 *
 * This function reads environment variables from process.env and validates
 * them against the expected schema using Zod.
 *
 * @param throwOnError - If true (default), throws an error when validation fails.
 *                       If false, logs a warning and returns a config with defaults.
 * @returns The validated worker environment configuration
 * @throws {Error} When validation fails and throwOnError is true
 *
 * @example
 * ```typescript
 * // In a worker process
 * import { validateWorkerEnvironmentConfig } from '$lib/core/config/worker-environment';
 *
 * const config = validateWorkerEnvironmentConfig();
 * console.log(`Polling every ${config.worker.pollInterval}ms`);
 * ```
 */
export function validateWorkerEnvironmentConfig(throwOnError = true): WorkerEnvironmentConfig {
	// Return cached config if available
	if (cachedConfig) {
		return cachedConfig;
	}

	// Use FLUXBASE_BASE_URL if available, otherwise fall back to FLUXBASE_PUBLIC_BASE_URL
	const fluxbaseUrl =
		process.env.FLUXBASE_BASE_URL || process.env.FLUXBASE_PUBLIC_BASE_URL || '';
	const fluxbasePublicUrl =
		process.env.FLUXBASE_PUBLIC_BASE_URL || process.env.FLUXBASE_BASE_URL || '';

	const rawConfig = {
		fluxbase: {
			url: fluxbaseUrl,
			publicUrl: fluxbasePublicUrl,
			serviceRoleKey: process.env.FLUXBASE_SERVICE_ROLE_KEY || '',
			anonKey: process.env.FLUXBASE_ANON_KEY || process.env.PUBLIC_FLUXBASE_ANON_KEY || ''
		},
		worker: {
			pollInterval: parseEnvInt(process.env.WORKER_POLL_INTERVAL, 5000),
			jobTimeout: parseEnvInt(process.env.JOB_TIMEOUT, 300000),
			retryAttempts: parseEnvInt(process.env.RETRY_ATTEMPTS, 3),
			retryDelay: parseEnvInt(process.env.RETRY_DELAY, 1000)
		},
		app: {
			nodeEnv: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
			mode: (process.env.APP_MODE || 'worker') as 'web' | 'worker' | 'workers',
			port: parseEnvInt(process.env.PORT, 4000)
		}
	};

	const result = workerEnvironmentSchema.safeParse(rawConfig);

	if (!result.success) {
		const errors = result.error.errors
			.map((e) => `  - ${e.path.join('.')}: ${e.message}`)
			.join('\n');

		const errorMessage = `Worker environment validation failed:\n${errors}`;

		if (throwOnError) {
			throw new Error(errorMessage);
		}

		console.warn(`⚠️ ${errorMessage}`);
		// Return raw config for graceful degradation (defaults will be applied)
		cachedConfig = rawConfig as WorkerEnvironmentConfig;
		return cachedConfig;
	}

	cachedConfig = result.data;
	return cachedConfig;
}

/**
 * Clears the cached configuration.
 * Useful for testing or when environment variables change at runtime.
 */
export function clearWorkerEnvironmentCache(): void {
	cachedConfig = null;
}

/**
 * Gets a specific Fluxbase configuration value.
 * Convenience function for accessing individual config values.
 *
 * @param key - The configuration key to retrieve
 * @returns The configuration value
 */
export function getFluxbaseConfig<K extends keyof WorkerEnvironmentConfig['fluxbase']>(
	key: K
): WorkerEnvironmentConfig['fluxbase'][K] {
	const config = validateWorkerEnvironmentConfig();
	return config.fluxbase[key];
}

/**
 * Gets a specific worker configuration value.
 * Convenience function for accessing individual worker config values.
 *
 * @param key - The configuration key to retrieve
 * @returns The configuration value
 */
export function getWorkerConfig<K extends keyof WorkerEnvironmentConfig['worker']>(
	key: K
): WorkerEnvironmentConfig['worker'][K] {
	const config = validateWorkerEnvironmentConfig();
	return config.worker[key];
}
