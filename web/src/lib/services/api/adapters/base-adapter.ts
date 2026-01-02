/**
 * Base adapter with common functionality for all service adapters.
 * Provides shared utilities for authentication and API calls.
 * @module adapters/base-adapter
 */

import type { AuthSession } from '@fluxbase/sdk';

/**
 * Configuration options for initializing a base adapter.
 */
export interface BaseAdapterConfig {
	/** The authenticated session from Fluxbase SDK */
	session: AuthSession;
}

/**
 * Abstract base class for all service adapters.
 * Provides common functionality for API calls and authentication checks.
 *
 * @abstract
 * @example
 * ```typescript
 * class MyAdapter extends BaseAdapter {
 *   async myMethod() {
 *     const user = await this.getAuthenticatedUser();
 *     return this.callApi('my-endpoint', { method: 'POST', body: { userId: user.id } });
 *   }
 * }
 * ```
 */
export abstract class BaseAdapter {
	/** The authenticated session for API calls */
	protected session: AuthSession;

	/**
	 * Creates a new adapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		this.session = config.session;
	}

	/**
	 * Calls a Fluxbase edge function with the given parameters.
	 * Handles endpoint name conversion and response unwrapping.
	 *
	 * @template T - The expected return type of the API call
	 * @param endpoint - The edge function endpoint (slash-separated names are converted to hyphens)
	 * @param options - Request options including method, body, and query parameters
	 * @returns Promise resolving to the API response data
	 * @throws Error if the edge function call fails
	 *
	 * @example
	 * ```typescript
	 * const result = await this.callApi<UserData>('users/profile', {
	 *   method: 'GET',
	 *   params: { include: 'preferences' }
	 * });
	 * ```
	 */
	protected async callApi<T = unknown>(
		endpoint: string,
		options: {
			method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
			body?: unknown;
			params?: Record<string, string>;
		} = {}
	): Promise<T> {
		const { method = 'GET', body, params } = options;

		// Convert slash-separated endpoints to hyphen-separated for Edge Functions
		const edgeFunctionName = endpoint.replace(/\//g, '-');

		// Build URL with query parameters if provided
		let url = edgeFunctionName;
		if (params && Object.keys(params).length > 0) {
			const queryString = new URLSearchParams(params).toString();
			url = `${edgeFunctionName}?${queryString}`;
		}

		// Get Fluxbase client
		const { fluxbase } = await import('$lib/fluxbase');

		// Invoke the edge function
		const { data, error } = await fluxbase.functions.invoke(url, {
			method,
			...(body && { body })
		});

		if (error) {
			throw new Error(error.message || 'Edge function call failed');
		}

		// Unwrap nested data structure
		if (data && typeof data === 'object' && 'data' in data) {
			return (data as { data: T }).data;
		}

		return data as T;
	}

	/**
	 * Retrieves the currently authenticated user.
	 * This is a helper method that all adapters can use to verify authentication
	 * before performing user-specific operations.
	 *
	 * @returns Promise resolving to the authenticated user object
	 * @throws Error if the user is not authenticated
	 *
	 * @example
	 * ```typescript
	 * const user = await this.getAuthenticatedUser();
	 * console.log(`Authenticated as: ${user.email}`);
	 * ```
	 */
	protected async getAuthenticatedUser() {
		const { fluxbase } = await import('$lib/fluxbase');
		const { data: userData } = await fluxbase.auth.getUser();

		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		return userData.user;
	}

	/**
	 * Check if AI features are enabled (accessible to all authenticated users).
	 * Uses the Fluxbase settings API to read the public setting.
	 * Returns true only if AI is enabled AND a provider is configured.
	 *
	 * @returns Promise resolving to true if AI is enabled, false otherwise
	 */
	protected async isAIEnabled(): Promise<boolean> {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const aiEnabled = await fluxbase.admin.settings.app.getSetting('app.ai.enabled');
			if (!aiEnabled) {
				return false;
			}

			// Also check if a provider is configured
			const { data: providers } = await fluxbase.admin.ai.listProviders();
			return !!(providers && providers.length > 0);
		} catch {
			// Default to false if setting doesn't exist or isn't accessible
			return false;
		}
	}
}
