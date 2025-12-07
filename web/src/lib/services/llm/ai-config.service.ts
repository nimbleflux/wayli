/**
 * AI Configuration Service
 *
 * Manages AI/LLM configuration with:
 * - Server-level defaults (from ai_config table)
 * - User-level overrides (from user_preferences.ai_config)
 *
 * Configuration hierarchy:
 * 1. User settings override server settings
 * 2. Server settings provide defaults
 * 3. Fallback to hardcoded defaults if neither exists
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	AIConfig,
	UserAIConfig,
	MergedAIConfig,
	AIProvider
} from '../../types/ai.types';

/**
 * Default configuration when nothing is set
 */
const FALLBACK_CONFIG: MergedAIConfig = {
	provider: 'openai',
	model: 'gpt-4o-mini',
	max_tokens: 4096,
	temperature: 0.7,
	enabled: false // Disabled by default until configured
};

/**
 * AI Configuration Service
 */
export class AIConfigService {
	private supabase: SupabaseClient;
	private cache: Map<string, { config: AIConfig; expiry: number }> = new Map();
	private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

	constructor(supabase: SupabaseClient) {
		this.supabase = supabase;
	}

	/**
	 * Get merged AI configuration for a user
	 * Combines server defaults with user overrides
	 */
	async getMergedConfig(
		userId: string,
		configName: string = 'default'
	): Promise<MergedAIConfig> {
		// Get server config
		const serverConfig = await this.getServerConfig(configName);

		// Get user config
		const userConfig = await this.getUserConfig(userId);

		// Merge configurations
		return this.mergeConfigs(serverConfig, userConfig);
	}

	/**
	 * Get server-level AI configuration
	 */
	async getServerConfig(name: string = 'default'): Promise<AIConfig | null> {
		// Check cache first
		const cached = this.cache.get(name);
		if (cached && cached.expiry > Date.now()) {
			return cached.config;
		}

		try {
			const { data, error } = await this.supabase
				.from('ai_config')
				.select('*')
				.eq('name', name)
				.eq('enabled', true)
				.single();

			if (error) {
				console.error(`Failed to fetch AI config '${name}':`, error);
				return null;
			}

			if (data) {
				// Cache the result
				this.cache.set(name, {
					config: data as AIConfig,
					expiry: Date.now() + this.CACHE_TTL
				});
			}

			return data as AIConfig | null;
		} catch (error) {
			console.error('Error fetching server AI config:', error);
			return null;
		}
	}

	/**
	 * Get user-level AI configuration override
	 */
	async getUserConfig(userId: string): Promise<UserAIConfig | null> {
		try {
			const { data, error } = await this.supabase
				.from('user_preferences')
				.select('ai_config')
				.eq('id', userId)
				.single();

			if (error) {
				console.error('Failed to fetch user AI config:', error);
				return null;
			}

			return (data?.ai_config as UserAIConfig) || null;
		} catch (error) {
			console.error('Error fetching user AI config:', error);
			return null;
		}
	}

	/**
	 * Update user AI configuration
	 */
	async updateUserConfig(userId: string, config: UserAIConfig): Promise<boolean> {
		try {
			const { error } = await this.supabase
				.from('user_preferences')
				.update({
					ai_config: config,
					updated_at: new Date().toISOString()
				})
				.eq('id', userId);

			if (error) {
				console.error('Failed to update user AI config:', error);
				return false;
			}

			return true;
		} catch (error) {
			console.error('Error updating user AI config:', error);
			return false;
		}
	}

	/**
	 * Clear user AI configuration (revert to server defaults)
	 */
	async clearUserConfig(userId: string): Promise<boolean> {
		return this.updateUserConfig(userId, {});
	}

	/**
	 * Get all available server configurations
	 */
	async getAvailableConfigs(): Promise<AIConfig[]> {
		try {
			const { data, error } = await this.supabase
				.from('ai_config')
				.select('*')
				.eq('enabled', true)
				.order('name');

			if (error) {
				console.error('Failed to fetch available AI configs:', error);
				return [];
			}

			return (data as AIConfig[]) || [];
		} catch (error) {
			console.error('Error fetching available AI configs:', error);
			return [];
		}
	}

	/**
	 * Merge server and user configurations
	 */
	private mergeConfigs(
		serverConfig: AIConfig | null,
		userConfig: UserAIConfig | null
	): MergedAIConfig {
		// Start with fallback
		const merged: MergedAIConfig = { ...FALLBACK_CONFIG };

		// Apply server config if available
		if (serverConfig) {
			merged.provider = serverConfig.provider;
			merged.model = serverConfig.model;
			merged.api_endpoint = serverConfig.api_endpoint;
			merged.max_tokens = serverConfig.max_tokens ?? FALLBACK_CONFIG.max_tokens;
			merged.temperature = serverConfig.temperature ?? FALLBACK_CONFIG.temperature;
			merged.enabled = serverConfig.enabled;
			merged.config = serverConfig.config;

			// Extract system prompt from config if present
			if (serverConfig.config?.system_prompt) {
				merged.system_prompt = serverConfig.config.system_prompt as string;
			}

			// Note: Server API key is encrypted and should be decrypted
			// This is a placeholder - actual decryption would happen server-side
			// merged.api_key = decryptApiKey(serverConfig.api_key_encrypted);
		}

		// Apply user overrides
		if (userConfig) {
			if (userConfig.provider) merged.provider = userConfig.provider;
			if (userConfig.model) merged.model = userConfig.model;
			if (userConfig.api_key) merged.api_key = userConfig.api_key;
			if (userConfig.api_endpoint) merged.api_endpoint = userConfig.api_endpoint;
			if (userConfig.max_tokens !== undefined) merged.max_tokens = userConfig.max_tokens;
			if (userConfig.temperature !== undefined) merged.temperature = userConfig.temperature;
			if (userConfig.enabled !== undefined) merged.enabled = userConfig.enabled;
		}

		return merged;
	}

	/**
	 * Validate an AI configuration
	 */
	validateConfig(config: Partial<MergedAIConfig>): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		if (config.provider && !['openai', 'anthropic', 'ollama', 'openrouter', 'azure', 'custom'].includes(config.provider)) {
			errors.push(`Invalid provider: ${config.provider}`);
		}

		if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
			errors.push('Temperature must be between 0 and 2');
		}

		if (config.max_tokens !== undefined && (config.max_tokens < 1 || config.max_tokens > 128000)) {
			errors.push('Max tokens must be between 1 and 128000');
		}

		// Provider-specific validation
		if (config.provider === 'ollama' && !config.api_endpoint) {
			errors.push('Ollama requires an API endpoint');
		}

		if (config.provider === 'azure' && !config.api_endpoint) {
			errors.push('Azure OpenAI requires an API endpoint');
		}

		if (config.provider && config.provider !== 'ollama' && !config.api_key) {
			// Most providers need an API key (except Ollama which is self-hosted)
			// This is a warning, not an error, as server config might provide the key
		}

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Clear the configuration cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Check if AI is available (configured and enabled)
	 */
	async isAIAvailable(userId: string, configName: string = 'default'): Promise<boolean> {
		const config = await this.getMergedConfig(userId, configName);
		return config.enabled && (!!config.api_key || config.provider === 'ollama');
	}
}

/**
 * Create an AI config service instance
 */
export function createAIConfigService(supabase: SupabaseClient): AIConfigService {
	return new AIConfigService(supabase);
}

/**
 * Get available AI providers with their descriptions
 */
export function getAIProviderOptions(): Array<{
	value: AIProvider;
	label: string;
	description: string;
	requiresApiKey: boolean;
	requiresEndpoint: boolean;
}> {
	return [
		{
			value: 'openai',
			label: 'OpenAI',
			description: 'GPT-4, GPT-4o, GPT-3.5 models',
			requiresApiKey: true,
			requiresEndpoint: false
		},
		{
			value: 'anthropic',
			label: 'Anthropic',
			description: 'Claude 3, Claude 3.5 models',
			requiresApiKey: true,
			requiresEndpoint: false
		},
		{
			value: 'ollama',
			label: 'Ollama',
			description: 'Self-hosted local models (Llama, Mistral, etc.)',
			requiresApiKey: false,
			requiresEndpoint: true
		},
		{
			value: 'openrouter',
			label: 'OpenRouter',
			description: 'Access multiple providers with one API',
			requiresApiKey: true,
			requiresEndpoint: false
		},
		{
			value: 'azure',
			label: 'Azure OpenAI',
			description: 'Microsoft Azure-hosted OpenAI models',
			requiresApiKey: true,
			requiresEndpoint: true
		},
		{
			value: 'custom',
			label: 'Custom',
			description: 'OpenAI-compatible custom endpoint',
			requiresApiKey: false,
			requiresEndpoint: true
		}
	];
}

/**
 * Get suggested models for each provider
 */
export function getSuggestedModels(provider: AIProvider): string[] {
	switch (provider) {
		case 'openai':
			return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
		case 'anthropic':
			return ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];
		case 'ollama':
			return ['llama3.1', 'llama3.1:70b', 'mistral', 'mixtral', 'codellama', 'phi3'];
		case 'openrouter':
			return [
				'openai/gpt-4o',
				'anthropic/claude-3.5-sonnet',
				'meta-llama/llama-3.1-405b-instruct',
				'google/gemini-pro-1.5'
			];
		case 'azure':
			return ['gpt-4o', 'gpt-4', 'gpt-35-turbo'];
		case 'custom':
			return [];
		default:
			return [];
	}
}
