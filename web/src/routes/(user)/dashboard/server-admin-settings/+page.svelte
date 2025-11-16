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
		Lock
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import RoleSelector from '$lib/components/RoleSelector.svelte';
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

	// Feature Toggles
	let enableRealtime = $state(true);
	let enableStorage = $state(true);
	let enableFunctions = $state(true);

	// Security
	let enableRateLimiting = $state(false);

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
		// Set admin flag since this is an admin-only page
		isAdmin = true;

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

			// Check if current user is admin (assuming admin users can access this page)
			isAdmin = true;
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
			await serviceAdapter.updateAppSetting(
				enableSignup ? 'enableSignup' : 'disableSignup'
			);

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
			const errorDescription = error?.message || error?.error || t('serverAdmin.failedToUpdateUser');
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

			// Email
			emailEnabled = app.email.enabled;
			emailProvider = app.email.provider;

			// Features
			enableRealtime = app.features.enable_realtime;
			enableStorage = app.features.enable_storage;
			enableFunctions = app.features.enable_functions;

			// Security
			enableRateLimiting = app.security.enable_global_rate_limit;

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

	// Admin state
	let isAdmin = $state(false);

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
								class="w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500"
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
								class="w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500"
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
							class="w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500"
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
								class="w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500"
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
								class="w-full rounded-lg border border-gray-300 bg-gray-50 py-3 pr-4 pl-10 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500"
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
					class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
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
				<Settings class="h-7 w-7 text-[rgb(37,140,244)]" />
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
						? 'border-[rgb(37,140,244)] text-[rgb(37,140,244)]'
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
						? 'border-[rgb(37,140,244)] text-[rgb(37,140,244)]'
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
								class="w-64 rounded-md border border-[rgb(218,218,221)] bg-white py-2 pr-4 pl-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[rgb(37,140,244)] focus:ring-1 focus:ring-[rgb(37,140,244)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100 dark:placeholder:text-gray-500"
								oninput={handleSearchInput}
							/>
						</div>
						<!-- Items per page selector -->
						<select
							bind:value={itemsPerPage}
							onchange={handleItemsPerPageChange}
							class="rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 focus:border-[rgb(37,140,244)] focus:ring-1 focus:ring-[rgb(37,140,244)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
						>
							<option value={5}>5 per page</option>
							<option value={10}>10 per page</option>
							<option value={25}>25 per page</option>
							<option value={50}>50 per page</option>
						</select>
					</div>
					<button
						class="flex cursor-pointer items-center gap-2 rounded-md bg-[rgb(37,140,244)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgb(37,140,244)]/90"
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
													? 'bg-[rgb(37,140,244)] text-white'
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
				<div class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]">
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
							<label for="serverName" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
								{t('serverAdmin.serverName')}
							</label>
							<input
								type="text"
								id="serverName"
								bind:value={serverName}
								class="mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[rgb(37,140,244)] focus:ring-1 focus:ring-[rgb(37,140,244)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
								placeholder={t('serverAdmin.enterServerName')}
							/>
						</div>

						<div>
							<label for="serverPexelsApiKey" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
								{t('serverAdmin.serverPexelsKey')}
							</label>
							<input
								type="text"
								id="serverPexelsApiKey"
								bind:value={serverPexelsApiKey}
								class="mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[rgb(37,140,244)] focus:ring-1 focus:ring-[rgb(37,140,244)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
							/>
							<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
								{t('serverAdmin.serverPexelsKeyDescription')}
							</p>
						</div>

						<div class="flex justify-end">
							<button
								onclick={saveWayliSettings}
								class="rounded-md bg-[rgb(37,140,244)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgb(37,140,244)]/90"
							>
								{t('serverAdmin.saveSettings')}
							</button>
						</div>
					</div>
				</div>

				<!-- Authentication Settings -->
				<div class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]">
					<div class="mb-4">
						<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
							{t('serverAdmin.authenticationSettings')}
						</h2>
						<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
							{t('serverAdmin.authSettingsDescription')}
						</p>
					</div>

					<div class="space-y-4">
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={enableSignup}
								class="rounded border-gray-300 text-[rgb(37,140,244)] focus:ring-[rgb(37,140,244)]"
							/>
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{t('serverAdmin.enableSignup')}
							</span>
						</label>

						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={requireEmailVerification}
								class="rounded border-gray-300 text-[rgb(37,140,244)] focus:ring-[rgb(37,140,244)]"
							/>
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{t('serverAdmin.requireEmailVerification')}
							</span>
						</label>

						<div>
							<label for="passwordMinLength" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
								{t('serverAdmin.passwordMinLength')}
							</label>
							<input
								type="number"
								id="passwordMinLength"
								bind:value={passwordMinLength}
								min="8"
								max="128"
								class="mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 focus:border-[rgb(37,140,244)] focus:ring-1 focus:ring-[rgb(37,140,244)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
							/>
						</div>

						<div class="flex justify-end">
							<button
								onclick={saveAuthSettings}
								class="rounded-md bg-[rgb(37,140,244)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgb(37,140,244)]/90"
							>
								{t('serverAdmin.saveSettings')}
							</button>
						</div>
					</div>
				</div>

				<!-- Email & SMTP Settings -->
				<div class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]">
					<div class="mb-4">
						<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
							{t('serverAdmin.emailSettings')}
						</h2>
						<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
							{t('serverAdmin.emailSettingsDescription')}
						</p>
					</div>

					<div class="space-y-4">
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={emailEnabled}
								class="rounded border-gray-300 text-[rgb(37,140,244)] focus:ring-[rgb(37,140,244)]"
							/>
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{t('serverAdmin.emailEnabled')}
							</span>
						</label>

						{#if emailEnabled}
							<div>
								<label for="emailProvider" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
									{t('serverAdmin.emailProvider')}
								</label>
								<select
									id="emailProvider"
									bind:value={emailProvider}
									class="mt-1 w-full rounded-md border border-[rgb(218,218,221)] bg-white px-3 py-2 text-sm text-gray-900 focus:border-[rgb(37,140,244)] focus:ring-1 focus:ring-[rgb(37,140,244)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-100"
								>
									<option value="smtp">SMTP</option>
									<option value="sendgrid">SendGrid</option>
									<option value="mailgun">Mailgun</option>
									<option value="ses">AWS SES</option>
								</select>
							</div>

							{#if emailProvider === 'smtp'}
								<div class="space-y-3 rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
									<h3 class="font-medium text-gray-900 dark:text-gray-100">
										{t('serverAdmin.smtpConfiguration')}
									</h3>

									<div class="grid grid-cols-2 gap-4">
										<div>
											<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
												{t('serverAdmin.smtpHost')}
											</label>
											<input
												type="text"
												bind:value={smtpHost}
												class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
												placeholder={t('serverAdmin.smtpHostPlaceholder')}
											/>
										</div>

										<div>
											<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
												{t('serverAdmin.smtpPort')}
											</label>
											<input
												type="number"
												bind:value={smtpPort}
												class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
												placeholder={t('serverAdmin.smtpPortPlaceholder')}
											/>
										</div>
									</div>

									<div>
										<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.smtpUsername')}
										</label>
										<input
											type="text"
											bind:value={smtpUsername}
											class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
											placeholder={t('serverAdmin.smtpUsernamePlaceholder')}
										/>
									</div>

									<div>
										<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.smtpPassword')}
										</label>
										<input
											type="password"
											bind:value={smtpPassword}
											class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
											placeholder={t('serverAdmin.smtpPasswordPlaceholder')}
										/>
									</div>

									<label class="flex items-center gap-2">
										<input
											type="checkbox"
											bind:checked={smtpUseTls}
											class="rounded border-gray-300 text-[rgb(37,140,244)]"
										/>
										<span class="text-sm text-gray-700 dark:text-gray-300">
											{t('serverAdmin.smtpUseTls')}
										</span>
									</label>

									<div>
										<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.smtpFromAddress')}
										</label>
										<input
											type="email"
											bind:value={smtpFromAddress}
											class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
											placeholder={t('serverAdmin.smtpFromAddressPlaceholder')}
										/>
									</div>

									<div>
										<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
											{t('serverAdmin.smtpFromName')}
										</label>
										<input
											type="text"
											bind:value={smtpFromName}
											class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
											placeholder={t('serverAdmin.smtpFromNamePlaceholder')}
										/>
									</div>
								</div>
							{/if}
						{/if}

						<div class="flex justify-end">
							<button
								onclick={saveEmailSettings}
								class="rounded-md bg-[rgb(37,140,244)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgb(37,140,244)]/90"
							>
								{t('serverAdmin.saveSettings')}
							</button>
						</div>
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
