<script lang="ts">
	import { X, Info } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { translate } from '$lib/i18n';
	import { state as appState } from '$lib/stores/app-state.svelte';

	const STORAGE_KEY = 'wayli-storage-notice-dismissed';

	let t = $derived($translate);

	let isDismissed = $state(false);
	let isLoading = $state(true);

	let shouldShow = $derived(!isLoading && !isDismissed);

	// Sync banner visibility with global state for layout adjustments
	$effect(() => {
		appState.storageBannerVisible = shouldShow;
	});

	$effect(() => {
		if (browser) {
			const dismissed = localStorage.getItem(STORAGE_KEY);
			isDismissed = dismissed === 'true';
			isLoading = false;
		}
	});

	function handleDismiss() {
		if (browser) {
			localStorage.setItem(STORAGE_KEY, 'true');
		}
		isDismissed = true;
	}
</script>

{#if shouldShow}
	<!-- Spacer to prevent content from being hidden behind fixed banner -->
	<div class="h-12"></div>
	<div
		class="fixed top-0 left-0 right-0 z-50 border-b border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
		transition:slide={{ duration: 300 }}
		role="alert"
		aria-live="polite"
	>
		<div class="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
			<div class="flex items-center justify-between gap-4">
				<div class="flex items-center gap-3">
					<Info class="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
					<p class="text-sm text-gray-600 dark:text-gray-300">
						{t('storageNotice.message')}
					</p>
				</div>
				<button
					onclick={handleDismiss}
					class="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
					aria-label={t('common.actions.close')}
				>
					<X class="h-5 w-5" />
				</button>
			</div>
		</div>
	</div>
{/if}
