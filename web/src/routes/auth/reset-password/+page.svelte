<script lang="ts">
	import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Use the reactive translation function
	let t = $derived($translate);

	// Get token from URL query parameters
	let token = $derived(page.url.searchParams.get('token'));

	let password = $state<string>('');
	let confirmPassword = $state<string>('');
	let loading = $state(false);
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);
	let isSuccess = $state(false);

	async function handlePasswordReset(event: Event) {
		event.preventDefault();

		if (!token) {
			toast.error(t('auth.invalidResetLink'));
			return;
		}

		if (password.length < 6) {
			toast.error(t('accountSettings.passwordMinLength'));
			return;
		}

		if (password !== confirmPassword) {
			toast.error(t('auth.passwordsDoNotMatch'));
			return;
		}

		loading = true;

		try {
			const { data, error } = await fluxbase.auth.resetPassword(token, password);

			if (error) throw error;

			isSuccess = true;
			toast.success(t('auth.passwordResetSuccess'));

			// User is now logged in, redirect to dashboard after a short delay
			setTimeout(() => {
				goto('/dashboard/location-data');
			}, 2000);
		} catch (error: any) {
			console.error('Password reset error:', error);
			toast.error(error.message || t('auth.signInFailed'));
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
	<title>{t('auth.resetPassword')} · Wayli</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-md">
		<!-- Back to sign in -->
		<div class="mb-8">
			<a
				href="/auth/signin"
				class="hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground inline-flex items-center text-sm text-gray-600 transition-colors"
			>
				<ArrowLeft class="mr-2 h-4 w-4" />
				{t('auth.backToSignIn')}
			</a>
		</div>

		<!-- Reset Password Form -->
		<div class="bg-card border-border rounded-2xl border p-8 shadow-xl">
			{#if !token}
				<!-- Invalid or missing token -->
				<div class="text-center">
					<div
						class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
					>
						<AlertCircle class="h-6 w-6 text-red-600 dark:text-red-400" />
					</div>
					<h1 class="text-foreground mb-2 text-2xl font-bold">
						{t('auth.invalidResetLink')}
					</h1>
					<p class="text-muted-foreground mb-6">
						{t('auth.invalidResetLinkDescription')}
					</p>
					<a
						href="/auth/forgot-password"
						class="bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 inline-block rounded-lg px-6 py-3 font-medium text-white transition-colors"
					>
						{t('auth.requestNewLink')}
					</a>
				</div>
			{:else}
				<div class="mb-8 text-center">
					<div
						class="bg-primary dark:bg-primary mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
					>
						<Lock class="h-6 w-6 text-white" />
					</div>
					<h1 class="text-foreground mb-2 text-2xl font-bold">
						{t('auth.resetPassword')}
					</h1>
					<p class="text-muted-foreground">
						{t('auth.enterNewPassword')}
					</p>
				</div>

				{#if isSuccess}
					<div class="text-center">
						<div
							class="mb-4 flex items-center justify-center rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20"
						>
							<CheckCircle class="mr-2 h-5 w-5 text-green-600 dark:text-green-400" />
							<p class="text-sm text-green-800 dark:text-green-200">
								{t('auth.passwordResetSuccess')}
							</p>
						</div>
						<p class="text-muted-foreground text-sm">
							{t('auth.redirectingToDashboard')}
						</p>
					</div>
				{:else}
					<form onsubmit={handlePasswordReset} class="space-y-6">
						<!-- New Password Field -->
						<div>
							<label for="password" class="text-muted-foreground mb-2 block text-sm font-medium">
								{t('auth.newPassword')}
							</label>
							<div class="relative">
								<Lock
									class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
								/>
								<input
									id="password"
									type={showPassword ? 'text' : 'password'}
									bind:value={password}
									required
									class="focus:ring-primary dark:border-border dark:bg-muted dark:text-foreground dark:placeholder:text-muted-foreground w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2"
									placeholder={t('auth.enterNewPassword')}
								/>
								<button
									type="button"
									onclick={togglePassword}
									class="text-muted-foreground hover:text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 transform cursor-pointer transition-colors"
								>
									{#if showPassword}
										<EyeOff class="h-5 w-5" />
									{:else}
										<Eye class="h-5 w-5" />
									{/if}
								</button>
							</div>
							<p class="text-muted-foreground mt-1 text-xs">
								{t('auth.passwordMinLength')}
							</p>
						</div>

						<!-- Confirm Password Field -->
						<div>
							<label
								for="confirmPassword"
								class="text-muted-foreground mb-2 block text-sm font-medium"
							>
								{t('auth.confirmPassword')}
							</label>
							<div class="relative">
								<Lock
									class="text-muted-foreground absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
								/>
								<input
									id="confirmPassword"
									type={showConfirmPassword ? 'text' : 'password'}
									bind:value={confirmPassword}
									required
									class="focus:ring-primary dark:border-border dark:bg-muted dark:text-foreground dark:placeholder:text-muted-foreground w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2"
									placeholder={t('auth.confirmNewPassword')}
								/>
								<button
									type="button"
									onclick={toggleConfirmPassword}
									class="text-muted-foreground hover:text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 transform cursor-pointer transition-colors"
								>
									{#if showConfirmPassword}
										<EyeOff class="h-5 w-5" />
									{:else}
										<Eye class="h-5 w-5" />
									{/if}
								</button>
							</div>
						</div>

						<!-- Reset Password Button -->
						<button
							type="submit"
							disabled={loading}
							class="bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 w-full cursor-pointer rounded-lg px-4 py-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
						>
							{loading ? t('auth.resettingPassword') : t('auth.resetPassword')}
						</button>
					</form>
				{/if}
			{/if}
		</div>
	</div>
</div>
