<script lang="ts">
	import { Mail, Lock, ArrowRight } from 'lucide-svelte';
	import { onMount } from 'svelte';

	import { userStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	onMount(() => {
		console.log('🔐 [AUTH] Page mounted');
		// Check if user is already authenticated
		(async () => {
			const {
				data: { user }
			} = await fluxbase.auth.getUser();
			console.log('🔐 [AUTH] User check:', user ? `Found - ${user.email}` : 'None');

			if (user) {
				// User is already authenticated, redirect to intended destination or default
				const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
				console.log('🔄 [AUTH] REDIRECTING: User already authenticated, going to', redirectTo);
				goto(redirectTo);
				return;
			}
		})();

		// Subscribe to auth changes for future logins
		const unsubscribe = userStore.subscribe((user) => {
			console.log('🔐 [AUTH] User store updated:', user ? `User: ${user.email}` : 'No user');
			if (user) {
				const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
				console.log('🔄 [AUTH] REDIRECTING: User authenticated, going to', redirectTo);
				goto(redirectTo);
			}
		});

		return unsubscribe;
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
	<div class="w-full max-w-md">
		<div
			class="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-8 text-center">
				<h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome to Wayli</h1>
				<p class="text-gray-600 dark:text-gray-400">Choose how you'd like to get started</p>
			</div>

			<div class="space-y-4">
				<a
					href="/auth/signin"
					class="flex w-full items-center justify-center gap-3 rounded-lg bg-[rgb(37,140,244)] px-4 py-3 font-medium text-white transition-colors hover:bg-[rgb(37,140,244)]/90"
				>
					<Mail class="h-5 w-5" />
					Sign in with email
					<ArrowRight class="h-5 w-5" />
				</a>

				<a
					href="/auth/signup"
					class="flex w-full items-center justify-center gap-3 rounded-lg bg-gray-100 px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
				>
					<Lock class="h-5 w-5" />
					Create new account
					<ArrowRight class="h-5 w-5" />
				</a>
			</div>

			<div class="mt-8 text-center">
				<a
					href="/"
					class="text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
				>
					Back to home
				</a>
			</div>
		</div>
	</div>
</div>
