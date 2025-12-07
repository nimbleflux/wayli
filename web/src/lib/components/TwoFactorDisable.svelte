<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { ShieldOff, AlertCircle, X } from 'lucide-svelte';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';
	import { translate } from '$lib/i18n';

	// Use the reactive translation function
	let t = $derived($translate);

	let { open = $bindable(false) } = $props();

	const dispatch = createEventDispatcher();

	let password = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	async function handleDisable() {
		if (!password) {
			error = 'Password is required';
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
			await serviceAdapter.disable2FA(password);

			toast.success('Two-factor authentication has been disabled');
			dispatch('success');
			handleClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to disable 2FA';
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	function handleClose() {
		open = false;
		password = '';
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
					class="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
				>
					<ShieldOff class="h-6 w-6 text-red-600 dark:text-red-400" />
				</div>
				<div>
					<h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
						Disable Two-Factor Authentication
					</h2>
					<p class="text-sm text-gray-600 dark:text-gray-400">
						Confirm your password to continue
					</p>
				</div>
			</div>

			<!-- Warning Message -->
			<div
				class="mb-6 flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20"
			>
				<AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
				<div class="text-sm">
					<p class="font-semibold text-yellow-900 dark:text-yellow-100">Warning</p>
					<p class="mt-1 text-yellow-700 dark:text-yellow-300">
						Disabling 2FA will make your account less secure. You'll only need your password to
						sign in.
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

			<!-- Password Input -->
			<div class="mb-6">
				<label for="disable-2fa-password" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
					Enter your password
				</label>
				<input
					id="disable-2fa-password"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-gray-900 transition focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
					onkeydown={(e) => {
						if (e.key === 'Enter' && password) {
							handleDisable();
						}
					}}
				/>
			</div>

			<!-- Action Buttons -->
			<div class="flex gap-3">
				<button
					onclick={handleClose}
					class="flex-1 rounded-lg border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-700 shadow transition-all duration-200 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
				>
					Cancel
				</button>
				<button
					onclick={handleDisable}
					disabled={isLoading || !password}
					class="flex-1 rounded-lg bg-red-600 px-6 py-3 font-semibold text-white shadow transition-all duration-200 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isLoading ? 'Disabling...' : 'Disable 2FA'}
				</button>
			</div>
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
