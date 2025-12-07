/**
 * OpenAI Provider
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse } from '../../../types/ai.types';
import { type ILLMProvider, createLLMError, isRetryableStatus, extractBaseConfig } from './base';

export class OpenAIProvider implements ILLMProvider {
	readonly provider: AIProvider = 'openai';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		const base = extractBaseConfig(config, 'https://api.openai.com/v1');
		this.apiKey = base.apiKey;
		this.model = base.model;
		this.endpoint = base.endpoint;
	}

	isConfigured(): boolean {
		return !!this.apiKey && !!this.model;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		if (!this.isConfigured()) {
			throw createLLMError(this.provider, 'NOT_CONFIGURED', 'OpenAI API key not configured');
		}

		const response = await fetch(`${this.endpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({
				model: this.model,
				messages: request.messages,
				max_tokens: request.max_tokens,
				temperature: request.temperature,
				stop: request.stop,
				stream: false
			})
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw createLLMError(
				this.provider,
				error.error?.code || `HTTP_${response.status}`,
				error.error?.message || `OpenAI API error: ${response.status}`,
				isRetryableStatus(response.status)
			);
		}

		const data = await response.json();
		return {
			content: data.choices[0]?.message?.content || '',
			model: data.model,
			provider: this.provider,
			usage: data.usage,
			finish_reason: data.choices[0]?.finish_reason
		};
	}
}
