<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Shield, AlertCircle, X, Key } from 'lucide-svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { translate } from '$lib/i18n';

	// Use the reactive translation function
	let t = $derived($translate);

	let { open = $bindable(false), userId = '' } = $props();

	const dispatch = createEventDispatcher();

	let code = $state('');
	let useBackupCode = $state(false);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	async function handleVerify() {
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
				user_id: userId,
				code: code
			});

			if (verifyError) {
				throw new Error(verifyError.message || 'Failed to verify 2FA code');
			}

			if (!data) {
				throw new Error('No verification response returned');
			}

			toast.success('Successfully verified! Signing you in...');
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
			class="animate-fade-in relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute right-4 top-4 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
				aria-label="Close"
			>
				<X class="h-5 w-5" />
			</button>

			<!-- Header -->
			<div class="mb-6 flex items-center gap-3">
				<div
					class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 dark:bg-primary/30"
				>
					<Shield class="h-6 w-6 text-primary dark:text-gray-300" />
				</div>
				<div>
					<h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
						Two-Factor Authentication
					</h2>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						Enter your verification code
					</p>
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
				<label for="code" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
					class="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-center text-2xl font-mono tracking-widest text-gray-900 placeholder-gray-400 transition-colors focus:border-transparent focus:ring-2 focus:ring-[rgb(34,51,95)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
					disabled={isLoading}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !isLoading) {
							handleVerify();
						}
					}}
				/>
				<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
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
					class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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
					class="flex-1 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
					disabled={isLoading}
				>
					Cancel
				</button>
				<button
					onclick={handleVerify}
					class="flex-1 rounded-lg bg-primary px-4 py-3 font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
