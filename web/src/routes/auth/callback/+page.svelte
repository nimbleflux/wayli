<script lang="ts">
	import { Loader2 } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let loading = true;
	let error = '';

	onMount(async () => {
		try {
			// Check for tokens in URL hash (implicit flow)
			const hashParams = new URLSearchParams(window.location.hash.substring(1));
			const accessToken = hashParams.get('access_token');
			const refreshToken = hashParams.get('refresh_token');

			if (accessToken) {
				// Implicit flow - log tokens for debugging
				console.log('🔍 [OAuth Callback] Implicit flow detected', {
					hasAccessToken: !!accessToken,
					hasRefreshToken: !!refreshToken
				});

				const { error: setError } = await fluxbase.auth.setSession({
					access_token: accessToken,
					refresh_token: refreshToken || ''
				});
				if (setError) throw setError;
			} else {
				// Check for authorization code (standard OAuth flow)
				const code = $page.url.searchParams.get('code');
				const state = $page.url.searchParams.get('state');

				if (code) {
					// Use SDK's built-in method - it handles redirect_uri automatically
					// (SDK stores redirect_uri during signInWithOAuth and retrieves it here)
					console.log('🔍 [OAuth Callback] Authorization code flow detected, exchanging code for session...');
					const exchangeResult = await fluxbase.auth.exchangeCodeForSession(
						code,
						state || undefined
					);

					// Debug logging to inspect what the SDK returns
					console.log('🔍 [OAuth Callback] exchangeCodeForSession result:', {
						hasError: !!exchangeResult.error,
						error: exchangeResult.error,
						hasData: !!exchangeResult.data,
						hasSession: !!exchangeResult.data?.session,
						hasAccessToken: !!exchangeResult.data?.session?.access_token,
						hasRefreshToken: !!exchangeResult.data?.session?.refresh_token,
						accessTokenLength: exchangeResult.data?.session?.access_token?.length || 0,
						refreshTokenLength: exchangeResult.data?.session?.refresh_token?.length || 0,
						expiresAt: exchangeResult.data?.session?.expires_at,
						expiresIn: exchangeResult.data?.session?.expires_in,
						user: exchangeResult.data?.session?.user?.id || exchangeResult.data?.user?.id
					});

					// Check what's stored in localStorage after the exchange
					const storedSession = localStorage.getItem('fluxbase.auth.session');
					console.log('🔍 [OAuth Callback] Stored session in localStorage:', {
						hasStoredSession: !!storedSession,
						sessionLength: storedSession?.length || 0
					});

					if (exchangeResult.error) throw exchangeResult.error;
				}
			}

			// Get the authenticated user
			const { data: userData, error: userError } = await fluxbase.auth.getUser();

			if (userError) throw userError;

			if (userData.user) {
				// Check onboarding status
				const { data: profile } = await fluxbase
					.from('user_profiles')
					.select('onboarding_completed, first_login_at')
					.eq('id', userData.user.id)
					.single();

				// If first-time user, update first_login_at and redirect to onboarding
				if (!profile?.onboarding_completed) {
					if (!profile?.first_login_at) {
						await fluxbase
							.from('user_profiles')
							.update({ first_login_at: new Date().toISOString() })
							.eq('id', userData.user.id);
					}

					toast.success("Welcome! Let's set up your profile.");
					goto('/dashboard/account-settings?onboarding=true');
				} else {
					// Get redirectTo from URL params or sessionStorage fallback
					const storedRedirectTo = sessionStorage.getItem('oauth_redirect_to');
					sessionStorage.removeItem('oauth_redirect_to');
					const redirectTo =
						$page.url.searchParams.get('redirectTo') || storedRedirectTo || '/dashboard/statistics';
					toast.success('Authentication successful');
					goto(redirectTo);
				}
			} else {
				error = 'No user found';
				toast.error('Authentication failed');
			}
		} catch (err: any) {
			error = err.message || 'Authentication failed';
			toast.error('Authentication failed');
		} finally {
			loading = false;
		}
	});
</script>

<div
	class="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900"
>
	<div class="text-center">
		{#if loading}
			<Loader2 class="text-primary dark:text-primary-dark mx-auto mb-4 h-8 w-8 animate-spin" />
			<h2 class="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
				Completing authentication...
			</h2>
			<p class="text-gray-600 dark:text-gray-400">Please wait while we complete your sign in.</p>
		{:else if error}
			<div
				class="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20"
			>
				<h2 class="mb-2 text-xl font-semibold text-red-800 dark:text-red-200">
					Authentication failed
				</h2>
				<p class="mb-4 text-red-700 dark:text-red-300">
					{error}
				</p>
				<a
					href="/auth/signin"
					class="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700"
				>
					Try again
				</a>
			</div>
		{/if}
	</div>
</div>
