/**
 * Base LLM Provider interface and utilities
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse, LLMError } from '../../../types/ai.types';

/**
 * Base interface for LLM providers
 */
export interface ILLMProvider {
	readonly provider: AIProvider;
	chat(request: LLMRequest): Promise<LLMResponse>;
	isConfigured(): boolean;
}

/**
 * Create a standardized LLM error object
 */
export function createLLMError(
	provider: AIProvider,
	code: string,
	message: string,
	retryable: boolean = false
): LLMError {
	return { provider, code, message, retryable };
}

/**
 * Check if a response status indicates a retryable error
 */
export function isRetryableStatus(status: number): boolean {
	return status >= 500 || status === 429 || status === 408;
}

/**
 * Base configuration for all providers
 */
export interface BaseProviderConfig {
	apiKey: string;
	model: string;
	endpoint: string;
}

/**
 * Extract common config from MergedAIConfig
 */
export function extractBaseConfig(config: MergedAIConfig, defaultEndpoint: string): BaseProviderConfig {
	return {
		apiKey: config.api_key || '',
		model: config.model,
		endpoint: config.api_endpoint || defaultEndpoint
	};
}
