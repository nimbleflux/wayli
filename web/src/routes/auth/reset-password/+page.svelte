<script lang="ts">
	import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';

	// Use the reactive translation function
	let t = $derived($translate);

	let password = $state<string>('');
	let confirmPassword = $state<string>('');
	let loading = $state(false);
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);
	let isSuccess = $state(false);

	onMount(async () => {
		// Check if we have a valid session with password reset token
		const { data } = await fluxbase.auth.getSession();

		if (!data?.session) {
			toast.error('Invalid or expired password reset link');
			goto('/auth/signin');
		}
	});

	async function handlePasswordReset(event: Event) {
		event.preventDefault();

		if (password.length < 6) {
			toast.error('Password must be at least 6 characters long');
			return;
		}

		if (password !== confirmPassword) {
			toast.error('Passwords do not match');
			return;
		}

		loading = true;

		try {
			const { error } = await fluxbase.auth.updateUser({
				password: password
			});

			if (error) throw error;

			isSuccess = true;
			toast.success('Password updated successfully');

			// Redirect to sign in after a short delay
			setTimeout(() => {
				goto('/auth/signin');
			}, 2000);
		} catch (error: any) {
			console.error('Password reset error:', error);
			toast.error(error.message || 'Failed to reset password');
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
	<title>{t('auth.resetPassword')} - Wayli</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
	<div class="w-full max-w-md">
		<!-- Back to sign in -->
		<div class="mb-8">
			<a
				href="/auth/signin"
				class="inline-flex items-center text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
			>
				<ArrowLeft class="mr-2 h-4 w-4" />
				{t('auth.backToSignIn')}
			</a>
		</div>

		<!-- Reset Password Form -->
		<div
			class="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-8 text-center">
				<div
					class="bg-primary dark:bg-primary-dark mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
				>
					<Lock class="h-6 w-6 text-white" />
				</div>
				<h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
					{t('auth.resetPassword')}
				</h1>
				<p class="text-gray-600 dark:text-gray-400">
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
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{t('auth.redirectingToSignIn')}
					</p>
				</div>
			{:else}
				<form onsubmit={handlePasswordReset} class="space-y-6">
					<!-- New Password Field -->
					<div>
						<label
							for="password"
							class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t('auth.newPassword')}
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
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
								placeholder={t('auth.enterNewPassword')}
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
						<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							{t('auth.passwordMinLength')}
						</p>
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
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-12 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
								placeholder={t('auth.confirmNewPassword')}
							/>
							<button
								type="button"
								onclick={toggleConfirmPassword}
								class="absolute top-1/2 right-3 -translate-y-1/2 transform cursor-pointer text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
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
						class="bg-primary hover:bg-primary/90 dark:bg-primary-dark dark:hover:bg-primary-dark/90 w-full cursor-pointer rounded-lg px-4 py-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					>
						{loading ? t('auth.resettingPassword') : t('auth.resetPassword')}
					</button>
				</form>
			{/if}
		</div>
	</div>
</div>
