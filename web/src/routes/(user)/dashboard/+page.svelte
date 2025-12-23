<script lang="ts">
	import { onMount } from 'svelte';

	import { translate } from '$lib/i18n';

	import { goto } from '$app/navigation';

	// Use the reactive translation function
	let t = $derived($translate);

	onMount(() => {
		// Automatically redirect to trips page when visiting /dashboard
		goto('/dashboard/statistics', { replaceState: true });
	});
</script>

<!-- This content will briefly show before redirect -->
<div class="flex min-h-[400px] items-center justify-center">
	<div class="text-center">
		<div class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-[rgb(34,51,95)]"></div>
		<p class="text-gray-600 dark:text-gray-400">{t('statistics.redirectingToTrips')}</p>
	</div>
</div>
