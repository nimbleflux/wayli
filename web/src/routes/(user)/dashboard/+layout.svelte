<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';

	import AppNav from '$lib/components/AppNav.svelte';
	import { t, changeLocale, type SupportedLocale } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionManager } from '$lib/services/session';
	import { userStore, sessionStore } from '$lib/stores/auth';
	import { connectionStatusStore, reconnectedStore } from '$lib/stores/job-store';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';

	// Snippet prop for rendering children
	let { children }: { children: Snippet } = $props();

	// No server-side data needed - everything is client-side

	// Admin role state
	let isAdmin = $state(false);
	let isCheckingAdmin = $state(true);

	// AI feature state
	let aiEnabled = $state(true); // Default to true until we know otherwise

	let isInitializing = true;
	// Get realtime connection status from job store
	let realtimeConnectionStatus = $derived($connectionStatusStore);

	async function handleSignout() {
		try {
			// Clear client session first to avoid stale UI
			await fluxbase.auth.signOut();
			userStore.set(null);
			sessionStore.set(null);
			// Redirect via full reload to ensure all components re-mount without auth state
			window.location.href = '/auth/signout';
		} catch (error) {
			console.error('❌ [Dashboard] Signout error:', error);
			window.location.href = '/auth/signout';
		}
	}

	// Check if the current user is an admin
	async function checkAdminRole() {
		try {
			if (!$userStore) {
				isAdmin = false;
				isCheckingAdmin = false;
				return;
			}

			const { data: userProfile, error } = await fluxbase
				.from('user_profiles')
				.select('role')
				.eq('id', $userStore.id)
				.single();

			if (error) {
				console.warn('⚠️ [Dashboard] Could not check admin role:', error.message);
				isAdmin = false;
			} else {
				isAdmin = userProfile?.role === 'admin';
			}
		} catch (error) {
			console.error('❌ [Dashboard] Error checking admin role:', error);
			isAdmin = false;
		} finally {
			isCheckingAdmin = false;
		}
	}

	// Load user preferences and apply language
	async function loadUserPreferences() {
		try {
			const session = await fluxbase.auth.getSession();
			if (!session.data?.session) return;

			const serviceAdapter = new ServiceAdapter({ session: session.data.session });
			const preferencesResult = await serviceAdapter.getPreferences();

			if (preferencesResult && typeof preferencesResult === 'object') {
				const preferencesData = (preferencesResult as any).data || preferencesResult;
				const userLanguage = preferencesData?.language;

				if (userLanguage && ['en', 'nl', 'es'].includes(userLanguage)) {
					await changeLocale(userLanguage as SupportedLocale);
				}
			}
		} catch (error) {
			console.error('❌ [Dashboard] Error loading user preferences:', error);
		}
	}

	// Check if AI features are enabled
	async function checkAIEnabled() {
		try {
			const session = await fluxbase.auth.getSession();
			if (!session.data?.session) return;

			const serviceAdapter = new ServiceAdapter({ session: session.data.session });
			aiEnabled = await serviceAdapter.isAIEnabled();
		} catch (error) {
			console.error('❌ [Dashboard] Error checking AI enabled:', error);
			// Default to false if we can't determine
			aiEnabled = false;
		}
	}

	onMount(async () => {
		try {
			// Session manager is already initialized in root layout
			// Wait a bit for any pending auth state changes to settle
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Check if user is authenticated using session manager
			const isAuthenticated = await sessionManager.isAuthenticated();

			if (!isAuthenticated) {
				goto('/auth/signin');
				return;
			}

			// Load user preferences and apply language
			await loadUserPreferences();

			// Check if AI features are enabled
			await checkAIEnabled();

			// Check admin role with timeout
			const adminCheckPromise = checkAdminRole();
			const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second timeout

			await Promise.race([adminCheckPromise, timeoutPromise]);

			// If we hit the timeout, force completion
			if (isCheckingAdmin) {
				console.warn('⚠️ [Dashboard] Admin role check timed out, proceeding anyway');
				isCheckingAdmin = false;
				isAdmin = false;
			}

			// Mark initialization as complete
			isInitializing = false;
		} catch (error) {
			console.error('❌ [Dashboard] Error initializing dashboard:', error);
			goto('/auth/signin');
		}
	});

	$effect(() => {
		// Only check authentication after initialization is complete
		if (isInitializing) return;

		// Check authentication status and redirect if needed
		if (!$userStore && !$sessionStore) {
			goto('/auth/signin');
		}
	});

	// Check admin role whenever user changes
	$effect(() => {
		if ($userStore && !isCheckingAdmin) {
			checkAdminRole();
		}
	});

	// Show toast when realtime connection is re-established
	$effect(() => {
		if ($reconnectedStore) {
			toast.success(t('realtime.reconnected'));
			reconnectedStore.set(false);
		}
	});

	// Cleanup is handled by Fluxbase SDK
</script>

<AppNav {isAdmin} {aiEnabled} onSignout={handleSignout} {realtimeConnectionStatus}>
	<!-- Main content area -->
	<div class="min-h-screen bg-gray-50 p-6 dark:bg-gray-900">
		{#if isCheckingAdmin}
			<div class="flex h-64 items-center justify-center">
				<div class="text-center">
					<div
						class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-[rgb(34,51,95)] dark:border-blue-400"
					></div>
				</div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>
</AppNav>
