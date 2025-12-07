/**
 * Azure OpenAI Provider
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse } from '../../../types/ai.types';
import { type ILLMProvider, createLLMError, isRetryableStatus, extractBaseConfig } from './base';

export class AzureOpenAIProvider implements ILLMProvider {
	readonly provider: AIProvider = 'azure';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		const base = extractBaseConfig(config, '');
		this.apiKey = base.apiKey;
		this.model = base.model;
		this.endpoint = base.endpoint;
	}

	isConfigured(): boolean {
		return !!this.apiKey && !!this.model && !!this.endpoint;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		if (!this.isConfigured()) {
			throw createLLMError(
				this.provider,
				'NOT_CONFIGURED',
				'Azure OpenAI endpoint and API key not configured'
			);
		}

		// Azure uses deployment name in URL
		const url = `${this.endpoint}/openai/deployments/${this.model}/chat/completions?api-version=2024-02-15-preview`;

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'api-key': this.apiKey
			},
			body: JSON.stringify({
				messages: request.messages,
				max_tokens: request.max_tokens,
				temperature: request.temperature,
				stop: request.stop
			})
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw createLLMError(
				this.provider,
				error.error?.code || `HTTP_${response.status}`,
				error.error?.message || `Azure OpenAI API error: ${response.status}`,
				isRetryableStatus(response.status)
			);
		}

		const data = await response.json();
		return {
			content: data.choices[0]?.message?.content || '',
			model: data.model || this.model,
			provider: this.provider,
			usage: data.usage,
			finish_reason: data.choices[0]?.finish_reason
		};
	}
}
