<script lang="ts">
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';

	export let value = '';
	export let placeholder = 'Enter address...';
	export let label = 'Address';
	export let disabled = false;
	export let required = false;
	export let showCoordinates = true;
	export let onInput: ((event: Event) => void) | undefined = undefined;
	export let onSelect:
		| ((data: {
				address: {
					display_name: string;
					coordinates?: { lat: number; lng: number };
					[key: string]: unknown;
				};
				displayName: string;
		  }) => void)
		| undefined = undefined;
	export let onClear: (() => void) | undefined = undefined;

	let inputElement: HTMLInputElement | undefined;
	let isSearching = false;
	let suggestions: Array<{
		display_name: string;
		coordinates?: { lat: number; lng: number };
		[key: string]: unknown;
	}> = [];
	let showSuggestions = false;
	let selectedIndex = -1;
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let searchError: string | null = null;
	let selectedAddress: {
		display_name: string;
		coordinates?: { lat: number; lng: number };
		[key: string]: unknown;
	} | null = null;

	$: if (value !== inputValue) {
		inputValue = value;
	}

	let inputValue = value;

	async function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		inputValue = target.value;
		value = target.value;
		selectedIndex = -1;
		selectedAddress = null;

		if (searchTimeout) clearTimeout(searchTimeout);

		if (!inputValue.trim()) {
			suggestions = [];
			showSuggestions = false;
			searchError = null;
			return;
		}

		searchTimeout = setTimeout(() => searchAddresses(), 300);
		if (onInput) {
			onInput(event);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!showSuggestions || suggestions.length === 0) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
				selectAddress(suggestions[selectedIndex]);
			}
		} else if (event.key === 'Escape') {
			showSuggestions = false;
			selectedIndex = -1;
		}
	}

	async function searchAddresses() {
		if (!inputValue.trim() || inputValue.trim().length < 3) {
			suggestions = [];
			showSuggestions = false;
			searchError = null;
			return;
		}

		try {
			isSearching = true;
			showSuggestions = true;
			searchError = null;

			const session = $sessionStore;
			if (!session) return;

			const serviceAdapter = new ServiceAdapter({ session });
			const data = (await serviceAdapter.searchGeocode(inputValue.trim())) as Array<{
				display_name: string;
				coordinates?: { lat: number; lng: number };
				[key: string]: unknown;
			}>;

			// The Edge Functions service returns the data array directly
			suggestions = Array.isArray(data) ? data : [];
			showSuggestions = true;

			if (suggestions.length === 0) {
				searchError = 'No addresses found';
			}
		} catch (error) {
			console.error('Error searching for address:', error);
			suggestions = [];
			searchError = 'Failed to search for address';
			showSuggestions = true;
		} finally {
			isSearching = false;
		}
	}

	function selectAddress(address: {
		display_name: string;
		coordinates?: { lat: number; lng: number };
		[key: string]: unknown;
	}) {
		selectedAddress = address;
		inputValue = address.display_name;
		value = address.display_name;
		showSuggestions = false;
		selectedIndex = -1;
		if (onSelect) {
			onSelect({ address, displayName: address.display_name });
		}
	}

	export let showClearButton: boolean = false;

	function clearAddress() {
		inputValue = '';
		value = '';
		selectedAddress = null;
		suggestions = [];
		showSuggestions = false;
		searchError = null;
		selectedIndex = -1;

		if (onClear) {
			onClear();
		}
	}
</script>

<div class="relative">
	<label
		for="address-input"
		class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
	>
		{label}
		{#if required}
			<span class="text-red-500">*</span>
		{/if}
	</label>

	<input
		id="address-input"
		type="text"
		bind:this={inputElement}
		bind:value={inputValue}
		{placeholder}
		{disabled}
		{required}
		oninput={handleInput}
		onkeydown={handleKeydown}
		class="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 transition focus:ring-2 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
	/>

	{#if showClearButton && inputValue}
		<button
			type="button"
			aria-label="Clear address"
			class="absolute top-2 right-2 rounded p-1 text-gray-500 hover:bg-gray-200 focus:ring-2 focus:ring-[rgb(34,51,95)] focus:outline-none dark:text-gray-300 dark:hover:bg-gray-700"
			onclick={clearAddress}
		>
			✕
		</button>
	{/if}

	<!-- Loading Spinner -->
	{#if isSearching}
		<div
			data-testid="loading-indicator"
			class="pointer-events-none absolute inset-y-0 right-3 flex items-center"
		>
			<div
				class="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"
			></div>
			<span class="sr-only">Searching...</span>
		</div>
	{/if}

	<!-- Suggestions Dropdown -->
	{#if showSuggestions}
		<div
			class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
		>
			{#if suggestions.length > 0}
				{#each suggestions as suggestion, index (suggestion.display_name + index)}
					<button
						type="button"
						data-testid="address-suggestion"
						class="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-gray-700 dark:focus:bg-gray-700 {selectedIndex ===
						index
							? 'bg-gray-100 dark:bg-gray-700'
							: ''}"
						onclick={() => selectAddress(suggestion)}
					>
						<div class="text-sm text-gray-900 dark:text-gray-100">{suggestion.display_name}</div>
						{#if suggestion.coordinates}
							<div class="text-xs text-gray-500 dark:text-gray-400">
								{suggestion.coordinates.lat.toFixed(4)}, {suggestion.coordinates.lng.toFixed(4)}
							</div>
						{/if}
					</button>
				{/each}
			{:else if searchError}
				<div class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
					{searchError}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Selected Address Display -->
	{#if selectedAddress && selectedAddress.coordinates && showCoordinates}
		<div
			class="mt-2 rounded-md border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20"
		>
			<div class="text-sm text-green-800 dark:text-green-200">
				📍 Coordinates: {selectedAddress.coordinates.lat.toFixed(4)}, {selectedAddress.coordinates.lng.toFixed(
					4
				)}
			</div>
			<div class="mt-1 text-xs text-green-600 dark:text-green-300">
				{selectedAddress.display_name}
			</div>
		</div>
	{/if}
</div>
