<script lang="ts">
	import { Mail, Lock, Eye, EyeOff, ArrowLeft, User, Check, X } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { userStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	// Use the reactive translation function
	let t = $derived($translate);

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let loading = $state(false);
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);
	let isEmailSent = $state(false);
	let registrationDisabled = $state(false);
	let isLoadingSettings = $state(false);
	let isFirstUser = $state(false);
	let hasRedirected = false; // Guard to prevent multiple redirects

	// OAuth-only mode
	let oauthOnlyMode = $state(false);
	let oauthProviders = $state<Array<{ name: string; display_name: string; authorize_url?: string }>>([]);

	// Password requirements from server (defaults match current behavior)
	let passwordMinLength = $state(8);
	let requireUppercase = $state(true);
	let requireLowercase = $state(true);
	let requireNumber = $state(true);
	let requireSpecial = $state(true);

	// Password validation - dynamically checks based on server requirements
	let passwordValidation = $derived({
		minLength: password.length >= passwordMinLength,
		hasUppercase: !requireUppercase || /[A-Z]/.test(password),
		hasLowercase: !requireLowercase || /[a-z]/.test(password),
		hasNumber: !requireNumber || /\d/.test(password),
		hasSpecial: !requireSpecial || /[!@#$%^&*(),.?":{}|<>]/.test(password)
	});

	let isPasswordValid = $derived(Object.values(passwordValidation).every(Boolean));
	let doPasswordsMatch = $derived(password === confirmPassword && password.length > 0);

	async function checkServerSettings() {
		isLoadingSettings = true;
		try {
			// Read public Wayli settings from app.settings (RLS allows anonymous read)
			const publicSettings = await fluxbase.settings.getMany([
				'wayli.is_setup_complete',
				'wayli.server_name',
				'wayli.password_min_length',
				'wayli.password_require_uppercase',
				'wayli.password_require_lowercase',
				'wayli.password_require_number',
				'wayli.password_require_special',
				'wayli.disable_password_login'
			]);

			// The value is wrapped in an object: {"value": false}
			const is_setup_complete =
				publicSettings['wayli.is_setup_complete']?.value === true ||
				publicSettings['wayli.is_setup_complete']?.value === 'true';

			// First user can always sign up
			isFirstUser = !is_setup_complete;

			// Check if password login is disabled (OAuth-only mode)
			oauthOnlyMode = publicSettings['wayli.disable_password_login']?.value === true;

			// Load OAuth providers if OAuth-only mode is enabled
			if (oauthOnlyMode) {
				try {
					const { data: providersResponse } = await fluxbase.auth.getOAuthProviders();
					oauthProviders = providersResponse?.providers || [];
				} catch {
					// OAuth providers not available, disable OAuth-only mode
					oauthOnlyMode = false;
				}
			}

			// Read password requirements from public settings
			if (publicSettings['wayli.password_min_length']?.value !== undefined) {
				passwordMinLength = publicSettings['wayli.password_min_length'].value;
			}
			if (publicSettings['wayli.password_require_uppercase']?.value !== undefined) {
				requireUppercase = publicSettings['wayli.password_require_uppercase'].value;
			}
			if (publicSettings['wayli.password_require_lowercase']?.value !== undefined) {
				requireLowercase = publicSettings['wayli.password_require_lowercase'].value;
			}
			if (publicSettings['wayli.password_require_number']?.value !== undefined) {
				requireNumber = publicSettings['wayli.password_require_number'].value;
			}
			if (publicSettings['wayli.password_require_special']?.value !== undefined) {
				requireSpecial = publicSettings['wayli.password_require_special'].value;
			}

			// Don't check signup_enabled from admin settings - that requires authentication
			// If signup is disabled via app settings, the backend will reject the attempt
			registrationDisabled = false;

			console.log('🔧 [SIGNUP] Server settings applied:', {
				is_setup_complete,
				registrationDisabled,
				isFirstUser,
				oauthOnlyMode,
				oauthProviders: oauthProviders.length,
				passwordRequirements: {
					minLength: passwordMinLength,
					requireUppercase,
					requireLowercase,
					requireNumber,
					requireSpecial
				}
			});
		} catch (error) {
			console.error('Error checking server settings:', error);
			// Default to allowing registration if we can't fetch settings
			registrationDisabled = false;
			isFirstUser = false;
			oauthOnlyMode = false;
		} finally {
			isLoadingSettings = false;
		}
	}

	onMount(() => {
		console.log('🔐 [SIGNUP] Page mounted');

		// Check server settings (which includes setup status)
		checkServerSettings();

		// Check if user is already authenticated
		(async () => {
			const {
				data: { user }
			} = await fluxbase.auth.getUser();
			console.log('🔐 [SIGNUP] User check:', user ? `Found - ${user.email}` : 'None');

			if (user) {
				// User is already authenticated, redirect to intended destination or default
				const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
				console.log('🔄 [SIGNUP] REDIRECTING: User already authenticated, going to', redirectTo);
				goto(redirectTo);
				return;
			}
		})();

		// Subscribe to auth changes for future registrations
		const unsubscribe = userStore.subscribe(async (user) => {
			console.log('🔐 [SIGNUP] User store updated:', user ? `User: ${user.email}` : 'No user');

			// Guard: Only redirect once to prevent infinite loops
			if (user && !hasRedirected) {
				hasRedirected = true;

				// Check if this is a new user who needs onboarding
				const { data: profile } = await fluxbase
					.from('user_profiles')
					.select('onboarding_completed, first_login_at')
					.eq('id', user.id)
					.single();

				// If first-time user, redirect to onboarding
				if (!profile?.onboarding_completed) {
					if (!profile?.first_login_at) {
						await fluxbase
							.from('user_profiles')
							.update({ first_login_at: new Date().toISOString() })
							.eq('id', user.id);
					}

					console.log('🔄 [SIGNUP] First-time user, redirecting to onboarding');
					goto('/dashboard/account-settings?onboarding=true');
				} else {
					const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
					console.log('🔄 [SIGNUP] REDIRECTING: User authenticated, going to', redirectTo);
					goto(redirectTo);
				}
			}
		});

		return unsubscribe;
	});

	async function handleSignUp(event: Event) {
		event.preventDefault();

		// Check if registration is disabled
		if (registrationDisabled) {
			toast.error(t('auth.userRegistrationDisabled'));
			return;
		}

		// Validate required fields
		if (!firstName.trim()) {
			toast.error(t('auth.firstNameRequired'));
			return;
		}

		if (!lastName.trim()) {
			toast.error(t('auth.lastNameRequired'));
			return;
		}

		if (!isPasswordValid) {
			toast.error(t('auth.passwordRequirementsNotMet'));
			return;
		}

		if (!doPasswordsMatch) {
			toast.error(t('auth.passwordsDoNotMatch'));
			return;
		}

		loading = true;

		try {
			const { data, error } = await fluxbase.auth.signUp({
				email,
				password,
				options: {
					data: {
						first_name: firstName.trim(),
						last_name: lastName.trim(),
						full_name: `${firstName.trim()} ${lastName.trim()}`.trim()
					}
				}
			});

			if (error) throw error;

			// Check if email verification is required based on Fluxbase Auth's response
			// If there's no session, email verification is required
			// If there's a session, the user is auto-confirmed and logged in
			if (!data.session && data.user && !data.user.email_confirmed_at) {
				// Email verification required - redirect to verification page
				sessionStorage.setItem('pending_verification_email', email);
				toast.success(t('auth.checkEmailConfirmationLink'));
				goto('/auth/verify-email');
			} else if (data.session) {
				// User is auto-confirmed and logged in
				toast.success(t('auth.signUpSuccess'));

				// Explicitly check profile and redirect (don't rely only on store subscription)
				try {
					const { data: profile } = await fluxbase
						.from('user_profiles')
						.select('onboarding_completed, first_login_at')
						.eq('id', data.user.id)
						.single();

					// Update first_login_at if needed
					if (!profile?.first_login_at) {
						await fluxbase
							.from('user_profiles')
							.update({ first_login_at: new Date().toISOString() })
							.eq('id', data.user.id);
					}

					// Redirect based on onboarding status
					if (!profile?.onboarding_completed) {
						console.log('🔄 [SIGNUP] First-time user, redirecting to onboarding');
						goto('/dashboard/account-settings?onboarding=true');
					} else {
						const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
						console.log('🔄 [SIGNUP] User authenticated, redirecting to', redirectTo);
						goto(redirectTo);
					}
				} catch (profileError) {
					console.error('Error fetching profile after signup:', profileError);
					// Fallback to default redirect
					const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
					goto(redirectTo);
				}
			}
		} catch (error: any) {
			toast.error(error.message || t('auth.signUpFailed'));
		} finally {
			loading = false;
		}
	}

	function togglePassword() {
		showPassword = !showPassword;
	}

	function toggleConfirmPassword() {
		showConfirmPassword = !showConfirmPassword;
	}

	async function signInWithOAuth(providerName: string) {
		loading = true;
		try {
			const redirectTo = $page.url.searchParams.get('redirectTo') || '/dashboard/statistics';
			const { error } = await fluxbase.auth.signInWithOAuth({
				provider: providerName,
				options: {
					redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`
				}
			});

			if (error) throw error;
		} catch (error: any) {
			console.error('OAuth sign in error:', error);
			toast.error(error.message || t('auth.signUpFailed'));
			loading = false;
		}
	}

	// Known OAuth providers with brand icons
	const knownProviders = ['google', 'github', 'gitlab', 'discord', 'azure', 'bitbucket', 'apple', 'microsoft', 'facebook', 'twitter'] as const;

	function isKnownProvider(providerName: string): boolean {
		return knownProviders.includes(providerName.toLowerCase() as typeof knownProviders[number]);
	}
</script>

{#snippet providerIcon(providerName: string, size: 'sm' | 'lg' = 'lg')}
	{@const sizeClass = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'}
	{#if providerName.toLowerCase() === 'google'}
		<svg class={sizeClass} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
			<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
			<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
			<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'github'}
		<svg class={sizeClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
			<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'gitlab'}
		<svg class={sizeClass} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<path fill="#E24329" d="m12 22.035l3.68-11.326H8.32L12 22.035z"/>
			<path fill="#FC6D26" d="M12 22.035L8.32 10.709H1.62L12 22.035z"/>
			<path fill="#FCA326" d="M1.62 10.709L.27 14.86c-.123.38-.003.795.3 1.03L12 22.035l-10.38-11.326z"/>
			<path fill="#E24329" d="M1.62 10.709h6.7L5.61 2.262c-.138-.423-.73-.423-.867 0L1.62 10.709z"/>
			<path fill="#FC6D26" d="M12 22.035l3.68-11.326h6.7L12 22.035z"/>
			<path fill="#FCA326" d="m22.38 10.709l1.35 4.151c.123.38.003.795-.3 1.03L12 22.035l10.38-11.326z"/>
			<path fill="#E24329" d="M22.38 10.709h-6.7l2.71-8.447c.138-.423.73-.423.867 0l3.123 8.447z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'discord'}
		<svg class={sizeClass} viewBox="0 0 24 24" fill="#5865F2" xmlns="http://www.w3.org/2000/svg">
			<path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'microsoft' || providerName.toLowerCase() === 'azure'}
		<svg class={sizeClass} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<path fill="#F25022" d="M1 1h10v10H1z"/>
			<path fill="#00A4EF" d="M1 13h10v10H1z"/>
			<path fill="#7FBA00" d="M13 1h10v10H13z"/>
			<path fill="#FFB900" d="M13 13h10v10H13z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'apple'}
		<svg class={sizeClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
			<path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'facebook'}
		<svg class={sizeClass} viewBox="0 0 24 24" fill="#1877F2" xmlns="http://www.w3.org/2000/svg">
			<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'twitter' || providerName.toLowerCase() === 'x'}
		<svg class={sizeClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
		</svg>
	{:else if providerName.toLowerCase() === 'bitbucket'}
		<svg class={sizeClass} viewBox="0 0 24 24" fill="#0052CC" xmlns="http://www.w3.org/2000/svg">
			<path d="M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891L.778 1.213zM14.52 15.53H9.522L8.17 8.466h7.561l-1.211 7.064z"/>
		</svg>
	{/if}
{/snippet}

<svelte:head>
	<title>{t('auth.signUp')} - Wayli</title>
</svelte:head>

<div
	class="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900"
>
	<div class="w-full max-w-md">
		<!-- Back to home (hidden during initial setup) -->
		{#if !isFirstUser}
			<div class="mb-8">
				<a
					href="/"
					class="inline-flex items-center text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
				>
					<ArrowLeft class="mr-2 h-4 w-4" />
					{t('auth.backToHome')}
				</a>
			</div>
		{/if}

		<!-- First User Banner -->
		{#if isFirstUser && !isLoadingSettings}
			<div class="mb-8">
				<div
					class="bg-primary/5 dark:bg-primary/20 rounded-xl border-2 border-[rgb(34,51,95)]/20 p-6 dark:border-[rgb(34,51,95)]/30"
				>
					<div class="flex items-start gap-3">
						<div class="flex-shrink-0">
							<div
								class="bg-primary/10 dark:bg-primary/40 flex h-12 w-12 items-center justify-center rounded-full text-2xl"
							>
								🎉
							</div>
						</div>
						<div class="flex-1">
							<h3 class="text-primary mb-2 text-lg font-semibold dark:text-gray-100">
								{t('signup.firstUserWelcome')}
							</h3>
							<p class="text-primary text-sm dark:text-gray-300">
								{t('signup.firstUserAdminInfo')}
							</p>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Sign Up Form -->
		<div
			class="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-8 text-center">
				<h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
					{t('auth.createYourAccount')}
				</h1>
				<p class="text-gray-600 dark:text-gray-400">{t('auth.joinWayli')}</p>
			</div>

			{#if isLoadingSettings}
				<div
					class="bg-primary/5 dark:bg-primary/20 mb-6 rounded-lg border border-[rgb(34,51,95)]/20 p-4 dark:border-[rgb(34,51,95)]/30"
				>
					<div class="flex items-center">
						<div
							class="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-[rgb(34,51,95)] border-t-transparent"
						></div>
						<div>
							<h3 class="text-primary text-sm font-medium dark:text-gray-200">
								{t('auth.loadingSettings')}
							</h3>
							<p class="text-primary mt-1 text-sm dark:text-gray-300">
								{t('auth.checkingRegistrationStatus')}
							</p>
						</div>
					</div>
				</div>
			{:else if registrationDisabled}
				<div
					class="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
				>
					<div class="flex items-center">
						<X class="mr-2 h-5 w-5 text-red-500" />
						<div>
							<h3 class="text-sm font-medium text-red-800 dark:text-red-200">
								{t('auth.registrationDisabled')}
							</h3>
							<p class="mt-1 text-sm text-red-700 dark:text-red-300">
								{t('auth.registrationDisabledDescription')}
							</p>
						</div>
					</div>
				</div>
			{/if}

			{#if isEmailSent}
				<div class="text-center">
					<div
						class="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20"
					>
						<p class="text-sm text-green-800 dark:text-green-200">
							{t('auth.checkEmailConfirmation')}
						</p>
					</div>
				</div>
			{:else if oauthOnlyMode && oauthProviders.length > 0 && !isFirstUser}
				<!-- OAuth-only mode: show only OAuth buttons -->
				<div class="space-y-4">
					<p class="text-center text-sm text-gray-600 dark:text-gray-400">
						{t('auth.signUpWithProvider')}
					</p>
					{#each oauthProviders as provider}
						<button
							type="button"
							onclick={() => signInWithOAuth(provider.name)}
							disabled={loading}
							class="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
						>
							{#if isKnownProvider(provider.name)}
								{@render providerIcon(provider.name, 'lg')}
							{/if}
							{t('auth.signUpWith')} {provider.display_name}
						</button>
					{/each}
				</div>

				<div class="mt-6 text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{t('auth.alreadyHaveAccount')}
						<a
							href="/auth/signin"
							class="text-primary hover:text-primary/80 dark:text-primary-dark dark:hover:text-primary-dark/80 cursor-pointer font-medium transition-colors"
						>
							{t('auth.signIn')}
						</a>
					</p>
				</div>
			{:else}
				<form onsubmit={handleSignUp} class="space-y-6">
					<!-- Name Fields -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label
								for="firstName"
								class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t('auth.firstName')}
							</label>
							<div class="relative">
								<User
									class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-gray-400"
								/>
								<input
									id="firstName"
									type="text"
									bind:value={firstName}
									required
									disabled={registrationDisabled}
									class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-4 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
									placeholder={t('auth.firstName')}
								/>
							</div>
						</div>
						<div>
							<label
								for="lastName"
								class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t('auth.lastName')}
							</label>
							<input
								id="lastName"
								type="text"
								bind:value={lastName}
								required
								disabled={registrationDisabled}
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
								placeholder={t('auth.lastName')}
							/>
						</div>
					</div>

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
								disabled={registrationDisabled}
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-4 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
								disabled={registrationDisabled}
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
								placeholder={t('auth.createPassword')}
							/>
							<button
								type="button"
								onclick={togglePassword}
								disabled={registrationDisabled}
								class="absolute top-1/2 right-3 -translate-y-1/2 transform cursor-pointer text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-gray-300"
							>
								{#if showPassword}
									<EyeOff class="h-5 w-5" />
								{:else}
									<Eye class="h-5 w-5" />
								{/if}
							</button>
						</div>

						<!-- Password Requirements -->
						{#if password.length > 0}
							<div class="mt-3 space-y-2">
								<p class="text-xs font-medium text-gray-700 dark:text-gray-300">
									{t('auth.passwordRequirements')}
								</p>
								<div class="space-y-1">
									<div class="flex items-center text-xs">
										{#if passwordValidation.minLength}
											<Check class="mr-2 h-3 w-3 text-green-500" />
										{:else}
											<X class="mr-2 h-3 w-3 text-red-500" />
										{/if}
										<span
											class={passwordValidation.minLength
												? 'text-green-600 dark:text-green-400'
												: 'text-red-600 dark:text-red-400'}
										>
											At least {passwordMinLength} characters
										</span>
									</div>
									{#if requireUppercase}
										<div class="flex items-center text-xs">
											{#if passwordValidation.hasUppercase}
												<Check class="mr-2 h-3 w-3 text-green-500" />
											{:else}
												<X class="mr-2 h-3 w-3 text-red-500" />
											{/if}
											<span
												class={passwordValidation.hasUppercase
													? 'text-green-600 dark:text-green-400'
													: 'text-red-600 dark:text-red-400'}
											>
												{t('auth.oneUppercaseLetter')}
											</span>
										</div>
									{/if}
									{#if requireLowercase}
										<div class="flex items-center text-xs">
											{#if passwordValidation.hasLowercase}
												<Check class="mr-2 h-3 w-3 text-green-500" />
											{:else}
												<X class="mr-2 h-3 w-3 text-red-500" />
											{/if}
											<span
												class={passwordValidation.hasLowercase
													? 'text-green-600 dark:text-green-400'
													: 'text-red-600 dark:text-red-400'}
											>
												{t('auth.oneLowercaseLetter')}
											</span>
										</div>
									{/if}
									{#if requireNumber}
										<div class="flex items-center text-xs">
											{#if passwordValidation.hasNumber}
												<Check class="mr-2 h-3 w-3 text-green-500" />
											{:else}
												<X class="mr-2 h-3 w-3 text-red-500" />
											{/if}
											<span
												class={passwordValidation.hasNumber
													? 'text-green-600 dark:text-green-400'
													: 'text-red-600 dark:text-red-400'}
											>
												{t('auth.oneNumber')}
											</span>
										</div>
									{/if}
									{#if requireSpecial}
										<div class="flex items-center text-xs">
											{#if passwordValidation.hasSpecial}
												<Check class="mr-2 h-3 w-3 text-green-500" />
											{:else}
												<X class="mr-2 h-3 w-3 text-red-500" />
											{/if}
											<span
												class={passwordValidation.hasSpecial
													? 'text-green-600 dark:text-green-400'
													: 'text-red-600 dark:text-red-400'}
											>
												{t('auth.oneSpecialCharacter')}
											</span>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- Confirm Password Field -->
					<div>
						<label
							for="confirmPassword"
							class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t('auth.confirmPassword')}
						</label>
						<div class="relative">
							<Lock
								class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-gray-400"
							/>
							<input
								id="confirmPassword"
								type={showConfirmPassword ? 'text' : 'password'}
								bind:value={confirmPassword}
								required
								disabled={registrationDisabled}
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400 {!doPasswordsMatch &&
								confirmPassword.length > 0
									? 'border-red-500'
									: ''}"
								placeholder={t('auth.confirmYourPassword')}
							/>
							<button
								type="button"
								onclick={toggleConfirmPassword}
								disabled={registrationDisabled}
								class="absolute top-1/2 right-3 -translate-y-1/2 transform cursor-pointer text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-gray-300"
							>
								{#if showConfirmPassword}
									<EyeOff class="h-5 w-5" />
								{:else}
									<Eye class="h-5 w-5" />
								{/if}
							</button>
						</div>
						{#if !doPasswordsMatch && confirmPassword.length > 0}
							<p class="mt-1 text-xs text-red-600 dark:text-red-400">
								{t('auth.passwordsDoNotMatch')}
							</p>
						{/if}
					</div>

					<!-- Sign Up Button -->
					<button
						type="submit"
						disabled={loading || !isPasswordValid || !doPasswordsMatch || registrationDisabled}
						class="bg-primary hover:bg-primary/90 dark:bg-primary-dark dark:hover:bg-primary-dark/90 w-full cursor-pointer rounded-lg px-4 py-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					>
						{loading
							? t('auth.creatingAccount')
							: registrationDisabled
								? t('auth.registrationDisabled')
								: t('auth.createAccount')}
					</button>
				</form>

				<div class="mt-6 text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{t('auth.alreadyHaveAccount')}
						<a
							href="/auth/signin"
							class="text-primary hover:text-primary/80 dark:text-primary-dark dark:hover:text-primary-dark/80 cursor-pointer font-medium transition-colors"
						>
							{t('auth.signIn')}
						</a>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
