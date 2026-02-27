// Admin operations adapter

import type { AdminSettingsResponse } from '$lib/types/settings.types';
import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

export class AdminAdapter extends BaseAdapter {
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Check if AI features are enabled
	 */
	async isAIEnabled(): Promise<boolean> {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const aiEnabled = await fluxbase.admin.settings.app.getSetting('app.ai.enabled');
			if (!aiEnabled) {
				return false;
			}

			const { data: providers } = await fluxbase.admin.ai.listProviders();
			return providers && providers.length > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Get all settings
	 */
	async getAllSettings(): Promise<AdminSettingsResponse> {
		const { fluxbase } = await import('$lib/fluxbase');

		const appSettings = await fluxbase.admin.settings.app.get();

		const customSettings = await fluxbase.admin.settings.app.listSettings();
		const wayliSettings = (customSettings || [])
			.filter((s: { key: string }) => s.key.startsWith('wayli.'))
			.reduce(
				(acc: Record<string, unknown>, s: { key: string; value: unknown }) => ({
					...acc,
					[s.key]: s.value
				}),
				{}
			);

		let providers: Array<{ is_default?: boolean; enabled?: boolean }> = [];
		let defaultProvider: { is_default?: boolean } | undefined;
		try {
			const { data: providerList } = await fluxbase.admin.ai.listProviders();
			if (providerList) {
				providers = providerList;
				defaultProvider = providers.find((p) => p.is_default);
			}
		} catch {
			// AI providers not configured yet
		}

		let aiEnabled = false;
		let allowUserOverride = false;
		try {
			const enableAISetting = await fluxbase.admin.settings.system.get('app.ai.enabled');
			aiEnabled = Boolean((enableAISetting?.value as { value?: boolean })?.value ?? false);

			const userOverrideSetting = await fluxbase.admin.settings.system.get(
				'app.ai.allow_user_provider_override'
			);
			allowUserOverride = Boolean((userOverrideSetting?.value as { value?: boolean })?.value ?? false);
		} catch {
			// Settings don't exist yet
		}

		if (!aiEnabled && providers.some((p) => p.enabled)) {
			aiEnabled = true;
		}

		const emailSettings = await fluxbase.admin.settings.email.get();

		const appSettingsWithAll = {
			...appSettings,
			email: emailSettings,
			ai: {
				enabled: aiEnabled,
				allow_user_provider_override: allowUserOverride,
				default_provider: defaultProvider,
				providers: providers
			}
		};

		let secretsMetadata: Record<string, unknown> = {};
		try {
			const pexelsSecretMeta = await fluxbase.admin.settings.app.getSecretSetting('pexels_api_key');
			if (pexelsSecretMeta) {
				secretsMetadata.pexels_api_key = pexelsSecretMeta;
			}
		} catch {
			// Secret doesn't exist yet
		}

		return {
			app: appSettingsWithAll,
			custom: wayliSettings,
			secrets: secretsMetadata
		};
	}

	/**
	 * Update app setting
	 */
	async updateAppSetting(action: string, params?: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');
		const settings = fluxbase.admin.settings.app;

		switch (action) {
			case 'updateEmailSettings':
				return await fluxbase.admin.settings.email.update(params as Parameters<typeof fluxbase.admin.settings.email.update>[0]);
			case 'enableSignup':
				return await settings.enableSignup();
			case 'disableSignup':
				return await settings.disableSignup();
			case 'setEmailVerificationRequired':
				return await settings.setEmailVerificationRequired((params as { required: boolean }).required);
			case 'setPasswordMinLength':
				return await settings.setPasswordMinLength((params as { length: number }).length);
			case 'setPasswordComplexity':
				return await settings.setPasswordComplexity(params as Parameters<typeof settings.setPasswordComplexity>[0]);
			case 'setSessionSettings':
				return await settings.setSessionSettings(
					(params as { timeoutMinutes: number }).timeoutMinutes,
					(params as { maxSessionsPerUser: number }).maxSessionsPerUser
				);
			case 'setFeature':
				return await settings.setFeature(
					(params as { feature: string }).feature,
					(params as { enabled: boolean }).enabled
				);
			case 'setRateLimiting':
				return await settings.setRateLimiting((params as { enabled: boolean }).enabled);
			case 'setAIConfig':
				return await this.updateAIConfig(params as Parameters<typeof this.updateAIConfig>[0]);
			default:
				throw new Error(`Unknown action: ${action}`);
		}
	}

	/**
	 * Update AI configuration
	 */
	async updateAIConfig(params: {
		enabled: boolean;
		allow_user_provider_override?: boolean;
		provider?: {
			name: string;
			display_name: string;
			provider_type: string;
			is_default?: boolean;
			config: {
				api_key?: string;
				model?: string;
				api_endpoint?: string;
				max_tokens?: number;
				temperature?: number;
			};
		};
	}) {
		const { fluxbase } = await import('$lib/fluxbase');

		await fluxbase.admin.settings.app.setSetting('app.ai.enabled', params.enabled, {
			description: 'Enable or disable AI chatbot functionality',
			value_type: 'boolean'
		});

		if (params.allow_user_provider_override !== undefined) {
			await fluxbase.admin.settings.app.setSetting(
				'app.ai.allow_user_provider_override',
				params.allow_user_provider_override,
				{
					description: 'Allow users to configure their own AI provider',
					value_type: 'boolean'
				}
			);
		}

		if (params.provider) {
			const { data: existingProviders } = await fluxbase.admin.ai.listProviders();
			const existing = existingProviders?.find((p: { name: string }) => p.name === params.provider!.name);

			if (existing) {
				await fluxbase.admin.ai.updateProvider((existing as { id: string }).id, {
					display_name: params.provider.display_name,
					provider_type: params.provider.provider_type,
					is_default: params.provider.is_default ?? false,
					config: params.provider.config
				});
			} else {
				await fluxbase.admin.ai.createProvider({
					name: params.provider.name,
					display_name: params.provider.display_name,
					provider_type: params.provider.provider_type,
					is_default: params.provider.is_default ?? true,
					config: params.provider.config,
					enabled: true
				});
			}
		}

		// Trigger table export via edge function after AI provider configuration
		// This is fire-and-forget - errors won't fail the AI config save
		try {
			const { fluxbase } = await import('$lib/fluxbase');
			fluxbase.functions.invoke('export-kb-tables', {}).catch((err) => {
				console.warn('[AdminAdapter] Failed to trigger table export:', err);
				// Don't fail the AI config save
			});
		} catch (err) {
			console.warn('[AdminAdapter] Failed to trigger table export:', err);
		}

		return { updated: true };
	}

	/**
	 * Update custom Wayli setting
	 */
	async updateCustomSetting(key: string, value: unknown, description?: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		if (!key.startsWith('wayli.')) {
			throw new Error('Custom setting keys must start with "wayli."');
		}

		await fluxbase.admin.settings.app.setSetting(key, value, {
			description: description || `Wayli setting: ${key}`,
			is_public: false,
			is_secret: key.includes('api_key') || key.includes('secret'),
			value_type: typeof value === 'object' ? 'json' : (typeof value as 'string' | 'number' | 'boolean')
		});

		return { updated: key };
	}

	/**
	 * Get admin workers
	 */
	async getAdminWorkers() {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: profile } = await fluxbase
			.from('user_profiles')
			.select('role')
			.eq('id', userData.user.id)
			.single();

		if (profile?.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}

		const { data: workers, error } = await fluxbase
			.from('workers')
			.select('*')
			.order('created_at', { ascending: false });

		if (error) {
			throw new Error(error.message || 'Failed to fetch workers');
		}

		return workers || [];
	}

	/**
	 * Manage workers
	 */
	async manageWorkers(action: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: profile } = await fluxbase
			.from('user_profiles')
			.select('role')
			.eq('id', userData.user.id)
			.single();

		if (profile?.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}

		const actionType = action.action as string;

		switch (actionType) {
			case 'create': {
				const { data: newWorker, error } = await fluxbase
					.from('workers')
					.insert({
						name: action.name,
						type: action.type || 'general',
						status: 'active',
						metadata: action.metadata || {}
					})
					.select()
					.single();

				if (error) {
					throw new Error(error.message || 'Failed to create worker');
				}

				return newWorker;
			}

			case 'update': {
				const { data: updatedWorker, error } = await fluxbase
					.from('workers')
					.update({
						name: action.name,
						type: action.type,
						status: action.status,
						metadata: action.metadata,
						updated_at: new Date().toISOString()
					})
					.eq('id', action.id)
					.select()
					.single();

				if (error) {
					throw new Error(error.message || 'Failed to update worker');
				}

				return updatedWorker;
			}

			case 'delete': {
				const { error } = await fluxbase.from('workers').delete().eq('id', action.id);

				if (error) {
					throw new Error(error.message || 'Failed to delete worker');
				}

				return { message: 'Worker deleted successfully' };
			}

			default:
				throw new Error(`Unknown action: ${actionType}`);
		}
	}

	/**
	 * Get admin users
	 */
	async getAdminUsers(options?: { page?: number; limit?: number }) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: profile } = await fluxbase
			.from('user_profiles')
			.select('role')
			.eq('id', userData.user.id)
			.single();

		if (profile?.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}

		const page = options?.page || 1;
		const limit = options?.limit || 50;
		const offset = (page - 1) * limit;

		const { data: users, error } = await fluxbase
			.from('user_profiles')
			.select('*')
			.order('created_at', { ascending: false })
			.range(offset, offset + limit - 1);

		if (error) {
			throw new Error(error.message || 'Failed to fetch users');
		}

		const { count } = await fluxbase.from('user_profiles').select('*', { count: 'exact', head: true });

		return {
			users: users || [],
			total: count || 0,
			page,
			limit
		};
	}

	/**
	 * Set system secret
	 */
	async setSystemSecret(key: string, value: string, description?: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		await fluxbase.admin.settings.app.setSecretSetting(key, value, {
			description: description || `System secret: ${key}`
		});

		return { updated: key };
	}

	/**
	 * Get system secret metadata
	 */
	async getSystemSecretMetadata(key: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const metadata = await fluxbase.admin.settings.app.getSecretSetting(key);
			return metadata || null;
		} catch {
			return null;
		}
	}

	/**
	 * List system secrets
	 */
	async listSystemSecrets() {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const secrets = await fluxbase.admin.settings.app.listSecretSettings();
			return secrets || [];
		} catch {
			return [];
		}
	}

	/**
	 * Delete system secret
	 */
	async deleteSystemSecret(key: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		await fluxbase.admin.settings.app.deleteSecretSetting(key);
		return { deleted: key };
	}
}
