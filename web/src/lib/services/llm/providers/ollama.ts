/**
 * Ollama Provider (self-hosted)
 */

import type { AIProvider, MergedAIConfig, LLMRequest, LLMResponse } from '../../../types/ai.types';
import { type ILLMProvider, createLLMError, isRetryableStatus, extractBaseConfig } from './base';

export class OllamaProvider implements ILLMProvider {
	readonly provider: AIProvider = 'ollama';
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		const base = extractBaseConfig(config, 'http://localhost:11434');
		this.model = base.model;
		this.endpoint = base.endpoint;
	}

	isConfigured(): boolean {
		return !!this.model && !!this.endpoint;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		if (!this.isConfigured()) {
			throw createLLMError(this.provider, 'NOT_CONFIGURED', 'Ollama endpoint not configured');
		}

		const response = await fetch(`${this.endpoint}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: this.model,
				messages: request.messages,
				stream: false,
				options: {
					temperature: request.temperature,
					num_predict: request.max_tokens,
					stop: request.stop
				}
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw createLLMError(
				this.provider,
				`HTTP_${response.status}`,
				`Ollama API error: ${error || response.status}`,
				isRetryableStatus(response.status)
			);
		}

		const data = await response.json();
		return {
			content: data.message?.content || '',
			model: data.model,
			provider: this.provider,
			usage: {
				prompt_tokens: data.prompt_eval_count || 0,
				completion_tokens: data.eval_count || 0,
				total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
			},
			finish_reason: data.done ? 'stop' : undefined
		};
	}
}
