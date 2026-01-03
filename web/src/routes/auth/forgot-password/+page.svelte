<script lang="ts">
	import { Mail, ArrowLeft, KeyRound, CheckCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';

	// Use the reactive translation function
	let t = $derived($translate);

	let email = $state<string>('');
	let loading = $state(false);
	let emailSent = $state(false);

	async function handleSubmit(event: Event) {
		event.preventDefault();

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
			emailSent = true;
			toast.success(t('auth.passwordResetEmailSent'));
		} catch (error: any) {
			// Even on error, show success to prevent email enumeration
			emailSent = true;
			toast.success(t('auth.passwordResetEmailSent'));
			console.error('Password reset error (hidden from user):', error);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{t('auth.forgotPasswordTitle')} - Wayli</title>
</svelte:head>

<div
	class="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900"
>
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

		<!-- Forgot Password Form -->
		<div
			class="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-8 text-center">
				<div
					class="bg-primary dark:bg-primary-dark mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
				>
					<KeyRound class="h-6 w-6 text-white" />
				</div>
				<h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
					{t('auth.forgotPasswordTitle')}
				</h1>
				<p class="text-gray-600 dark:text-gray-400">
					{t('auth.forgotPasswordDescription')}
				</p>
			</div>

			{#if emailSent}
				<div class="text-center">
					<div
						class="mb-4 flex items-center justify-center rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20"
					>
						<CheckCircle class="mr-2 h-5 w-5 text-green-600 dark:text-green-400" />
						<p class="text-sm text-green-800 dark:text-green-200">
							{t('auth.checkEmailPasswordReset')}
						</p>
					</div>
					<button
						type="button"
						onclick={() => (emailSent = false)}
						class="text-primary hover:text-primary/80 dark:text-primary-dark dark:hover:text-primary-dark/80 text-sm transition-colors"
					>
						{t('auth.tryDifferentMethod')}
					</button>
				</div>
			{:else}
				<form onsubmit={handleSubmit} class="space-y-6">
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
								class="focus:ring-primary w-full rounded-lg border border-gray-300 bg-white py-3 pr-4 pl-10 text-gray-900 placeholder-gray-500 transition-colors focus:border-transparent focus:ring-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
								placeholder={t('auth.enterYourEmail')}
							/>
						</div>
					</div>

					<!-- Submit Button -->
					<button
						type="submit"
						disabled={loading}
						class="bg-primary hover:bg-primary/90 dark:bg-primary-dark dark:hover:bg-primary-dark/90 w-full cursor-pointer rounded-lg px-4 py-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					>
						{loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
					</button>
				</form>

				<div class="mt-6 text-center">
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{t('auth.dontHaveAccount')}
						<a
							href="/auth/signup"
							class="text-primary hover:text-primary/80 dark:text-primary-dark dark:hover:text-primary-dark/80 cursor-pointer font-medium transition-colors"
						>
							{t('auth.signUp')}
						</a>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
