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
				// Expired or invalid tokens during signout are expected and can be ignored
				const isExpiredToken = error.message?.includes('Invalid or expired token') ||
					error.message?.includes('expired') ||
					error.message?.includes('invalid');

				if (isExpiredToken) {
					console.log('[Signout] Session already expired (this is normal)');
				} else {
					console.warn('[Signout] SDK signOut warning:', error.message);
				}
			} else {
				console.log('[Signout] SDK signOut successful');
			}
		} catch (error) {
			// Don't log errors for expired sessions during signout
			const errorMessage = error instanceof Error ? error.message : String(error);
			const isExpiredToken = errorMessage.includes('Invalid or expired token') ||
				errorMessage.includes('expired') ||
				errorMessage.includes('invalid');

			if (isExpiredToken) {
				console.log('[Signout] Session already expired (this is normal)');
			} else {
				console.error('[Signout] Unexpected error during signout:', error);
			}
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
		<Loader2 class="mx-auto mb-4 h-8 w-8 animate-spin text-[rgb(34,51,95)]" />
		<h2 class="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Signing out...</h2>
		<p class="text-gray-600 dark:text-gray-400">Please wait while we sign you out.</p>
		<p class="mt-2 text-sm text-gray-500 dark:text-gray-500">Redirecting to home page...</p>
	</div>
</div>
