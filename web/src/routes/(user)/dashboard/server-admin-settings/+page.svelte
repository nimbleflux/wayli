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
		BookOpen,
		Database,
		RefreshCw,
		ArrowRight,
		RotateCcw,
		Globe,
		Gauge,
		Save,
		Loader2,
		MapPin,
		Route,
		CalendarDays
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import RoleSelector from '$lib/components/RoleSelector.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Input from '$lib/components/ui/input/index.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import UserEditModal from '$lib/components/UserEditModal.svelte';
	import { ensureStorageBuckets } from '$lib/services/bucket-ensure.service';
	import { translate } from '$lib/i18n';
	import { customValue } from '$lib/utils/custom-settings';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';
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
	let valhallaEndpoint = $state('https://valhalla.wayli.app');
	let immichEnabled = $state(false);
	let immichEndpoint = $state('');
	let isGeneratingTripRoutes = $state(false);

	// Tavily web-search integration (Fluxbase ai.tool_integrations)
	let tavilyIntegration = $state<any | null>(null);
	let tavilyApiKey = $state('');
	let tavilyBaseURL = $state('https://api.tavily.com');
	let tavilyDepth = $state<'basic' | 'advanced'>('basic');
	let tavilySaving = $state(false);
	let tavilyTesting = $state(false);
	let tavilyTestResult = $state<{ ok: boolean; message: string } | null>(null);
	let tavilyClearing = $state(false);
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
		redirect_urls: string[];
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
	// Allowed redirect URIs (web callback + app deep links); first entry is the default
	let oauthFormRedirectUrls = $state<string[]>([]);
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
	let isDetectingTransportModes = $state(false);
	// Full re-run: re-decode every user's whole window (up to 3 years),
	// ignoring watermarks. Heavier; used after detection-logic changes.
	let reprocessTransportModes = $state(false);
	let isReverseGeocodingAllUsers = $state(false);
	let isRefreshingActivity = $state(false);
	let isForceRegeocoding = $state(false);
	let isFillingCountryCodes = $state(false);
	let showForceRegeocodeConfirm = $state(false);
	// Clear and rebuild place visits
	let showClearPlaceVisitsConfirm = $state(false);
	let isClearingPlaceVisits = $state(false);
	let showClearUserPlaceVisitsConfirm = $state(false);
	let userToClearPlaceVisits = $state<UserProfile | null>(null);
	let isClearingUserPlaceVisits = $state(false);

	// Landing page redirect — select a user whose blog is shown
	let landingRedirectUsername = $state('');
	let usersWithUsernames = $state<
		Array<{ id: string; username: string; full_name: string | null }>
	>([]);
	let isSavingLandingRedirect = $state(false);

	// Community features
	let communityEnabled = $state(true);
	let isSavingCommunity = $state(false);

	// Aggregate "Save all" across the settings blocks (excludes OAuth-provider
	// CRUD and the maintenance job-trigger buttons, which aren't settings saves).
	let isSavingAll = $state(false);

	// AI Settings - provider-based model
	let aiEnabled = $state(false);
	let aiAllowUserOverride = $state(false);
	let providerName = $state('wayli-default');
	let providerDisplayName = $state('OpenAI');
	let providerType = $state('openai');
	let providerModel = $state('gpt-4.1-mini-2025-04-14');
	let providerApiKey = $state('');
	let providerApiKeyConfigured = $state(false);
	let providerApiEndpoint = $state('');
	let providerMaxTokens = $state(4096);
	let providerTemperature = $state(0.7);
	let providerIsDefault = $state(true);
	let providerReadOnly = $state(false);

	// AI usage limits (chatbot-level quotas enforced by Fluxbase). 0 = unlimited,
	// which is the default. Mirrors the pexels_rate_limit toggle pattern.
	let aiQuestionLimitEnabled = $state(false); // Daily question/turn limit on/off
	let aiQuestionLimit = $state(100); // messages/day when enabled
	let aiTokenBudgetEnabled = $state(false); // Daily token budget on/off
	let aiTokenBudget = $state(200000); // tokens/day when enabled

	// Handle Escape key for modals
	$effect(() => {
		if (
			showAddUserModal ||
			isModalOpen ||
			showDeleteConfirm ||
			showClearPlaceVisitsConfirm ||
			showClearUserPlaceVisitsConfirm
		) {
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
			console.log('🔍 [DEBUG] Current user metadata:', session.user.metadata);
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
			toast.error(t('serverAdmin.failedToFetchUsers'), { description: errorMessage });
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

			// Save Valhalla endpoint
			await serviceAdapter.updateCustomSetting(
				'wayli.valhalla_endpoint',
				valhallaEndpoint,
				'Valhalla routing service endpoint URL'
			);

			// Save Immich integration toggle + default endpoint
			await serviceAdapter.updateCustomSetting(
				'wayli.immich_enabled',
				immichEnabled,
				'Enable the Immich photo integration for all users'
			);
			await serviceAdapter.updateCustomSetting(
				'wayli.immich_endpoint',
				immichEndpoint,
				'Default Immich instance URL users can connect to'
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

	// ponytail: Tavily config stored in Fluxbase's ai.tool_integrations table
	// (not app.settings secret) because the supervisor's web agent reads the
	// key from there — app.settings secrets aren't visible to the supervisor.

	// Resolve the existing Tavily web_search integration, if any. Throws on
	// transport/server errors so callers can surface them.
	async function findTavilyIntegration(): Promise<any | null> {
		const { data: integrations, error } = await fluxbase.admin.ai.listIntegrations({
			integration_type: 'web_search' as any
		});
		if (error) throw error;
		return (integrations ?? []).find((i: any) => i.provider === 'tavily') ?? null;
	}

	function isDuplicateIntegrationError(error: any): boolean {
		const msg = String(error?.message ?? error ?? '');
		return (
			msg.includes('23505') ||
			msg.includes('duplicate key') ||
			msg.includes('tool_integrations_name_key')
		);
	}

	async function updateTavilyIntegration(id: string, config: Record<string, string>) {
		const { data, error } = await fluxbase.admin.ai.updateIntegration(id, { config });
		if (error) throw error;
		if (data) tavilyIntegration = data;
	}

	async function saveTavily(): Promise<boolean> {
		tavilySaving = true;
		tavilyTestResult = null;
		try {
			const config: Record<string, string> = {
				base_url: tavilyBaseURL.trim() || 'https://api.tavily.com',
				default_depth: tavilyDepth
			};
			// Only send api_key when the user typed a new one. Sending the
			// masked placeholder back would overwrite the encrypted value.
			if (tavilyApiKey.trim()) {
				config.api_key = tavilyApiKey.trim();
			}

			// The page load may not have finished (or its lookup failed) when
			// the user saves. Resolve the integration fresh so an existing row
			// is updated instead of re-created — create would hit the global
			// unique-name constraint on ai.tool_integrations.
			if (!tavilyIntegration?.id) {
				try {
					tavilyIntegration = await findTavilyIntegration();
				} catch (e) {
					console.warn('Failed to look up existing Tavily integration before save:', e);
				}
			}

			if (tavilyIntegration?.id) {
				await updateTavilyIntegration(tavilyIntegration.id, config);
			} else {
				if (!config.api_key) {
					throw new Error('API key is required when creating the integration');
				}
				// ponytail workaround: Fluxbase rc.6 handler doesn't populate
				// created_by from auth context (fixed in source, awaiting image
				// rebuild). The server still accepts it via the request body, but
				// the SDK type doesn't expose the field — cast to any.
				const { data: userData } = await fluxbase.auth.getUser();
				const userId = userData?.user?.id;
				try {
					const { data, error } = await fluxbase.admin.ai.createIntegration({
						name: 'Tavily',
						integration_type: 'web_search' as any,
						provider: 'tavily' as any,
						config,
						enabled: true,
						is_default: true,
						...(userId ? { created_by: userId } : {})
					} as any);
					if (error) throw error;
					if (data) tavilyIntegration = data;
				} catch (createError: any) {
					// The row exists but wasn't visible to the earlier lookup
					// (e.g. it was created moments ago). Resolve and update it
					// instead of failing the save.
					if (isDuplicateIntegrationError(createError)) {
						const existing = await findTavilyIntegration();
						if (existing?.id) {
							await updateTavilyIntegration(existing.id, config);
							tavilyApiKey = '';
							toast.success(t('serverAdmin.tavilySaved'));
							return true;
						}
					}
					throw createError;
				}
			}
			tavilyApiKey = '';
			toast.success(t('serverAdmin.tavilySaved'));
			return true;
		} catch (error: any) {
			console.error('Failed to save Tavily config:', error);
			toast.error(t('serverAdmin.tavilySaveFailed'), { description: error?.message });
			return false;
		} finally {
			tavilySaving = false;
		}
	}

	async function testTavily() {
		if (!tavilyIntegration?.id) {
			tavilyTestResult = {
				ok: false,
				message: 'Save the integration first before testing.'
			};
			return;
		}
		tavilyTesting = true;
		tavilyTestResult = null;
		try {
			const { data, error } = await fluxbase.admin.ai.testIntegration(tavilyIntegration.id);
			if (error) throw error;
			const ok = data?.status === 'ok';
			tavilyTestResult = {
				ok,
				message: ok ? t('serverAdmin.tavilyTestOk') : data?.error || t('serverAdmin.tavilyTestFail')
			};
			toast[ok ? 'success' : 'error'](tavilyTestResult.message);
		} catch (error: any) {
			tavilyTestResult = { ok: false, message: error?.message || String(error) };
			toast.error(t('serverAdmin.tavilyTestFail'), { description: tavilyTestResult.message });
		} finally {
			tavilyTesting = false;
		}
	}

	async function clearTavilyKey() {
		if (!tavilyIntegration?.id) return;
		tavilyClearing = true;
		try {
			// ponytail: overwrite api_key with empty string; server preserves
			// the rest of the config. Marks the integration as not usable until
			// a new key is provided.
			const { data, error } = await fluxbase.admin.ai.updateIntegration(tavilyIntegration.id, {
				config: { ...(tavilyIntegration.config ?? {}), api_key: '' }
			});
			if (error) throw error;
			if (data) tavilyIntegration = data;
			tavilyApiKey = '';
			toast.success(t('serverAdmin.tavilyKeyCleared'));
		} catch (error: any) {
			toast.error(t('serverAdmin.tavilyClearFailed'), { description: error?.message });
		} finally {
			tavilyClearing = false;
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
		// Client secret is only required when creating a provider; on edit an
		// empty secret keeps the stored one (see oauthClientSecretPlaceholderEdit).
		if (!oauthFormClientId || (!oauthEditingId && !oauthFormClientSecret)) {
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

		// Clean the redirect URI allowlist: trim, drop empties, dedupe (first entry = default)
		const redirectUrls = oauthFormRedirectUrls
			.map((url) => url.trim())
			.filter((url) => url !== '')
			.filter((url, index, all) => all.indexOf(url) === index);
		if (redirectUrls.length === 0) {
			toast.error(t('serverAdmin.oauthRedirectUrisRequired'));
			return;
		}

		isSavingOAuth = true;
		try {
			// Get scopes - use custom scopes for custom provider, defaults otherwise
			const scopes = isCustomProvider
				? oauthFormScopes.split(/[\s,]+/).filter(Boolean)
				: getDefaultScopes(oauthFormProvider);

			const providerName = isCustomProvider ? oauthFormCustomName : oauthFormProvider;
			const displayName =
				oauthFormDisplayName ||
				(isCustomProvider ? oauthFormCustomName : getDefaultDisplayName(oauthFormProvider));

			if (oauthEditingId) {
				// Update existing provider
				const updatePayload: Record<string, unknown> = {
					display_name: displayName,
					client_id: oauthFormClientId,
					redirect_urls: redirectUrls,
					scopes,
					enabled: oauthFormEnabled
				};

				// Only send the secret when a new one was typed; the backend
				// keeps the stored secret when the field is omitted.
				if (oauthFormClientSecret.trim()) {
					updatePayload.client_secret = oauthFormClientSecret.trim();
				}

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
					redirect_urls: redirectUrls,
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

		// Load the stored redirect URI allowlist; ensure the web callback and
		// the mobile deep link stay available even if they were removed earlier
		const storedUrls =
			provider.redirect_urls?.length > 0
				? [...provider.redirect_urls]
				: provider.redirect_url
					? [provider.redirect_url]
					: [];
		const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
		const webCallback = `${baseUrl}/auth/callback`;
		if (!storedUrls.includes(webCallback)) storedUrls.push(webCallback);
		if (!storedUrls.includes('wayli://oauth/callback')) storedUrls.push('wayli://oauth/callback');
		oauthFormRedirectUrls = storedUrls;

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

	// Default allowlist for new providers: the web callback plus the mobile deep link
	function defaultOAuthRedirectUrls(): string[] {
		const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
		return [`${baseUrl}/auth/callback`, 'wayli://oauth/callback'];
	}

	function openOAuthForm() {
		resetOAuthForm();
		showOAuthForm = true;
	}

	function addOAuthRedirectUrl() {
		oauthFormRedirectUrls = [...oauthFormRedirectUrls, ''];
	}

	function removeOAuthRedirectUrl(index: number) {
		if (oauthFormRedirectUrls.length <= 1) return;
		oauthFormRedirectUrls = oauthFormRedirectUrls.filter((_, i) => i !== index);
	}

	function resetOAuthForm() {
		oauthEditingId = null;
		oauthFormProvider = 'google';
		oauthFormDisplayName = '';
		oauthFormClientId = '';
		oauthFormClientSecret = '';
		oauthFormEnabled = true;
		oauthFormRedirectUrls = defaultOAuthRedirectUrls();
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

			// Push usage limits to the wayli-assistant chatbot (0 = unlimited).
			// Fluxbase enforces these server-side on the next message via the
			// field-level partial update (PUT /api/v1/admin/ai/chatbots/:id).
			const dailyRequestLimit = aiQuestionLimitEnabled ? aiQuestionLimit : 0;
			const dailyTokenBudget = aiTokenBudgetEnabled ? aiTokenBudget : 0;
			try {
				const { data: chatbots } = await fluxbase.admin.ai.listChatbots('wayli');
				const chatbot = (chatbots ?? []).find((c: any) => c.name === 'wayli-assistant');
				if (chatbot) {
					await fluxbase.admin.ai.updateChatbot(chatbot.id, {
						daily_request_limit: dailyRequestLimit,
						daily_token_budget: dailyTokenBudget
					});
				}
			} catch (e) {
				console.error('Failed to update chatbot limits:', e);
			}
			// Also persist to wayli.* settings (for record-keeping / reload).
			await serviceAdapter.updateCustomSetting(
				'wayli.ai.daily_request_limit',
				dailyRequestLimit,
				'AI daily question limit (0 = unlimited)'
			);
			await serviceAdapter.updateCustomSetting(
				'wayli.ai.daily_token_budget',
				dailyTokenBudget,
				'AI daily token budget (0 = unlimited)'
			);

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
			const { error } = await fluxbase.jobs.submit(
				'scheduled-detect-place-visits',
				{},
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;

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

	/**
	 * Queue the scheduled (all-users) daily-activity refresh job. Rebuilds each
	 * user's tracker_daily_activity cache from their watermark, which feeds the
	 * activity calendar on the Location Data page. Same job the daily 05:00 UTC
	 * cron runs; this is the manual/admin trigger.
	 */
	async function refreshActivityAllUsers() {
		if (isRefreshingActivity) return;

		isRefreshingActivity = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'scheduled-refresh-daily-activity',
				{},
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;

			toast.success(t('serverAdmin.refreshActivityQueued'));
		} catch (error: any) {
			console.error('Failed to refresh activity for all users:', error);
			toast.error(t('serverAdmin.refreshActivityFailed'), {
				description: error?.message
			});
		} finally {
			isRefreshingActivity = false;
		}
	}

	async function detectTransportModesAllUsers() {
		if (isDetectingTransportModes) return;

		isDetectingTransportModes = true;
		try {
			// Runs the scheduled (all-users) transport-mode detector. The job is
			// incremental per-user (resumes from each user's watermark, or does a
			// full backfill on first run). Same job the daily 04:00 cron runs.
			// With "Full re-run" checked it re-decodes every user's whole window
			// (up to 3 years) — needed after detection-logic changes to relabel
			// history. Manual point corrections are never overwritten either way.
			const { error } = await fluxbase.jobs.submit(
				'scheduled-detect-transport-mode',
				{ reprocess_all: reprocessTransportModes },
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;

			toast.success(
				reprocessTransportModes
					? 'Full transport-mode re-run queued (all history, all users)'
					: t('serverAdmin.detectTransportModesQueued')
			);
			reprocessTransportModes = false;
		} catch (error: any) {
			console.error('Failed to queue transport-mode detection:', error);
			toast.error(t('serverAdmin.detectTransportModesFailed'), {
				description: error?.message
			});
		} finally {
			isDetectingTransportModes = false;
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
			toast.success(t('serverAdmin.userDeleted'));
		} else {
			let errorDescription = 'An unknown error occurred while deleting the user.';
			try {
				const result = await response.json();
				errorDescription = result.error || result.message || errorDescription;
			} catch {
				// The response was not JSON, which is fine. The server might have crashed.
			}
			toast.error(t('serverAdmin.failedToDeleteUser'), { description: errorDescription });
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

			if ((data as any)?.success) {
				toast.success(t('serverAdmin.userUpdated'));
				handleCloseModal();
				await invalidateAll(); // Refresh the user list
			} else {
				const errorDescription = (data as any)?.error || t('serverAdmin.failedToUpdateUser');
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
		const session = $sessionStore;
		if (!session) return;

		let result: AdminSettingsResponse;
		try {
			const serviceAdapter = new ServiceAdapter({ session });
			result = await serviceAdapter.getAllSettings();
		} catch (error: any) {
			console.error('❌ Failed to load custom settings:', error);
			// Provide safe defaults so the rest of the page can render
			result = {
				app: {
					authentication: {
						enable_signup: true,
						require_email_verification: false,
						read_only: false
					},
					features: {
						enable_realtime: true,
						enable_storage: true,
						enable_functions: true,
						enable_jobs: true,
						enable_rpc: true
					},
					security: {},
					email: { provider: 'none' },
					storage: {},
					ai: {}
				} as any,
				custom: {}
			};
			toast.error(t('serverAdmin.failedToLoadSettings'), {
				description: error?.message || 'Custom settings endpoint unavailable'
			});
		}

		// App settings - result is already typed correctly
		const { app, custom } = result;

		// Authentication - use auth settings API as the source of truth
		try {
			const authSettings = await fluxbase.admin.oauth.authSettings.get();
			enableSignup = authSettings.enable_signup;
			requireEmailVerification = authSettings.require_email_verification;
			disablePasswordLogin = authSettings.disable_app_password_login ?? false;
			authReadOnly = !!(authSettings._overrides && Object.keys(authSettings._overrides).length > 0);
		} catch {
			// Fallback to app settings if auth API unavailable
			enableSignup = app?.authentication?.enable_signup ?? true;
			requireEmailVerification = app?.authentication?.require_email_verification ?? false;
			authReadOnly = app?.authentication?.read_only ?? false;
		}

		emailProvider = app?.email?.provider ?? 'none';
		smtpHost = app?.email?.smtp_host ?? '';
		smtpPort = app?.email?.smtp_port ?? 587;
		smtpUsername = app?.email?.smtp_username ?? '';
		smtpUseTls = app?.email?.smtp_tls ?? true;
		smtpFromAddress = app?.email?.from_address ?? '';
		smtpFromName = app?.email?.from_name ?? 'Wayli';

		// Email - now using flat EmailProviderSettings structure from SDK
		emailProvider = app?.email?.provider;
		smtpHost = app?.email?.smtp_host ?? '';
		smtpPort = app?.email?.smtp_port ?? 587;
		smtpUsername = app?.email?.smtp_username ?? '';
		smtpUseTls = app?.email?.smtp_tls ?? true;
		smtpFromAddress = app?.email?.from_address ?? '';
		smtpFromName = app?.email?.from_name ?? 'Wayli';
		// Note: SMTP password is not returned for security (smtp_password_set indicates if configured)

		// Per-field read-only status from _overrides
		emailProviderReadOnly = app?.email?._overrides?.provider?.is_overridden ?? false;
		emailSmtpReadOnly = app?.email?._overrides?.smtp_host?.is_overridden ?? false;

		// Features
		enableRealtime = app?.features?.enable_realtime ?? true;
		enableStorage = app?.features?.enable_storage ?? true;
		enableFunctions = app?.features?.enable_functions ?? true;

		// Security
		enableRateLimiting = app?.security?.enable_global_rate_limit ?? false;

		// AI Settings - load from provider-based model
		if (app.ai) {
			aiEnabled = app?.ai?.enabled ?? false;
			aiAllowUserOverride = app?.ai?.allow_user_provider_override ?? false;

			// Load default provider into form if available
			const defaultProvider = app?.ai?.default_provider;
			providerApiKeyConfigured = false;
			if (defaultProvider) {
				providerName = 'wayli-default'; // Always use fixed provider name
				providerDisplayName = defaultProvider.display_name ?? 'OpenAI';
				providerType = defaultProvider.provider_type ?? 'openai';
				providerModel = defaultProvider.config?.model ?? 'gpt-4.1-mini-2025-04-14';
				providerApiEndpoint = defaultProvider.config?.api_endpoint ?? '';
				providerMaxTokens = defaultProvider.config?.max_tokens ?? 4096;
				providerTemperature = defaultProvider.config?.temperature ?? 0.7;
				providerIsDefault = defaultProvider.is_default ?? true;
				providerReadOnly = defaultProvider.read_only ?? false;
				// The API key itself is never returned; the server masks it
				// with a sentinel when one is stored.
				providerApiKeyConfigured = defaultProvider.config?.api_key === '***masked***';
			}

			// Load chatbot usage limits from the live wayli-assistant record.
			// These are enforced by Fluxbase server-side; 0 = unlimited.
			try {
				const { data: chatbots } = await fluxbase.admin.ai.listChatbots('wayli');
				// The SDK's AIChatbotSummary type doesn't (yet) include the usage
				// limit fields the API returns; widen the found record with them.
				const chatbot = (chatbots ?? []).find((c: any) => c.name === 'wayli-assistant') as
					{ daily_request_limit?: number | null; daily_token_budget?: number | null } | undefined;
				if (chatbot) {
					const q = chatbot.daily_request_limit ?? 0;
					aiQuestionLimitEnabled = q > 0;
					aiQuestionLimit = q > 0 ? q : 100;
					const tk = chatbot.daily_token_budget ?? 0;
					aiTokenBudgetEnabled = tk > 0;
					aiTokenBudget = tk > 0 ? tk : 200000;
				}
			} catch (e) {
				console.error('Failed to load chatbot limits:', e);
			}
		}

		// Custom Wayli settings — `custom` is a raw key → value map (see
		// WayliCustomSettings); customValue() also tolerates legacy wrapped
		// shapes in case an older endpoint ever serves them again.
		serverName = customValue<string>(custom, 'wayli.server_name', '') || '';

		// Note: Auth settings (enableSignup, requireEmailVerification, disablePasswordLogin)
		// are loaded above from fluxbase.admin.oauth.authSettings.get()

		// Load Pexels rate limit (0 = unlimited)
		const loadedRateLimit = customValue<number>(custom, 'wayli.pexels_rate_limit', 200) ?? 200;
		if (loadedRateLimit === 0) {
			pexelsRateLimitEnabled = false;
			pexelsRateLimit = 200; // Default value for when re-enabled
		} else {
			pexelsRateLimitEnabled = true;
			pexelsRateLimit = loadedRateLimit;
		}

		// Load Pelias endpoint
		peliasEndpoint =
			customValue<string>(custom, 'wayli.pelias_endpoint', 'https://pelias.wayli.app') ||
			'https://pelias.wayli.app';

		// Load Valhalla endpoint
		valhallaEndpoint =
			customValue<string>(custom, 'wayli.valhalla_endpoint', 'https://valhalla.wayli.app') ||
			'https://valhalla.wayli.app';

		// Load Immich integration settings
		immichEnabled = customValue<boolean>(custom, 'wayli.immich_enabled', false) || false;
		immichEndpoint = customValue<string>(custom, 'wayli.immich_endpoint', '') || '';

		// Load Pexels API key secret metadata (value is not returned)
		if (result.secrets?.pexels_api_key) {
			pexelsApiKeyConfigured = true;
			pexelsApiKeyUpdatedAt = result.secrets.pexels_api_key.updated_at;
		} else {
			pexelsApiKeyConfigured = false;
			pexelsApiKeyUpdatedAt = null;
		}

		// Load Tavily integration (Fluxbase ai.tool_integrations)
		try {
			const existing = await findTavilyIntegration();
			tavilyIntegration = existing;
			if (existing) {
				tavilyBaseURL = existing.config?.base_url || 'https://api.tavily.com';
				tavilyDepth = (existing.config?.default_depth as 'basic' | 'advanced') || 'basic';
			}
		} catch (err: any) {
			// Surface this: a silently failed lookup makes saving fall back to
			// "create", which then fails on the unique-name constraint.
			console.warn('Failed to load Tavily integration:', err);
			toast.warning(t('serverAdmin.tavilyLoadFailed'), { description: err?.message });
		}

		console.log('✅ Settings loaded successfully');

		// Ensure required storage buckets exist (self-healing)
		ensureStorageBuckets().catch(() => {});

		// Load landing redirect + community settings from the already-fetched
		// `custom` map (getAllSettings above) instead of two extra per-key
		// requests that 404 on a fresh install.
		const redirectUser = customValue<string>(custom, 'wayli.landing_redirect_username');
		if (redirectUser && typeof redirectUser === 'string' && redirectUser.trim()) {
			landingRedirectUsername = redirectUser.trim();
		}

		const commVal = customValue(custom, 'wayli.community_enabled');
		communityEnabled = !(commVal === false || commVal === 'false');

		// Load users independently (not blocked by settings errors)
		try {
			const { data: usersData } = await fluxbase
				.from('user_profiles')
				.select('id, username, full_name')
				.not('username', 'is', null);
			usersWithUsernames = (usersData as any[]) ?? [];
		} catch {
			// Can't load users — selector will be empty
		}
	}

	onMount(() => {
		// Load all settings when component mounts
		loadAllSettings();
		loadOAuthProviders();
	});

	async function saveLandingRedirect() {
		isSavingLandingRedirect = true;
		try {
			const username = landingRedirectUsername || null;
			// is_public so anonymous landing visitors can read it (the landing
			// page reads this from the central settings store, which runs an
			// anon-allowed bulk fetch; non-public rows are hidden from anon by RLS).
			await fluxbase.admin.settings.app.setSetting(
				'wayli.landing_redirect_username',
				{ value: username },
				{
					description: 'Username whose public journal is shown as the landing page',
					is_public: true
				}
			);
			toast.success(username ? "Landing page set to user's blog" : 'Landing page reset to default');
		} catch {
			toast.error('Failed to save landing page setting');
		} finally {
			isSavingLandingRedirect = false;
		}
	}

	async function saveCommunitySettings() {
		isSavingCommunity = true;
		try {
			// is_public so anonymous landing visitors honor the community-enabled
			// gate (previously anon never saw this and always fell through).
			await fluxbase.admin.settings.app.setSetting(
				'wayli.community_enabled',
				{ value: communityEnabled },
				{
					description: 'Enable community hub as the landing page',
					is_public: true
				}
			);
			toast.success(communityEnabled ? 'Community hub enabled' : 'Community hub disabled');
		} catch {
			toast.error('Failed to save community setting');
		} finally {
			isSavingCommunity = false;
		}
	}

	async function generateTripRoutesAllUsers() {
		if (isGeneratingTripRoutes) return;

		isGeneratingTripRoutes = true;
		try {
			// Snap the trips of every user who opted into the road-snapping
			// beta (account setting) to the road network via Valhalla —
			// backfill + keep-fresh; same job the daily cron runs.
			// tracker_data is never modified — only trips.metadata.
			const { error } = await fluxbase.jobs.submit(
				'scheduled-generate-trip-routes',
				{},
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;
			toast.success('Trip route generation queued');
		} catch (error: any) {
			console.error('Failed to queue trip route generation:', error);
			toast.error('Failed to queue trip route generation', {
				description: error?.message
			});
		} finally {
			isGeneratingTripRoutes = false;
		}
	}

	/**
	 * Persist all settings blocks in one action. Each block's own handler
	 * validates + writes + toasts; this orchestrates them and adds a single
	 * summary. OAuth provider CRUD and maintenance job-trigger buttons are
	 * intentionally excluded (per-provider / not "settings").
	 */
	async function saveAll() {
		if (isSavingAll) return;
		isSavingAll = true;
		const steps: { label: string; ok: boolean }[] = [
			{ label: 'General', ok: false },
			{ label: 'Web search', ok: false },
			{ label: 'Authentication', ok: false },
			{ label: 'Email', ok: false },
			{ label: 'AI', ok: false },
			{ label: 'Landing redirect', ok: false },
			{ label: 'Community', ok: false }
		];
		const run = async (fn: () => Promise<boolean | void>, idx: number) => {
			try {
				const ok = await fn();
				steps[idx].ok = ok !== false;
			} catch {
				steps[idx].ok = false;
			}
		};
		await run(saveWayliSettings, 0);
		await run(saveTavily, 1);
		await run(saveAuthSettings, 2);
		await run(saveEmailSettings, 3);
		await run(saveAISettings, 4);
		await run(saveLandingRedirect, 5);
		await run(saveCommunitySettings, 6);

		const failed = steps.filter((s) => !s.ok);
		if (failed.length === 0) {
			toast.success('All settings saved');
		} else {
			toast.error(
				`Saved with ${failed.length} block(s) failing: ${failed.map((s) => s.label).join(', ')}`
			);
		}
		isSavingAll = false;
	}

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
			toast.error(t('serverAdmin.fillRequiredFields'));
			return;
		}

		if (!newUserPassword || newUserPassword.length < 6) {
			toast.error(t('serverAdmin.passwordMinLengthError'));
			return;
		}

		if (newUserPassword !== newUserConfirmPassword) {
			toast.error(t('serverAdmin.passwordsDoNotMatch'));
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

			if ((data as any)?.success) {
				toast.success(t('serverAdmin.userAdded'));
				handleCloseAddUserModal();
				await invalidateAll(); // Refresh the user list
			} else {
				const errorDescription =
					(data as any)?.error || 'An unknown error occurred while adding the user.';
				toast.error(t('serverAdmin.failedToAddUser'), { description: errorDescription });
			}
		} catch (error: any) {
			console.error('Error adding user:', error);
			const errorMessage = error?.message || error?.error || 'An unexpected error occurred.';
			toast.error(t('serverAdmin.failedToAddUser'), { description: errorMessage });
		}
	}
</script>

<svelte:head>
	<title>{t('serverAdmin.title')} · Wayli</title>
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
			class="bg-card relative w-full max-w-lg rounded-xl p-8 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Modal Header -->
			<div class="mb-6 flex items-start justify-between">
				<div>
					<h2 id="add-user-modal-title" class="text-foreground text-2xl font-bold">Add New User</h2>
					<p class="text-muted-foreground">Create a new user account.</p>
				</div>
				<button
					onclick={handleCloseAddUserModal}
					class="text-muted-foreground hover:bg-muted dark:hover:bg-muted rounded-full p-1 transition-colors"
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
							class="text-muted-foreground mb-1 block text-sm font-medium">First Name *</label
						>
						<div class="relative">
							<UserIcon
								class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
							/>
							<Input
								type="text"
								id="newUserFirstName"
								bind:value={newUserFirstName}
								class="w-full"
								placeholder={t('serverAdmin.firstNamePlaceholder')}
								required
							/>
						</div>
					</div>

					<div>
						<label
							for="newUserLastName"
							class="text-muted-foreground mb-1 block text-sm font-medium">Last Name *</label
						>
						<div class="relative">
							<UserIcon
								class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
							/>
							<Input
								type="text"
								id="newUserLastName"
								bind:value={newUserLastName}
								class="w-full"
								placeholder={t('serverAdmin.lastNamePlaceholder')}
								required
							/>
						</div>
					</div>
				</div>

				<div>
					<label for="newUserEmail" class="text-muted-foreground mb-1 block text-sm font-medium"
						>Email Address *</label
					>
					<div class="relative">
						<Mail class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
						<Input
							type="email"
							id="newUserEmail"
							bind:value={newUserEmail}
							class="w-full"
							placeholder={t('serverAdmin.emailPlaceholder')}
							required
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label
							for="newUserPassword"
							class="text-muted-foreground mb-1 block text-sm font-medium">Password *</label
						>
						<div class="relative">
							<Lock
								class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
							/>
							<Input
								type="password"
								id="newUserPassword"
								bind:value={newUserPassword}
								class="w-full"
								placeholder={t('serverAdmin.passwordMinPlaceholder')}
								required
							/>
						</div>
					</div>

					<div>
						<label
							for="newUserConfirmPassword"
							class="text-muted-foreground mb-1 block text-sm font-medium">Confirm Password *</label
						>
						<div class="relative">
							<Lock
								class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
							/>
							<Input
								type="password"
								id="newUserConfirmPassword"
								bind:value={newUserConfirmPassword}
								class="w-full"
								placeholder={t('serverAdmin.confirmPasswordPlaceholder')}
								required
							/>
						</div>
					</div>
				</div>

				<div>
					<span class="text-muted-foreground mb-2 block text-sm font-medium">Role</span>
					<RoleSelector bind:role={newUserRole} />
				</div>
			</div>

			<!-- Modal Footer -->
			<div class="mt-8 flex justify-end gap-3">
				<button
					onclick={handleCloseAddUserModal}
					class="dark:text-muted-foreground hover:bg-muted rounded-lg px-5 py-2.5 text-sm font-medium text-gray-700"
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
			class="bg-card relative w-full max-w-md rounded-lg p-6 shadow-xl"
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
					<h3 id="delete-user-modal-title" class="text-foreground text-lg font-medium">
						Delete User
					</h3>
					<p id="delete-user-modal-description" class="text-muted-foreground text-sm">
						Are you sure you want to delete this user? This action cannot be undone.
					</p>
				</div>
			</div>

			<div class="dark:bg-muted mb-4 rounded-lg bg-gray-50 p-4">
				<div class="flex items-center">
					<div>
						<div class="text-foreground text-sm font-medium">
							{getUserDisplayName(userToDelete)}
						</div>
						<div class="text-muted-foreground text-sm">{userToDelete.email}</div>
					</div>
				</div>
			</div>

			<div class="flex justify-end space-x-3">
				<button
					type="button"
					onclick={handleCloseDeleteConfirm}
					class="dark:text-muted-foreground hover:bg-muted cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-gray-700"
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
		<div class="mb-8 flex items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<Settings class="text-primary h-6 w-6" />
				<div>
					<h1 class="text-foreground text-xl font-bold">{t('serverAdmin.title')}</h1>
					<p class="text-muted-foreground text-sm">Server configuration and administration</p>
				</div>
			</div>
			<button
				type="button"
				onclick={saveAll}
				disabled={isSavingAll}
				class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if isSavingAll}
					<Loader2 class="h-4 w-4 animate-spin" />
					Saving…
				{:else}
					<Save class="h-4 w-4" />
					Save all
				{/if}
			</button>
		</div>

		<!-- Tab Navigation -->
		<div class="border-border mb-6 border-b">
			<nav class="-mb-px flex space-x-8">
				<button
					class="cursor-pointer border-b-2 px-1 py-2 text-sm font-medium {activeTab === 'settings'
						? 'border-primary text-primary dark:border-primary dark:text-primary'
						: 'text-muted-foreground hover:border-border hover:text-foreground dark:hover:text-muted-foreground border-transparent'}"
					onclick={() => (activeTab = 'settings')}
				>
					<div class="flex items-center gap-2">
						<Server class="h-4 w-4" />
						{t('serverAdmin.general')}
					</div>
				</button>
				<button
					class="cursor-pointer border-b-2 px-1 py-2 text-sm font-medium {activeTab === 'users'
						? 'border-primary text-primary dark:border-primary dark:text-primary'
						: 'text-muted-foreground hover:border-border hover:text-foreground dark:hover:text-muted-foreground border-transparent'}"
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
				class="border-border dark:border-border dark:bg-card mb-8 rounded-xl border bg-white p-6"
			>
				<div class="mb-4">
					<h2 class="text-foreground text-xl font-semibold">User Management</h2>
					<p class="text-muted-foreground mt-1 text-sm">
						Manage users and their permissions. Total users: {pagination.total}
						{#if searchQuery}
							(Showing {users.length} filtered results)
						{/if}
					</p>
				</div>

				<div class="mb-6 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<div class="relative">
							<Search
								class="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
							/>
							<Input
								type="text"
								bind:value={searchQuery}
								placeholder={t('serverAdmin.searchUsersPlaceholder')}
								class="w-full"
								oninput={handleSearchInput}
							/>
						</div>
						<!-- Items per page selector -->
						<select bind:value={itemsPerPage} onchange={handleItemsPerPageChange} class="w-full">
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
					class="border-border dark:border-border dark:bg-card overflow-hidden rounded-lg border bg-white"
				>
					{#if users.length === 0}
						<div class="py-8 text-center">
							<UserIcon class="text-muted-foreground mx-auto h-12 w-12" />
							<h3 class="text-foreground mt-2 text-sm font-medium">No users found</h3>
							<p class="text-muted-foreground mt-1 text-sm">
								{searchQuery
									? 'Try adjusting your search terms.'
									: 'No users have been created yet.'}
							</p>
						</div>
					{:else}
						<table class="divide-border dark:divide-border min-w-full divide-y">
							<thead class="dark:bg-muted bg-gray-50">
								<tr>
									<th
										scope="col"
										class="text-muted-foreground px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
									>
										User
									</th>
									<th
										scope="col"
										class="text-muted-foreground px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
									>
										Role
									</th>
									<th
										scope="col"
										class="text-muted-foreground px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
									>
										Created
									</th>
									<th
										scope="col"
										class="text-muted-foreground px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
									>
										Status
									</th>
									<th scope="col" class="relative px-6 py-3">
										<span class="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody class="divide-border dark:divide-border dark:bg-card divide-y bg-white">
								{#each users as user (user.id)}
									<tr>
										<td class="px-6 py-4 whitespace-nowrap">
											<div class="flex items-center gap-3">
												<UserAvatar {user} size="lg" />
												<div>
													<div class="text-foreground text-sm font-medium">
														{getUserDisplayName(user)}
													</div>
													<div class="text-muted-foreground text-sm">{user.email}</div>
												</div>
											</div>
										</td>
										<td class="px-6 py-4 whitespace-nowrap">
											<span
												class="inline-flex rounded-full px-2 text-xs leading-5 font-semibold {user.role ===
												'admin'
													? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
													: 'dark:bg-background/20 dark:text-muted-foreground bg-gray-100 text-gray-800'}"
											>
												{user.role === 'admin' ? 'Admin' : 'User'}
											</span>
										</td>
										<td class="text-muted-foreground px-6 py-4 text-sm whitespace-nowrap">
											{formatDate(user.created_at)}
										</td>
										<td class="text-muted-foreground px-6 py-4 text-sm whitespace-nowrap">
											Active
										</td>
										<td class="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
											<div class="flex items-center justify-end gap-2">
												<button
													class="text-muted-foreground hover:bg-muted hover:text-muted-foreground cursor-pointer rounded p-1"
													onclick={() => handleEditUser(user)}
													title="Edit user"
												>
													<Edit class="h-4 w-4" />
												</button>
												<button
													class="text-muted-foreground cursor-pointer rounded p-1 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
													onclick={() => handleClearUserPlaceVisits(user)}
													title={t('serverAdmin.clearUserPlaceVisits')}
												>
													<RotateCcw class="h-4 w-4" />
												</button>
												<button
													class="text-muted-foreground cursor-pointer rounded p-1 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
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
								class="border-border dark:border-border dark:bg-card border-t bg-white px-6 py-3"
							>
								<div class="flex items-center justify-between">
									<div class="text-muted-foreground flex items-center text-sm">
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
											class="text-muted-foreground hover:bg-muted relative inline-flex items-center rounded-md px-2 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
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
													: 'text-muted-foreground hover:bg-muted dark:hover:bg-muted'}"
											>
												{pageNum}
											</button>
										{/each}

										<!-- Next button -->
										<button
											onclick={goToNextPage}
											disabled={!pagination.hasNext}
											class="text-muted-foreground hover:bg-muted relative inline-flex items-center rounded-md px-2 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
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
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4">
						<h2 class="text-foreground text-xl font-semibold">
							{t('serverAdmin.wayliSettings')}
						</h2>
						<p class="text-muted-foreground mt-1 text-sm">
							{t('serverAdmin.wayliSettingsDescription')}
						</p>
					</div>

					<div class="space-y-4">
						<div>
							<label for="serverName" class="text-muted-foreground block text-sm font-medium">
								{t('serverAdmin.serverName')}
							</label>
							<Input
								type="text"
								id="serverName"
								bind:value={serverName}
								class="w-full"
								placeholder={t('serverAdmin.enterServerName')}
							/>
						</div>

						<div>
							<label
								for="serverPexelsApiKey"
								class="text-muted-foreground block text-sm font-medium"
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
									<Input
										type="password"
										id="serverPexelsApiKey"
										bind:value={serverPexelsApiKey}
										class="w-full"
										placeholder={t('serverAdmin.enterNewKeyToReplace')}
									/>
								</div>
							{:else}
								<Input
									type="password"
									id="serverPexelsApiKey"
									bind:value={serverPexelsApiKey}
									class="w-full"
									placeholder={t('serverAdmin.enterPexelsApiKey')}
								/>
							{/if}
							<p class="text-muted-foreground mt-1 text-xs">
								{t('serverAdmin.serverPexelsKeyDescription')}
							</p>
						</div>

						<div>
							<div class="flex items-center justify-between">
								<span class="text-muted-foreground block text-sm font-medium">
									Enable Pexels API Rate Limit
								</span>
								<Switch
									bind:checked={pexelsRateLimitEnabled}
									label="Enable Pexels API Rate Limit"
								/>
							</div>
							<p class="text-muted-foreground mt-1 text-xs">
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
										class="text-muted-foreground block text-sm font-medium"
									>
										Requests per hour
									</label>
									<Input
										type="number"
										id="pexelsRateLimit"
										bind:value={pexelsRateLimit}
										min="1"
										step="1"
										class="w-full"
										placeholder={t('serverAdmin.rateLimitPlaceholder')}
									/>
									<p class="text-muted-foreground mt-1 text-xs">
										Default: 200 (Pexels free tier limit)
									</p>
								</div>
							{/if}
						</div>

						<div>
							<label for="peliasEndpoint" class="text-muted-foreground block text-sm font-medium">
								Pelias Geocoding Endpoint
							</label>
							<Input
								type="url"
								id="peliasEndpoint"
								bind:value={peliasEndpoint}
								class="w-full"
								placeholder={t('serverAdmin.peliasEndpointPlaceholder')}
								pattern="https?://.+"
								required
							/>
							<p class="text-muted-foreground mt-1 text-xs">
								Geocoding service URL for address lookups and reverse geocoding
							</p>
						</div>

						<div>
							<label for="valhallaEndpoint" class="text-muted-foreground block text-sm font-medium">
								Valhalla Routing Endpoint
							</label>
							<Input
								type="url"
								id="valhallaEndpoint"
								bind:value={valhallaEndpoint}
								class="w-full"
								placeholder="https://valhalla.wayli.app"
								pattern="https?://.+"
							/>
							<p class="text-muted-foreground mt-1 text-xs">
								Routing service URL for map-matching transport detection (used when a user enables
								it in their preferences)
							</p>
						</div>

						<div class="rounded-md border p-3">
							<div class="flex items-center justify-between">
								<label for="immichEnabled" class="block text-sm font-medium">
									Immich Photo Integration
								</label>
								<Switch bind:checked={immichEnabled} />
							</div>
							<div class="mt-3">
								<label for="immichEndpoint" class="text-muted-foreground block text-sm font-medium">
									Default Immich Endpoint
								</label>
								<Input
									type="url"
									id="immichEndpoint"
									bind:value={immichEndpoint}
									class="mt-1 w-full"
									placeholder="http://immich.local:2283"
									pattern="https?://.+"
								/>
								<p class="text-muted-foreground mt-1 text-xs">
									Default Immich instance URL offered to users on the Connections page (users can
									enter their own). The integration is hidden from all users while disabled.
								</p>
							</div>
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
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4">
						<h2 class="text-foreground text-xl font-semibold">
							{t('serverAdmin.authenticationSettings')}
						</h2>
						<p class="text-muted-foreground mt-1 text-sm">
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
							<span class="text-muted-foreground text-sm">
								{t('serverAdmin.enableSignup')}
							</span>
							<Switch
								bind:checked={enableSignup}
								label={t('serverAdmin.enableSignup')}
								disabled={authReadOnly}
							/>
						</div>

						<div class="flex items-center justify-between">
							<span class="text-muted-foreground text-sm">
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
								<span class="text-muted-foreground text-sm">
									{t('serverAdmin.disablePasswordLogin')}
								</span>
								<p class="text-muted-foreground text-xs">
									{t('serverAdmin.disablePasswordLoginDescription')}
								</p>
							</div>
							<Switch
								bind:checked={disablePasswordLogin}
								label={t('serverAdmin.disablePasswordLogin')}
								disabled={authReadOnly || oauthProviders.filter((p) => p.enabled).length === 0}
							/>
						</div>

						{#if disablePasswordLogin && oauthProviders.filter((p) => p.enabled).length === 0}
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
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4">
						<h2 class="text-foreground text-xl font-semibold">
							{t('serverAdmin.emailSettings')}
						</h2>
						<p class="text-muted-foreground mt-1 text-sm">
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

						<div class="dark:bg-card border-border space-y-3 rounded border bg-gray-50 p-4">
							<h3 class="text-foreground font-medium">
								{t('serverAdmin.smtpConfiguration')}
							</h3>

							<div class="grid grid-cols-2 gap-4">
								<div>
									<label for="smtpHost" class="text-muted-foreground block text-sm font-medium">
										{t('serverAdmin.smtpHost')}
									</label>
									<Input
										id="smtpHost"
										type="text"
										bind:value={smtpHost}
										disabled={emailSmtpReadOnly}
										class="w-full"
										placeholder={t('serverAdmin.smtpHostPlaceholder')}
									/>
								</div>

								<div>
									<label for="smtpPort" class="text-muted-foreground block text-sm font-medium">
										{t('serverAdmin.smtpPort')}
									</label>
									<Input
										id="smtpPort"
										type="number"
										bind:value={smtpPort}
										disabled={emailSmtpReadOnly}
										class="w-full"
										placeholder={t('serverAdmin.smtpPortPlaceholder')}
									/>
								</div>
							</div>

							<div>
								<label for="smtpUsername" class="text-muted-foreground block text-sm font-medium">
									{t('serverAdmin.smtpUsername')}
								</label>
								<Input
									id="smtpUsername"
									type="text"
									bind:value={smtpUsername}
									disabled={emailSmtpReadOnly}
									class="w-full"
									placeholder={t('serverAdmin.smtpUsernamePlaceholder')}
								/>
							</div>

							<div>
								<label for="smtpPassword" class="text-muted-foreground block text-sm font-medium">
									{t('serverAdmin.smtpPassword')}
								</label>
								<Input
									id="smtpPassword"
									type="password"
									bind:value={smtpPassword}
									disabled={emailSmtpReadOnly}
									class="w-full"
									placeholder={t('serverAdmin.smtpPasswordPlaceholder')}
								/>
							</div>

							<div class="flex items-center justify-between">
								<span class="text-muted-foreground text-sm">
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
									class="text-muted-foreground block text-sm font-medium"
								>
									{t('serverAdmin.smtpFromAddress')}
								</label>
								<Input
									id="smtpFromAddress"
									type="email"
									bind:value={smtpFromAddress}
									disabled={emailSmtpReadOnly}
									class="w-full"
									placeholder={t('serverAdmin.smtpFromAddressPlaceholder')}
								/>
							</div>

							<div>
								<label for="smtpFromName" class="text-muted-foreground block text-sm font-medium">
									{t('serverAdmin.smtpFromName')}
								</label>
								<Input
									id="smtpFromName"
									type="text"
									bind:value={smtpFromName}
									disabled={emailSmtpReadOnly}
									class="w-full"
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
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4 flex items-center gap-3">
						<Lock class="h-6 w-6 text-indigo-500" />
						<div>
							<h2 class="text-foreground text-xl font-semibold">
								{t('serverAdmin.oauthSettings')}
							</h2>
							<p class="text-muted-foreground mt-1 text-sm">
								{t('serverAdmin.oauthSettingsDescription')}
							</p>
						</div>
					</div>

					<div class="space-y-4">
						<!-- Configured Providers List -->
						{#if isLoadingOAuth}
							<div class="flex items-center justify-center py-8">
								<RefreshCw class="text-muted-foreground h-5 w-5 animate-spin" />
							</div>
						{:else if oauthProviders.length > 0}
							<div class="space-y-2">
								{#each oauthProviders as provider}
									<div
										class="dark:bg-card border-border flex items-center justify-between rounded-lg border bg-gray-50 p-3"
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
												<div class="text-foreground text-sm font-medium">
													{provider.display_name}
												</div>
												<div class="text-muted-foreground text-xs">
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
												class="text-muted-foreground hover:bg-muted dark:hover:bg-muted hover:text-muted-foreground rounded p-1.5"
												title={t('serverAdmin.edit')}
											>
												<Edit class="h-4 w-4" />
											</button>
											<button
												onclick={() => deleteOAuthProvider(provider.id)}
												class="text-muted-foreground rounded p-1.5 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
												title={t('serverAdmin.delete')}
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-muted-foreground py-4 text-center text-sm">
								{t('serverAdmin.noOAuthProviders')}
							</p>
						{/if}

						<!-- Add/Edit Provider Form -->
						{#if showOAuthForm}
							<div
								class="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-900/20"
							>
								<h3 class="text-foreground font-medium">
									{oauthEditingId
										? t('serverAdmin.editOAuthProvider')
										: t('serverAdmin.addOAuthProvider')}
								</h3>

								<div>
									<label
										for="oauthProvider"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.oauthProvider')}
									</label>
									<select
										id="oauthProvider"
										bind:value={oauthFormProvider}
										disabled={!!oauthEditingId}
										class="w-full"
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
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.oauthCustomName')}
										</label>
										<Input
											id="oauthCustomName"
											type="text"
											bind:value={oauthFormCustomName}
											class="w-full"
											placeholder={t('serverAdmin.oauthCustomNamePlaceholder')}
										/>
										<p class="text-muted-foreground mt-1 text-xs">
											{t('serverAdmin.oauthCustomNameHint')}
										</p>
									</div>

									<!-- Discovery URL -->
									<div>
										<label
											for="oauthDiscoveryUrl"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.oauthDiscoveryUrl')}
										</label>
										<div class="mt-1 flex gap-2">
											<Input
												id="oauthDiscoveryUrl"
												type="url"
												bind:value={oauthFormDiscoveryUrl}
												class="w-full"
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
										<p class="text-muted-foreground mt-1 text-xs">
											{t('serverAdmin.oauthDiscoveryUrlHint')}
										</p>
									</div>

									<!-- Authorization URL -->
									<div>
										<label
											for="oauthAuthorizationUrl"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.oauthAuthorizationUrl')}
										</label>
										<Input
											id="oauthAuthorizationUrl"
											type="url"
											bind:value={oauthFormAuthorizationUrl}
											class="w-full"
											placeholder={t('serverAdmin.oauthAuthorizationUrlPlaceholder')}
										/>
									</div>

									<!-- Token URL -->
									<div>
										<label
											for="oauthTokenUrl"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.oauthTokenUrl')}
										</label>
										<Input
											id="oauthTokenUrl"
											type="url"
											bind:value={oauthFormTokenUrl}
											class="w-full"
											placeholder={t('serverAdmin.oauthTokenUrlPlaceholder')}
										/>
									</div>

									<!-- User Info URL -->
									<div>
										<label
											for="oauthUserInfoUrl"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.oauthUserInfoUrl')}
										</label>
										<Input
											id="oauthUserInfoUrl"
											type="url"
											bind:value={oauthFormUserInfoUrl}
											class="w-full"
											placeholder={t('serverAdmin.oauthUserInfoUrlPlaceholder')}
										/>
									</div>

									<!-- Scopes -->
									<div>
										<label
											for="oauthScopes"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.oauthScopes')}
										</label>
										<Input
											id="oauthScopes"
											type="text"
											bind:value={oauthFormScopes}
											class="w-full"
											placeholder={t('serverAdmin.oauthScopesPlaceholder')}
										/>
										<p class="text-muted-foreground mt-1 text-xs">
											{t('serverAdmin.oauthScopesHint')}
										</p>
									</div>
								{/if}

								<div>
									<label
										for="oauthDisplayName"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.oauthDisplayName')}
									</label>
									<Input
										id="oauthDisplayName"
										type="text"
										bind:value={oauthFormDisplayName}
										class="w-full"
										placeholder={oauthFormProvider === 'custom'
											? t('serverAdmin.oauthDisplayNamePlaceholder')
											: getDefaultDisplayName(oauthFormProvider)}
									/>
								</div>

								<div>
									<label
										for="oauthClientId"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.oauthClientId')}
									</label>
									<Input
										id="oauthClientId"
										type="text"
										bind:value={oauthFormClientId}
										class="w-full"
										placeholder={t('serverAdmin.oauthClientIdPlaceholder')}
									/>
								</div>

								<div>
									<label
										for="oauthClientSecret"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.oauthClientSecret')}
									</label>
									<Input
										id="oauthClientSecret"
										type="password"
										bind:value={oauthFormClientSecret}
										class="w-full"
										placeholder={oauthEditingId
											? t('serverAdmin.oauthClientSecretPlaceholderEdit')
											: t('serverAdmin.oauthClientSecretPlaceholder')}
									/>
								</div>

								<!-- Redirect URIs -->
								<div>
									<label
										for="oauthRedirectUrl0"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.oauthRedirectUrisLabel')}
									</label>
									<div class="space-y-2">
										{#each oauthFormRedirectUrls as url, index (index)}
											<div class="flex items-center gap-2">
												<Input
													id="oauthRedirectUrl{index}"
													type="text"
													bind:value={oauthFormRedirectUrls[index]}
													class="w-full font-mono text-xs"
													placeholder={t('serverAdmin.oauthRedirectUriPlaceholder')}
													aria-label={t('serverAdmin.oauthRedirectUriAriaLabel', {
														index: index + 1
													})}
												/>
												<button
													type="button"
													onclick={() => removeOAuthRedirectUrl(index)}
													disabled={oauthFormRedirectUrls.length <= 1}
													class="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-2 disabled:cursor-not-allowed disabled:opacity-40"
													aria-label={t('serverAdmin.oauthRedirectUriRemove', { index: index + 1 })}
												>
													<X class="h-4 w-4" />
												</button>
											</div>
										{/each}
										<button
											type="button"
											onclick={addOAuthRedirectUrl}
											class="hover:border-border dark:border-border dark:text-muted-foreground dark:hover:border-border hover:text-muted-foreground w-full rounded-md border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-600"
										>
											+ {t('serverAdmin.oauthRedirectUrisAdd')}
										</button>
									</div>
									<p class="text-muted-foreground mt-1 text-xs">
										{t('serverAdmin.oauthRedirectUrisHint')}
									</p>
								</div>

								<div class="flex items-center justify-between">
									<span class="text-muted-foreground text-sm">
										{t('serverAdmin.oauthEnabled')}
									</span>
									<Switch bind:checked={oauthFormEnabled} label={t('serverAdmin.oauthEnabled')} />
								</div>

								<div class="flex justify-end gap-2">
									<button
										onclick={resetOAuthForm}
										class="dark:border-border dark:text-muted-foreground bg-card hover:bg-muted rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
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
										{oauthEditingId
											? t('serverAdmin.updateProvider')
											: t('serverAdmin.addProvider')}
									</button>
								</div>
							</div>
						{:else}
							<button
								onclick={openOAuthForm}
								class="hover:border-border dark:border-border dark:text-muted-foreground dark:hover:border-border hover:text-muted-foreground w-full rounded-md border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600"
							>
								+ {t('serverAdmin.addOAuthProvider')}
							</button>
						{/if}
					</div>
				</div>

				<!-- Landing Page (hidden when community hub is enabled) -->
				<div
					class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6 {communityEnabled
						? 'hidden'
						: ''}"
				>
					<div class="mb-4 flex items-center gap-3">
						<BookOpen class="text-primary h-6 w-6" />
						<div>
							<h2 class="text-foreground text-xl font-semibold">Landing Page</h2>
							<p class="text-muted-foreground mt-1 text-sm">
								Select a user whose public travel journal is shown when visitors land on the site.
							</p>
						</div>
					</div>

					<div class="space-y-4">
						{#if usersWithUsernames.length === 0}
							<p class="bg-muted text-muted-foreground rounded-lg p-3 text-sm">
								No users have set a public username yet. Users can set one in their Account Settings
								under "Public Profile".
							</p>
						{:else}
							<label class="block">
								<span class="text-foreground mb-1.5 block text-sm font-medium"
									>Show this user's blog</span
								>
								<select
									bind:value={landingRedirectUsername}
									class="border-border focus:ring-primary w-full max-w-md rounded-md border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:outline-none"
								>
									<option value="">Default landing page (no redirect)</option>
									{#each usersWithUsernames as user (user.id)}
										<option value={user.username}>
											{user.full_name || user.username} (@{user.username})
										</option>
									{/each}
								</select>
								<p class="text-muted-foreground mt-1 text-xs">
									Visitors will be redirected to <code class="bg-muted rounded px-1"
										>/u/{landingRedirectUsername || 'username'}</code
									>
								</p>
							</label>
						{/if}

						<button
							type="button"
							onclick={saveLandingRedirect}
							disabled={isSavingLandingRedirect || usersWithUsernames.length === 0}
							class="bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
						>
							{isSavingLandingRedirect ? 'Saving...' : 'Save'}
						</button>
					</div>
				</div>

				<!-- Community Hub (always visible — controls whether landing page shows community or redirect) -->
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4 flex items-center gap-3">
						<div>
							<h2 class="text-foreground text-xl font-semibold">Community Hub</h2>
							<p class="text-muted-foreground mt-1 text-sm">
								Configure the landing page for this instance.
							</p>
						</div>
					</div>
					<div class="space-y-4">
						<div class="flex items-start justify-between gap-4">
							<div>
								<span class="text-foreground text-sm font-medium">Enable community hub</span>
								<p class="text-muted-foreground text-xs">
									When enabled, the landing page shows public stories from all users. When disabled,
									it redirects to the configured user's blog (or shows a sign-in page).
								</p>
							</div>
							<Switch bind:checked={communityEnabled} label="Enable community hub" />
						</div>
						<button
							type="button"
							onclick={saveCommunitySettings}
							disabled={isSavingCommunity}
							class="bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
						>
							{isSavingCommunity ? 'Saving...' : 'Save'}
						</button>
					</div>
				</div>

				<!-- AI Settings -->
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4 flex items-center gap-3">
						<Bot class="h-6 w-6 text-purple-500" />
						<div>
							<h2 class="text-foreground text-xl font-semibold">
								{t('serverAdmin.aiSettings')}
							</h2>
							<p class="text-muted-foreground mt-1 text-sm">
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
								<span class="text-muted-foreground text-sm font-medium">
									{t('serverAdmin.aiEnabled')}
								</span>
								<p class="text-muted-foreground text-xs">
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
									<span class="text-muted-foreground text-sm font-medium">
										{t('serverAdmin.allowUserOverride')}
									</span>
									<p class="text-muted-foreground text-xs">
										{t('serverAdmin.allowUserOverrideDescription')}
									</p>
								</div>
								<Switch
									bind:checked={aiAllowUserOverride}
									label={t('serverAdmin.allowUserOverride')}
									disabled={providerReadOnly}
								/>
							</div>

							<div class="dark:bg-card border-border space-y-3 rounded border bg-gray-50 p-4">
								<div class="grid grid-cols-2 gap-4">
									<div>
										<label
											for="providerName"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.aiProviderName')}
										</label>
										<Input
											id="providerName"
											type="text"
											value={providerName}
											disabled
											class="w-full"
											placeholder={t('serverAdmin.aiProviderNamePlaceholder')}
										/>
									</div>
									<div>
										<label
											for="providerDisplayName"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.aiDisplayName')}
										</label>
										<Input
											id="providerDisplayName"
											type="text"
											bind:value={providerDisplayName}
											disabled={providerReadOnly}
											class="w-full"
											placeholder={t('serverAdmin.aiDisplayNamePlaceholder')}
										/>
									</div>
								</div>

								<div>
									<label for="providerType" class="text-muted-foreground block text-sm font-medium">
										{t('serverAdmin.aiProvider')}
									</label>
									<select
										id="providerType"
										bind:value={providerType}
										disabled={providerReadOnly}
										class="w-full"
									>
										<option value="openai">{t('serverAdmin.aiProviders.openai')}</option>
										<option value="azure">{t('serverAdmin.aiProviders.azure')}</option>
										<option value="ollama">{t('serverAdmin.aiProviders.ollama')}</option>
									</select>
								</div>

								<div>
									<label
										for="providerModel"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.aiModel')}
									</label>
									<Input
										id="providerModel"
										type="text"
										bind:value={providerModel}
										disabled={providerReadOnly}
										class="w-full"
										placeholder={t('serverAdmin.modelPlaceholder')}
									/>
									<p class="text-muted-foreground mt-1 text-xs">
										{t('serverAdmin.aiModelDescription')}
									</p>
								</div>

								<div>
									<label
										for="providerApiKey"
										class="text-muted-foreground block text-sm font-medium"
									>
										{t('serverAdmin.aiApiKey')}
									</label>
									{#if providerApiKeyConfigured}
										<div
											class="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20"
										>
											<span class="text-sm font-medium text-green-700 dark:text-green-300">
												{t('serverAdmin.secretConfigured')}
											</span>
										</div>
										<div class="mt-2">
											<Input
												id="providerApiKey"
												type="password"
												bind:value={providerApiKey}
												disabled={providerReadOnly}
												class="w-full"
												placeholder={t('serverAdmin.enterNewKeyToReplace')}
											/>
										</div>
									{:else}
										<Input
											id="providerApiKey"
											type="password"
											bind:value={providerApiKey}
											disabled={providerReadOnly}
											class="w-full"
											placeholder={t('serverAdmin.aiApiKeyPlaceholder')}
										/>
									{/if}
								</div>

								{#if providerType === 'ollama' || providerType === 'azure' || providerType === 'custom'}
									<div>
										<label
											for="providerApiEndpoint"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.aiApiEndpoint')}
										</label>
										<Input
											id="providerApiEndpoint"
											type="text"
											bind:value={providerApiEndpoint}
											disabled={providerReadOnly}
											class="w-full"
											placeholder={t('serverAdmin.aiApiEndpointPlaceholder')}
										/>
										<p class="text-muted-foreground mt-1 text-xs">
											{t('serverAdmin.aiApiEndpointDescription')}
										</p>
									</div>
								{/if}

								<div class="grid grid-cols-2 gap-4">
									<div>
										<label
											for="providerMaxTokens"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.aiMaxTokens')}
										</label>
										<Input
											id="providerMaxTokens"
											type="number"
											bind:value={providerMaxTokens}
											disabled={providerReadOnly}
											min="256"
											max="128000"
											class="w-full"
										/>
									</div>

									<div>
										<label
											for="providerTemperature"
											class="text-muted-foreground block text-sm font-medium"
										>
											{t('serverAdmin.aiTemperature')}
										</label>
										<Input
											id="providerTemperature"
											type="number"
											bind:value={providerTemperature}
											disabled={providerReadOnly}
											min="0"
											max="2"
											step="0.1"
											class="w-full"
										/>
									</div>
								</div>
							</div>

							<!-- Usage Limits (chatbot quotas, 0 = unlimited) -->
							<div class="dark:bg-card border-border space-y-3 rounded border bg-gray-50 p-4">
								<div class="flex items-center gap-2">
									<Gauge class="text-muted-foreground h-4 w-4" />
									<span class="text-muted-foreground text-sm font-medium">
										{t('serverAdmin.aiUsageLimits')}
									</span>
								</div>
								<p class="text-muted-foreground text-xs">
									{t('serverAdmin.aiUsageLimitsDescription')}
								</p>

								<!-- Daily question limit -->
								<div class="flex items-center justify-between">
									<div class="flex-1 pr-4">
										<span class="text-muted-foreground block text-sm font-medium">
											{t('serverAdmin.aiQuestionLimit')}
										</span>
										<p class="text-muted-foreground text-xs">
											{t('serverAdmin.aiQuestionLimitDescription')}
										</p>
									</div>
									<div class="flex items-center gap-3">
										{#if aiQuestionLimitEnabled}
											<Input type="number" bind:value={aiQuestionLimit} min="1" class="w-28" />
										{/if}
										<Switch
											bind:checked={aiQuestionLimitEnabled}
											label={t('serverAdmin.aiQuestionLimit')}
										/>
									</div>
								</div>

								<!-- Daily token budget -->
								<div class="flex items-center justify-between">
									<div class="flex-1 pr-4">
										<span class="text-muted-foreground block text-sm font-medium">
											{t('serverAdmin.aiTokenBudget')}
										</span>
										<p class="text-muted-foreground text-xs">
											{t('serverAdmin.aiTokenBudgetDescription')}
										</p>
									</div>
									<div class="flex items-center gap-3">
										{#if aiTokenBudgetEnabled}
											<Input type="number" bind:value={aiTokenBudget} min="1" class="w-32" />
										{/if}
										<Switch
											bind:checked={aiTokenBudgetEnabled}
											label={t('serverAdmin.aiTokenBudget')}
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

				<!-- Web Search (Tavily) -->
				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-4 flex items-center gap-3">
						<Globe class="h-6 w-6 text-sky-500" />
						<div class="flex-1">
							<h2 class="text-foreground text-xl font-semibold">
								{t('serverAdmin.tavilyTitle')}
							</h2>
							<p class="text-muted-foreground mt-1 text-sm">
								{t('serverAdmin.tavilyDescription')}
								<a
									href="https://tavily.com"
									target="_blank"
									rel="noopener"
									class="text-primary ml-1 text-xs underline"
								>
									{t('serverAdmin.tavilyGetKey')}
								</a>
							</p>
						</div>
						{#if tavilyIntegration?.id}
							<span
								class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
							>
								{t('serverAdmin.tavilyConfigured')}
							</span>
						{/if}
					</div>

					<div class="space-y-4">
						<!-- API Key -->
						<div>
							<label class="text-foreground mb-1 block text-sm font-medium" for="tavily-api-key">
								{t('serverAdmin.tavilyKey')}
							</label>
							<input
								id="tavily-api-key"
								type="password"
								bind:value={tavilyApiKey}
								placeholder={t('serverAdmin.tavilyKeyPlaceholder')}
								class="border-border bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
								autocomplete="off"
							/>
							{#if tavilyIntegration?.config?.api_key}
								<p class="text-muted-foreground mt-1 text-xs">
									{t('serverAdmin.tavilyKeyMasked')}
									{#if tavilyIntegration.updated_at}
										· {new Date(tavilyIntegration.updated_at).toLocaleDateString()}
									{/if}
								</p>
								<button
									type="button"
									onclick={clearTavilyKey}
									disabled={tavilyClearing}
									class="text-destructive hover:text-destructive mt-1 text-xs underline disabled:opacity-50"
								>
									{tavilyClearing
										? t('serverAdmin.tavilyClearing')
										: t('serverAdmin.tavilyClearKey')}
								</button>
							{/if}
						</div>

						<!-- Base URL -->
						<div>
							<label class="text-foreground mb-1 block text-sm font-medium" for="tavily-base-url">
								{t('serverAdmin.tavilyBaseURL')}
							</label>
							<input
								id="tavily-base-url"
								type="url"
								bind:value={tavilyBaseURL}
								placeholder="https://api.tavily.com"
								class="border-border bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
							/>
						</div>

						<!-- Default Depth -->
						<div>
							<label class="text-foreground mb-1 block text-sm font-medium" for="tavily-depth">
								{t('serverAdmin.tavilyDepth')}
							</label>
							<select
								id="tavily-depth"
								bind:value={tavilyDepth}
								class="border-border bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
							>
								<option value="basic">{t('serverAdmin.tavilyDepthBasic')}</option>
								<option value="advanced">{t('serverAdmin.tavilyDepthAdvanced')}</option>
							</select>
							<p class="text-muted-foreground mt-1 text-xs">
								{t('serverAdmin.tavilyDepthHint')}
							</p>
						</div>

						<!-- Test result -->
						{#if tavilyTestResult}
							<div
								class="rounded-md border p-2 text-xs {tavilyTestResult.ok
									? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
									: 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400'}"
							>
								{tavilyTestResult.message}
							</div>
						{/if}

						<!-- Action buttons -->
						<div class="flex items-center justify-end gap-2 pt-2">
							{#if tavilyIntegration?.id}
								<button
									type="button"
									onclick={testTavily}
									disabled={tavilyTesting || tavilySaving}
									class="border-border text-foreground hover:bg-muted inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
								>
									{tavilyTesting ? t('serverAdmin.tavilyTesting') : t('serverAdmin.tavilyTest')}
								</button>
							{/if}
							<button
								type="button"
								onclick={saveTavily}
								disabled={tavilySaving || tavilyTesting}
								class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
							>
								{tavilySaving ? t('serverAdmin.tavilySaving') : t('serverAdmin.saveSettings')}
							</button>
						</div>
					</div>
				</div>

				<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
					<div class="mb-6 flex items-center gap-3">
						<Database class="h-6 w-6 text-emerald-500" />
						<div>
							<h2 class="text-foreground text-xl font-semibold">
								{t('serverAdmin.databaseMaintenance')}
							</h2>
							<p class="text-muted-foreground mt-1 text-sm">
								{t('serverAdmin.databaseMaintenanceDescription')}
							</p>
						</div>
					</div>

					<div class="space-y-6">
						<!-- Data Processing Pipeline -->
						<div class="border-border rounded-lg border p-4">
							<h3 class="text-foreground mb-1 text-sm font-semibold">
								{t('serverAdmin.pipelineTitle')}
							</h3>
							<p class="text-muted-foreground mb-4 text-xs">
								{t('serverAdmin.pipelineDescription')}
							</p>

							<!-- Pipeline Flow Diagram - Vertical Layout -->
							<div class="flex flex-col items-center">
								<!-- Step 1: Reverse Geocode -->
								<div
									class="dark:border-border dark:bg-card flex w-full max-w-xl items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4"
								>
									<div class="flex items-start gap-3">
										<span
											class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
											>1</span
										>
										<div class="min-w-0">
											<span class="text-muted-foreground text-sm font-medium">
												{t('serverAdmin.reverseGeocode')}
											</span>
											<p class="text-muted-foreground text-xs">
												{t('serverAdmin.reverseGeocodeDescription')}
											</p>
										</div>
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

								<!-- Connector -->
								<div class="flex flex-col items-center py-1">
									<div class="dark:bg-muted h-4 w-0.5 bg-gray-300"></div>
									<ChevronDown class="text-muted-foreground h-4 w-4" />
								</div>

								<!-- Step 2: Sync Place Visits -->
								<div
									class="dark:border-border dark:bg-card flex w-full max-w-xl items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4"
								>
									<div class="flex items-start gap-3">
										<span
											class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
											>2</span
										>
										<div class="min-w-0">
											<span class="text-muted-foreground text-sm font-medium">
												{t('serverAdmin.refreshPlaceVisits')}
											</span>
											<p class="text-muted-foreground text-xs">
												{t('serverAdmin.refreshPlaceVisitsDescription')}
											</p>
										</div>
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
						</div>

						<!-- Standalone Operations -->
						<div class="border-border rounded-xl border p-4">
							<h3 class="text-foreground mb-1 text-sm font-semibold">
								{t('serverAdmin.standaloneTitle')}
							</h3>
							<p class="text-muted-foreground mb-4 text-xs">
								{t('serverAdmin.standaloneDescription')}
							</p>

							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<!-- Force Re-geocode -->
								<div
									class="dark:border-border dark:bg-card flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
								>
									<div class="text-muted-foreground shrink-0">
										<Globe class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-foreground text-sm font-medium">
											{t('serverAdmin.forceRegeocode')}
										</span>
										<p class="text-muted-foreground mt-0.5 text-xs">
											{t('serverAdmin.forceRegeocodeDescription')}
										</p>
									</div>
									<button
										onclick={promptForceRegeocode}
										disabled={isForceRegeocoding}
										class="bg-primary hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw class={`h-3.5 w-3.5 ${isForceRegeocoding ? 'animate-spin' : ''}`} />
										{isForceRegeocoding ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>

								<!-- Fill Country Codes -->
								<div
									class="dark:border-border dark:bg-card flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
								>
									<div class="text-muted-foreground shrink-0">
										<MapPin class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-foreground text-sm font-medium">
											{t('serverAdmin.fillCountryCodes')}
										</span>
										<p class="text-muted-foreground mt-0.5 text-xs">
											{t('serverAdmin.fillCountryCodesDescription')}
										</p>
									</div>
									<button
										onclick={fillMissingCountryCodes}
										disabled={isFillingCountryCodes}
										class="bg-primary hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw
											class={`h-3.5 w-3.5 ${isFillingCountryCodes ? 'animate-spin' : ''}`}
										/>
										{isFillingCountryCodes ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>

								<!-- Re-detect Transport Modes -->
								<div
									class="dark:border-border dark:bg-card flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
								>
									<div class="text-muted-foreground shrink-0">
										<Route class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-foreground text-sm font-medium">
											{t('serverAdmin.detectTransportModes')}
										</span>
										<p class="text-muted-foreground mt-0.5 text-xs">
											{t('serverAdmin.detectTransportModesDescription')}
										</p>
										<label class="mt-1.5 flex items-center gap-2">
											<Switch
												bind:checked={reprocessTransportModes}
												label="Full re-run (re-analyze all history)"
												size="sm"
											/>
											<span class="text-muted-foreground text-xs">
												Full re-run — re-analyze all history (up to 3 years), ignoring watermarks
											</span>
										</label>
									</div>
									<button
										onclick={detectTransportModesAllUsers}
										disabled={isDetectingTransportModes}
										class="bg-primary hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw
											class={`h-3.5 w-3.5 ${isDetectingTransportModes ? 'animate-spin' : ''}`}
										/>
										{isDetectingTransportModes ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>

								<!-- Generate Trip Routes (Valhalla) -->
								<div
									class="dark:border-border dark:bg-card flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
								>
									<div class="text-muted-foreground shrink-0">
										<MapPin class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-foreground text-sm font-medium"> Generate Trip Routes </span>
										<p class="text-muted-foreground mt-0.5 text-xs">
											Snap the trips of users who enabled the Road-Snapped Routes beta in their
											account settings to the road network via Valhalla (read-only on location data;
											privacy zones clipped).
										</p>
									</div>
									<button
										onclick={generateTripRoutesAllUsers}
										disabled={isGeneratingTripRoutes}
										class="bg-primary hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw
											class={`h-3.5 w-3.5 ${isGeneratingTripRoutes ? 'animate-spin' : ''}`}
										/>
										{isGeneratingTripRoutes ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>

								<!-- Refresh Activity -->
								<div
									class="dark:border-border dark:bg-card flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
								>
									<div class="text-muted-foreground shrink-0">
										<CalendarDays class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-foreground text-sm font-medium">
											{t('serverAdmin.refreshActivity')}
										</span>
										<p class="text-muted-foreground mt-0.5 text-xs">
											{t('serverAdmin.refreshActivityDescription')}
										</p>
									</div>
									<button
										onclick={refreshActivityAllUsers}
										disabled={isRefreshingActivity}
										class="bg-primary hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw
											class={`h-3.5 w-3.5 ${isRefreshingActivity ? 'animate-spin' : ''}`}
										/>
										{isRefreshingActivity ? t('serverAdmin.running') : t('serverAdmin.run')}
									</button>
								</div>
							</div>

							<!-- Clear & Rebuild Place Visits — full-width destructive action -->
							<div
								class="mt-3 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
							>
								<div class="shrink-0 text-red-500">
									<Trash2 class="h-5 w-5" />
								</div>
								<div class="min-w-0 flex-1">
									<span class="text-foreground text-sm font-medium">
										{t('serverAdmin.clearPlaceVisits')}
									</span>
									<p class="text-muted-foreground mt-0.5 text-xs">
										{t('serverAdmin.clearPlaceVisitsDescription')}
									</p>
								</div>
								<button
									onclick={promptClearPlaceVisits}
									disabled={isClearingPlaceVisits}
									class="inline-flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<Trash2 class={`h-3.5 w-3.5 ${isClearingPlaceVisits ? 'animate-spin' : ''}`} />
									{isClearingPlaceVisits ? t('serverAdmin.running') : t('serverAdmin.run')}
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
							class="dark:bg-card mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="document"
						>
							<h3 class="text-foreground mb-2 text-lg font-semibold">
								{t('serverAdmin.forceRegeocodeConfirmTitle')}
							</h3>
							<p class="text-muted-foreground mb-6 text-sm">
								{t('serverAdmin.forceRegeocodeConfirmMessage')}
							</p>
							<div class="flex justify-end gap-3">
								<button
									onclick={cancelForceRegeocode}
									class="dark:border-border dark:text-muted-foreground hover:bg-muted rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
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
							class="dark:bg-card mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="document"
						>
							<div class="mb-4 flex items-center gap-3">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
								>
									<Trash2 class="h-5 w-5 text-red-600 dark:text-red-400" />
								</div>
								<h3 class="text-foreground text-lg font-semibold">
									{t('serverAdmin.clearPlaceVisitsConfirmTitle')}
								</h3>
							</div>
							<p class="text-muted-foreground mb-6 text-sm">
								{t('serverAdmin.clearPlaceVisitsConfirmMessage')}
							</p>
							<div class="flex justify-end gap-3">
								<button
									onclick={cancelClearPlaceVisits}
									class="dark:border-border dark:text-muted-foreground hover:bg-muted rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
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
							class="dark:bg-card mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
							role="document"
						>
							<div class="mb-4 flex items-center gap-3">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30"
								>
									<RotateCcw class="h-5 w-5 text-amber-600 dark:text-amber-400" />
								</div>
								<h3 class="text-foreground text-lg font-semibold">
									{t('serverAdmin.clearUserPlaceVisitsConfirmTitle')}
								</h3>
							</div>
							<div class="dark:bg-card mb-4 rounded-lg bg-gray-50 p-3">
								<div class="text-foreground font-medium">
									{userToClearPlaceVisits.first_name || ''}
									{userToClearPlaceVisits.last_name || ''}
								</div>
								<div class="text-muted-foreground text-sm">
									{userToClearPlaceVisits.email}
								</div>
							</div>
							<p class="text-muted-foreground mb-6 text-sm">
								{t('serverAdmin.clearUserPlaceVisitsConfirmMessage')}
							</p>
							<div class="flex justify-end gap-3">
								<button
									onclick={cancelClearUserPlaceVisits}
									class="dark:border-border dark:text-muted-foreground hover:bg-muted rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
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
			<Settings class="text-muted-foreground mx-auto mb-4 h-12 w-12" />
			<h2 class="text-foreground mb-2 text-xl font-semibold">Access Denied</h2>
			<p class="text-muted-foreground">You don't have permission to access this page.</p>
		</div>
	</div>
{/if}
