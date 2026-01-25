<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';

	import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
	import ReauthenticationModal from '$lib/components/ReauthenticationModal.svelte';
	import StorageNoticeBanner from '$lib/components/StorageNoticeBanner.svelte';
	import { initializeI18n } from '$lib/i18n';
	import { serviceAdapter } from '$lib/services/service-layer-adapter';
	import { sessionManager } from '$lib/services/session';
	import { initializeTheme } from '$lib/stores/app-state.svelte';
	import { suppressDeprecationWarnings } from '$lib/utils/suppress-warnings';

	import { beforeNavigate, afterNavigate } from '$app/navigation';

	onMount(async () => {
		// Initialize theme
		initializeTheme();
		// Suppress deprecation warnings from third-party libraries
		suppressDeprecationWarnings();

		// Initialize session management first
		try {
			await sessionManager.initialize();
		} catch (error) {
			console.error('❌ [ROOT] Failed to initialize session manager:', error);
		}

		// Initialize i18n system
		try {
			await initializeI18n();
		} catch (error) {
			console.error('❌ [ROOT] Failed to initialize i18n system:', error);
		}

		// Initialize client-side service layer
		try {
			await serviceAdapter.initialize();
		} catch (error) {
			console.error('❌ [ROOT] Failed to initialize client service layer:', error);
		}
	});

	// Track page changes using modern navigation lifecycle (without debug logging)
	beforeNavigate(() => {
		// Navigation started
	});

	afterNavigate(() => {
		// Navigation completed
	});
</script>

<Toaster richColors />
<StorageNoticeBanner />

<ErrorBoundary>
	<slot />
</ErrorBoundary>

<!-- Global re-authentication modal for sensitive actions -->
<ReauthenticationModal />
