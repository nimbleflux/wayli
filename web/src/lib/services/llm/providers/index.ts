/**
 * LLM Providers - Index
 *
 * Exports all LLM providers and the factory function.
 */

export { type ILLMProvider, createLLMError, isRetryableStatus } from './base';
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';
export { OllamaProvider } from './ollama';
export { OpenRouterProvider } from './openrouter';
export { AzureOpenAIProvider } from './azure';
export { CustomProvider } from './custom';

import type { MergedAIConfig } from '../../../types/ai.types';
import type { ILLMProvider } from './base';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OpenRouterProvider } from './openrouter';
import { AzureOpenAIProvider } from './azure';
import { CustomProvider } from './custom';

/**
 * Factory function to create the appropriate provider
 */
export function createLLMProvider(config: MergedAIConfig): ILLMProvider {
	switch (config.provider) {
		case 'openai':
			return new OpenAIProvider(config);
		case 'anthropic':
			return new AnthropicProvider(config);
		case 'ollama':
			return new OllamaProvider(config);
		case 'openrouter':
			return new OpenRouterProvider(config);
		case 'azure':
			return new AzureOpenAIProvider(config);
		case 'custom':
			return new CustomProvider(config);
		default:
			throw new Error(`Unknown provider: ${config.provider}`);
	}
}
