<script lang="ts">
	import { Mail, ArrowLeft, RefreshCw } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';

	// Use the reactive translation function
	let t = $derived($translate);

	let email = $state('');
	let resendLoading = $state(false);
	let resendCooldown = $state(0);
	let cooldownInterval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		// Get email from sessionStorage or Fluxbase session
		const pendingEmail = sessionStorage.getItem('pending_verification_email');

		(async () => {
			const {
				data: { user }
			} = await fluxbase.auth.getUser();

			if (user && user.email_confirmed_at) {
				// User is already verified, redirect to dashboard
				console.log('🔄 [VERIFY-EMAIL] User already verified, redirecting to dashboard');
				sessionStorage.removeItem('pending_verification_email');
				goto('/dashboard/statistics');
			} else if (user?.email) {
				// Get email from user object if available
				email = user.email;
			} else if (pendingEmail) {
				// Fall back to sessionStorage
				email = pendingEmail;
			}
		})();

		return () => {
			if (cooldownInterval) {
				clearInterval(cooldownInterval);
			}
		};
	});

	async function resendVerificationEmail() {
		if (!email) {
			toast.error(t('auth.emailRequired'));
			return;
		}

		if (resendCooldown > 0) {
			toast.error(t('auth.pleaseWaitBeforeResending'));
			return;
		}

		resendLoading = true;

		try {
			const { error } = await fluxbase.auth.resend({
				type: 'signup',
				email: email,
				options: {
					emailRedirectTo: `${window.location.origin}/auth/callback`
				}
			});

			if (error) throw error;

			toast.success(t('auth.verificationEmailResent'));

			// Start cooldown (60 seconds)
			resendCooldown = 60;
			cooldownInterval = setInterval(() => {
				resendCooldown--;
				if (resendCooldown <= 0 && cooldownInterval) {
					clearInterval(cooldownInterval);
					cooldownInterval = null;
				}
			}, 1000);
		} catch (error: any) {
			console.error('Error resending verification email:', error);
			toast.error(error.message || t('auth.failedToResendEmail'));
		} finally {
			resendLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{t('auth.verifyYourEmail')} - Wayli</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
	<div class="w-full max-w-md">
		<!-- Back to signin -->
		<div class="mb-8">
			<a
				href="/auth/signin"
				class="inline-flex items-center text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
			>
				<ArrowLeft class="mr-2 h-4 w-4" />
				{t('auth.backToSignIn')}
			</a>
		</div>

		<!-- Verification Card -->
		<div
			class="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-6 text-center">
				<!-- Email Icon -->
				<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 dark:bg-primary/30">
					<Mail class="h-8 w-8 text-primary dark:text-gray-400" />
				</div>

				<h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
					{t('auth.verifyYourEmail')}
				</h1>
				<p class="text-gray-600 dark:text-gray-400">
					{t('auth.verificationEmailSent')}
				</p>
			</div>

			<!-- Email Address -->
			{#if email}
				<div class="mb-6 rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
					<p class="text-center text-sm font-medium text-gray-900 dark:text-gray-100">
						{email}
					</p>
				</div>
			{/if}

			<!-- Instructions -->
			<div class="mb-6 space-y-3">
				<div class="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
					<div class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary dark:bg-primary/30 dark:text-gray-300">
						1
					</div>
					<p>{t('auth.checkInboxForEmail')}</p>
				</div>
				<div class="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
					<div class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary dark:bg-primary/30 dark:text-gray-300">
						2
					</div>
					<p>{t('auth.clickVerificationLink')}</p>
				</div>
				<div class="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
					<div class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary dark:bg-primary/30 dark:text-gray-300">
						3
					</div>
					<p>{t('auth.youWillBeRedirected')}</p>
				</div>
			</div>

			<!-- Resend Button -->
			<div class="mb-6">
				<button
					type="button"
					onclick={resendVerificationEmail}
					disabled={resendLoading || resendCooldown > 0}
					class="w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
				>
					{#if resendLoading}
						<span class="flex items-center justify-center gap-2">
							<RefreshCw class="h-4 w-4 animate-spin" />
							{t('auth.resending')}
						</span>
					{:else if resendCooldown > 0}
						{t('auth.resendIn', { seconds: resendCooldown })}
					{:else}
						{t('auth.resendVerificationEmail')}
					{/if}
				</button>
			</div>

			<!-- Help Text -->
			<div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
				<p class="text-center text-sm text-gray-600 dark:text-gray-400">
					{t('auth.didntReceiveEmail')}
					<br />
					<span class="text-xs">{t('auth.checkSpamFolder')}</span>
				</p>
			</div>
		</div>

		<!-- Additional Help -->
		<div class="mt-6 text-center">
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{t('auth.needHelp')}
				<a
					href="mailto:support@wayli.app"
					class="cursor-pointer font-medium text-primary transition-colors hover:text-primary/80"
				>
					{t('auth.contactSupport')}
				</a>
			</p>
		</div>
	</div>
</div>
