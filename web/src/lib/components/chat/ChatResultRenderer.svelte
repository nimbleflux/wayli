<script lang="ts">
	import { MapPin, Clock, ChevronDown, ChevronUp, ChevronRight, Database } from 'lucide-svelte';
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
	let isTableCollapsed = $state(true);
	const maxInitialResults = 5;

	// Safely access data with fallback to empty array
	const safeData = $derived(queryResult.data ?? []);

	const detection = $derived(detectResultType(queryResult.query, safeData, queryResult.rowCount));

	const showAsCards = $derived(
		detection.suggestedView === 'cards' && safeData.length <= maxCardsToShow
	);

	// For table view, show 5 initially or all if expanded
	const displayData = $derived(
		showAsCards ? safeData : showAllResults ? safeData : safeData.slice(0, maxInitialResults)
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

	/**
	 * Get a displayable value from a row, trying priority fields first
	 * then falling back to the first meaningful string/number value
	 */
	function getDisplayValue(row: Record<string, unknown>): string {
		// Priority fields to try first
		const priorityFields = [
			'poi_name',
			'title',
			'name',
			'visited_country_codes',
			'visited_countries',
			'country',
			'city',
			'visited_cities',
			'primary_city',
			'primary_country_code'
		];

		for (const field of priorityFields) {
			if (row[field] && typeof row[field] === 'string') {
				return row[field] as string;
			}
		}

		// Fields to skip in fallback (dates, IDs, metadata)
		const skipFields = [
			'id',
			'metadata',
			'created_at',
			'updated_at',
			'start_date',
			'end_date',
			'started_at',
			'ended_at',
			'recorded_at',
			'timestamp'
		];

		// ISO date pattern to skip (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
		const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;

		// Fallback: find first non-excluded, non-date string value
		for (const [key, value] of Object.entries(row)) {
			if (key.endsWith('_id') || skipFields.includes(key)) continue;
			if (value && typeof value === 'string' && value.length < 200) {
				// Skip ISO date strings
				if (isoDatePattern.test(value)) continue;
				return value;
			}
			if (typeof value === 'number') {
				return String(value);
			}
		}

		return 'Unknown';
	}

	// Fields to skip when determining displayable columns
	const skipColumnFields = [
		'id',
		'metadata',
		'created_at',
		'updated_at',
		'start_date',
		'end_date',
		'started_at',
		'ended_at',
		'recorded_at',
		'timestamp',
		'image_url',
		'labels',
		'visited_country_codes'
	];

	/**
	 * Get columns that should be displayed in a table view
	 * Filters out IDs, metadata, and other non-display fields
	 */
	function getDisplayableColumns(data: Record<string, unknown>[]): string[] {
		if (data.length === 0) return [];

		const sample = data[0];
		const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;

		return Object.keys(sample).filter((key) => {
			if (key.endsWith('_id') || skipColumnFields.includes(key)) return false;
			const value = sample[key];
			// Include strings (non-date) and numbers
			if (typeof value === 'string') {
				return value.length < 200 && !isoDatePattern.test(value);
			}
			return typeof value === 'number';
		});
	}

	/**
	 * Format a column key as a readable header
	 * e.g., "poi_name" -> "POI Name", "visited_cities" -> "Visited Cities"
	 */
	function formatColumnHeader(key: string): string {
		return key
			.split('_')
			.map((word) => {
				// Handle common abbreviations
				if (word.toLowerCase() === 'poi') return 'POI';
				if (word.toLowerCase() === 'id') return 'ID';
				return word.charAt(0).toUpperCase() + word.slice(1);
			})
			.join(' ');
	}

	/**
	 * Format a cell value for display
	 */
	function formatCellValue(value: unknown): string {
		if (value === null || value === undefined) return '-';
		if (typeof value === 'number') return value.toLocaleString();
		if (typeof value === 'string') return value;
		return String(value);
	}

	// Compute displayable columns for the current data
	const displayableColumns = $derived(getDisplayableColumns(safeData));
	const hasMultipleColumns = $derived(displayableColumns.length > 1);
</script>

<div
	class={showAsCards
		? ''
		: 'rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900'}
>
	<!-- Collapsible Header - only show for table view, not cards -->
	{#if !showAsCards}
		<button
			type="button"
			onclick={() => (isTableCollapsed = !isTableCollapsed)}
			class="flex w-full items-center gap-2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
		>
			{#if isTableCollapsed}
				<ChevronRight class="h-3.5 w-3.5 shrink-0" />
			{:else}
				<ChevronDown class="h-3.5 w-3.5 shrink-0" />
			{/if}
			<Database class="h-3 w-3 shrink-0" />
			<span class="font-medium">
				{#if totalQueries > 1}
					Query {queryIndex + 1} of {totalQueries}
				{:else}
					Query Results
				{/if}
			</span>
			<span class="text-gray-400">
				{queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''}
			</span>
		</button>

		{#if !isTableCollapsed && cleanSummary}
			<div class="mt-2 mb-3 text-sm text-gray-700 dark:text-gray-300">
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
						<ChatTripCard {trip} onclick={() => handleTripClick(trip)} />
					{/each}
				</ChatCardGrid>
			{:else if detection.type === 'place_visit'}
				<ChatCardGrid columns={displayData.length > 2 ? 2 : 1}>
					{#each displayData as place, idx (idx)}
						<ChatPlaceCard {place} onclick={() => handlePlaceClick(place)} />
					{/each}
				</ChatCardGrid>
			{:else}
				<!-- Fallback to simple list for other types -->
				<div class="max-h-48 overflow-y-auto">
					{#each displayData as row, rowIdx (rowIdx)}
						<div class="border-t border-gray-200 py-2 first:border-t-0 dark:border-gray-700">
							<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
								{getDisplayValue(row)}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if !isTableCollapsed}
			<!-- Table view (collapsible) -->
			<div class="mt-2 max-h-64 overflow-auto">
				{#if hasMultipleColumns}
					<!-- Multi-column table -->
					<table class="w-full text-left text-sm">
						<thead class="sticky top-0 bg-gray-100 text-xs uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-400">
							<tr>
								{#each displayableColumns.slice(0, 5) as col}
									<th class="whitespace-nowrap px-2 py-1.5 font-medium">
										{formatColumnHeader(col)}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-200 dark:divide-gray-700">
							{#each displayData as row, rowIdx (rowIdx)}
								<tr class="hover:bg-gray-100 dark:hover:bg-gray-800/50">
									{#each displayableColumns.slice(0, 5) as col}
										<td class="px-2 py-1.5 text-gray-900 dark:text-gray-100">
											{formatCellValue(row[col])}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<!-- Single-column list -->
					{#each displayData as row, rowIdx (rowIdx)}
						<div class="border-t border-gray-200 py-2 first:border-t-0 dark:border-gray-700">
							<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
								{getDisplayValue(row)}
							</div>
						</div>
					{/each}
				{/if}
				{#if safeData.length > maxInitialResults}
					<button
						onclick={() => (showAllResults = !showAllResults)}
						class="dark:text-primary-dark dark:hover:text-primary-dark/80 mt-2 flex w-full items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600"
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
