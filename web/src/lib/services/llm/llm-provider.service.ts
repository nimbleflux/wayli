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
 */

import type {
	AIProvider,
	MergedAIConfig,
	LLMRequest,
	LLMResponse,
	LLMError,
	ChatMessage
} from '../../types/ai.types';

/**
 * Base interface for LLM providers
 */
export interface ILLMProvider {
	readonly provider: AIProvider;
	chat(request: LLMRequest): Promise<LLMResponse>;
	isConfigured(): boolean;
}

/**
 * OpenAI Provider
 */
export class OpenAIProvider implements ILLMProvider {
	readonly provider: AIProvider = 'openai';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		this.apiKey = config.api_key || '';
		this.model = config.model;
		this.endpoint = config.api_endpoint || 'https://api.openai.com/v1';
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
				error.error?.code || 'API_ERROR',
				error.error?.message || `OpenAI API error: ${response.status}`,
				response.status >= 500 || response.status === 429
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

/**
 * Anthropic Provider (Claude)
 */
export class AnthropicProvider implements ILLMProvider {
	readonly provider: AIProvider = 'anthropic';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		this.apiKey = config.api_key || '';
		this.model = config.model;
		this.endpoint = config.api_endpoint || 'https://api.anthropic.com/v1';
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
				error.error?.type || 'API_ERROR',
				error.error?.message || `Anthropic API error: ${response.status}`,
				response.status >= 500 || response.status === 429
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

/**
 * Ollama Provider (self-hosted)
 */
export class OllamaProvider implements ILLMProvider {
	readonly provider: AIProvider = 'ollama';
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		this.model = config.model;
		this.endpoint = config.api_endpoint || 'http://localhost:11434';
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
				'API_ERROR',
				`Ollama API error: ${error || response.status}`,
				response.status >= 500
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

/**
 * OpenRouter Provider (multiple providers behind one API)
 */
export class OpenRouterProvider implements ILLMProvider {
	readonly provider: AIProvider = 'openrouter';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		this.apiKey = config.api_key || '';
		this.model = config.model;
		this.endpoint = config.api_endpoint || 'https://openrouter.ai/api/v1';
	}

	isConfigured(): boolean {
		return !!this.apiKey && !!this.model;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		if (!this.isConfigured()) {
			throw createLLMError(this.provider, 'NOT_CONFIGURED', 'OpenRouter API key not configured');
		}

		const response = await fetch(`${this.endpoint}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
				'HTTP-Referer': 'https://wayli.app',
				'X-Title': 'Wayli'
			},
			body: JSON.stringify({
				model: this.model,
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
				error.error?.code || 'API_ERROR',
				error.error?.message || `OpenRouter API error: ${response.status}`,
				response.status >= 500 || response.status === 429
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

/**
 * Azure OpenAI Provider
 */
export class AzureOpenAIProvider implements ILLMProvider {
	readonly provider: AIProvider = 'azure';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		this.apiKey = config.api_key || '';
		this.model = config.model;
		this.endpoint = config.api_endpoint || '';
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
				error.error?.code || 'API_ERROR',
				error.error?.message || `Azure OpenAI API error: ${response.status}`,
				response.status >= 500 || response.status === 429
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

/**
 * Custom Provider (OpenAI-compatible API)
 */
export class CustomProvider implements ILLMProvider {
	readonly provider: AIProvider = 'custom';
	private apiKey: string;
	private model: string;
	private endpoint: string;

	constructor(config: MergedAIConfig) {
		this.apiKey = config.api_key || '';
		this.model = config.model;
		this.endpoint = config.api_endpoint || '';
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
				error.error?.code || 'API_ERROR',
				error.error?.message || `Custom API error: ${response.status}`,
				response.status >= 500
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

/**
 * Create an LLM error object
 */
function createLLMError(
	provider: AIProvider,
	code: string,
	message: string,
	retryable: boolean = false
): LLMError {
	return { provider, code, message, retryable };
}

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

/**
 * LLM Service class that manages configuration and provider selection
 */
export class LLMService {
	private config: MergedAIConfig;
	private provider: ILLMProvider;

	constructor(config: MergedAIConfig) {
		this.config = config;
		this.provider = createLLMProvider(config);
	}

	/**
	 * Send a chat completion request
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
}
