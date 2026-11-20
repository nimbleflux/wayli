<script lang="ts">
	import { Mail, Lock, ArrowRight, Loader2 } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { safeRedirectTo } from '$lib/utils/redirect';

	import { userStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';
	import { loadPublicSettings, getSetting } from '$lib/stores/settings.svelte';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Issue #289: don't advertise login methods before the auth config is
	// known — show a spinner until we know which methods this instance has.
	let isLoadingConfig = $state(true);
	let passwordLoginEnabled = $state(true);
	let signupEnabled = $state(true);

	onMount(() => {
		console.log('🔐 [AUTH] Page mounted');
		// Check if user is already authenticated
		(async () => {
			const { data } = await fluxbase.auth.getUser();
			const user = data?.user;
			console.log('🔐 [AUTH] User check:', user ? `Found - ${user.email}` : 'None');

			if (user) {
				// User is already authenticated, redirect to intended destination or default
				const redirectTo = safeRedirectTo(
					page.url.searchParams.get('redirectTo'),
					'/dashboard/location-data'
				);
				console.log('🔄 [AUTH] REDIRECTING: User already authenticated, going to', redirectTo);
				goto(redirectTo);
				return;
			}
		})();

		// Load which login methods exist (falls back to defaults on error, like
		// the signin/signup pages do)
		(async () => {
			try {
				const { data: authConfig, error } = await fluxbase.auth.getAuthConfig();
				if (!error && authConfig) {
					passwordLoginEnabled = authConfig.password_login_enabled !== false;
					signupEnabled = authConfig.signup_enabled !== false;
				}

				// First user on a fresh install can always sign up, matching the
				// signup page's own logic — keep the account button visible for them.
				await loadPublicSettings();
				const isSetupComplete = getSetting<unknown>('wayli.is_setup_complete', null);
				if (isSetupComplete !== true && isSetupComplete !== 'true') {
					signupEnabled = true;
				}
			} catch (error) {
				console.error('Error loading auth config:', error);
			} finally {
				isLoadingConfig = false;
			}
		})();

		// Subscribe to auth changes for future logins
		const unsubscribe = userStore.subscribe((user) => {
			console.log('🔐 [AUTH] User store updated:', user ? `User: ${user.email}` : 'No user');
			if (user) {
				const redirectTo = safeRedirectTo(
					page.url.searchParams.get('redirectTo'),
					'/dashboard/location-data'
				);
				console.log('🔄 [AUTH] REDIRECTING: User authenticated, going to', redirectTo);
				goto(redirectTo);
			}
		});

		return unsubscribe;
	});
</script>

<div class="bg-background flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-md">
		<div class="bg-card border-border rounded-2xl border p-8 shadow-xl">
			<div class="mb-8 text-center">
				<h1 class="text-foreground mb-2 text-2xl font-bold">Welcome to Wayli</h1>
				<p class="text-muted-foreground">Choose how you'd like to get started</p>
			</div>

			{#if isLoadingConfig}
				<div class="flex items-center justify-center py-8">
					<Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
				</div>
			{:else}
				<div class="space-y-4">
					{#if passwordLoginEnabled}
						<a
							href="/auth/signin"
							class="bg-primary hover:bg-primary/90 flex w-full items-center justify-center gap-3 rounded-lg px-4 py-3 font-medium text-white transition-colors"
						>
							<Mail class="h-5 w-5" />
							Sign in with email
							<ArrowRight class="h-5 w-5" />
						</a>
					{/if}

					{#if signupEnabled}
						<a
							href="/auth/signup"
							class="hover:bg-muted dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted flex w-full items-center justify-center gap-3 rounded-lg bg-gray-100 px-4 py-3 font-medium text-gray-700 transition-colors"
						>
							<Lock class="h-5 w-5" />
							Create new account
							<ArrowRight class="h-5 w-5" />
						</a>
					{/if}
				</div>
			{/if}

			<div class="mt-8 text-center">
				<a
					href="/"
					class="hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground text-sm text-gray-600 transition-colors"
				>
					Back to home
				</a>
			</div>
		</div>
	</div>
</div>
