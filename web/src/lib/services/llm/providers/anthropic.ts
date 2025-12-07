/**
 * Anthropic Provider (Claude)
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse } from '../../../types/ai.types';
import { type ILLMProvider, createLLMError, isRetryableStatus, extractBaseConfig } from './base';

export class AnthropicProvider implements ILLMProvider {
	readonly provider: AIProvider = 'anthropic';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		const base = extractBaseConfig(config, 'https://api.anthropic.com/v1');
		this.apiKey = base.apiKey;
		this.model = base.model;
		this.endpoint = base.endpoint;
	}

	isConfigured(): boolean {
		return !!this.apiKey && !!this.model;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		if (!this.isConfigured()) {
			throw createLLMError(this.provider, 'NOT_CONFIGURED', 'Anthropic API key not configured');
		}

		// Convert OpenAI-style messages to Anthropic format
		let systemPrompt = '';
		const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

		for (const msg of request.messages) {
			if (msg.role === 'system') {
				systemPrompt = msg.content;
			} else {
				messages.push({
					role: msg.role as 'user' | 'assistant',
					content: msg.content
				});
			}
		}

		const response = await fetch(`${this.endpoint}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: this.model,
				max_tokens: request.max_tokens || 4096,
				system: systemPrompt || undefined,
				messages,
				temperature: request.temperature,
				stop_sequences: request.stop
			})
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw createLLMError(
				this.provider,
				error.error?.type || `HTTP_${response.status}`,
				error.error?.message || `Anthropic API error: ${response.status}`,
				isRetryableStatus(response.status)
			);
		}

		const data = await response.json();
		return {
			content: data.content[0]?.text || '',
			model: data.model,
			provider: this.provider,
			usage: {
				prompt_tokens: data.usage?.input_tokens || 0,
				completion_tokens: data.usage?.output_tokens || 0,
				total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
			},
			finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason
		};
	}
}
