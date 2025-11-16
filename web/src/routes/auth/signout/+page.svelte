<script lang="ts">
	import { Loader2 } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import { userStore, sessionStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';

	onMount(async () => {
		console.log('[Signout] Client-side signout page mounted - clearing stores');

		try {
			// Clear client-side stores immediately
			userStore.set(null);
			sessionStore.set(null);

			console.log('[Signout] Client stores cleared');

			// Sign out using Fluxbase SDK directly
			const { error } = await fluxbase.auth.signOut();

			if (error) {
				console.error('[Signout] SDK signOut error:', error);
			} else {
				console.log('[Signout] SDK signOut successful');
			}
		} catch (error) {
			console.error('[Signout] Error during signout:', error);
		} finally {
			// Always redirect to landing page after a short delay
			setTimeout(() => {
				goto('/');
			}, 1000);
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
	<div class="text-center">
		<Loader2 class="mx-auto mb-4 h-8 w-8 animate-spin text-[rgb(37,140,244)]" />
		<h2 class="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Signing out...</h2>
		<p class="text-gray-600 dark:text-gray-400">Please wait while we sign you out.</p>
		<p class="mt-2 text-sm text-gray-500 dark:text-gray-500">Redirecting to home page...</p>
	</div>
</div>
