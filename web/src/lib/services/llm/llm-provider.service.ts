/**
 * LLM Provider Service
 *
 * Provides a unified interface for interacting with various LLM providers:
 * - OpenAI (GPT-4, GPT-3.5, etc.)
 * - Anthropic (Claude)
 * - Ollama (self-hosted)
 * - OpenRouter (multiple providers)
 * - Azure OpenAI
 * - Custom endpoints
 *
 * Includes retry logic with exponential backoff for transient failures.
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse, ChatMessage } from '../../types/ai.types';
import { type ILLMProvider, createLLMProvider, createLLMError } from './providers';
import { withRetry, type RetryConfig } from './retry';

// Re-export types and utilities for convenience
export type { ILLMProvider } from './providers';
export { createLLMProvider, createLLMError } from './providers';

// Re-export individual providers for direct use if needed
export {
	OpenAIProvider,
	AnthropicProvider,
	OllamaProvider,
	OpenRouterProvider,
	AzureOpenAIProvider,
	CustomProvider
} from './providers';

/**
 * LLM Service class that manages configuration, provider selection, and retries
 */
export class LLMService {
	private config: MergedAIConfig;
	private provider: ILLMProvider;
	private retryConfig: Partial<RetryConfig>;

	constructor(config: MergedAIConfig, retryConfig?: Partial<RetryConfig>) {
		this.config = config;
		this.provider = createLLMProvider(config);
		this.retryConfig = retryConfig || {};
	}

	/**
	 * Send a chat completion request with automatic retry
	 */
	async chat(messages: ChatMessage[], options?: Partial<LLMRequest>): Promise<LLMResponse> {
		if (!this.config.enabled) {
			throw createLLMError(this.config.provider, 'DISABLED', 'AI is disabled');
		}

		const request: LLMRequest = {
			messages,
			max_tokens: options?.max_tokens ?? this.config.max_tokens,
			temperature: options?.temperature ?? this.config.temperature,
			stop: options?.stop,
			stream: false
		};

		// Use retry wrapper for resilience
		return withRetry(() => this.provider.chat(request), this.retryConfig);
	}

	/**
	 * Send a chat completion request without retry
	 */
	async chatOnce(messages: ChatMessage[], options?: Partial<LLMRequest>): Promise<LLMResponse> {
		if (!this.config.enabled) {
			throw createLLMError(this.config.provider, 'DISABLED', 'AI is disabled');
		}

		const request: LLMRequest = {
			messages,
			max_tokens: options?.max_tokens ?? this.config.max_tokens,
			temperature: options?.temperature ?? this.config.temperature,
			stop: options?.stop,
			stream: false
		};

		return this.provider.chat(request);
	}

	/**
	 * Check if the service is properly configured
	 */
	isConfigured(): boolean {
		return this.provider.isConfigured();
	}

	/**
	 * Get the current provider type
	 */
	getProvider(): AIProvider {
		return this.config.provider;
	}

	/**
	 * Get the current model
	 */
	getModel(): string {
		return this.config.model;
	}

	/**
	 * Update configuration and recreate provider
	 */
	updateConfig(config: MergedAIConfig): void {
		this.config = config;
		this.provider = createLLMProvider(config);
	}

	/**
	 * Update retry configuration
	 */
	updateRetryConfig(retryConfig: Partial<RetryConfig>): void {
		this.retryConfig = { ...this.retryConfig, ...retryConfig };
	}
}

/**
 * Create an LLM service instance with default retry configuration
 */
export function createLLMService(
	config: MergedAIConfig,
	retryConfig?: Partial<RetryConfig>
): LLMService {
	return new LLMService(config, retryConfig);
}
