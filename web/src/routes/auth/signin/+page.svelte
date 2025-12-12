<script lang="ts">
	import { Mail, Lock, Eye, EyeOff, ArrowLeft, LogIn } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { userStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';
	import { sessionManager } from '$lib/services/session';
	import TwoFactorVerify from '$lib/components/TwoFactorVerify.svelte';

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	// Use the reactive translation function
	let t = $derived($translate);

	let email = $state<string>('');
	let password = $state<string>('');
	let loading = $state(false);
	let showPassword = $state(false);
	let rememberMe = $state(true); // Default to checked
	let isMagicLinkSent = $state(false);
	let show2FAModal = $state(false);
	let twoFactorUserId = $state('');

	onMount(() => {
		// Subscribe to user store for authentication state changes
		userStore.subscribe((user) => {
			if (user && $page.url.pathname === '/auth/signin') {
				// Don't automatically redirect - let the login flow handle it
				// This prevents the brief flash of the dashboard
			}
		});
	});

	async function handleSignIn(event: Event) {
		event.preventDefault();
		loading = true;

		try {
			// Debug: Check fluxbase client configuration
			console.log('🔧 [SignIn] Fluxbase client auth config:', {
				persist: (fluxbase.auth as any).persist,
				autoRefresh: (fluxbase.auth as any).autoRefresh,
				hasSession: !!(fluxbase.auth as any).session
			});

			// Authenticate with Fluxbase
			const { data, error } = await fluxbase.auth.signInWithPassword({
				email,
				password
			});

			if (error) throw error;

			// Check if 2FA is required (Fluxbase returns this directly in the response)
			if (data && 'requires_2fa' in data && data.requires_2fa) {
				console.log('🔐 [SignIn] 2FA required for this user');
				// User has 2FA enabled - show verification modal
				twoFactorUserId = data.user_id || '';
				show2FAModal = true;
				loading = false;
				return;
			}

			// No 2FA required - we have a session
			const user = data.user;
			const session = data.session;

			if (!session || !user) {
				toast.error(t('auth.noSessionReturned'));
				return;
			}

			// Debug: Check if session is being stored
			console.log('✅ [SignIn] Session received:', {
				user: user.email,
				hasAccessToken: !!session.access_token,
				expiresAt: session.expires_at
			});

			// Record login with Remember Me preference
			sessionManager.recordLogin(rememberMe);

			// Check localStorage for the session
			setTimeout(() => {
				const storedSession = localStorage.getItem('fluxbase.auth.session');
				console.log('💾 [SignIn] Session in localStorage:', storedSession ? 'Found' : 'NOT FOUND');
				if (storedSession) {
					const parsed = JSON.parse(storedSession);
					console.log('💾 [SignIn] Stored session user:', parsed.user?.email);
				}
			}, 100);

			// Check onboarding status
			console.log('🔍 [SignIn] Checking user profile for user:', user.id);
			const { data: profile, error: profileError } = await fluxbase
				.from('user_profiles')
				.select('onboarding_completed, first_login_at')
				.eq('id', user.id)
				.single();

			if (profileError) {
				console.error('❌ [SignIn] Error fetching profile:', profileError);
				// Profile fetch failed - redirect to dashboard anyway
				toast.success(t('auth.signedInSuccessfully'));
				console.log('🔄 [SignIn] Profile query failed, redirecting to dashboard');
				goto('/dashboard/statistics', { replaceState: true });
				return;
			}

			console.log('✅ [SignIn] Profile fetched:', profile);

			// If first-time user, redirect to onboarding
			if (!profile?.onboarding_completed) {
				if (!profile?.first_login_at) {
					const { error: updateError } = await fluxbase
						.from('user_profiles')
						.update({ first_login_at: new Date().toISOString() })
						.eq('id', user.id);

					if (updateError) {
						console.error('❌ [SignIn] Error updating first_login_at:', updateError);
					}
				}

				toast.success(t('auth.welcomeSetupProfile'));
				goto('/dashboard/account-settings?onboarding=true');
				return;
			}

			// Returning user - proceed with normal login
			toast.success(t('auth.signedInSuccessfully'));

			// Wait for the auth state change to propagate, then redirect
			setTimeout(() => {
				// Check if we're still on the signin page
				if ($page.url.pathname.startsWith('/auth/signin')) {
					const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
					console.log('🔄 [SignIn] Redirecting after successful authentication to:', redirectTo);
					goto(redirectTo, { replaceState: true });
				}
			}, 500);
		} catch (error: any) {
			console.error('Sign in error:', error);
			toast.error(error.message || t('auth.signInFailed'));
		} finally {
			loading = false;
		}
	}

	async function handlePasswordReset() {
		if (!email) {
			toast.error(t('auth.enterValidEmail'));
			return;
		}

		loading = true;

		try {
			// Always attempt to send reset email
			// We don't check for errors to prevent email enumeration attacks
			await fluxbase.auth.resetPasswordForEmail(email, {
				redirectTo: `${window.location.origin}/auth/reset-password`
			});

			// Always show success message, regardless of whether the email exists
			// This prevents attackers from discovering which emails are registered
			isMagicLinkSent = true;
			toast.success(t('auth.passwordResetEmailSent'));
		} catch (error: any) {
			// Even on error, show success to prevent email enumeration
			isMagicLinkSent = true;
			toast.success(t('auth.passwordResetEmailSent'));
			console.error('Password reset error (hidden from user):', error);
		} finally {
			loading = false;
		}
	}

	function togglePassword() {
		showPassword = !showPassword;
	}

	async function handle2FASuccess(event: CustomEvent) {
		console.log('✅ [SignIn] 2FA verification successful');
		const authData = event.detail;

		// Store session in fluxbase client
		if (authData.access_token && authData.refresh_token) {
			// Calculate expires_at from expires_in if provided, otherwise default to 1 hour
			// (matching FLUXBASE_AUTH_JWT_EXPIRY default)
			const expiresIn = authData.expires_in || 3600;
			const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

			await fluxbase.auth.setSession({
				access_token: authData.access_token,
				refresh_token: authData.refresh_token,
				expires_at: expiresAt
			});
		}

		// Record login with Remember Me preference
		sessionManager.recordLogin(rememberMe);

		// Redirect to dashboard
		const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
		toast.success(t('auth.signedInSuccessfully'));
		goto(redirectTo, { replaceState: true });
	}
</script>

<svelte:head>
	<title>{t('auth.signIn')} - Wayli</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
	<div class="w-full max-w-md">
		<!-- Back to home -->
		<div class="mb-8">
			<a
				href="/"
				class="inline-flex items-center text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
			>
				<ArrowLeft class="mr-2 h-4 w-4" />
				{t('auth.backToHome')}
			</a>
		</div>

		<!-- Sign In Form -->
		<div
			class="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-8 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary dark:bg-primary-dark"
				>
					<LogIn class="h-6 w-6 text-white" />
				</div>
				<h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
					{t('auth.signInToAccount')}
				</h1>
				<p class="text-gray-600 dark:text-gray-400">
					{t('auth.welcomeBack')}
				</p>
			</div>

			{#if isMagicLinkSent}
				<div class="text-center">
					<div
						class="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20"
					>
						<p class="text-sm text-green-800 dark:text-green-200">
							{t('auth.checkEmailPasswordReset')}
						</p>
					</div>
					<button
						type="button"
						onclick={() => (isMagicLinkSent = false)}
						class="text-sm text-primary transition-colors hover:text-primary/80 dark:text-primary-dark dark:hover:text-primary-dark/80"
					>
						{t('auth.backToSignIn')}
					</button>
				</div>
			{:else}
				<form onsubmit={handleSignIn} class="space-y-6">
					<!-- Email Field -->
					<div>
						<label
							for="email"
							class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t('auth.emailAddress')}
						</label>
						<div class="relative">
							<Mail
								class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-gray-400"
							/>
							<input
								id="email"
								type="email"
								bind:value={email}
								required
								class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-4 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-primary dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
								placeholder={t('auth.enterYourEmail')}
							/>
						</div>
					</div>

					<!-- Password Field -->
					<div>
						<label
							for="password"
							class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t('auth.password')}
						</label>
						<div class="relative">
							<Lock
								class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-gray-400"
							/>
							<input
								id="password"
								type={showPassword ? 'text' : 'password'}
								bind:value={password}
								required
								class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-primary dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
								placeholder={t('auth.enterYourPassword')}
							/>
							<button
								type="button"
								onclick={togglePassword}
								class="absolute top-1/2 right-3 -translate-y-1/2 transform cursor-pointer text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
							>
								{#if showPassword}
									<EyeOff class="h-5 w-5" />
								{:else}
									<Eye class="h-5 w-5" />
								{/if}
							</button>
						</div>
					</div>

					<!-- Remember Me & Forgot Password -->
					<div class="flex items-center justify-between">
						<label class="flex cursor-pointer items-center">
							<input
								type="checkbox"
								bind:checked={rememberMe}
								class="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary dark:border-gray-600 dark:bg-gray-700"
							/>
							<span class="ml-2 text-sm text-gray-600 dark:text-gray-400">
								{t('auth.rememberMe')}
							</span>
						</label>
						<button
							type="button"
							onclick={handlePasswordReset}
							disabled={loading || !email}
							class="cursor-pointer text-sm text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-dark dark:hover:text-primary-dark/80"
						>
							{t('auth.forgotPassword')}
						</button>
					</div>

					<!-- Sign In Button -->
					<button
						type="submit"
						disabled={loading}
						class="w-full cursor-pointer rounded-lg bg-primary px-4 py-3 font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-dark dark:hover:bg-primary-dark/90"
					>
						{loading ? t('auth.signingIn') : t('auth.signIn')}
					</button>
				</form>

				<div class="mt-6 text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{t('auth.dontHaveAccount')}
						<a
							href="/auth/signup"
							class="cursor-pointer font-medium text-primary transition-colors hover:text-primary/80 dark:text-primary-dark dark:hover:text-primary-dark/80"
						>
							{t('auth.signUp')}
						</a>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- 2FA Verification Modal -->
<TwoFactorVerify bind:open={show2FAModal} userId={twoFactorUserId} on:success={handle2FASuccess} />
