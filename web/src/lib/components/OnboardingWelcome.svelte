<script lang="ts">
	import { ArrowRight, Home, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { onboardingState, onboardingActions } from '$lib/stores/onboarding';
	import { sessionStore } from '$lib/stores/auth';
	import type { OnboardingCallbacks } from '$lib/types/onboarding.types';

	let {
		open = $bindable(false),
		onComplete,
		onSkip
	}: {
		open: boolean;
		onComplete: (homeAddress?: any) => Promise<void>;
		onSkip: () => Promise<void>;
	} = $props();

	let t = $derived($translate);
	let currentStep = $derived($onboardingState.currentStep);

	// Home address state
	let homeAddressInput = $state('');
	let selectedHomeAddress = $state<any>(null);
	let homeAddressSuggestions = $state<any[]>([]);
	let showSuggestions = $state(false);
	let isSearching = $state(false);
	let selectedAddressIndex = $state(-1);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	async function handleContinue() {
		if (currentStep === 0) {
			// Move to home address step
			onboardingActions.nextStep();
		} else if (currentStep === 1) {
			// Complete onboarding with home address
			await onComplete(selectedHomeAddress);
			onboardingActions.complete();
			open = false;
		}
	}

	async function handleSkip() {
		if (currentStep === 1) {
			// Skip home address
			await onSkip();
			onboardingActions.complete();
			open = false;
		}
	}

	function handleClose() {
		if (confirm(t('onboarding.confirmSkip'))) {
			onSkip();
			onboardingActions.complete();
			open = false;
		}
	}

	// Address autocomplete functions
	function handleAddressInput(event: Event) {
		const target = event.target as HTMLInputElement;
		homeAddressInput = target.value;
		selectedAddressIndex = -1;
		selectedHomeAddress = null;

		if (searchTimeout) clearTimeout(searchTimeout);

		if (!homeAddressInput.trim()) {
			homeAddressSuggestions = [];
			showSuggestions = false;
			return;
		}

		searchTimeout = setTimeout(() => searchAddress(), 300);
	}

	function handleAddressKeydown(event: KeyboardEvent) {
		if (!showSuggestions || homeAddressSuggestions.length === 0) return;

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				selectedAddressIndex = Math.min(
					selectedAddressIndex + 1,
					homeAddressSuggestions.length - 1
				);
				break;
			case 'ArrowUp':
				event.preventDefault();
				selectedAddressIndex = Math.max(selectedAddressIndex - 1, 0);
				break;
			case 'Enter':
				event.preventDefault();
				if (selectedAddressIndex >= 0 && selectedAddressIndex < homeAddressSuggestions.length) {
					selectAddress(homeAddressSuggestions[selectedAddressIndex]);
				}
				break;
			case 'Escape':
				event.preventDefault();
				showSuggestions = false;
				selectedAddressIndex = -1;
				break;
		}
	}

	async function searchAddress() {
		if (!homeAddressInput.trim()) {
			homeAddressSuggestions = [];
			showSuggestions = false;
			return;
		}

		isSearching = true;

		try {
			const session = $sessionStore;
			if (!session) return;

			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.searchGeocode(homeAddressInput)) as any;

			homeAddressSuggestions = Array.isArray(result) ? result : [];
			showSuggestions = homeAddressSuggestions.length > 0;
		} catch (error) {
			console.error('Error searching for address:', error);
			homeAddressSuggestions = [];
			showSuggestions = false;
		} finally {
			isSearching = false;
		}
	}

	function selectAddress(suggestion: any) {
		selectedHomeAddress = suggestion;
		homeAddressInput = suggestion.display_name;
		showSuggestions = false;
		homeAddressSuggestions = [];
	}
</script>

{#if open}
	<!-- Modal Overlay -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) handleClose();
		}}
	>
		<!-- Modal Content -->
		<div
			class="relative w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute top-4 right-4 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
				aria-label={t('common.close')}
			>
				<X class="h-5 w-5" />
			</button>

			<!-- Progress Indicator -->
			<div class="mb-6 flex items-center justify-center gap-2">
				{#each Array(2) as _, i (i)}
					<div
						class="h-2 w-8 rounded-full transition-colors {i === currentStep
							? 'bg-primary'
							: 'bg-gray-300 dark:bg-gray-600'}"
					></div>
				{/each}
			</div>

			{#if currentStep === 0}
				<!-- Step 1: Welcome -->
				<div class="text-center">
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-4xl dark:bg-primary/20"
					>
						👋
					</div>
					<h2 class="mb-4 text-3xl font-bold text-gray-900 dark:text-gray-100">
						{t('onboarding.welcome')}
					</h2>
					<p class="mb-8 text-lg text-gray-600 dark:text-gray-400">
						{t('onboarding.welcomeMessage')}
					</p>
					<p class="mb-6 text-sm text-gray-500 dark:text-gray-500">
						{t('onboarding.stepProgress', { current: 1, total: 2 })}
					</p>
					<button
						onclick={handleContinue}
						class="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 font-semibold text-white transition-all hover:scale-105 hover:bg-primary/90"
					>
						{t('onboarding.continue')}
						<ArrowRight class="h-5 w-5" />
					</button>
				</div>
			{:else if currentStep === 1}
				<!-- Step 2: Home Location (Optional) -->
				<div>
					<div class="mb-6 text-center">
						<div
							class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20"
						>
							<Home class="h-8 w-8 text-green-600 dark:text-green-400" />
						</div>
						<h2 class="mb-4 text-3xl font-bold text-gray-900 dark:text-gray-100">
							{t('onboarding.setHomeLocation')}
						</h2>
						<p class="mb-2 text-gray-600 dark:text-gray-400">
							{t('onboarding.homeLocationHelp')}
						</p>
						<p class="mb-6 text-sm text-gray-500 dark:text-gray-500">
							{t('onboarding.homeLocationOptional')}
						</p>
					</div>

					<!-- Address Input -->
					<div class="mb-8">
						<label
							for="onboarding-address"
							class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t('onboarding.homeAddressLabel')}
						</label>
						<div class="relative">
							<input
								id="onboarding-address"
								type="text"
								bind:value={homeAddressInput}
								oninput={handleAddressInput}
								onkeydown={handleAddressKeydown}
								placeholder={t('onboarding.homeAddressPlaceholder')}
								class="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-[rgb(34,51,95)] focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
							/>
							{#if isSearching}
								<div class="absolute top-1/2 right-3 -translate-y-1/2">
									<div
										class="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(34,51,95)] border-t-transparent"
									></div>
								</div>
							{/if}
						</div>

						<!-- Suggestions Dropdown -->
						{#if homeAddressSuggestions.length > 0 && showSuggestions}
							<div
								class="mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
							>
								{#each homeAddressSuggestions as suggestion, index (suggestion.display_name + index)}
									<button
										type="button"
										class="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-100 dark:hover:bg-gray-700 dark:focus:bg-gray-700 {selectedAddressIndex ===
										index
											? 'bg-primary/10 dark:bg-primary/20'
											: ''}"
										onclick={() => selectAddress(suggestion)}
									>
										<div class="font-medium">{suggestion.display_name}</div>
										{#if suggestion.lat && suggestion.lon}
											<div class="text-xs text-gray-500 dark:text-gray-400">
												📍 {parseFloat(suggestion.lat).toFixed(6)}, {parseFloat(
													suggestion.lon
												).toFixed(6)}
											</div>
										{/if}
									</button>
								{/each}
							</div>
						{/if}

						{#if selectedHomeAddress && selectedHomeAddress.lat}
							<div
								class="mt-2 rounded-md border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20"
							>
								<div class="text-sm text-green-800 dark:text-green-200">
									✅ {selectedHomeAddress.display_name}
								</div>
							</div>
						{/if}

						<p class="mt-2 text-xs text-gray-500 dark:text-gray-500">
							{t('onboarding.homeLocationTip')}
						</p>
					</div>

					<!-- Action Buttons -->
					<p class="mb-4 text-center text-sm text-gray-500 dark:text-gray-500">
						{t('onboarding.stepProgress', { current: 2, total: 2 })}
					</p>
					<div class="flex gap-4">
						<button
							onclick={handleContinue}
							disabled={!selectedHomeAddress}
							class="flex-1 rounded-lg bg-primary px-6 py-3 font-semibold text-white transition-all hover:scale-105 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
						>
							{t('onboarding.continue')}
						</button>
						<button
							onclick={handleSkip}
							class="flex-1 rounded-lg border-2 border-gray-300 px-6 py-3 font-semibold text-gray-700 transition-all hover:scale-105 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							{t('onboarding.skipForNow')}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
