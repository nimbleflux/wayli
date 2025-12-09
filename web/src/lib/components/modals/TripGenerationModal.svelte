<script lang="ts">
	import { Route } from 'lucide-svelte';

	import Modal from '$lib/components/ui/modal/index.svelte';
	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';

	// Use the reactive translation function
	let t = $derived($translate);

	// Props using Svelte 5 runes
	let {
		open = $bindable(false),
		startDate = $bindable(''),
		endDate = $bindable(''),
		useCustomHomeAddress = $bindable(false),
		customHomeAddress = $bindable(''),
		customHomeAddressInput = $bindable(''),
		isCustomHomeAddressSearching = $bindable(false),
		customHomeAddressSuggestions = $bindable([]),
		showCustomHomeAddressSuggestions = $bindable(false),
		selectedCustomHomeAddressIndex = $bindable(-1),
		customHomeAddressSearchError = $bindable(null),
		selectedCustomHomeAddress = $bindable(null),
		clearExistingSuggestions = $bindable(false),
		onClose,
		onGenerate,
		onCustomHomeAddressToggle
	} = $props<{
		open?: boolean;
		startDate?: string;
		endDate?: string;
		useCustomHomeAddress?: boolean;
		customHomeAddress?: string;
		customHomeAddressInput?: string;
		isCustomHomeAddressSearching?: boolean;
		customHomeAddressSuggestions?: Array<{ display_name: string; [key: string]: unknown }>;
		showCustomHomeAddressSuggestions?: boolean;
		selectedCustomHomeAddressIndex?: number;
		customHomeAddressSearchError?: string | null;
		selectedCustomHomeAddress?: { display_name: string; [key: string]: unknown } | null;
		clearExistingSuggestions?: boolean;
		onClose?: () => void;
		onGenerate?: (data: {
			startDate: string;
			endDate: string;
			useCustomHomeAddress: boolean;
			customHomeAddress: string | null;
			customHomeAddressGeocode: { display_name: string; [key: string]: unknown } | null;
			clearExistingSuggestions: boolean;
		}) => void;

		onCustomHomeAddressToggle?: (data: { useCustomHomeAddress: boolean }) => void;
	}>();

	// Add timeout variable at the top
	let customHomeAddressSearchTimeout: ReturnType<typeof setTimeout> | null = null;

	function closeModal() {
		if (onClose) {
			onClose();
		}
	}

	function generateTrip() {
		// Only validate dates if both are provided
		// Allow generation when no dates are set (process all data)
		if (startDate && endDate) {
			if (startDate === endDate) {
				alert(t('tripGenerationModal.singleDayTripError'));
				return;
			}
			if (new Date(startDate) > new Date(endDate)) {
				alert(t('tripGenerationModal.startDateMustBeBeforeEndDate'));
				return;
			}
		}

		if (onGenerate) {
			onGenerate({
				startDate,
				endDate,
				useCustomHomeAddress,
				customHomeAddress: useCustomHomeAddress ? customHomeAddressInput : null,
				customHomeAddressGeocode:
					useCustomHomeAddress && selectedCustomHomeAddress ? selectedCustomHomeAddress : null,
				clearExistingSuggestions
			});
		}
	}

	function handleCustomHomeAddressToggle() {
		// Clear the custom home address when toggle is turned off
		if (!useCustomHomeAddress) {
			customHomeAddress = '';
			customHomeAddressInput = '';
			selectedCustomHomeAddress = null;
			customHomeAddressSuggestions = [];
			showCustomHomeAddressSuggestions = false;
		}
		if (onCustomHomeAddressToggle) {
			onCustomHomeAddressToggle({ useCustomHomeAddress });
		}
	}

	function handleCustomHomeAddressInput(event: Event) {
		const target = event.target as HTMLInputElement;
		customHomeAddressInput = target.value;

		// Clear previous timeout
		if (customHomeAddressSearchTimeout) {
			clearTimeout(customHomeAddressSearchTimeout);
		}

		// Debounce the search
		customHomeAddressSearchTimeout = setTimeout(() => {
			searchCustomHomeAddressSuggestions();
		}, 300);
	}

	function handleCustomHomeAddressKeydown(event: KeyboardEvent) {
		if (!showCustomHomeAddressSuggestions || customHomeAddressSuggestions.length === 0) return;

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				selectedCustomHomeAddressIndex = Math.min(
					selectedCustomHomeAddressIndex + 1,
					customHomeAddressSuggestions.length - 1
				);
				break;
			case 'ArrowUp':
				event.preventDefault();
				selectedCustomHomeAddressIndex = Math.max(selectedCustomHomeAddressIndex - 1, 0);
				break;
			case 'Enter':
				event.preventDefault();
				if (
					selectedCustomHomeAddressIndex >= 0 &&
					selectedCustomHomeAddressIndex < customHomeAddressSuggestions.length
				) {
					selectCustomHomeAddress(customHomeAddressSuggestions[selectedCustomHomeAddressIndex]);
				}
				break;
			case 'Escape':
				showCustomHomeAddressSuggestions = false;
				selectedCustomHomeAddressIndex = -1;
				break;
		}
	}

	async function searchCustomHomeAddressSuggestions() {
		if (!customHomeAddressInput.trim() || customHomeAddressInput.trim().length < 3) {
			customHomeAddressSuggestions = [];
			showCustomHomeAddressSuggestions = false;
			customHomeAddressSearchError = null;
			return;
		}

		try {
			isCustomHomeAddressSearching = true;
			showCustomHomeAddressSuggestions = true;
			customHomeAddressSearchError = null;

			const session = $sessionStore;
			if (!session) return;

			const serviceAdapter = new ServiceAdapter({ session });
			const data = (await serviceAdapter.searchGeocode(customHomeAddressInput.trim())) as Array<{
				display_name: string;
				coordinates?: { lat: number; lng: number };
				[key: string]: unknown;
			}>;

			// The Edge Functions service returns the data array directly
			customHomeAddressSuggestions = Array.isArray(data) ? data : [];
			showCustomHomeAddressSuggestions = true;

			if (customHomeAddressSuggestions.length === 0) {
				customHomeAddressSearchError = 'No addresses found';
			}
		} catch (error) {
			console.error('Error searching for address:', error);
			customHomeAddressSuggestions = [];
			customHomeAddressSearchError = 'Failed to search for address';
			showCustomHomeAddressSuggestions = true;
		} finally {
			isCustomHomeAddressSearching = false;
		}
	}

	function selectCustomHomeAddress(suggestion: {
		display_name: string;
		coordinates?: { lat: number; lng: number };
		[key: string]: unknown;
	}) {
		selectedCustomHomeAddress = suggestion;
		customHomeAddressInput = suggestion.display_name;
		customHomeAddress = suggestion.display_name; // Update the bound prop so parent receives the value
		showCustomHomeAddressSuggestions = false;
		selectedCustomHomeAddressIndex = -1;
	}
</script>

<Modal {open} title={t('tripGenerationModal.title')} size="lg" onClose={closeModal}>
	<div class="space-y-6">
		<!-- Date Range Selection -->
		<div>
			<label
				for="start-date"
				class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
				>{t('tripGenerationModal.startDate')}</label
			>
			<input
				id="start-date"
				type="date"
				bind:value={startDate}
				class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 transition focus:ring-2 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			/>
		</div>

		<div>
			<label for="end-date" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
				>{t('tripGenerationModal.endDate')}</label
			>
			<input
				id="end-date"
				type="date"
				bind:value={endDate}
				class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 transition focus:ring-2 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			/>
		</div>

		<!-- Date Range Help Text -->
		<div
			class="rounded-md border border-[rgb(34,51,95)]/20 bg-[rgb(34,51,95)]/5 p-3 dark:border-[rgb(34,51,95)]/40 dark:bg-[rgb(34,51,95)]/20"
		>
			<div class="flex items-start gap-2">
				<div class="mt-0.5 h-4 w-4 flex-shrink-0 text-[rgb(34,51,95)] dark:text-gray-300">ℹ️</div>
				<div class="text-sm text-[rgb(34,51,95)] dark:text-gray-300">
					<strong>Dates are optional:</strong> Leave both dates empty to generate trip suggestions from
					all your available location data. Set specific dates to limit the analysis to a particular
					time period.
				</div>
			</div>
		</div>

		<!-- Custom Home Address Toggle -->
		<div class="flex items-center gap-3">
			<input
				id="custom-home-address-toggle"
				type="checkbox"
				bind:checked={useCustomHomeAddress}
				onchange={handleCustomHomeAddressToggle}
				class="h-4 w-4 rounded border-gray-300 text-[rgb(34,51,95)] focus:ring-[rgb(34,51,95)] dark:border-gray-600"
			/>
			<label
				for="custom-home-address-toggle"
				class="text-sm font-medium text-gray-700 dark:text-gray-300"
				>{t('tripGenerationModal.useCustomHomeAddress')}</label
			>
		</div>

		<!-- Custom Home Address Input -->
		{#if useCustomHomeAddress}
			<div>
				<label
					for="custom-home-address"
					class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
					>{t('tripGenerationModal.customHomeAddress')}</label
				>
				<div class="relative">
					<input
						id="custom-home-address"
						type="text"
						bind:value={customHomeAddressInput}
						oninput={handleCustomHomeAddressInput}
						onkeydown={handleCustomHomeAddressKeydown}
						placeholder={t('tripGenerationModal.enterCustomHomeAddress')}
						class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 transition focus:ring-2 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
					/>

					{#if isCustomHomeAddressSearching}
						<div class="absolute top-1/2 right-3 -translate-y-1/2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"
							></div>
						</div>
					{/if}
				</div>

				{#if customHomeAddressSuggestions.length > 0 && showCustomHomeAddressSuggestions}
					<div
						class="mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
					>
						{#each customHomeAddressSuggestions as suggestion, index (suggestion.display_name + index)}
							<button
								type="button"
								class="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-gray-700 dark:focus:bg-gray-700 {selectedCustomHomeAddressIndex ===
								index
									? 'bg-gray-100 dark:bg-gray-700'
									: ''}"
								onclick={() => selectCustomHomeAddress(suggestion)}
							>
								<div class="text-sm text-gray-900 dark:text-gray-100">
									{suggestion.display_name}
								</div>
								{#if suggestion.coordinates}
									<div class="text-xs text-gray-500 dark:text-gray-400">
										{suggestion.coordinates.lat.toFixed(4)}, {suggestion.coordinates.lng.toFixed(4)}
									</div>
								{/if}
							</button>
						{/each}
						{#if customHomeAddressSearchError}
							<div class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
								{customHomeAddressSearchError}
							</div>
						{/if}
					</div>
				{:else if showCustomHomeAddressSuggestions && customHomeAddressSearchError}
					<div
						class="mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
					>
						<div class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
							{customHomeAddressSearchError}
						</div>
					</div>
				{/if}

				{#if selectedCustomHomeAddress && selectedCustomHomeAddress.coordinates}
					<div
						class="mt-2 rounded-md border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20"
					>
						<div class="text-sm text-green-800 dark:text-green-200">
							📍 Coordinates: {selectedCustomHomeAddress.coordinates.lat.toFixed(6)}, {selectedCustomHomeAddress.coordinates.lng.toFixed(
								6
							)}
						</div>
						<div class="mt-1 text-xs text-green-600 dark:text-green-300">
							{selectedCustomHomeAddress.display_name}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Clear Existing Suggestions Checkbox -->
		<div class="flex items-center gap-3">
			<input
				id="clear-existing-suggestions"
				type="checkbox"
				bind:checked={clearExistingSuggestions}
				class="h-4 w-4 rounded border-gray-300 text-[rgb(34,51,95)] focus:ring-[rgb(34,51,95)] dark:border-gray-600 dark:bg-gray-800"
			/>
			<label for="clear-existing-suggestions" class="text-sm text-gray-700 dark:text-gray-300">
				{t('tripGenerationModal.clearExistingSuggestions')}
			</label>
		</div>

		<!-- Action Buttons -->
		<div class="flex gap-3 pt-4">
			<button
				onclick={closeModal}
				class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-[rgb(34,51,95)] focus:ring-offset-2 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				{t('common.actions.cancel')}
			</button>
			<button
				onclick={generateTrip}
				class="flex flex-1 items-center justify-center rounded-lg bg-[rgb(34,51,95)] px-4 py-2 font-medium text-white transition-colors hover:bg-[rgb(34,51,95)]/90 focus:ring-2 focus:ring-[rgb(34,51,95)] focus:ring-offset-2 focus:outline-none dark:bg-[rgb(34,51,95)] dark:hover:bg-[rgb(34,51,95)]/90"
			>
				<Route class="mr-2 h-4 w-4 flex-shrink-0" />
				<span class="truncate">{t('tripGenerationModal.generateSuggestions')}</span>
			</button>
		</div>
	</div>
</Modal>
