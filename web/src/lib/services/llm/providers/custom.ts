/**
 * Custom Provider (OpenAI-compatible API)
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse } from '../../../types/ai.types';
import { type ILLMProvider, createLLMError, isRetryableStatus, extractBaseConfig } from './base';

export class CustomProvider implements ILLMProvider {
	readonly provider: AIProvider = 'custom';
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
		return !!this.model && !!this.endpoint;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		if (!this.isConfigured()) {
			throw createLLMError(this.provider, 'NOT_CONFIGURED', 'Custom endpoint not configured');
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (this.apiKey) {
			headers['Authorization'] = `Bearer ${this.apiKey}`;
		}

		const response = await fetch(`${this.endpoint}/chat/completions`, {
			method: 'POST',
			headers,
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
				error.error?.message || `Custom API error: ${response.status}`,
				isRetryableStatus(response.status)
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || data.message?.content || '',
			model: data.model || this.model,
			provider: this.provider,
			usage: data.usage,
			finish_reason: data.choices?.[0]?.finish_reason
		};
	}
}
