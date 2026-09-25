<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Shield, AlertCircle, X, Key } from 'lucide-svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { translate } from '$lib/i18n';

	// Use the reactive translation function
	let t = $derived($translate);

	let { open = $bindable(false), userId = '', mfaToken = '' } = $props();

	const dispatch = createEventDispatcher();

	let code = $state('');
	let useBackupCode = $state(false);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	async function handleVerify() {
		// The platform's challenge flow (Fluxbase ≥ 2026.9.3) requires the
		// short-lived mfa_token returned by the signIn response.
		if (!mfaToken) {
			error = 'Your verification challenge expired — please sign in again';
			return;
		}

		// Validate code format
		if (useBackupCode) {
			if (!code || code.length !== 8) {
				error = 'Backup code must be 8 characters';
				return;
			}
		} else {
			if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
				error = '2FA code must be 6 digits';
				return;
			}
		}

		isLoading = true;
		error = null;

		try {
			// Call Fluxbase SDK directly - no session needed for verify2FA
			const { data, error: verifyError } = await fluxbase.auth.verify2FA({
				mfa_token: mfaToken,
				user_id: userId || undefined,
				code: code
			});

			if (verifyError) {
				throw new Error(verifyError.message || 'Failed to verify 2FA code');
			}

			if (!data) {
				throw new Error('No verification response returned');
			}

			toast.success(t('auth.twoFactorVerified'));
			dispatch('success', data);
			handleClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to verify code';
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	function handleClose() {
		open = false;
		code = '';
		error = null;
		useBackupCode = false;
	}

	function toggleCodeType() {
		useBackupCode = !useBackupCode;
		code = '';
		error = null;
	}
</script>

{#if open}
	<!-- Modal Overlay -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={handleClose}
		onkeydown={(e) => {
			if (e.key === 'Escape') handleClose();
		}}
		role="button"
		tabindex="0"
		aria-label="Close modal"
	>
		<!-- Modal Box -->
		<div
			class="animate-fade-in bg-card border-border relative w-full max-w-md rounded-2xl border p-8 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="text-muted-foreground hover:bg-muted hover:text-muted-foreground absolute top-4 right-4 rounded-full p-2"
				aria-label="Close"
			>
				<X class="h-5 w-5" />
			</button>

			<!-- Header -->
			<div class="mb-6 flex items-center gap-3">
				<div
					class="bg-primary/10 dark:bg-primary/30 flex h-12 w-12 items-center justify-center rounded-full"
				>
					<Shield class="text-primary dark:text-muted-foreground h-6 w-6" />
				</div>
				<div>
					<h2 class="text-foreground text-2xl font-bold">Two-Factor Authentication</h2>
					<p class="text-muted-foreground text-sm">Enter your verification code</p>
				</div>
			</div>

			<!-- Error Message -->
			{#if error}
				<div
					class="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
				>
					<AlertCircle class="h-5 w-5 text-red-600 dark:text-red-400" />
					<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
				</div>
			{/if}

			<!-- Code Input -->
			<div class="mb-6">
				<label for="code" class="text-muted-foreground mb-2 block text-sm font-medium">
					{#if useBackupCode}
						Backup Code
					{:else}
						Authenticator Code
					{/if}
				</label>
				<input
					id="code"
					type="text"
					bind:value={code}
					placeholder={useBackupCode ? 'XXXXXXXX' : '000000'}
					maxlength={useBackupCode ? 8 : 6}
					class="focus:ring-primary dark:border-border dark:text-foreground dark:placeholder:text-muted-foreground bg-card w-full rounded-lg border border-gray-300 px-4 py-3 text-center font-mono text-2xl tracking-widest text-gray-900 placeholder-gray-400 transition-colors focus:border-transparent focus:ring-2"
					disabled={isLoading}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !isLoading) {
							handleVerify();
						}
					}}
				/>
				<p class="text-muted-foreground mt-2 text-xs">
					{#if useBackupCode}
						Enter one of your 8-character backup codes
					{:else}
						Enter the 6-digit code from your authenticator app
					{/if}
				</p>
			</div>

			<!-- Toggle Code Type -->
			<div class="mb-6">
				<button
					onclick={toggleCodeType}
					class="dark:bg-card dark:text-muted-foreground border-border hover:bg-muted flex w-full items-center justify-center gap-2 rounded-lg border bg-gray-50 px-4 py-2 text-sm text-gray-700 transition-colors"
					disabled={isLoading}
				>
					<Key class="h-4 w-4" />
					{#if useBackupCode}
						Use authenticator app instead
					{:else}
						Use backup code instead
					{/if}
				</button>
			</div>

			<!-- Action Buttons -->
			<div class="flex gap-3">
				<button
					onclick={handleClose}
					class="dark:border-border dark:text-muted-foreground hover:bg-muted flex-1 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition-colors"
					disabled={isLoading}
				>
					Cancel
				</button>
				<button
					onclick={handleVerify}
					class="bg-primary hover:bg-primary/90 flex-1 rounded-lg px-4 py-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isLoading || !code}
				>
					{#if isLoading}
						Verifying...
					{:else}
						Verify
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
