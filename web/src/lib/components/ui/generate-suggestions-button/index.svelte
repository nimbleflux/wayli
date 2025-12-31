<script lang="ts">
	import { RefreshCw } from 'lucide-svelte';
	import { onMount } from 'svelte';

	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { fluxbase } from '$lib/fluxbase';

	import Tooltip from '../tooltip/index.svelte';

	import type { UserProfile } from '$lib/types/user.types';

	import { browser } from '$app/environment';

	// Use the reactive translation function
	let t = $derived($translate);

	// Props using Svelte 5 runes
	let { disabled = false, onClick } = $props<{
		disabled?: boolean;
		onClick?: () => void;
	}>();

	// User profile and home address state
	let hasHomeAddress = $state(false);
	let isLoadingProfile = $state(false);

	// Load user profile to check for home address
	async function loadUserProfile() {
		if (!browser) return;

		isLoadingProfile = true;
		try {
			const session = await fluxbase.auth.getSession();
			if (!session.data.session?.user) {
				console.error('No session found');
				return;
			}

			// Use the Edge Function to get user profile
			const serviceAdapter = new ServiceAdapter({ session: session.data.session });
			const profile = (await serviceAdapter.getProfile()) as UserProfile;

			// Check if user has a home address
			hasHomeAddress = !!profile?.home_address;
			console.log('🏠 User home address check:', {
				hasHomeAddress,
				homeAddress: profile?.home_address
			});
		} catch (error) {
			console.error('Error loading user profile:', error);
		} finally {
			isLoadingProfile = false;
		}
	}

	function handleClick() {
		if (hasHomeAddress && !disabled && onClick) {
			onClick();
		}
	}

	// Load user profile on mount

	onMount(() => {
		loadUserProfile();
	});

	// Determine if button should be disabled
	let isDisabled = $derived(disabled || !hasHomeAddress || isLoadingProfile);
</script>

<Tooltip
	text={isDisabled
		? t('generateSuggestions.pleaseAddHomeAddress')
		: t('generateSuggestions.tooltip')}
	position="top"
>
	<button
		class="flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors {!isDisabled
			? 'bg-primary hover:bg-primary/90 cursor-pointer text-white'
			: 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400'}"
		onclick={handleClick}
		disabled={isDisabled}
	>
		{#if isLoadingProfile}
			<div
				class="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"
			></div>
		{:else}
			<RefreshCw class="h-4 w-4" />
		{/if}
		{t('generateSuggestions.buttonText')}
	</button>
</Tooltip>
