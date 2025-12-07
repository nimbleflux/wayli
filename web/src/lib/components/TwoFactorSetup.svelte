<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Shield, Copy, CheckCircle, AlertCircle, X } from 'lucide-svelte';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';
	import { translate } from '$lib/i18n';
	import type { TwoFactorSetupResponse, TwoFactorEnableResponse } from '$lib/types/user.types';

	// Use the reactive translation function
	let t = $derived($translate);

	let { open = $bindable(false) } = $props();

	const dispatch = createEventDispatcher();

	// Steps: 'setup', 'verify', 'complete'
	let currentStep = $state<'setup' | 'verify' | 'complete'>('setup');
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// Setup data
	let setupData = $state<TwoFactorSetupResponse | null>(null);
	let qrCodeSrc = $state<string>('');
	let secret = $state<string>('');
	let manualEntryKey = $state<string>('');

	// Verification data
	let verificationCode = $state('');
	let backupCodes = $state<string[]>([]);

	// State for copied feedback
	let secretCopied = $state(false);
	let backupCodesCopied = $state(false);

	$effect(() => {
		if (open && currentStep === 'setup') {
			initializeSetup();
		}
	});

	async function initializeSetup() {
		isLoading = true;
		error = null;

		try {
			const session = $sessionStore;
			if (!session) {
				throw new Error('No session found');
			}

			const serviceAdapter = new ServiceAdapter({ session });
			const data = await serviceAdapter.setup2FA();

			setupData = data as TwoFactorSetupResponse;
			qrCodeSrc = data.qr_code;
			secret = data.secret;
			manualEntryKey = data.secret;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to initialize 2FA setup';
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	async function handleVerifyCode() {
		if (!verificationCode || verificationCode.length !== 6) {
			error = '2FA code must be 6 digits';
			return;
		}

		isLoading = true;
		error = null;

		try {
			const session = $sessionStore;
			if (!session) {
				throw new Error('No session found');
			}

			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.enable2FA(verificationCode)) as TwoFactorEnableResponse;

			backupCodes = result.backup_codes || [];
			currentStep = 'complete';
			toast.success('Two-factor authentication enabled successfully!');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to verify code';
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	function copyToClipboard(text: string, type: 'secret' | 'backupCodes') {
		navigator.clipboard.writeText(text).then(() => {
			if (type === 'secret') {
				secretCopied = true;
				setTimeout(() => (secretCopied = false), 2000);
				toast.success('Secret copied to clipboard');
			} else {
				backupCodesCopied = true;
				setTimeout(() => (backupCodesCopied = false), 2000);
				toast.success('Backup codes copied to clipboard');
			}
		});
	}

	function handleClose() {
		if (currentStep === 'complete') {
			dispatch('success');
		}
		open = false;
		// Reset state
		currentStep = 'setup';
		setupData = null;
		qrCodeSrc = '';
		secret = '';
		verificationCode = '';
		backupCodes = [];
		error = null;
	}

	function handleBackupCodesDownload() {
		const content = backupCodes.join('\n');
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'wayli-2fa-backup-codes.txt';
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Backup codes downloaded');
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
			class="animate-fade-in relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
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
					class="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(34,51,95)]/10 dark:bg-[rgb(34,51,95)]/30"
				>
					<Shield class="h-6 w-6 text-[rgb(34,51,95)] dark:text-gray-300" />
				</div>
				<div>
					<h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
						{currentStep === 'setup'
							? 'Set Up Two-Factor Authentication'
							: currentStep === 'verify'
								? 'Verify Your Code'
								: 'Backup Codes'}
					</h2>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						{currentStep === 'setup'
							? 'Step 1 of 3: Scan QR code'
							: currentStep === 'verify'
								? 'Step 2 of 3: Enter verification code'
								: 'Step 3 of 3: Save your backup codes'}
					</p>
				</div>
			</div>

			{#if error}
				<div
					class="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
				>
					<AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
					<p class="text-sm text-red-700 dark:text-red-300">{error}</p>
				</div>
			{/if}

			<!-- Setup Step -->
			{#if currentStep === 'setup'}
				{#if isLoading}
					<div class="flex flex-col items-center justify-center py-12">
						<div
							class="h-12 w-12 animate-spin rounded-full border-4 border-[rgb(34,51,95)] border-t-transparent"
						></div>
						<p class="mt-4 text-sm text-gray-600 dark:text-gray-400">
							Generating QR code...
						</p>
					</div>
				{:else if qrCodeSrc}
					<div class="space-y-6">
						<!-- QR Code -->
						<div class="flex justify-center">
							<div class="rounded-lg border-4 border-gray-200 bg-white p-4 dark:border-gray-700">
								<img src={qrCodeSrc} alt="2FA QR Code" class="h-48 w-48" />
							</div>
						</div>

						<!-- Instructions -->
						<div class="space-y-2 text-sm text-gray-700 dark:text-gray-300">
							<p class="font-semibold">Scan this QR code with your authenticator app:</p>
							<ul class="list-inside list-disc space-y-1 text-gray-600 dark:text-gray-400">
								<li>Google Authenticator</li>
								<li>Microsoft Authenticator</li>
								<li>Authy</li>
								<li>Or any TOTP-compatible app</li>
							</ul>
						</div>

						<!-- Manual Entry -->
						<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
							<p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
								Or enter this code manually:
							</p>
							<div class="flex items-center gap-2">
								<code
									class="flex-1 rounded bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100"
								>
									{manualEntryKey}
								</code>
								<button
									onclick={() => copyToClipboard(manualEntryKey, 'secret')}
									class="rounded-lg p-2 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
									aria-label="Copy secret"
								>
									{#if secretCopied}
										<CheckCircle class="h-5 w-5 text-green-600" />
									{:else}
										<Copy class="h-5 w-5" />
									{/if}
								</button>
							</div>
						</div>

						<!-- Next Button -->
						<button
							onclick={() => (currentStep = 'verify')}
							class="w-full rounded-lg bg-[rgb(34,51,95)] px-6 py-3 font-semibold text-white shadow transition-all duration-200 hover:bg-[rgb(34,51,95)]/90"
						>
							Continue to Verification
						</button>
					</div>
				{/if}
			{/if}

			<!-- Verify Step -->
			{#if currentStep === 'verify'}
				<div class="space-y-6">
					<div>
						<p class="mb-4 text-sm text-gray-700 dark:text-gray-300">
							Enter the 6-digit code from your authenticator app to complete setup:
						</p>
						<input
							type="text"
							bind:value={verificationCode}
							placeholder="000000"
							maxlength="6"
							pattern="[0-9]*"
							inputmode="numeric"
							class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-center font-mono text-2xl tracking-widest text-gray-900 transition focus:border-[rgb(34,51,95)] focus:outline-none focus:ring-2 focus:ring-[rgb(34,51,95)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
							oninput={(e) => {
								const target = e.target as HTMLInputElement;
								target.value = target.value.replace(/[^0-9]/g, '');
								verificationCode = target.value;
							}}
						/>
					</div>

					<div class="flex gap-3">
						<button
							onclick={() => (currentStep = 'setup')}
							class="flex-1 rounded-lg border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-700 shadow transition-all duration-200 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
						>
							Back
						</button>
						<button
							onclick={handleVerifyCode}
							disabled={isLoading || verificationCode.length !== 6}
							class="flex-1 rounded-lg bg-[rgb(34,51,95)] px-6 py-3 font-semibold text-white shadow transition-all duration-200 hover:bg-[rgb(34,51,95)]/90 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isLoading ? 'Verifying...' : 'Verify & Enable'}
						</button>
					</div>
				</div>
			{/if}

			<!-- Complete Step -->
			{#if currentStep === 'complete'}
				<div class="space-y-6">
					<!-- Success Message -->
					<div
						class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20"
					>
						<CheckCircle class="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
						<div>
							<p class="font-semibold text-green-900 dark:text-green-100">
								Two-factor authentication enabled!
							</p>
							<p class="mt-1 text-sm text-green-700 dark:text-green-300">
								Your account is now more secure.
							</p>
						</div>
					</div>

					<!-- Backup Codes -->
					<div>
						<p class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
							Save your backup codes:
						</p>
						<div
							class="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20"
						>
							<p class="text-xs text-yellow-800 dark:text-yellow-200">
								<strong>Important:</strong> Keep these codes in a safe place. You can use them to access
								your account if you lose your authenticator device.
							</p>
						</div>
						<div
							class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800"
						>
							<div class="grid grid-cols-2 gap-2 font-mono text-sm">
								{#each backupCodes as code}
									<div class="rounded bg-white px-3 py-2 text-gray-900 dark:bg-gray-700 dark:text-gray-100">{code}</div>
								{/each}
							</div>
						</div>
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-3">
						<button
							onclick={() => copyToClipboard(backupCodes.join('\n'), 'backupCodes')}
							class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-700 shadow transition-all duration-200 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
						>
							{backupCodesCopied ? 'Copied!' : 'Copy Codes'}
						</button>
						<button
							onclick={handleBackupCodesDownload}
							class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-700 shadow transition-all duration-200 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
						>
							Download
						</button>
					</div>

					<!-- Finish Button -->
					<button
						onclick={handleClose}
						class="w-full rounded-lg bg-[rgb(34,51,95)] px-6 py-3 font-semibold text-white shadow transition-all duration-200 hover:bg-[rgb(34,51,95)]/90"
					>
						Done
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.animate-fade-in {
		animation: fadeIn 0.2s ease-in-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
