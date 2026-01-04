<script lang="ts">
	import {
		Settings,
		User as UserIcon,
		UserPlus,
		Server,
		Search,
		Edit,
		Trash2,
		ChevronLeft,
		ChevronRight,
		ChevronDown,
		X,
		Mail,
		Lock,
		Bot,
		Database,
		RefreshCw,
		ArrowRight,
		RotateCcw
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import RoleSelector from '$lib/components/RoleSelector.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import UserEditModal from '$lib/components/UserEditModal.svelte';
	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';
	import { trackRPCExecution } from '$lib/stores/job-store';
	import { fluxbase } from '$lib/fluxbase';

	import type { UserProfile } from '$lib/types/user.types';
	import type { AdminSettingsResponse } from '$lib/types/settings.types';

	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	// Use the reactive translation function
	let t = $derived($translate);

	// Initialize users from client-side data
	let users = $state<UserProfile[]>([]);
	let searchQuery = $state('');
	let debouncedSearchQuery = $state('');
	let currentPage = $state(1);
	let itemsPerPage = $state(10);

	// Initialize server settings
	let serverName = $state('');
	let serverPexelsApiKey = $state('');
	let pexelsApiKeyConfigured = $state(false);
	let pexelsApiKeyUpdatedAt = $state<string | null>(null);
	let pexelsRateLimitEnabled = $state(true); // Toggle for enabling rate limit
	let pexelsRateLimit = $state(200); // Default: 200 requests/hour
	let peliasEndpoint = $state('https://pelias.wayli.app');
	let showAddUserModal = $state(false);
	let isModalOpen = $state(false);
	let selectedUser = $state<UserProfile | null>(null);
	let showDeleteConfirm = $state(false);
	let userToDelete = $state<UserProfile | null>(null);
	let searchTimeout: ReturnType<typeof setTimeout>;
	let activeTab = $state('settings'); // Add tab state - default to settings tab

	// Authentication Settings
	let enableSignup = $state(false);
	let requireEmailVerification = $state(false);
	let authReadOnly = $state(false);

	// Email Settings
	let emailProvider = $state('smtp');
	let smtpHost = $state('');
	let smtpPort = $state(587);
	let smtpUsername = $state('');
	let smtpPassword = $state('');
	let smtpUseTls = $state(true);
	let smtpFromAddress = $state('');
	let smtpFromName = $state('Wayli');
	// Per-field read-only status based on overrides
	let emailProviderReadOnly = $state(false);
	let emailSmtpReadOnly = $state(false);
	// Derived: true if configuration fields have overrides (for banner display)
	let hasEmailConfigOverrides = $derived(emailProviderReadOnly || emailSmtpReadOnly);

	// OAuth Settings
	interface OAuthProvider {
		id: string;
		provider_name: string;
		display_name: string;
		enabled: boolean;
		client_id: string;
		redirect_url: string;
		scopes: string[];
		is_custom: boolean;
		authorization_url?: string;
		token_url?: string;
		user_info_url?: string;
	}
	let oauthProviders = $state<OAuthProvider[]>([]);
	let isLoadingOAuth = $state(false);
	let isSavingOAuth = $state(false);
	// Form state for adding/editing providers
	let oauthFormProvider = $state('google');
	let oauthFormDisplayName = $state('');
	let oauthFormClientId = $state('');
	let oauthFormClientSecret = $state('');
	let oauthFormEnabled = $state(true);
	let oauthEditingId = $state<string | null>(null);
	let showOAuthForm = $state(false);
	// Custom OAuth provider fields
	let oauthFormCustomName = $state('');
	let oauthFormDiscoveryUrl = $state('');
	let oauthFormAuthorizationUrl = $state('');
	let oauthFormTokenUrl = $state('');
	let oauthFormUserInfoUrl = $state('');
	let oauthFormScopes = $state('openid email profile');
	let isDiscoveringOAuth = $state(false);
	let disablePasswordLogin = $state(false);

	// Feature Toggles
	let enableRealtime = $state(true);
	let enableStorage = $state(true);
	let enableFunctions = $state(true);

	// Security
	let enableRateLimiting = $state(false);

	// Database Maintenance
	let isRefreshingPlaceVisits = $state(false);
	let isSyncingPoiEmbeddings = $state(false);
	let isSyncingTripEmbeddings = $state(false);
	let isReverseGeocodingAllUsers = $state(false);
	let isForceRegeocoding = $state(false);
	let isFillingCountryCodes = $state(false);
	let showForceRegeocodeConfirm = $state(false);
	// Clear and rebuild place visits
	let showClearPlaceVisitsConfirm = $state(false);
	let isClearingPlaceVisits = $state(false);
	let showClearUserPlaceVisitsConfirm = $state(false);
	let userToClearPlaceVisits = $state<UserProfile | null>(null);
	let isClearingUserPlaceVisits = $state(false);

	// AI Settings - provider-based model
	let aiEnabled = $state(false);
	let aiAllowUserOverride = $state(false);
	let providerName = $state('wayli-default');
	let providerDisplayName = $state('OpenAI (Production)');
	let providerType = $state('openai');
	let providerModel = $state('gpt-4.1-mini-2025-04-14');
	let providerApiKey = $state('');
	let providerApiEndpoint = $state('');
	let providerMaxTokens = $state(4096);
	let providerTemperature = $state(0.7);
	let providerIsDefault = $state(true);
	let providerReadOnly = $state(false);

	// Handle Escape key for modals
	$effect(() => {
		if (showAddUserModal || isModalOpen || showDeleteConfirm || showClearPlaceVisitsConfirm || showClearUserPlaceVisitsConfirm) {
			const handleKeydown = (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					if (showAddUserModal) {
						handleCloseAddUserModal();
					} else if (isModalOpen) {
						handleCloseModal();
					} else if (showDeleteConfirm) {
						showDeleteConfirm = false;
					} else if (showClearPlaceVisitsConfirm) {
						showClearPlaceVisitsConfirm = false;
					} else if (showClearUserPlaceVisitsConfirm) {
						cancelClearUserPlaceVisits();
					}
				}
			};

			window.addEventListener('keydown', handleKeydown);

			return () => {
				window.removeEventListener('keydown', handleKeydown);
			};
		}
	});

	// Initialize pagination data
	let pagination = $state({
		page: 1,
		limit: 10,
		total: 0,
		totalPages: 0,
		hasNext: false,
		hasPrev: false
	});

	// Fetch initial data on mount
	onMount(async () => {
		// Debug: Show current user info
		const session = $sessionStore;
		if (session?.user) {
			console.log('🔍 [DEBUG] Current user ID:', session.user.id);
			console.log('🔍 [DEBUG] Current user email:', session.user.email);
			console.log('🔍 [DEBUG] Current user metadata:', session.user.user_metadata);
		}

		await fetchFilteredUsers();
	});

	// Debounced search update - only trigger when user changes the input
	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(async () => {
			if (searchQuery !== debouncedSearchQuery) {
				console.log('Client - Search query changed:', searchQuery);
				debouncedSearchQuery = searchQuery;
				currentPage = 1; // Reset to first page when search changes
				await fetchFilteredUsers();
			}
		}, 300);
	}

	async function fetchFilteredUsers() {
		if (!browser) return;

		const params = new SvelteURLSearchParams();
		if (debouncedSearchQuery) params.set('search', debouncedSearchQuery);
		if (currentPage > 1) params.set('page', currentPage.toString());
		if (itemsPerPage !== 10) params.set('limit', itemsPerPage.toString());

		try {
			const session = $sessionStore;
			if (!session) return;

			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.getAdminUsers({
				page: currentPage,
				limit: itemsPerPage
			})) as any;

			// Edge Functions return { success: true, data: ... }
			const responseData = result.data || result;
			users = responseData.users || [];
			pagination = responseData.pagination || {
				page: 1,
				limit: 10,
				total: 0,
				totalPages: 0,
				hasNext: false,
				hasPrev: false
			};

			// Admin check handled by layout - isAdmin initialized to true
		} catch (error: any) {
			console.error('Error fetching filtered users:', error);
			const errorMessage = error?.message || error?.error || 'Failed to fetch users';
			toast.error('Failed to fetch users', { description: errorMessage });
		}
	}

	async function goToPage(page: number) {
		if (!browser) return;
		if (page >= 1 && page <= pagination.totalPages) {
			currentPage = page;
			await fetchFilteredUsers();
		}
	}

	async function goToPreviousPage() {
		if (!browser) return;
		if (pagination.hasPrev) {
			currentPage--;
			await fetchFilteredUsers();
		}
	}

	async function goToNextPage() {
		if (!browser) return;
		if (pagination.hasNext) {
			currentPage++;
			await fetchFilteredUsers();
		}
	}

	async function handleItemsPerPageChange() {
		if (!browser) return;
		currentPage = 1; // Reset to first page when changing items per page
		await fetchFilteredUsers();
	}

	function formatDate(dateString: string | null) {
		if (!dateString) return 'Never';
		return new Date(dateString).toLocaleDateString();
	}

	function getUserDisplayName(user: UserProfile) {
		return (
			user.full_name ||
			`${user.first_name || ''} ${user.last_name || ''}`.trim() ||
			user.email?.split('@')[0] ||
			'Unknown User'
		);
	}

	async function saveWayliSettings() {
		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });

			await serviceAdapter.updateCustomSetting(
				'wayli.server_name',
				serverName,
				'Wayli server name for branding'
			);

			// Save Pexels rate limit (0 = unlimited)
			const rateLimitValue = pexelsRateLimitEnabled ? pexelsRateLimit : 0;
			await serviceAdapter.updateCustomSetting(
				'wayli.pexels_rate_limit',
				rateLimitValue,
				'Pexels API rate limit (requests per hour, 0 = unlimited)'
			);

			// Save Pelias endpoint
			await serviceAdapter.updateCustomSetting(
				'wayli.pelias_endpoint',
				peliasEndpoint,
				'Pelias geocoding service endpoint URL'
			);

			// Use encrypted secret storage for Pexels API key
			if (serverPexelsApiKey) {
				await serviceAdapter.setSystemSecret(
					'pexels_api_key',
					serverPexelsApiKey,
					'Server-level Pexels API key for trip image suggestions'
				);
				pexelsApiKeyConfigured = true;
				pexelsApiKeyUpdatedAt = new Date().toISOString();
				serverPexelsApiKey = ''; // Clear input after save
			}

			toast.success(t('serverAdmin.wayliSettingsSaved'));
		} catch (error: any) {
			console.error('❌ Failed to save Wayli settings:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	async function clearPexelsApiKey() {
		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });
			await serviceAdapter.deleteSystemSecret('pexels_api_key');
			pexelsApiKeyConfigured = false;
			pexelsApiKeyUpdatedAt = null;
			toast.success(t('serverAdmin.pexelsKeyCleared'));
		} catch (error: any) {
			console.error('❌ Failed to clear Pexels API key:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	async function saveAuthSettings() {
		try {
			// Update all auth settings via the auth settings API in one call
			await fluxbase.admin.oauth.authSettings.update({
				enable_signup: enableSignup,
				require_email_verification: requireEmailVerification,
				disable_app_password_login: disablePasswordLogin
			});

			toast.success(t('serverAdmin.authSettingsSaved'));
		} catch (error: any) {
			console.error('❌ Failed to save auth settings:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	async function saveEmailSettings() {
		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });

			// Update all email settings in a single call using the new SDK method
			await serviceAdapter.updateAppSetting('updateEmailSettings', {
				provider: emailProvider as 'smtp',
				from_address: smtpFromAddress,
				from_name: smtpFromName,
				smtp_host: smtpHost,
				smtp_port: smtpPort,
				smtp_username: smtpUsername,
				// Only send password if user entered one (it's not returned from get)
				...(smtpPassword && { smtp_password: smtpPassword }),
				smtp_tls: smtpUseTls
			});

			toast.success(t('serverAdmin.emailSettingsSaved'));
		} catch (error: any) {
			console.error('Failed to save email settings:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	// OAuth Functions
	async function loadOAuthProviders() {
		isLoadingOAuth = true;
		try {
			const providers = await fluxbase.admin.oauth.providers.listProviders();
			oauthProviders = providers || [];
		} catch (error: any) {
			console.error('Failed to load OAuth providers:', error);
			// Don't show error toast - OAuth might not be configured yet
		} finally {
			isLoadingOAuth = false;
		}
	}

	async function saveOAuthProvider() {
		if (!oauthFormClientId || !oauthFormClientSecret) {
			toast.error(t('serverAdmin.oauthClientIdSecretRequired'));
			return;
		}

		const isCustomProvider = oauthFormProvider === 'custom';

		// Validate custom provider fields
		if (isCustomProvider) {
			if (!oauthFormCustomName) {
				toast.error(t('serverAdmin.oauthCustomNameRequired'));
				return;
			}
			if (!oauthFormAuthorizationUrl || !oauthFormTokenUrl || !oauthFormUserInfoUrl) {
				toast.error(t('serverAdmin.oauthEndpointsRequired'));
				return;
			}
		}

		isSavingOAuth = true;
		try {
			const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
			const redirectUrl = `${baseUrl}/auth/callback`;

			// Get scopes - use custom scopes for custom provider, defaults otherwise
			const scopes = isCustomProvider
				? oauthFormScopes.split(/[\s,]+/).filter(Boolean)
				: getDefaultScopes(oauthFormProvider);

			const providerName = isCustomProvider ? oauthFormCustomName : oauthFormProvider;
			const displayName = oauthFormDisplayName || (isCustomProvider ? oauthFormCustomName : getDefaultDisplayName(oauthFormProvider));

			if (oauthEditingId) {
				// Update existing provider
				const updatePayload: Record<string, unknown> = {
					display_name: displayName,
					client_id: oauthFormClientId,
					client_secret: oauthFormClientSecret,
					redirect_url: redirectUrl,
					scopes,
					enabled: oauthFormEnabled
				};

				// Include custom provider fields if editing a custom provider
				if (isCustomProvider) {
					updatePayload.authorization_url = oauthFormAuthorizationUrl;
					updatePayload.token_url = oauthFormTokenUrl;
					updatePayload.user_info_url = oauthFormUserInfoUrl;
				}

				await fluxbase.admin.oauth.providers.updateProvider(oauthEditingId, updatePayload);
				toast.success(t('serverAdmin.oauthProviderUpdated'));
			} else {
				// Create new provider
				const createPayload = {
					provider_name: providerName,
					display_name: displayName,
					client_id: oauthFormClientId,
					client_secret: oauthFormClientSecret,
					redirect_url: redirectUrl,
					scopes,
					enabled: oauthFormEnabled,
					is_custom: isCustomProvider,
					...(isCustomProvider && {
						authorization_url: oauthFormAuthorizationUrl,
						token_url: oauthFormTokenUrl,
						user_info_url: oauthFormUserInfoUrl
					})
				};

				await fluxbase.admin.oauth.providers.createProvider(createPayload);
				toast.success(t('serverAdmin.oauthProviderAdded'));
			}

			// Reset form and reload
			resetOAuthForm();
			await loadOAuthProviders();
		} catch (error: any) {
			console.error('Failed to save OAuth provider:', error);
			toast.error(t('serverAdmin.oauthProviderSaveFailed'), {
				description: error?.message
			});
		} finally {
			isSavingOAuth = false;
		}
	}

	async function deleteOAuthProvider(providerId: string) {
		try {
			await fluxbase.admin.oauth.providers.deleteProvider(providerId);
			toast.success(t('serverAdmin.oauthProviderDeleted'));
			await loadOAuthProviders();
		} catch (error: any) {
			console.error('Failed to delete OAuth provider:', error);
			toast.error(t('serverAdmin.oauthProviderDeleteFailed'), {
				description: error?.message
			});
		}
	}

	async function toggleOAuthProvider(providerId: string, enabled: boolean) {
		try {
			if (enabled) {
				await fluxbase.admin.oauth.providers.enableProvider(providerId);
			} else {
				await fluxbase.admin.oauth.providers.disableProvider(providerId);
			}
			await loadOAuthProviders();
		} catch (error: any) {
			console.error('Failed to toggle OAuth provider:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	function editOAuthProvider(provider: OAuthProvider) {
		oauthEditingId = provider.id;
		oauthFormDisplayName = provider.display_name;
		oauthFormClientId = provider.client_id;
		oauthFormClientSecret = ''; // Never pre-fill secrets
		oauthFormEnabled = provider.enabled;

		// Handle custom providers
		if (provider.is_custom) {
			oauthFormProvider = 'custom';
			oauthFormCustomName = provider.provider_name;
			oauthFormAuthorizationUrl = provider.authorization_url || '';
			oauthFormTokenUrl = provider.token_url || '';
			oauthFormUserInfoUrl = provider.user_info_url || '';
			oauthFormScopes = provider.scopes?.join(' ') || 'openid email profile';
		} else {
			oauthFormProvider = provider.provider_name;
			// Reset custom fields
			oauthFormCustomName = '';
			oauthFormAuthorizationUrl = '';
			oauthFormTokenUrl = '';
			oauthFormUserInfoUrl = '';
			oauthFormScopes = 'openid email profile';
		}

		showOAuthForm = true;
	}

	function resetOAuthForm() {
		oauthEditingId = null;
		oauthFormProvider = 'google';
		oauthFormDisplayName = '';
		oauthFormClientId = '';
		oauthFormClientSecret = '';
		oauthFormEnabled = true;
		// Reset custom provider fields
		oauthFormCustomName = '';
		oauthFormDiscoveryUrl = '';
		oauthFormAuthorizationUrl = '';
		oauthFormTokenUrl = '';
		oauthFormUserInfoUrl = '';
		oauthFormScopes = 'openid email profile';
		showOAuthForm = false;
	}

	function getDefaultDisplayName(provider: string): string {
		const names: Record<string, string> = {
			google: 'Google',
			github: 'GitHub',
			gitlab: 'GitLab',
			discord: 'Discord',
			azure: 'Microsoft',
			bitbucket: 'Bitbucket'
		};
		return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
	}

	function getDefaultScopes(provider: string): string[] {
		const scopes: Record<string, string[]> = {
			google: ['openid', 'email', 'profile'],
			github: ['user:email', 'read:user'],
			gitlab: ['openid', 'email', 'profile'],
			discord: ['identify', 'email'],
			azure: ['openid', 'email', 'profile'],
			bitbucket: ['account', 'email']
		};
		return scopes[provider] || ['openid', 'email', 'profile'];
	}

	async function discoverOAuthEndpoints() {
		if (!oauthFormDiscoveryUrl) {
			toast.error(t('serverAdmin.oauthDiscoveryUrlRequired'));
			return;
		}

		isDiscoveringOAuth = true;
		try {
			// Ensure the URL ends with the well-known path
			const discoveryUrl = oauthFormDiscoveryUrl.endsWith('/.well-known/openid-configuration')
				? oauthFormDiscoveryUrl
				: `${oauthFormDiscoveryUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;

			const response = await fetch(discoveryUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch discovery document: ${response.status}`);
			}

			const config = await response.json();

			// Auto-fill the endpoint fields
			if (config.authorization_endpoint) {
				oauthFormAuthorizationUrl = config.authorization_endpoint;
			}
			if (config.token_endpoint) {
				oauthFormTokenUrl = config.token_endpoint;
			}
			if (config.userinfo_endpoint) {
				oauthFormUserInfoUrl = config.userinfo_endpoint;
			}
			if (config.scopes_supported && Array.isArray(config.scopes_supported)) {
				// Filter to common scopes if available
				const commonScopes = ['openid', 'email', 'profile'];
				const supportedCommon = commonScopes.filter((s) => config.scopes_supported.includes(s));
				if (supportedCommon.length > 0) {
					oauthFormScopes = supportedCommon.join(' ');
				}
			}

			toast.success(t('serverAdmin.oauthDiscoverySuccess'));
		} catch (error: any) {
			console.error('Failed to discover OAuth endpoints:', error);
			toast.error(t('serverAdmin.oauthDiscoveryFailed'), {
				description: error?.message
			});
		} finally {
			isDiscoveringOAuth = false;
		}
	}

	async function saveAISettings() {
		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });

			await serviceAdapter.updateAppSetting('setAIConfig', {
				enabled: aiEnabled,
				allow_user_provider_override: aiAllowUserOverride,
				provider: aiEnabled
					? {
							name: providerName,
							display_name: providerDisplayName,
							provider_type: providerType,
							is_default: providerIsDefault,
							config: {
								api_key: providerApiKey || undefined,
								model: providerModel,
								api_endpoint: providerApiEndpoint || undefined,
								max_tokens: providerMaxTokens,
								temperature: providerTemperature
							}
						}
					: undefined
			});

			toast.success(t('serverAdmin.aiSettingsSaved'));

			// Reload settings to get updated provider list
			await loadAllSettings();

			// Dispatch event to notify components that AI configuration changed
			window.dispatchEvent(new CustomEvent('ai-config-changed'));
		} catch (error: any) {
			console.error('❌ Failed to save AI settings:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	async function refreshPlaceVisits() {
		if (isRefreshingPlaceVisits) return;

		isRefreshingPlaceVisits = true;
		try {
			// Directly invoke the incremental place visit detection RPC
			const { data, error } = await (fluxbase.rpc as any).invoke(
				'detect-place-visits-incremental',
				{ user_id: null },
				{ namespace: 'wayli', async: true }
			);
			if (error) throw error;

			// Track the RPC execution in the job store for sidebar visibility
			if (data?.execution_id) {
				trackRPCExecution(data.execution_id, 'detect-place-visits-incremental', 'wayli');
			}

			toast.success(t('serverAdmin.refreshPlaceVisitsQueued'));
		} catch (error: any) {
			console.error('Failed to refresh place visits:', error);
			toast.error(t('serverAdmin.refreshPlaceVisitsFailed'), {
				description: error?.message
			});
		} finally {
			isRefreshingPlaceVisits = false;
		}
	}

	async function syncPoiEmbeddingsForAllUsers() {
		if (isSyncingPoiEmbeddings) return;

		// Check if AI is enabled before syncing embeddings
		if (!aiEnabled) {
			toast.error(t('serverAdmin.aiNotEnabled'));
			return;
		}

		isSyncingPoiEmbeddings = true;
		try {
			// First refresh place visits
			const { data: rpcData, error: rpcError } = await (fluxbase.rpc as any).invoke(
				'detect-place-visits-incremental',
				{ user_id: null },
				{ namespace: 'wayli', async: true }
			);
			if (rpcError) throw rpcError;

			// Track the RPC execution in the job store for sidebar visibility
			if (rpcData?.execution_id) {
				trackRPCExecution(rpcData.execution_id, 'detect-place-visits-incremental', 'wayli');
			}

			// Then sync POI embeddings
			const { error } = await fluxbase.jobs.submit(
				'sync-poi-embeddings',
				{},
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.syncPoiEmbeddingsQueued'));
		} catch (error: any) {
			console.error('❌ Failed to sync POI embeddings:', error);
			toast.error(t('serverAdmin.syncPoiEmbeddingsFailed'), {
				description: error?.message
			});
		} finally {
			isSyncingPoiEmbeddings = false;
		}
	}

	async function syncTripEmbeddingsForAllUsers() {
		if (isSyncingTripEmbeddings) return;

		// Check if AI is enabled before syncing embeddings
		if (!aiEnabled) {
			toast.error(t('serverAdmin.aiNotEnabled'));
			return;
		}

		isSyncingTripEmbeddings = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'scheduled-sync-trip-embeddings',
				{},
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.syncTripEmbeddingsQueued'));
		} catch (error: any) {
			console.error('❌ Failed to sync trip embeddings:', error);
			toast.error(t('serverAdmin.syncTripEmbeddingsFailed'), {
				description: error?.message
			});
		} finally {
			isSyncingTripEmbeddings = false;
		}
	}

	async function reverseGeocodeAllUsers() {
		if (isReverseGeocodingAllUsers) return;

		isReverseGeocodingAllUsers = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'reverse-geocoding',
				{ all_users: true },
				{
					namespace: 'wayli',
					priority: 4
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.reverseGeocodeQueued'));
		} catch (error: any) {
			console.error('❌ Failed to queue reverse geocoding:', error);
			toast.error(t('serverAdmin.reverseGeocodeFailed'), {
				description: error?.message
			});
		} finally {
			isReverseGeocodingAllUsers = false;
		}
	}

	function promptForceRegeocode() {
		showForceRegeocodeConfirm = true;
	}

	function cancelForceRegeocode() {
		showForceRegeocodeConfirm = false;
	}

	async function confirmForceRegeocode() {
		showForceRegeocodeConfirm = false;
		if (isForceRegeocoding) return;

		isForceRegeocoding = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'reverse-geocoding',
				{ all_users: true, force: true },
				{
					namespace: 'wayli',
					priority: 3
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.forceRegeocodeQueued'));
		} catch (error: any) {
			console.error('❌ Failed to queue force re-geocoding:', error);
			toast.error(t('serverAdmin.forceRegeocodeFailed'), {
				description: error?.message
			});
		} finally {
			isForceRegeocoding = false;
		}
	}

	async function fillMissingCountryCodes() {
		if (isFillingCountryCodes) return;

		isFillingCountryCodes = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'reverse-geocoding',
				{ all_users: true, fill_country_codes_only: true },
				{
					namespace: 'wayli',
					priority: 4
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.fillCountryCodesQueued'));
		} catch (error: any) {
			console.error('❌ Failed to queue fill country codes:', error);
			toast.error(t('serverAdmin.fillCountryCodesFailed'), {
				description: error?.message
			});
		} finally {
			isFillingCountryCodes = false;
		}
	}

	// Clear and rebuild place visits - all users
	function promptClearPlaceVisits() {
		showClearPlaceVisitsConfirm = true;
	}

	function cancelClearPlaceVisits() {
		showClearPlaceVisitsConfirm = false;
	}

	async function confirmClearPlaceVisits() {
		showClearPlaceVisitsConfirm = false;
		if (isClearingPlaceVisits) return;

		isClearingPlaceVisits = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'clear-and-rebuild-place-visits',
				{},
				{
					namespace: 'wayli',
					priority: 4
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.clearPlaceVisitsQueued'));
		} catch (error: any) {
			console.error('❌ Failed to queue clear and rebuild place visits:', error);
			toast.error(t('serverAdmin.clearPlaceVisitsFailed'), {
				description: error?.message
			});
		} finally {
			isClearingPlaceVisits = false;
		}
	}

	// Clear and rebuild place visits - per user
	function handleClearUserPlaceVisits(user: UserProfile) {
		userToClearPlaceVisits = user;
		showClearUserPlaceVisitsConfirm = true;
	}

	function cancelClearUserPlaceVisits() {
		showClearUserPlaceVisitsConfirm = false;
		userToClearPlaceVisits = null;
	}

	async function confirmClearUserPlaceVisits() {
		if (!userToClearPlaceVisits || isClearingUserPlaceVisits) return;

		const userId = userToClearPlaceVisits.id;
		showClearUserPlaceVisitsConfirm = false;
		isClearingUserPlaceVisits = true;

		try {
			const { error } = await fluxbase.jobs.submit(
				'clear-and-rebuild-place-visits',
				{ user_id: userId },
				{
					namespace: 'wayli',
					priority: 4
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.clearPlaceVisitsQueued'));
		} catch (error: any) {
			console.error('❌ Failed to queue clear and rebuild place visits for user:', error);
			toast.error(t('serverAdmin.clearPlaceVisitsFailed'), {
				description: error?.message
			});
		} finally {
			isClearingUserPlaceVisits = false;
			userToClearPlaceVisits = null;
		}
	}

	function handleEditUser(user: UserProfile) {
		selectedUser = user;
		isModalOpen = true;
	}

	function getPageNumbers() {
		const pages = [];
		const maxVisiblePages = 5;

		if (pagination.totalPages <= maxVisiblePages) {
			// Show all pages if total is small
			for (let i = 1; i <= pagination.totalPages; i++) {
				pages.push(i);
			}
		} else {
			// Show pages around current page
			let start = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
			let end = Math.min(pagination.totalPages, start + maxVisiblePages - 1);

			// Adjust start if we're near the end
			if (end === pagination.totalPages) {
				start = Math.max(1, end - maxVisiblePages + 1);
			}

			for (let i = start; i <= end; i++) {
				pages.push(i);
			}
		}

		return pages;
	}

	function handleDeleteUser(user: UserProfile) {
		userToDelete = user;
		showDeleteConfirm = true;
	}

	function handleCloseModal() {
		isModalOpen = false;
		selectedUser = null;
	}

	function handleCloseDeleteConfirm(e?: MouseEvent) {
		if (e && e.currentTarget !== e.target) return;
		showDeleteConfirm = false;
		userToDelete = null;
	}

	async function handleConfirmDelete() {
		if (!userToDelete) return;

		const formData = new FormData();
		formData.append('userId', userToDelete.id);

		const response = await fetch('?/deleteUser', {
			method: 'POST',
			body: formData
		});

		if (response.ok) {
			users = users.filter((u: UserProfile) => u.id !== userToDelete!.id);
			toast.success('User deleted successfully');
		} else {
			let errorDescription = 'An unknown error occurred while deleting the user.';
			try {
				const result = await response.json();
				errorDescription = result.error || result.message || errorDescription;
			} catch {
				// The response was not JSON, which is fine. The server might have crashed.
			}
			toast.error('Failed to delete user', { description: errorDescription });
		}

		handleCloseDeleteConfirm();
	}

	async function handleSaveUser(event: CustomEvent) {
		const updatedUser = event.detail;

		try {
			const { data, error } = await fluxbase.functions.invoke('admin-users', {
				method: 'POST',
				body: {
					action: 'updateUser',
					userId: updatedUser.id,
					email: updatedUser.email,
					firstName: updatedUser.first_name || '',
					lastName: updatedUser.last_name || '',
					role: updatedUser.role || 'user'
				}
			});

			if (error) {
				throw error;
			}

			if (data?.success) {
				toast.success(t('serverAdmin.userUpdated'));
				handleCloseModal();
				await invalidateAll(); // Refresh the user list
			} else {
				const errorDescription = data?.error || t('serverAdmin.failedToUpdateUser');
				toast.error(t('serverAdmin.failedToUpdateUser'), {
					description: errorDescription
				});
			}
		} catch (error: any) {
			console.error('Error updating user:', error);
			const errorDescription =
				error?.message || error?.error || t('serverAdmin.failedToUpdateUser');
			toast.error(t('serverAdmin.failedToUpdateUser'), {
				description: errorDescription
			});
		}
	}

	async function loadAllSettings() {
		try {
			const session = $sessionStore;
			if (!session) return;

			const serviceAdapter = new ServiceAdapter({ session });
			const result: AdminSettingsResponse = await serviceAdapter.getAllSettings();

			// App settings - result is already typed correctly
			const { app, custom } = result;

			console.log('🔧 [ADMIN] Loaded app settings:', {
				authentication: app.authentication,
				features: app.features,
				security: app.security
			});

			// Authentication - use auth settings API as the source of truth
			try {
				const authSettings = await fluxbase.admin.oauth.authSettings.get();
				console.log('🔧 [ADMIN] Loaded auth settings from API:', authSettings);
				enableSignup = authSettings.enable_signup;
				requireEmailVerification = authSettings.require_email_verification;
				disablePasswordLogin = authSettings.disable_app_password_login ?? false;
				// Check if any auth settings have overrides (read-only)
				authReadOnly = !!(authSettings._overrides && Object.keys(authSettings._overrides).length > 0);
			} catch (authError) {
				console.warn('Could not load auth settings from API, falling back to app settings:', authError);
				// Fallback to app settings
				enableSignup = app.authentication.enable_signup;
				requireEmailVerification = app.authentication.require_email_verification;
				authReadOnly = app.authentication.read_only ?? false;
			}

			// Email - now using flat EmailProviderSettings structure from SDK
			emailProvider = app.email.provider;
			smtpHost = app.email.smtp_host ?? '';
			smtpPort = app.email.smtp_port ?? 587;
			smtpUsername = app.email.smtp_username ?? '';
			smtpUseTls = app.email.smtp_tls ?? true;
			smtpFromAddress = app.email.from_address ?? '';
			smtpFromName = app.email.from_name ?? 'Wayli';
			// Note: SMTP password is not returned for security (smtp_password_set indicates if configured)

			// Per-field read-only status from _overrides
			emailProviderReadOnly = app.email._overrides?.provider?.is_overridden ?? false;
			emailSmtpReadOnly = app.email._overrides?.smtp_host?.is_overridden ?? false;

			// Features
			enableRealtime = app.features.enable_realtime;
			enableStorage = app.features.enable_storage;
			enableFunctions = app.features.enable_functions;

			// Security
			enableRateLimiting = app.security.enable_global_rate_limit;

			// AI Settings - load from provider-based model
			if (app.ai) {
				aiEnabled = app.ai.enabled ?? false;
				aiAllowUserOverride = app.ai.allow_user_provider_override ?? false;

				// Load default provider into form if available
				const defaultProvider = app.ai.default_provider;
				if (defaultProvider) {
					providerName = 'wayli-default'; // Always use fixed provider name
					providerDisplayName = defaultProvider.display_name ?? 'OpenAI (Production)';
					providerType = defaultProvider.provider_type ?? 'openai';
					providerModel = defaultProvider.config?.model ?? 'gpt-4.1-mini-2025-04-14';
					providerApiEndpoint = defaultProvider.config?.api_endpoint ?? '';
					providerMaxTokens = defaultProvider.config?.max_tokens ?? 4096;
					providerTemperature = defaultProvider.config?.temperature ?? 0.7;
					providerIsDefault = defaultProvider.is_default ?? true;
					providerReadOnly = defaultProvider.read_only ?? false;
					// Note: API key is not returned for security reasons
				}
			}

			// Custom Wayli settings
			serverName = custom['wayli.server_name']?.value || '';

			// Note: Auth settings (enableSignup, requireEmailVerification, disablePasswordLogin)
			// are loaded above from fluxbase.admin.oauth.authSettings.get()

			// Load Pexels rate limit (0 = unlimited)
			const loadedRateLimit = custom['wayli.pexels_rate_limit']?.value ?? 200;
			if (loadedRateLimit === 0) {
				pexelsRateLimitEnabled = false;
				pexelsRateLimit = 200; // Default value for when re-enabled
			} else {
				pexelsRateLimitEnabled = true;
				pexelsRateLimit = loadedRateLimit;
			}

			// Load Pelias endpoint
			peliasEndpoint = custom['wayli.pelias_endpoint']?.value || 'https://pelias.wayli.app';

			// Load Pexels API key secret metadata (value is not returned)
			if (result.secrets?.pexels_api_key) {
				pexelsApiKeyConfigured = true;
				pexelsApiKeyUpdatedAt = result.secrets.pexels_api_key.updated_at;
			} else {
				pexelsApiKeyConfigured = false;
				pexelsApiKeyUpdatedAt = null;
			}

			console.log('✅ Settings loaded successfully');
		} catch (error: any) {
			console.error('❌ Failed to load settings:', error);
			toast.error(t('serverAdmin.failedToLoadSettings'), {
				description: error?.message || 'Unknown error'
			});
		}
	}

	onMount(() => {
		// Load all settings when component mounts
		loadAllSettings();
		loadOAuthProviders();
	});

	// Add User Modal State
	let newUserEmail = $state('');
	let newUserFirstName = $state('');
	let newUserLastName = $state('');
	let newUserPassword = $state('');
	let newUserConfirmPassword = $state('');
	let newUserRole = $state<'admin' | 'user'>('user');

	// Admin state - initialized to true since layout already protects this route
	let isAdmin = $state(true);

	function handleCloseAddUserModal() {
		showAddUserModal = false;
		newUserEmail = '';
		newUserFirstName = '';
		newUserLastName = '';
		newUserPassword = '';
		newUserConfirmPassword = '';
		newUserRole = 'user';
	}

	async function handleAddUser() {
		if (!newUserEmail || !newUserFirstName || !newUserLastName) {
			toast.error('Please fill in all required fields');
			return;
		}

		if (!newUserPassword || newUserPassword.length < 6) {
			toast.error('Password must be at least 6 characters long');
			return;
		}

		if (newUserPassword !== newUserConfirmPassword) {
			toast.error('Passwords do not match');
			return;
		}

		try {
			const { data, error } = await fluxbase.functions.invoke('admin-users', {
				method: 'POST',
				body: {
					action: 'addUser',
					email: newUserEmail,
					firstName: newUserFirstName,
					lastName: newUserLastName,
					password: newUserPassword,
					role: newUserRole
				}
			});

			if (error) {
				throw error;
			}

			if (data?.success) {
				toast.success('User added successfully');
				handleCloseAddUserModal();
				await invalidateAll(); // Refresh the user list
			} else {
				const errorDescription = data?.error || 'An unknown error occurred while adding the user.';
				toast.error('Failed to add user', { description: errorDescription });
			}
		} catch (error: any) {
			console.error('Error adding user:', error);
			const errorMessage = error?.message || error?.error || 'An unexpected error occurred.';
			toast.error('Failed to add user', { description: errorMessage });
		}
	}
</script>

<svelte:head>
	<title>{t('serverAdmin.title')} - Wayli</title>
</svelte:head>

<svelte:window />

{#if isModalOpen && selectedUser}
	<UserEditModal
		isOpen={isModalOpen}
		user={selectedUser}
		onClose={handleCloseModal}
		onSave={(user) => handleSaveUser(new CustomEvent('save', { detail: user }))}
	/>
{/if}

<!-- Add User Modal -->
{#if showAddUserModal}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleCloseAddUserModal}
		onkeydown={(e) => {
			if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
				handleCloseAddUserModal();
			}
		}}
		role="button"
		tabindex="0"
		aria-label="Close modal"
	>
		<div
			class="relative w-full max-w-lg rounded-xl bg-white p-8 shadow-2xl dark:bg-gray-800"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Modal Header -->
			<div class="mb-6 flex items-start justify-between">
				<div>
					<h2 id="add-user-modal-title" class="text-2xl font-bold text-gray-900 dark:text-gray-100">
						Add New User
					</h2>
					<p class="text-gray-500 dark:text-gray-400">Create a new user account.</p>
				</div>
				<button
					onclick={handleCloseAddUserModal}
					class="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
					aria-label="Close modal"
				>
					<X class="h-6 w-6" />
				</button>
			</div>

			<!-- Form Fields -->
			<div class="space-y-6">
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label
							for="newUserFirstName"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>First Name *</label
						>
						<div class="relative">
							<UserIcon class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								id="newUserFirstName"
								bind:value={newUserFirstName}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder="e.g. Jane"
								required
							/>
						</div>
					</div>

					<div>
						<label
							for="newUserLastName"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>Last Name *</label
						>
						<div class="relative">
							<UserIcon class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								id="newUserLastName"
								bind:value={newUserLastName}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder="e.g. Doe"
								required
							/>
						</div>
					</div>
				</div>

				<div>
					<label
						for="newUserEmail"
						class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>Email Address *</label
					>
					<div class="relative">
						<Mail class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
						<input
							type="email"
							id="newUserEmail"
							bind:value={newUserEmail}
							class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							placeholder="e.g. jane.doe@example.com"
							required
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label
							for="newUserPassword"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>Password *</label
						>
						<div class="relative">
							<Lock class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="password"
								id="newUserPassword"
								bind:value={newUserPassword}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder="Min. 6 characters"
								required
							/>
						</div>
					</div>

					<div>
						<label
							for="newUserConfirmPassword"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>Confirm Password *</label
						>
						<div class="relative">
							<Lock class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="password"
								id="newUserConfirmPassword"
								bind:value={newUserConfirmPassword}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder="Confirm password"
								required
							/>
						</div>
					</div>
				</div>

				<div>
					<span class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Role</span>
					<RoleSelector bind:role={newUserRole} />
				</div>
			</div>

			<!-- Modal Footer -->
			<div class="mt-8 flex justify-end gap-3">
				<button
					onclick={handleCloseAddUserModal}
					class="rounded-lg px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={handleAddUser}
					class="bg-primary hover:bg-primary/90 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
				>
					Add User
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm && userToDelete}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleCloseDeleteConfirm}
		onkeydown={(e) => {
			if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
				handleCloseDeleteConfirm();
			}
		}}
		role="button"
		tabindex="0"
		aria-label="Close modal"
	>
		<div
			class="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex-shrink-0">
					<div
						class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20"
					>
						<Trash2 class="h-6 w-6 text-red-600 dark:text-red-400" />
					</div>
				</div>
				<div>
					<h3
						id="delete-user-modal-title"
						class="text-lg font-medium text-gray-900 dark:text-gray-100"
					>
						Delete User
					</h3>
					<p id="delete-user-modal-description" class="text-sm text-gray-500 dark:text-gray-400">
						Are you sure you want to delete this user? This action cannot be undone.
					</p>
				</div>
			</div>

			<div class="mb-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
				<div class="flex items-center">
					<div>
						<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
							{getUserDisplayName(userToDelete)}
						</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">{userToDelete.email}</div>
					</div>
				</div>
			</div>

			<div class="flex justify-end space-x-3">
				<button
					type="button"
					onclick={handleCloseDeleteConfirm}
					class="cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleConfirmDelete}
					class="cursor-pointer rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
				>
					Delete User
				</button>
			</div>
		</div>
	</div>
{/if}

{#if isAdmin}
	<div>
		<!-- Header -->
		<div class="mb-8">
			<div class="flex items-center gap-3">
				<Settings class="text-primary dark:text-primary-dark h-7 w-7" />
				<h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
					{t('serverAdmin.title')}
				</h1>
			</div>
		</div>

		<!-- Tab Navigation -->
		<div class="mb-6 border-b border-gray-200 dark:border-gray-700">
			<nav class="-mb-px flex space-x-8">
				<button
					class="cursor-pointer border-b-2 px-1 py-2 text-sm font-medium {activeTab === 'settings'
						? 'border-primary text-primary dark:border-primary-dark dark:text-primary-dark'
						: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
					onclick={() => (activeTab = 'settings')}
				>
					<div class="flex items-center gap-2">
						<Server class="h-4 w-4" />
						{t('serverAdmin.general')}
					</div>
				</button>
				<button
					class="cursor-pointer border-b-2 px-1 py-2 text-sm font-medium {activeTab === 'users'
						? 'border-primary text-primary dark:border-primary-dark dark:text-primary-dark'
						: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
					onclick={() => (activeTab = 'users')}
				>
					<div class="flex items-center gap-2">
						<UserIcon class="h-4 w-4" />
						{t('serverAdmin.users')}
					</div>
				</button>
			</nav>
		</div>

		<!-- Users Tab -->
		{#if activeTab === 'users'}
			<div
				class="mb-8 rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
			>
				<div class="mb-4">
					<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">User Management</h2>
					<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
						Manage users and their permissions. Total users: {pagination.total}
						{#if searchQuery}
							(Showing {users.length} filtered results)
						{/if}
					</p>
				</div>

				<div class="mb-6 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<div class="relative">
							<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Search users..."
								class="focus:border-primary focus:ring-primary w-64 rounded-md border border-[rgb(218,218,221)] bg-white py-2 pr-4 pl-9 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100 dark:placeholder:text-gray-500"
								oninput={handleSearchInput}
							/>
						</div>
						<!-- Items per page selector -->
						<select
							bind:value={itemsPerPage}
							onchange={handleItemsPerPageChange}
							class="focus:border-primary focus:ring-primary rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
						>
							<option value={5}>5 per page</option>
							<option value={10}>10 per page</option>
							<option value={25}>25 per page</option>
							<option value={50}>50 per page</option>
						</select>
					</div>
					<button
						class="bg-primary hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white"
						onclick={() => (showAddUserModal = true)}
					>
						<UserPlus class="h-4 w-4" />
						Add User
					</button>
				</div>

				<div
					class="overflow-hidden rounded-lg border border-[rgb(218,218,221)] bg-white dark:border-[#3f3f46] dark:bg-[#23232a]"
				>
					{#if users.length === 0}
						<div class="py-8 text-center">
							<UserIcon class="mx-auto h-12 w-12 text-gray-400" />
							<h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
								No users found
							</h3>
							<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
								{searchQuery
									? 'Try adjusting your search terms.'
									: 'No users have been created yet.'}
							</p>
						</div>
					{:else}
						<table class="min-w-full divide-y divide-[rgb(218,218,221)] dark:divide-[#3f3f46]">
							<thead class="bg-gray-50 dark:bg-[#2d2d35]">
								<tr>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-300"
									>
										User
									</th>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-300"
									>
										Role
									</th>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-300"
									>
										Created
									</th>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-300"
									>
										Status
									</th>
									<th scope="col" class="relative px-6 py-3">
										<span class="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody
								class="divide-y divide-[rgb(218,218,221)] bg-white dark:divide-[#3f3f46] dark:bg-[#23232a]"
							>
								{#each users as user (user.id)}
									<tr>
										<td class="px-6 py-4 whitespace-nowrap">
											<div class="flex items-center gap-3">
												<UserAvatar {user} size="lg" />
												<div>
													<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
														{getUserDisplayName(user)}
													</div>
													<div class="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
												</div>
											</div>
										</td>
										<td class="px-6 py-4 whitespace-nowrap">
											<span
												class="inline-flex rounded-full px-2 text-xs leading-5 font-semibold {user.role ===
												'admin'
													? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
													: 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'}"
											>
												{user.role === 'admin' ? 'Admin' : 'User'}
											</span>
										</td>
										<td
											class="px-6 py-4 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400"
										>
											{formatDate(user.created_at)}
										</td>
										<td
											class="px-6 py-4 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400"
										>
											Active
										</td>
										<td class="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
											<div class="flex items-center justify-end gap-2">
												<button
													class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
													onclick={() => handleEditUser(user)}
													title="Edit user"
												>
													<Edit class="h-4 w-4" />
												</button>
												<button
													class="cursor-pointer rounded p-1 text-gray-500 hover:bg-amber-50 hover:text-amber-600 dark:text-gray-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
													onclick={() => handleClearUserPlaceVisits(user)}
													title={t('serverAdmin.clearUserPlaceVisits')}
												>
													<RotateCcw class="h-4 w-4" />
												</button>
												<button
													class="cursor-pointer rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
													onclick={() => handleDeleteUser(user)}
													title="Delete user"
												>
													<Trash2 class="h-4 w-4" />
												</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>

						<!-- Pagination Controls -->
						{#if pagination.totalPages > 1}
							<div
								class="border-t border-[rgb(218,218,221)] bg-white px-6 py-3 dark:border-[#3f3f46] dark:bg-[#23232a]"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center text-sm text-gray-700 dark:text-gray-300">
										<span>
											Showing {(pagination.page - 1) * pagination.limit + 1} to {Math.min(
												pagination.page * pagination.limit,
												pagination.total
											)} of {pagination.total} results
										</span>
									</div>
									<div class="flex items-center space-x-2">
										<!-- Previous button -->
										<button
											onclick={goToPreviousPage}
											disabled={!pagination.hasPrev}
											class="relative inline-flex items-center rounded-md px-2 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
										>
											<span class="sr-only">Previous</span>
											<ChevronLeft class="h-5 w-5" />
										</button>

										<!-- Page numbers -->
										{#each getPageNumbers() as pageNum (pageNum)}
											<button
												onclick={() => goToPage(pageNum)}
												class="relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium {pageNum ===
												currentPage
													? 'bg-primary text-white'
													: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'}"
											>
												{pageNum}
											</button>
										{/each}

										<!-- Next button -->
										<button
											onclick={goToNextPage}
											disabled={!pagination.hasNext}
											class="relative inline-flex items-center rounded-md px-2 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
										>
											<span class="sr-only">Next</span>
											<ChevronRight class="h-5 w-5" />
										</button>
									</div>
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Settings Tab -->
		{#if activeTab === 'settings'}
			<div class="space-y-8">
				<!-- Wayli Settings -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-4">
						<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
							{t('serverAdmin.wayliSettings')}
						</h2>
						<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
							{t('serverAdmin.wayliSettingsDescription')}
						</p>
					</div>

					<div class="space-y-4">
						<div>
							<label
								for="serverName"
								class="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t('serverAdmin.serverName')}
							</label>
							<input
								type="text"
								id="serverName"
								bind:value={serverName}
								class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
								placeholder={t('serverAdmin.enterServerName')}
							/>
						</div>

						<div>
							<label
								for="serverPexelsApiKey"
								class="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t('serverAdmin.serverPexelsKey')}
							</label>
							{#if pexelsApiKeyConfigured}
								<div class="mt-1 flex items-center gap-2">
									<div
										class="flex flex-1 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20"
									>
										<span class="text-sm font-medium text-green-700 dark:text-green-300">
											{t('serverAdmin.secretConfigured')}
										</span>
										{#if pexelsApiKeyUpdatedAt}
											<span class="text-xs text-green-600 dark:text-green-400">
												({new Date(pexelsApiKeyUpdatedAt).toLocaleDateString()})
											</span>
										{/if}
									</div>
									<button
										type="button"
										onclick={clearPexelsApiKey}
										class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
									>
										{t('serverAdmin.clearSecret')}
									</button>
								</div>
								<div class="mt-2">
									<input
										type="password"
										id="serverPexelsApiKey"
										bind:value={serverPexelsApiKey}
										class="focus:border-primary focus:ring-primary w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
										placeholder={t('serverAdmin.enterNewKeyToReplace')}
									/>
								</div>
							{:else}
								<input
									type="password"
									id="serverPexelsApiKey"
									bind:value={serverPexelsApiKey}
									class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
									placeholder={t('serverAdmin.enterPexelsApiKey')}
								/>
							{/if}
							<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
								{t('serverAdmin.serverPexelsKeyDescription')}
							</p>
						</div>

						<div>
							<div class="flex items-center justify-between">
								<span class="block text-sm font-medium text-gray-700 dark:text-gray-300">
									Enable Pexels API Rate Limit
								</span>
								<Switch
									bind:checked={pexelsRateLimitEnabled}
									label="Enable Pexels API Rate Limit"
								/>
							</div>
							<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
								{#if pexelsRateLimitEnabled}
									Rate limiting is enabled. Configure the limit below.
								{:else}
									Rate limiting is disabled (unlimited). Requires Pexels API approval.
								{/if}
							</p>

							{#if pexelsRateLimitEnabled}
								<div class="mt-3">
									<label
										for="pexelsRateLimit"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										Requests per hour
									</label>
									<input
										type="number"
										id="pexelsRateLimit"
										bind:value={pexelsRateLimit}
										min="1"
										step="1"
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
										placeholder="200"
									/>
									<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
										Default: 200 (Pexels free tier limit)
									</p>
								</div>
							{/if}
						</div>

						<div>
							<label
								for="peliasEndpoint"
								class="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								Pelias Geocoding Endpoint
							</label>
							<input
								type="url"
								id="peliasEndpoint"
								bind:value={peliasEndpoint}
								class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
								placeholder="https://pelias.wayli.app"
								pattern="https?://.+"
								required
							/>
							<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
								Geocoding service URL for address lookups and reverse geocoding
							</p>
						</div>

						<div class="flex justify-end">
							<button
								onclick={saveWayliSettings}
								class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
							>
								{t('serverAdmin.saveSettings')}
							</button>
						</div>
					</div>
				</div>

				<!-- Authentication Settings -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-4">
						<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
							{t('serverAdmin.authenticationSettings')}
						</h2>
						<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
							{t('serverAdmin.authSettingsDescription')}
						</p>
					</div>

					<div class="space-y-4">
						{#if authReadOnly}
							<div
								class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
							>
								<Lock class="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
								<div>
									<span class="text-sm font-medium text-amber-800 dark:text-amber-200">
										{t('serverAdmin.authSettingsReadOnly')}
									</span>
									<p class="text-xs text-amber-700 dark:text-amber-300">
										{t('serverAdmin.authSettingsReadOnlyDescription')}
									</p>
								</div>
							</div>
						{/if}

						<div class="flex items-center justify-between">
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{t('serverAdmin.enableSignup')}
							</span>
							<Switch
								bind:checked={enableSignup}
								label={t('serverAdmin.enableSignup')}
								disabled={authReadOnly}
							/>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{t('serverAdmin.requireEmailVerification')}
							</span>
							<Switch
								bind:checked={requireEmailVerification}
								label={t('serverAdmin.requireEmailVerification')}
								disabled={authReadOnly}
							/>
						</div>

						<div class="flex items-center justify-between">
							<div>
								<span class="text-sm text-gray-700 dark:text-gray-300">
									{t('serverAdmin.disablePasswordLogin')}
								</span>
								<p class="text-xs text-gray-500 dark:text-gray-400">
									{t('serverAdmin.disablePasswordLoginDescription')}
								</p>
							</div>
							<Switch
								bind:checked={disablePasswordLogin}
								label={t('serverAdmin.disablePasswordLogin')}
								disabled={authReadOnly || oauthProviders.filter(p => p.enabled).length === 0}
							/>
						</div>

						{#if disablePasswordLogin && oauthProviders.filter(p => p.enabled).length === 0}
							<div
								class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
							>
								<Lock class="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
								<span class="text-sm text-amber-800 dark:text-amber-200">
									{t('serverAdmin.noOAuthProvidersWarning')}
								</span>
							</div>
						{/if}

						{#if !authReadOnly}
							<div class="flex justify-end">
								<button
									onclick={saveAuthSettings}
									class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
								>
									{t('serverAdmin.saveSettings')}
								</button>
							</div>
						{/if}
					</div>
				</div>

				<!-- Email & SMTP Settings -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-4">
						<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
							{t('serverAdmin.emailSettings')}
						</h2>
						<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
							{t('serverAdmin.emailSettingsDescription')}
						</p>
					</div>

					<div class="space-y-4">
						{#if hasEmailConfigOverrides}
							<div
								class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
							>
								<Lock class="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
								<div>
									<span class="text-sm font-medium text-amber-800 dark:text-amber-200">
										{t('serverAdmin.emailSettingsPartialReadOnly')}
									</span>
									<p class="text-xs text-amber-700 dark:text-amber-300">
										{t('serverAdmin.emailSettingsPartialReadOnlyDescription')}
									</p>
								</div>
							</div>
						{/if}

						<div
							class="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800"
						>
							<h3 class="font-medium text-gray-900 dark:text-gray-100">
								{t('serverAdmin.smtpConfiguration')}
							</h3>

							<div class="grid grid-cols-2 gap-4">
								<div>
									<label
										for="smtpHost"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.smtpHost')}
									</label>
									<input
										id="smtpHost"
										type="text"
										bind:value={smtpHost}
										disabled={emailSmtpReadOnly}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										placeholder={t('serverAdmin.smtpHostPlaceholder')}
									/>
								</div>

								<div>
									<label
										for="smtpPort"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.smtpPort')}
									</label>
									<input
										id="smtpPort"
										type="number"
										bind:value={smtpPort}
										disabled={emailSmtpReadOnly}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										placeholder={t('serverAdmin.smtpPortPlaceholder')}
									/>
								</div>
							</div>

							<div>
								<label
									for="smtpUsername"
									class="block text-sm font-medium text-gray-700 dark:text-gray-300"
								>
									{t('serverAdmin.smtpUsername')}
								</label>
								<input
									id="smtpUsername"
									type="text"
									bind:value={smtpUsername}
									disabled={emailSmtpReadOnly}
									class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
									placeholder={t('serverAdmin.smtpUsernamePlaceholder')}
								/>
							</div>

							<div>
								<label
									for="smtpPassword"
									class="block text-sm font-medium text-gray-700 dark:text-gray-300"
								>
									{t('serverAdmin.smtpPassword')}
								</label>
								<input
									id="smtpPassword"
									type="password"
									bind:value={smtpPassword}
									disabled={emailSmtpReadOnly}
									class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
									placeholder={t('serverAdmin.smtpPasswordPlaceholder')}
								/>
							</div>

							<div class="flex items-center justify-between">
								<span class="text-sm text-gray-700 dark:text-gray-300">
									{t('serverAdmin.smtpUseTls')}
								</span>
								<Switch
									bind:checked={smtpUseTls}
									label={t('serverAdmin.smtpUseTls')}
									disabled={emailSmtpReadOnly}
								/>
							</div>

							<div>
								<label
									for="smtpFromAddress"
									class="block text-sm font-medium text-gray-700 dark:text-gray-300"
								>
									{t('serverAdmin.smtpFromAddress')}
								</label>
								<input
									id="smtpFromAddress"
									type="email"
									bind:value={smtpFromAddress}
									disabled={emailSmtpReadOnly}
									class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
									placeholder={t('serverAdmin.smtpFromAddressPlaceholder')}
								/>
							</div>

							<div>
								<label
									for="smtpFromName"
									class="block text-sm font-medium text-gray-700 dark:text-gray-300"
								>
									{t('serverAdmin.smtpFromName')}
								</label>
								<input
									id="smtpFromName"
									type="text"
									bind:value={smtpFromName}
									disabled={emailSmtpReadOnly}
									class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
									placeholder={t('serverAdmin.smtpFromNamePlaceholder')}
								/>
							</div>
						</div>

						{#if !emailSmtpReadOnly}
							<div class="flex justify-end">
								<button
									onclick={saveEmailSettings}
									class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
								>
									{t('serverAdmin.saveSettings')}
								</button>
							</div>
						{/if}
					</div>
				</div>

				<!-- OAuth Settings -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-4 flex items-center gap-3">
						<Lock class="h-6 w-6 text-indigo-500" />
						<div>
							<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.oauthSettings')}
							</h2>
							<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
								{t('serverAdmin.oauthSettingsDescription')}
							</p>
						</div>
					</div>

					<div class="space-y-4">
						<!-- Configured Providers List -->
						{#if isLoadingOAuth}
							<div class="flex items-center justify-center py-8">
								<RefreshCw class="h-5 w-5 animate-spin text-gray-400" />
							</div>
						{:else if oauthProviders.length > 0}
							<div class="space-y-2">
								{#each oauthProviders as provider}
									<div
										class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
									>
										<div class="flex items-center gap-3">
											<div
												class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900"
											>
												<span class="text-sm font-medium text-indigo-600 dark:text-indigo-400">
													{provider.display_name.charAt(0).toUpperCase()}
												</span>
											</div>
											<div>
												<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
													{provider.display_name}
												</div>
												<div class="text-xs text-gray-500 dark:text-gray-400">
													{provider.provider_name}
												</div>
											</div>
										</div>
										<div class="flex items-center gap-2">
											<Switch
												checked={provider.enabled}
												label={t('serverAdmin.enabled')}
												onchange={() => toggleOAuthProvider(provider.id, !provider.enabled)}
											/>
											<button
												onclick={() => editOAuthProvider(provider)}
												class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300"
												title={t('serverAdmin.edit')}
											>
												<Edit class="h-4 w-4" />
											</button>
											<button
												onclick={() => deleteOAuthProvider(provider.id)}
												class="rounded p-1.5 text-gray-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
												title={t('serverAdmin.delete')}
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<p class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
								{t('serverAdmin.noOAuthProviders')}
							</p>
						{/if}

						<!-- Add/Edit Provider Form -->
						{#if showOAuthForm}
							<div
								class="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-900/20"
							>
								<h3 class="font-medium text-gray-900 dark:text-gray-100">
									{oauthEditingId ? t('serverAdmin.editOAuthProvider') : t('serverAdmin.addOAuthProvider')}
								</h3>

								<div>
									<label
										for="oauthProvider"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.oauthProvider')}
									</label>
									<select
										id="oauthProvider"
										bind:value={oauthFormProvider}
										disabled={!!oauthEditingId}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800"
									>
										<option value="google">Google</option>
										<option value="github">GitHub</option>
										<option value="gitlab">GitLab</option>
										<option value="discord">Discord</option>
										<option value="azure">Microsoft Azure</option>
										<option value="bitbucket">Bitbucket</option>
										<option value="custom">{t('serverAdmin.oauthCustomProvider')}</option>
									</select>
								</div>

								{#if oauthFormProvider === 'custom'}
									<!-- Custom Provider Name -->
									<div>
										<label
											for="oauthCustomName"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.oauthCustomName')}
										</label>
										<input
											id="oauthCustomName"
											type="text"
											bind:value={oauthFormCustomName}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
											placeholder={t('serverAdmin.oauthCustomNamePlaceholder')}
										/>
										<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.oauthCustomNameHint')}
										</p>
									</div>

									<!-- Discovery URL -->
									<div>
										<label
											for="oauthDiscoveryUrl"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.oauthDiscoveryUrl')}
										</label>
										<div class="mt-1 flex gap-2">
											<input
												id="oauthDiscoveryUrl"
												type="url"
												bind:value={oauthFormDiscoveryUrl}
												class="focus:border-primary focus:ring-primary w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
												placeholder={t('serverAdmin.oauthDiscoveryUrlPlaceholder')}
											/>
											<button
												type="button"
												onclick={discoverOAuthEndpoints}
												disabled={isDiscoveringOAuth || !oauthFormDiscoveryUrl}
												class="bg-primary hover:bg-primary/90 flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
											>
												{#if isDiscoveringOAuth}
													<RefreshCw class="h-4 w-4 animate-spin" />
												{:else}
													<Search class="h-4 w-4" />
												{/if}
												{t('serverAdmin.oauthDiscover')}
											</button>
										</div>
										<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.oauthDiscoveryUrlHint')}
										</p>
									</div>

									<!-- Authorization URL -->
									<div>
										<label
											for="oauthAuthorizationUrl"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.oauthAuthorizationUrl')}
										</label>
										<input
											id="oauthAuthorizationUrl"
											type="url"
											bind:value={oauthFormAuthorizationUrl}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
											placeholder={t('serverAdmin.oauthAuthorizationUrlPlaceholder')}
										/>
									</div>

									<!-- Token URL -->
									<div>
										<label
											for="oauthTokenUrl"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.oauthTokenUrl')}
										</label>
										<input
											id="oauthTokenUrl"
											type="url"
											bind:value={oauthFormTokenUrl}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
											placeholder={t('serverAdmin.oauthTokenUrlPlaceholder')}
										/>
									</div>

									<!-- User Info URL -->
									<div>
										<label
											for="oauthUserInfoUrl"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.oauthUserInfoUrl')}
										</label>
										<input
											id="oauthUserInfoUrl"
											type="url"
											bind:value={oauthFormUserInfoUrl}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
											placeholder={t('serverAdmin.oauthUserInfoUrlPlaceholder')}
										/>
									</div>

									<!-- Scopes -->
									<div>
										<label
											for="oauthScopes"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.oauthScopes')}
										</label>
										<input
											id="oauthScopes"
											type="text"
											bind:value={oauthFormScopes}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
											placeholder={t('serverAdmin.oauthScopesPlaceholder')}
										/>
										<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.oauthScopesHint')}
										</p>
									</div>
								{/if}

								<div>
									<label
										for="oauthDisplayName"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.oauthDisplayName')}
									</label>
									<input
										id="oauthDisplayName"
										type="text"
										bind:value={oauthFormDisplayName}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
										placeholder={oauthFormProvider === 'custom' ? t('serverAdmin.oauthDisplayNamePlaceholder') : getDefaultDisplayName(oauthFormProvider)}
									/>
								</div>

								<div>
									<label
										for="oauthClientId"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.oauthClientId')}
									</label>
									<input
										id="oauthClientId"
										type="text"
										bind:value={oauthFormClientId}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
										placeholder={t('serverAdmin.oauthClientIdPlaceholder')}
									/>
								</div>

								<div>
									<label
										for="oauthClientSecret"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.oauthClientSecret')}
									</label>
									<input
										id="oauthClientSecret"
										type="password"
										bind:value={oauthFormClientSecret}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
										placeholder={oauthEditingId ? t('serverAdmin.oauthClientSecretPlaceholderEdit') : t('serverAdmin.oauthClientSecretPlaceholder')}
									/>
								</div>

								<div class="flex items-center justify-between">
									<span class="text-sm text-gray-700 dark:text-gray-300">
										{t('serverAdmin.oauthEnabled')}
									</span>
									<Switch bind:checked={oauthFormEnabled} label={t('serverAdmin.oauthEnabled')} />
								</div>

								<div class="flex justify-end gap-2">
									<button
										onclick={resetOAuthForm}
										class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
									>
										{t('serverAdmin.cancel')}
									</button>
									<button
										onclick={saveOAuthProvider}
										disabled={isSavingOAuth}
										class="bg-primary hover:bg-primary/90 flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
									>
										{#if isSavingOAuth}
											<RefreshCw class="h-4 w-4 animate-spin" />
										{/if}
										{oauthEditingId ? t('serverAdmin.updateProvider') : t('serverAdmin.addProvider')}
									</button>
								</div>
							</div>
						{:else}
							<button
								onclick={() => (showOAuthForm = true)}
								class="w-full rounded-md border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300"
							>
								+ {t('serverAdmin.addOAuthProvider')}
							</button>
						{/if}
					</div>
				</div>

				<!-- AI Settings -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-4 flex items-center gap-3">
						<Bot class="h-6 w-6 text-purple-500" />
						<div>
							<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.aiSettings')}
							</h2>
							<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
								{t('serverAdmin.aiSettingsDescription')}
							</p>
						</div>
					</div>

					<div class="space-y-4">
						{#if providerReadOnly}
							<div
								class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
							>
								<Lock class="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
								<div>
									<span class="text-sm font-medium text-amber-800 dark:text-amber-200">
										{t('serverAdmin.aiProviderReadOnly')}
									</span>
									<p class="text-xs text-amber-700 dark:text-amber-300">
										{t('serverAdmin.aiProviderReadOnlyDescription')}
									</p>
								</div>
							</div>
						{/if}

						<div class="flex items-center justify-between">
							<div>
								<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
									{t('serverAdmin.aiEnabled')}
								</span>
								<p class="text-xs text-gray-500 dark:text-gray-400">
									{t('serverAdmin.aiEnabledDescription')}
								</p>
							</div>
							<Switch
								bind:checked={aiEnabled}
								label={t('serverAdmin.aiEnabled')}
								disabled={providerReadOnly}
							/>
						</div>

						{#if aiEnabled}
							<div class="flex items-center justify-between">
								<div>
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
										{t('serverAdmin.allowUserOverride')}
									</span>
									<p class="text-xs text-gray-500 dark:text-gray-400">
										{t('serverAdmin.allowUserOverrideDescription')}
									</p>
								</div>
								<Switch
									bind:checked={aiAllowUserOverride}
									label={t('serverAdmin.allowUserOverride')}
									disabled={providerReadOnly}
								/>
							</div>

							<div
								class="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800"
							>
								<div class="grid grid-cols-2 gap-4">
									<div>
										<label
											for="providerName"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.aiProviderName')}
										</label>
										<input
											id="providerName"
											type="text"
											value={providerName}
											disabled
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
											placeholder={t('serverAdmin.aiProviderNamePlaceholder')}
										/>
									</div>
									<div>
										<label
											for="providerDisplayName"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.aiDisplayName')}
										</label>
										<input
											id="providerDisplayName"
											type="text"
											bind:value={providerDisplayName}
											disabled={providerReadOnly}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
											placeholder={t('serverAdmin.aiDisplayNamePlaceholder')}
										/>
									</div>
								</div>

								<div>
									<label
										for="providerType"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.aiProvider')}
									</label>
									<select
										id="providerType"
										bind:value={providerType}
										disabled={providerReadOnly}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
									>
										<option value="openai">{t('serverAdmin.aiProviders.openai')}</option>
										<option value="azure">{t('serverAdmin.aiProviders.azure')}</option>
										<option value="ollama">{t('serverAdmin.aiProviders.ollama')}</option>
									</select>
								</div>

								<div>
									<label
										for="providerModel"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.aiModel')}
									</label>
									<input
										id="providerModel"
										type="text"
										bind:value={providerModel}
										disabled={providerReadOnly}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										placeholder="gpt-4.1-mini-2025-04-14"
									/>
									<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
										{t('serverAdmin.aiModelDescription')}
									</p>
								</div>

								<div>
									<label
										for="providerApiKey"
										class="block text-sm font-medium text-gray-700 dark:text-gray-300"
									>
										{t('serverAdmin.aiApiKey')}
									</label>
									<input
										id="providerApiKey"
										type="password"
										bind:value={providerApiKey}
										disabled={providerReadOnly}
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										placeholder={t('serverAdmin.aiApiKeyPlaceholder')}
									/>
								</div>

								{#if providerType === 'ollama' || providerType === 'azure' || providerType === 'custom'}
									<div>
										<label
											for="providerApiEndpoint"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.aiApiEndpoint')}
										</label>
										<input
											id="providerApiEndpoint"
											type="text"
											bind:value={providerApiEndpoint}
											disabled={providerReadOnly}
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
											placeholder={t('serverAdmin.aiApiEndpointPlaceholder')}
										/>
										<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.aiApiEndpointDescription')}
										</p>
									</div>
								{/if}

								<div class="grid grid-cols-2 gap-4">
									<div>
										<label
											for="providerMaxTokens"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.aiMaxTokens')}
										</label>
										<input
											id="providerMaxTokens"
											type="number"
											bind:value={providerMaxTokens}
											disabled={providerReadOnly}
											min="256"
											max="128000"
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										/>
									</div>

									<div>
										<label
											for="providerTemperature"
											class="block text-sm font-medium text-gray-700 dark:text-gray-300"
										>
											{t('serverAdmin.aiTemperature')}
										</label>
										<input
											id="providerTemperature"
											type="number"
											bind:value={providerTemperature}
											disabled={providerReadOnly}
											min="0"
											max="2"
											step="0.1"
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										/>
									</div>
								</div>
							</div>
						{/if}

						{#if !providerReadOnly}
							<div class="flex justify-end">
								<button
									onclick={saveAISettings}
									class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
								>
									{t('serverAdmin.saveSettings')}
								</button>
							</div>
						{/if}
					</div>
				</div>

				<!-- Database Maintenance -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-6 flex items-center gap-3">
						<Database class="h-6 w-6 text-emerald-500" />
						<div>
							<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.databaseMaintenance')}
							</h2>
							<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
								{t('serverAdmin.databaseMaintenanceDescription')}
							</p>
						</div>
					</div>

					<div class="space-y-6">
						<!-- Data Processing Pipeline -->
						<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
							<h3 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.pipelineTitle')}
							</h3>
							<p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
								{t('serverAdmin.pipelineDescription')}
							</p>

							<!-- Pipeline Flow Diagram -->
							<div class="space-y-3">
								<!-- Row 1: Reverse Geocode → Refresh Place Visits -->
								<div class="flex flex-wrap items-center gap-3">
									<!-- Reverse Geocode Card -->
									<div
										class="flex min-w-[200px] flex-1 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
									>
										<div class="min-w-0 flex-1">
											<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
												{t('serverAdmin.reverseGeocode')}
											</span>
											<p class="text-xs text-gray-500 dark:text-gray-400">
												{t('serverAdmin.reverseGeocodeDescription')}
											</p>
										</div>
										<button
											onclick={reverseGeocodeAllUsers}
											disabled={isReverseGeocodingAllUsers}
											class="bg-primary hover:bg-primary/90 ml-3 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
										>
											<RefreshCw
												class={`h-3.5 w-3.5 ${isReverseGeocodingAllUsers ? 'animate-spin' : ''}`}
											/>
											{isReverseGeocodingAllUsers ? t('serverAdmin.running') : t('serverAdmin.run')}
										</button>
									</div>

									<!-- Arrow -->
									<div class="flex shrink-0 items-center">
										<ArrowRight class="h-5 w-5 text-gray-400" />
									</div>

									<!-- Refresh Place Visits Card -->
									<div
										class="flex min-w-[200px] flex-1 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
									>
										<div class="min-w-0 flex-1">
											<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
												{t('serverAdmin.refreshPlaceVisits')}
											</span>
											<p class="text-xs text-gray-500 dark:text-gray-400">
												{t('serverAdmin.refreshPlaceVisitsDescription')}
											</p>
										</div>
										<button
											onclick={refreshPlaceVisits}
											disabled={isRefreshingPlaceVisits}
											class="bg-primary hover:bg-primary/90 ml-3 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
										>
											<RefreshCw
												class={`h-3.5 w-3.5 ${isRefreshingPlaceVisits ? 'animate-spin' : ''}`}
											/>
											{isRefreshingPlaceVisits
												? t('serverAdmin.refreshing')
												: t('serverAdmin.refresh')}
										</button>
									</div>
								</div>

								<!-- Vertical Arrow with "auto" label -->
								<div class="flex justify-center pl-[calc(50%+1.5rem)]">
									<div class="flex flex-col items-center">
										<ChevronDown class="h-5 w-5 text-gray-400" />
										<span class="text-xs font-medium text-emerald-600 dark:text-emerald-400">
											{t('serverAdmin.autoTrigger')}
										</span>
									</div>
								</div>

								<!-- Row 2: Sync POI Embeddings -->
								<div class="flex justify-center pl-[calc(50%+1.5rem)]">
									<div
										class="flex max-w-md min-w-[200px] flex-1 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
									>
										<div class="min-w-0 flex-1">
											<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
												{t('serverAdmin.syncPoiEmbeddings')}
											</span>
											<p class="text-xs text-gray-500 dark:text-gray-400">
												{t('serverAdmin.syncPoiEmbeddingsDescription')}
											</p>
										</div>
										<button
											onclick={syncPoiEmbeddingsForAllUsers}
											disabled={isSyncingPoiEmbeddings}
											class="bg-primary hover:bg-primary/90 ml-3 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
										>
											<RefreshCw
												class={`h-3.5 w-3.5 ${isSyncingPoiEmbeddings ? 'animate-spin' : ''}`}
											/>
											{isSyncingPoiEmbeddings ? t('serverAdmin.syncing') : t('serverAdmin.sync')}
										</button>
									</div>
								</div>

								<!-- Vertical Arrow with "auto" label -->
								<div class="flex justify-center pl-[calc(50%+1.5rem)]">
									<div class="flex flex-col items-center">
										<ChevronDown class="h-5 w-5 text-gray-400" />
										<span class="text-xs font-medium text-emerald-600 dark:text-emerald-400">
											{t('serverAdmin.autoTrigger')}
										</span>
									</div>
								</div>

								<!-- Row 3: User Preferences (info only) -->
								<div class="flex justify-center pl-[calc(50%+1.5rem)]">
									<div
										class="flex max-w-md min-w-[200px] flex-1 items-center rounded-lg border border-dashed border-gray-300 bg-gray-100/50 p-3 dark:border-gray-600 dark:bg-gray-800/50"
									>
										<span class="text-sm font-medium text-gray-500 dark:text-gray-400">
											{t('serverAdmin.userPreferencesComputed')}
										</span>
										<span class="ml-2 text-xs text-gray-400 dark:text-gray-500">(computed)</span>
									</div>
								</div>
							</div>
						</div>

						<!-- Standalone Operations -->
						<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
							<h3 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.standaloneTitle')}
							</h3>
							<p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
								{t('serverAdmin.standaloneDescription')}
							</p>

							<div class="flex flex-wrap gap-3">
								<!-- Force Re-geocode Card -->
								<div
									class="flex min-w-[200px] flex-1 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
								>
									<div class="min-w-0 flex-1">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.forceRegeocode')}
										</span>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.forceRegeocodeDescription')}
										</p>
									</div>
									<button
										onclick={promptForceRegeocode}
										disabled={isForceRegeocoding}
										class="bg-primary hover:bg-primary/90 ml-3 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw class={`h-3.5 w-3.5 ${isForceRegeocoding ? 'animate-spin' : ''}`} />
										{isForceRegeocoding ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>

								<!-- Fill Country Codes Card -->
								<div
									class="flex min-w-[200px] flex-1 items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
								>
									<div class="min-w-0 flex-1">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.fillCountryCodes')}
										</span>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.fillCountryCodesDescription')}
										</p>
									</div>
									<button
										onclick={fillMissingCountryCodes}
										disabled={isFillingCountryCodes}
										class="bg-primary hover:bg-primary/90 ml-3 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw
											class={`h-3.5 w-3.5 ${isFillingCountryCodes ? 'animate-spin' : ''}`}
										/>
										{isFillingCountryCodes ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>

								<!-- Clear & Rebuild Place Visits Card -->
								<div
									class="flex min-w-[200px] flex-1 items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
								>
									<div class="min-w-0 flex-1">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.clearPlaceVisits')}
										</span>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											{t('serverAdmin.clearPlaceVisitsDescription')}
										</p>
									</div>
									<button
										onclick={promptClearPlaceVisits}
										disabled={isClearingPlaceVisits}
										class="ml-3 inline-flex shrink-0 items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<Trash2 class={`h-3.5 w-3.5 ${isClearingPlaceVisits ? 'animate-spin' : ''}`} />
										{isClearingPlaceVisits ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>
							</div>
						</div>

						<!-- Trip Processing -->
						<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
							<h3 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.tripProcessingTitle')}
							</h3>
							<p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
								{t('serverAdmin.tripProcessingDescription')}
							</p>

							<div
								class="flex max-w-md min-w-[200px] items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
							>
								<div class="min-w-0 flex-1">
									<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
										{t('serverAdmin.syncTripEmbeddings')}
									</span>
									<p class="text-xs text-gray-500 dark:text-gray-400">
										{t('serverAdmin.syncTripEmbeddingsDescription')}
									</p>
								</div>
								<button
									onclick={syncTripEmbeddingsForAllUsers}
									disabled={isSyncingTripEmbeddings}
									class="bg-primary hover:bg-primary/90 ml-3 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
								>
									<RefreshCw
										class={`h-3.5 w-3.5 ${isSyncingTripEmbeddings ? 'animate-spin' : ''}`}
									/>
									{isSyncingTripEmbeddings ? t('serverAdmin.syncing') : t('serverAdmin.sync')}
								</button>
							</div>
						</div>
					</div>
				</div>

				<!-- Force Re-geocode Confirmation Modal -->
				{#if showForceRegeocodeConfirm}
					<div
						class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
						onclick={cancelForceRegeocode}
						onkeydown={(e) => e.key === 'Escape' && cancelForceRegeocode()}
						role="dialog"
						aria-modal="true"
						tabindex="-1"
					>
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-[#23232a]"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="document"
						>
							<h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
								{t('serverAdmin.forceRegeocodeConfirmTitle')}
							</h3>
							<p class="mb-6 text-sm text-gray-600 dark:text-gray-300">
								{t('serverAdmin.forceRegeocodeConfirmMessage')}
							</p>
							<div class="flex justify-end gap-3">
								<button
									onclick={cancelForceRegeocode}
									class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									{t('serverAdmin.cancel')}
								</button>
								<button
									onclick={confirmForceRegeocode}
									class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
								>
									{t('serverAdmin.confirm')}
								</button>
							</div>
						</div>
					</div>
				{/if}

				<!-- Clear & Rebuild Place Visits Confirmation Modal (All Users) -->
				{#if showClearPlaceVisitsConfirm}
					<div
						class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
						onclick={cancelClearPlaceVisits}
						onkeydown={(e) => e.key === 'Escape' && cancelClearPlaceVisits()}
						role="dialog"
						aria-modal="true"
						tabindex="-1"
					>
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-[#23232a]"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="document"
						>
							<div class="mb-4 flex items-center gap-3">
								<div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
									<Trash2 class="h-5 w-5 text-red-600 dark:text-red-400" />
								</div>
								<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
									{t('serverAdmin.clearPlaceVisitsConfirmTitle')}
								</h3>
							</div>
							<p class="mb-6 text-sm text-gray-600 dark:text-gray-300">
								{t('serverAdmin.clearPlaceVisitsConfirmMessage')}
							</p>
							<div class="flex justify-end gap-3">
								<button
									onclick={cancelClearPlaceVisits}
									class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									{t('serverAdmin.cancel')}
								</button>
								<button
									onclick={confirmClearPlaceVisits}
									class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
								>
									{t('serverAdmin.confirm')}
								</button>
							</div>
						</div>
					</div>
				{/if}

				<!-- Clear & Rebuild Place Visits Confirmation Modal (Per User) -->
				{#if showClearUserPlaceVisitsConfirm && userToClearPlaceVisits}
					<div
						class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
						onclick={cancelClearUserPlaceVisits}
						onkeydown={(e) => e.key === 'Escape' && cancelClearUserPlaceVisits()}
						role="dialog"
						aria-modal="true"
						tabindex="-1"
					>
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-[#23232a]"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="document"
						>
							<div class="mb-4 flex items-center gap-3">
								<div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
									<RotateCcw class="h-5 w-5 text-amber-600 dark:text-amber-400" />
								</div>
								<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
									{t('serverAdmin.clearUserPlaceVisitsConfirmTitle')}
								</h3>
							</div>
							<div class="mb-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
								<div class="font-medium text-gray-900 dark:text-gray-100">
									{userToClearPlaceVisits.first_name || ''} {userToClearPlaceVisits.last_name || ''}
								</div>
								<div class="text-sm text-gray-500 dark:text-gray-400">{userToClearPlaceVisits.email}</div>
							</div>
							<p class="mb-6 text-sm text-gray-600 dark:text-gray-300">
								{t('serverAdmin.clearUserPlaceVisitsConfirmMessage')}
							</p>
							<div class="flex justify-end gap-3">
								<button
									onclick={cancelClearUserPlaceVisits}
									class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									{t('serverAdmin.cancel')}
								</button>
								<button
									onclick={confirmClearUserPlaceVisits}
									class="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
								>
									{t('serverAdmin.confirm')}
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="flex h-64 items-center justify-center">
		<div class="text-center">
			<Settings class="mx-auto mb-4 h-12 w-12 text-gray-400" />
			<h2 class="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Access Denied</h2>
			<p class="text-gray-600 dark:text-gray-300">You don't have permission to access this page.</p>
		</div>
	</div>
{/if}
