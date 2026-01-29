/**
 * Server-side environment configuration for SvelteKit
 *
 * This module provides validated access to server-only environment variables
 * using SvelteKit's $env/static/private. These values are never exposed to the client.
 *
 * Usage:
 * ```typescript
 * import { validateServerEnvironmentConfig } from '$lib/core/config/server-environment';
 *
 * const config = validateServerEnvironmentConfig();
 * // Use config.fluxbase.url, config.fluxbase.serviceRoleKey, etc.
 * ```
 *
 * @module server-environment
 */

import { z } from 'zod';
import {
	FLUXBASE_SERVICE_ROLE_KEY,
	FLUXBASE_BASE_URL
} from '$env/static/private';
import {
	PUBLIC_FLUXBASE_ANON_KEY
} from '$env/static/public';

/**
 * Schema for server-side environment variables
 */
const serverEnvironmentSchema = z.object({
	fluxbase: z.object({
		/** Internal Fluxbase URL for server-to-server communication */
		url: z.string().url('FLUXBASE_BASE_URL must be a valid URL'),
		/** Service role key for privileged operations */
		serviceRoleKey: z.string().min(1, 'FLUXBASE_SERVICE_ROLE_KEY is required'),
		/** Anonymous key for client-compatible operations */
		anonKey: z.string().min(1, 'PUBLIC_FLUXBASE_ANON_KEY is required')
	})
});

export type ServerEnvironmentConfig = z.infer<typeof serverEnvironmentSchema>;

/**
 * Cached configuration to avoid repeated validation
 */
let cachedConfig: ServerEnvironmentConfig | null = null;

/**
 * Validates and returns the server-side environment configuration.
 *
 * This function reads environment variables from SvelteKit's $env/static/private
 * and validates them against the expected schema using Zod.
 *
 * @param throwOnError - If true (default), throws an error when validation fails.
 *                       If false, logs a warning and returns a config with empty values.
 * @returns The validated server environment configuration
 * @throws {Error} When validation fails and throwOnError is true
 *
 * @example
 * ```typescript
 * // In a server route or load function
 * import { validateServerEnvironmentConfig } from '$lib/core/config/server-environment';
 *
 * export async function load() {
 *   const config = validateServerEnvironmentConfig();
 *   // Use config.fluxbase.serviceRoleKey for privileged database operations
 * }
 * ```
 */
export function validateServerEnvironmentConfig(throwOnError = true): ServerEnvironmentConfig {
	// Return cached config if available
	if (cachedConfig) {
		return cachedConfig;
	}

	const rawConfig = {
		fluxbase: {
			url: FLUXBASE_BASE_URL || '',
			serviceRoleKey: FLUXBASE_SERVICE_ROLE_KEY || '',
			anonKey: PUBLIC_FLUXBASE_ANON_KEY || ''
		}
	};

	const result = serverEnvironmentSchema.safeParse(rawConfig);

	if (!result.success) {
		const errors = result.error.errors
			.map((e) => `  - ${e.path.join('.')}: ${e.message}`)
			.join('\n');

		const errorMessage = `Server environment validation failed:\n${errors}`;

		if (throwOnError) {
			throw new Error(errorMessage);
		}

		console.warn(`⚠️ ${errorMessage}`);
		// Return a config with empty values for graceful degradation
		cachedConfig = rawConfig as ServerEnvironmentConfig;
		return cachedConfig;
	}

	cachedConfig = result.data;
	return cachedConfig;
}

/**
 * Clears the cached configuration.
 * Useful for testing or when environment variables change at runtime.
 */
export function clearServerEnvironmentCache(): void {
	cachedConfig = null;
}

/**
 * Gets a specific Fluxbase configuration value.
 * Convenience function for accessing individual config values.
 *
 * @param key - The configuration key to retrieve
 * @returns The configuration value
 */
export function getFluxbaseConfig<K extends keyof ServerEnvironmentConfig['fluxbase']>(
	key: K
): ServerEnvironmentConfig['fluxbase'][K] {
	const config = validateServerEnvironmentConfig();
	return config.fluxbase[key];
}
