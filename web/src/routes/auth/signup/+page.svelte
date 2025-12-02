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
				'wayli.password_require_special'
			]);

			// The value is wrapped in an object: {"value": false}
			const is_setup_complete = publicSettings['wayli.is_setup_complete']?.value === true
				|| publicSettings['wayli.is_setup_complete']?.value === 'true';

			// First user can always sign up
			isFirstUser = !is_setup_complete;

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
</script>

<svelte:head>
	<title>{t('auth.signUp')} - Wayli</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
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
					class="rounded-xl border-2 border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-900/20"
				>
					<div class="flex items-start gap-3">
						<div class="flex-shrink-0">
							<div
								class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900/40"
							>
								🎉
							</div>
						</div>
						<div class="flex-1">
							<h3 class="mb-2 text-lg font-semibold text-blue-900 dark:text-blue-100">
								{t('signup.firstUserWelcome')}
							</h3>
							<p class="text-sm text-blue-700 dark:text-blue-300">
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
					class="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20"
				>
					<div class="flex items-center">
						<div
							class="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
						></div>
						<div>
							<h3 class="text-sm font-medium text-blue-800 dark:text-blue-200">
								{t('auth.loadingSettings')}
							</h3>
							<p class="mt-1 text-sm text-blue-700 dark:text-blue-300">
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
									class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-4 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-[rgb(37,140,244)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
								class="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-[rgb(37,140,244)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
								class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-4 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-[rgb(37,140,244)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
								class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-[rgb(37,140,244)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
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
								class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 focus:ring-[rgb(37,140,244)] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-400 {!doPasswordsMatch &&
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
						class="w-full cursor-pointer rounded-lg bg-[rgb(37,140,244)] px-4 py-3 font-medium text-white transition-colors hover:bg-[rgb(37,140,244)]/90 disabled:cursor-not-allowed disabled:opacity-50"
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
							class="cursor-pointer font-medium text-[rgb(37,140,244)] transition-colors hover:text-[rgb(37,140,244)]/80"
						>
							{t('auth.signIn')}
						</a>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
