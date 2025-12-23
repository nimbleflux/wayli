<script lang="ts">
	import { MapPin, Clock, ChevronDown, ChevronUp } from 'lucide-svelte';
	import { detectResultType, type ChatResultType } from '$lib/utils/chat-result-detection';
	import { getAmenityLabel } from '$lib/utils/amenity-icons';
	import ChatPlaceCard from './ChatPlaceCard.svelte';
	import ChatTripCard from './ChatTripCard.svelte';
	import ChatCardGrid from './ChatCardGrid.svelte';

	interface QueryResultData {
		query: string;
		summary: string;
		rowCount: number;
		data: Record<string, unknown>[];
	}

	interface Props {
		queryResult: QueryResultData;
		queryIndex?: number;
		totalQueries?: number;
		maxCardsToShow?: number;
		onPlaceClick?: (place: Record<string, unknown>) => void;
		onTripClick?: (trip: Record<string, unknown>) => void;
	}

	let {
		queryResult,
		queryIndex = 0,
		totalQueries = 1,
		maxCardsToShow = 6,
		onPlaceClick,
		onTripClick
	}: Props = $props();

	// State for expand/collapse
	let showAllResults = $state(false);
	const maxInitialResults = 5;

	// Safely access data with fallback to empty array
	const safeData = $derived(queryResult.data ?? []);

	const detection = $derived(
		detectResultType(queryResult.query, safeData, queryResult.rowCount)
	);

	const showAsCards = $derived(
		detection.suggestedView === 'cards' && safeData.length <= maxCardsToShow
	);

	// For table view, show 5 initially or all if expanded
	const displayData = $derived(
		showAsCards
			? safeData
			: showAllResults
				? safeData
				: safeData.slice(0, maxInitialResults)
	);

	// Clean up summary by removing "Sample X values: ..." text
	const cleanSummary = $derived(
		queryResult.summary?.replace(/\s*Sample \w+ values:.*$/i, '').trim() || ''
	);

	function formatDate(dateStr: unknown): string {
		if (!dateStr || typeof dateStr !== 'string') return '';
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return String(dateStr);
		}
	}

	function handlePlaceClick(place: Record<string, unknown>) {
		onPlaceClick?.(place);
	}

	function handleTripClick(trip: Record<string, unknown>) {
		onTripClick?.(trip);
	}
</script>

<div class={showAsCards ? '' : 'rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900'}>
	<!-- Header and Summary - only show for table view, not cards -->
	{#if !showAsCards}
		<div class="mb-2 flex items-center justify-between">
			<span class="text-xs font-medium text-gray-500 dark:text-gray-400">
				{#if totalQueries > 1}
					Query {queryIndex + 1} of {totalQueries}
				{:else}
					Query Results
				{/if}
			</span>
			<span class="text-xs text-gray-400">
				{queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''}
			</span>
		</div>

		{#if cleanSummary}
			<div class="mb-3 text-sm text-gray-700 dark:text-gray-300">
				{cleanSummary}
			</div>
		{/if}
	{/if}

	<!-- Results -->
	{#if safeData.length > 0}
		{#if showAsCards}
			<!-- Card view -->
			{#if detection.type === 'trip'}
				<ChatCardGrid columns={displayData.length > 2 ? 2 : 1}>
					{#each displayData as trip, idx (idx)}
						<ChatTripCard
							trip={trip}
							onclick={() => handleTripClick(trip)}
						/>
					{/each}
				</ChatCardGrid>
			{:else if detection.type === 'place_visit'}
				<ChatCardGrid columns={displayData.length > 2 ? 2 : 1}>
					{#each displayData as place, idx (idx)}
						<ChatPlaceCard
							place={place}
							onclick={() => handlePlaceClick(place)}
						/>
					{/each}
				</ChatCardGrid>
			{:else}
				<!-- Fallback to table for other types -->
				<div class="max-h-48 overflow-y-auto">
					{#each displayData as row, rowIdx (rowIdx)}
						<div class="border-t border-gray-200 py-2 first:border-t-0 dark:border-gray-700">
							<div class="text-sm text-gray-900 dark:text-gray-100">
								{JSON.stringify(row, null, 2)}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<!-- Table view -->
			<div class="max-h-48 overflow-y-auto">
				{#each displayData as row, rowIdx (rowIdx)}
					<div class="border-t border-gray-200 py-2 first:border-t-0 dark:border-gray-700">
						{#if detection.type === 'place_visit'}
							<!-- Place visit row -->
							<div class="flex items-center gap-2">
								<span class="font-medium text-gray-900 dark:text-gray-100">
									{row.poi_name || 'Unknown Place'}
								</span>
								{#if row.poi_amenity}
									<span class="text-xs text-gray-500">
										({getAmenityLabel(row.poi_amenity as string)})
									</span>
								{/if}
							</div>
							{#if row.city || row.country}
								<div class="flex items-center gap-1 text-xs text-gray-500">
									<MapPin class="h-3 w-3" />
									{row.city}{row.country ? `, ${row.country}` : ''}
								</div>
							{/if}
							{#if row.started_at}
								<div class="flex items-center gap-1 text-xs text-gray-400">
									<Clock class="h-3 w-3" />
									{formatDate(row.started_at)}
								</div>
							{/if}
						{:else if detection.type === 'trip'}
							<!-- Trip row -->
							<div class="flex items-center gap-2">
								<span class="font-medium text-gray-900 dark:text-gray-100">
									{row.title || 'Untitled Trip'}
								</span>
								{#if row.status}
									<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
										{row.status}
									</span>
								{/if}
							</div>
							{#if row.start_date || row.end_date}
								<div class="text-xs text-gray-500">
									{formatDate(row.start_date)} - {formatDate(row.end_date)}
								</div>
							{/if}
						{:else}
							<!-- Generic row -->
							<div class="flex items-center gap-2">
								<span class="font-medium text-gray-900 dark:text-gray-100">
									{row.poi_name || row.title || row.name || 'Unknown'}
								</span>
							</div>
							{#if row.city || row.country}
								<div class="flex items-center gap-1 text-xs text-gray-500">
									<MapPin class="h-3 w-3" />
									{row.city}{row.country ? `, ${row.country}` : ''}
								</div>
							{/if}
							{#if row.started_at || row.recorded_at}
								<div class="flex items-center gap-1 text-xs text-gray-400">
									<Clock class="h-3 w-3" />
									{formatDate(row.started_at || row.recorded_at)}
								</div>
							{/if}
						{/if}
					</div>
				{/each}
				{#if safeData.length > maxInitialResults}
					<button
						onclick={() => (showAllResults = !showAllResults)}
						class="mt-2 flex w-full items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-primary-dark dark:hover:text-primary-dark/80"
					>
						{#if showAllResults}
							<ChevronUp class="h-3 w-3" />
							Show less
						{:else}
							<ChevronDown class="h-3 w-3" />
							Show all {safeData.length} results
						{/if}
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>
