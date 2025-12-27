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
		X,
		Mail,
		Lock,
		Bot,
		Database,
		RefreshCw
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
	let showAddUserModal = $state(false);
	let isModalOpen = $state(false);
	let selectedUser = $state<UserProfile | null>(null);
	let showDeleteConfirm = $state(false);
	let userToDelete = $state<UserProfile | null>(null);
	let searchTimeout: ReturnType<typeof setTimeout>;
	let activeTab = $state('settings'); // Add tab state - default to settings tab

	// Authentication Settings
	let enableSignup = $state(false);
	let enableMagicLink = $state(false);
	let passwordMinLength = $state(8);
	let requireEmailVerification = $state(false);
	let requireUppercase = $state(false);
	let requireLowercase = $state(false);
	let requireNumber = $state(false);
	let requireSpecial = $state(false);
	let sessionTimeout = $state(15);
	let maxSessions = $state(5);
	let authReadOnly = $state(false);

	// Email Settings
	let emailEnabled = $state(false);
	let emailProvider = $state('smtp');
	let smtpHost = $state('');
	let smtpPort = $state(587);
	let smtpUsername = $state('');
	let smtpPassword = $state('');
	let smtpUseTls = $state(true);
	let smtpFromAddress = $state('');
	let smtpFromName = $state('Wayli');
	let smtpReplyTo = $state('');
	// Per-field read-only status based on overrides
	let emailEnabledReadOnly = $state(false);
	let emailProviderReadOnly = $state(false);
	let emailSmtpReadOnly = $state(false);
	// Derived: true if any email field has overrides (for banner display)
	let hasEmailOverrides = $derived(emailEnabledReadOnly || emailProviderReadOnly || emailSmtpReadOnly);
	// Derived: true if all email fields are read-only (hide save button)
	let allEmailReadOnly = $derived(emailEnabledReadOnly && emailSmtpReadOnly);

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

	// AI Settings - provider-based model
	let aiEnabled = $state(false);
	let aiAllowUserOverride = $state(false);
	let providerName = $state('wayli-default');
	let providerDisplayName = $state('OpenAI (Production)');
	let providerType = $state('openai');
	let providerModel = $state('gpt-4-turbo');
	let providerApiKey = $state('');
	let providerApiEndpoint = $state('');
	let providerMaxTokens = $state(4096);
	let providerTemperature = $state(0.7);
	let providerIsDefault = $state(true);
	let providerReadOnly = $state(false);

	// Handle Escape key for modals
	$effect(() => {
		if (showAddUserModal || isModalOpen || showDeleteConfirm) {
			const handleKeydown = (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					if (showAddUserModal) {
						handleCloseAddUserModal();
					} else if (isModalOpen) {
						handleCloseModal();
					} else if (showDeleteConfirm) {
						showDeleteConfirm = false;
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

			if (serverPexelsApiKey) {
				await serviceAdapter.updateCustomSetting(
					'wayli.server_pexels_api_key',
					serverPexelsApiKey,
					'Server-level Pexels API key'
				);
			}

			toast.success(t('serverAdmin.wayliSettingsSaved'));
		} catch (error: any) {
			console.error('❌ Failed to save Wayli settings:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
		}
	}

	async function saveAuthSettings() {
		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });

			// Update signup
			await serviceAdapter.updateAppSetting(enableSignup ? 'enableSignup' : 'disableSignup');

			// Update email verification
			await serviceAdapter.updateAppSetting('setEmailVerificationRequired', {
				required: requireEmailVerification
			});

			// Update password min length
			await serviceAdapter.updateAppSetting('setPasswordMinLength', {
				length: passwordMinLength
			});

			// Update password complexity
			await serviceAdapter.updateAppSetting('setPasswordComplexity', {
				require_uppercase: requireUppercase,
				require_lowercase: requireLowercase,
				require_number: requireNumber,
				require_special: requireSpecial
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

			// Update email enabled
			await serviceAdapter.updateAppSetting('setEmailEnabled', {
				enabled: emailEnabled
			});

			// Configure SMTP if enabled and provider is smtp
			if (emailEnabled && emailProvider === 'smtp') {
				await serviceAdapter.updateAppSetting('configureSMTP', {
					host: smtpHost,
					port: smtpPort,
					username: smtpUsername,
					password: smtpPassword,
					use_tls: smtpUseTls,
					from_address: smtpFromAddress,
					from_name: smtpFromName,
					reply_to_address: smtpReplyTo || undefined
				});
			}

			toast.success(t('serverAdmin.emailSettingsSaved'));
		} catch (error: any) {
			console.error('❌ Failed to save email settings:', error);
			toast.error(t('serverAdmin.failedToUpdateSettings'), {
				description: error?.message
			});
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
			// Submit the refresh-place-visits job which has service_role access to the RPC
			const { error } = await fluxbase.jobs.submit(
				'refresh-place-visits',
				{},
				{
					namespace: 'wayli',
					priority: 5
				}
			);
			if (error) throw error;
			toast.success(t('serverAdmin.refreshPlaceVisitsQueued'));
		} catch (error: any) {
			console.error('❌ Failed to refresh place visits:', error);
			toast.error(t('serverAdmin.refreshPlaceVisitsFailed'), {
				description: error?.message
			});
		} finally {
			isRefreshingPlaceVisits = false;
		}
	}

	async function syncPoiEmbeddingsForAllUsers() {
		if (isSyncingPoiEmbeddings) return;

		isSyncingPoiEmbeddings = true;
		try {
			const { error } = await fluxbase.jobs.submit(
				'scheduled-refresh-place-visits',
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

			// Authentication
			enableSignup = app.authentication.enable_signup;
			enableMagicLink = app.authentication.enable_magic_link;
			passwordMinLength = app.authentication.password_min_length;
			requireEmailVerification = app.authentication.require_email_verification;
			authReadOnly = app.authentication.read_only ?? false;

			// Email
			emailEnabled = app.email.enabled;
			emailProvider = app.email.provider;
			// Per-field read-only status from overrides
			emailEnabledReadOnly = app.email.overrides?.enabled ?? false;
			emailProviderReadOnly = app.email.overrides?.provider ?? false;
			emailSmtpReadOnly = app.email.overrides?.smtp ?? false;

			// Load SMTP configuration if available
			if (app.email.smtp) {
				smtpHost = app.email.smtp.host ?? '';
				smtpPort = app.email.smtp.port ?? 587;
				smtpUsername = app.email.smtp.username ?? '';
				smtpUseTls = app.email.smtp.use_tls ?? true;
				smtpFromAddress = app.email.smtp.from_address ?? '';
				smtpFromName = app.email.smtp.from_name ?? 'Wayli';
				smtpReplyTo = app.email.smtp.reply_to_address ?? '';
				// Note: SMTP password is not returned for security reasons
			}

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
					providerModel = defaultProvider.config?.model ?? 'gpt-4-turbo';
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
			serverPexelsApiKey = custom['wayli.server_pexels_api_key']?.value || '';

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
							<UserIcon class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								id="newUserFirstName"
								bind:value={newUserFirstName}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
							<UserIcon class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								id="newUserLastName"
								bind:value={newUserLastName}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
						<Mail class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
						<input
							type="email"
							id="newUserEmail"
							bind:value={newUserEmail}
							class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
							<Lock class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="password"
								id="newUserPassword"
								bind:value={newUserPassword}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
							<Lock class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
							<input
								type="password"
								id="newUserConfirmPassword"
								bind:value={newUserConfirmPassword}
								class="focus:border-primary focus:ring-primary dark:focus:border-primary dark:focus:ring-primary w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
							<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Search users..."
								class="focus:border-primary focus:ring-primary w-64 rounded-md border border-[rgb(218,218,221)] bg-white py-2 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100 dark:placeholder:text-gray-500"
								oninput={handleSearchInput}
							/>
						</div>
						<!-- Items per page selector -->
						<select
							bind:value={itemsPerPage}
							onchange={handleItemsPerPageChange}
							class="focus:border-primary focus:ring-primary rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
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
										class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
									>
										User
									</th>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
									>
										Role
									</th>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
									>
										Created
									</th>
									<th
										scope="col"
										class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300"
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
										<td class="whitespace-nowrap px-6 py-4">
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
										<td class="whitespace-nowrap px-6 py-4">
											<span
												class="inline-flex rounded-full px-2 text-xs font-semibold leading-5 {user.role ===
												'admin'
													? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
													: 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'}"
											>
												{user.role === 'admin' ? 'Admin' : 'User'}
											</span>
										</td>
										<td
											class="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400"
										>
											{formatDate(user.created_at)}
										</td>
										<td
											class="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400"
										>
											Active
										</td>
										<td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
											<div class="flex items-center justify-end gap-2">
												<button
													class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
													onclick={() => handleEditUser(user)}
													title="Edit user"
												>
													<Edit class="h-4 w-4" />
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
								class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
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
							<input
								type="text"
								id="serverPexelsApiKey"
								bind:value={serverPexelsApiKey}
								class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
							/>
							<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
								{t('serverAdmin.serverPexelsKeyDescription')}
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

						<div>
							<label
								for="passwordMinLength"
								class="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t('serverAdmin.passwordMinLength')}
							</label>
							<input
								type="number"
								id="passwordMinLength"
								bind:value={passwordMinLength}
								disabled={authReadOnly}
								min="8"
								max="128"
								class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
							/>
						</div>

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
						{#if hasEmailOverrides}
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

						<div class="flex items-center justify-between">
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{t('serverAdmin.emailEnabled')}
							</span>
							<Switch
								bind:checked={emailEnabled}
								label={t('serverAdmin.emailEnabled')}
								disabled={emailEnabledReadOnly}
							/>
						</div>

						{#if emailEnabled}
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										placeholder={t('serverAdmin.smtpFromNamePlaceholder')}
									/>
								</div>
							</div>
						{/if}

						{#if !allEmailReadOnly}
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

				<!-- Database Maintenance -->
				<div
					class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<div class="mb-4 flex items-center gap-3">
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

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<div>
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
								class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RefreshCw class={`h-4 w-4 ${isRefreshingPlaceVisits ? 'animate-spin' : ''}`} />
								{isRefreshingPlaceVisits ? t('serverAdmin.refreshing') : t('serverAdmin.refresh')}
							</button>
						</div>

						<div class="flex items-center justify-between">
							<div>
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
								class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RefreshCw class={`h-4 w-4 ${isSyncingPoiEmbeddings ? 'animate-spin' : ''}`} />
								{isSyncingPoiEmbeddings ? t('serverAdmin.syncing') : t('serverAdmin.sync')}
							</button>
						</div>

						<div class="flex items-center justify-between">
							<div>
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
								class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RefreshCw class={`h-4 w-4 ${isSyncingTripEmbeddings ? 'animate-spin' : ''}`} />
								{isSyncingTripEmbeddings ? t('serverAdmin.syncing') : t('serverAdmin.sync')}
							</button>
						</div>

						<div class="flex items-center justify-between">
							<div>
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
								class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RefreshCw class={`h-4 w-4 ${isReverseGeocodingAllUsers ? 'animate-spin' : ''}`} />
								{isReverseGeocodingAllUsers ? t('serverAdmin.running') : t('serverAdmin.run')}
							</button>
						</div>
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
										placeholder="gpt-4-turbo"
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
										class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
											class="focus:border-primary focus:ring-primary mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
