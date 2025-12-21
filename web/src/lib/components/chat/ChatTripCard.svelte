<script lang="ts">
	import { Calendar, MapPin, ExternalLink } from 'lucide-svelte';

	interface TripData {
		id?: string;
		title?: string;
		description?: string;
		start_date?: string;
		end_date?: string;
		status?: string;
		image_url?: string;
		labels?: string[];
		visited_cities?: string;
		visited_countries?: string;
		visited_country_codes?: string;
	}

	interface Props {
		trip: TripData;
		compact?: boolean;
		onclick?: () => void;
	}

	let { trip, compact = false, onclick }: Props = $props();

	// Generate statistics URL with date range filter
	function getStatisticsUrl(): string | null {
		if (!trip.start_date || !trip.end_date) return null;
		const start = trip.start_date.split('T')[0]; // Get just the date part
		const end = trip.end_date.split('T')[0];
		return `/dashboard/statistics?start=${start}&end=${end}`;
	}

	const statisticsUrl = $derived(getStatisticsUrl());

	function formatDateRange(start: string | undefined, end: string | undefined): string {
		if (!start) return '';
		try {
			const startDate = new Date(start);
			const endDate = end ? new Date(end) : null;

			const startStr = startDate.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric'
			});

			if (!endDate) return startStr;

			const endStr = endDate.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});

			return `${startStr} - ${endStr}`;
		} catch {
			return start;
		}
	}

	function calculateDuration(start: string | undefined, end: string | undefined): string {
		if (!start || !end) return '';
		try {
			const startDate = new Date(start);
			const endDate = new Date(end);
			const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			return `${days} day${days !== 1 ? 's' : ''}`;
		} catch {
			return '';
		}
	}

	function parseCountries(countries: string | undefined): string[] {
		if (!countries) return [];
		// Could be comma-separated or JSON array
		try {
			if (countries.startsWith('[')) {
				return JSON.parse(countries);
			}
			return countries.split(',').map((c) => c.trim()).filter(Boolean);
		} catch {
			return countries.split(',').map((c) => c.trim()).filter(Boolean);
		}
	}

	function parseCities(cities: string | undefined): string {
		if (!cities) return '';
		try {
			if (cities.startsWith('[')) {
				const arr = JSON.parse(cities);
				return arr.slice(0, 3).join(', ') + (arr.length > 3 ? '...' : '');
			}
			const arr = cities.split(',').map((c) => c.trim()).filter(Boolean);
			return arr.slice(0, 3).join(', ') + (arr.length > 3 ? '...' : '');
		} catch {
			return cities;
		}
	}

	function getLabelClass(label: string): string {
		const lowerLabel = label.toLowerCase();
		if (lowerLabel === 'adventure') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
		if (lowerLabel === 'nature') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
		if (lowerLabel === 'roadtrip') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
		if (lowerLabel === 'vacation') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
		if (lowerLabel === 'auto-generated' || lowerLabel === 'suggested') return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
		return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
	}

	const countries = $derived(parseCountries(trip.visited_country_codes || trip.visited_countries));
	const cities = $derived(parseCities(trip.visited_cities));
	const dateRange = $derived(formatDateRange(trip.start_date, trip.end_date));
	const duration = $derived(calculateDuration(trip.start_date, trip.end_date));
	const labels = $derived(trip.labels || []);
</script>

{#if statisticsUrl}
<a
	href={statisticsUrl}
	class="group flex w-full items-start gap-3 overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
>
	<!-- Image thumbnail -->
	<div class="relative h-20 w-24 flex-shrink-0 overflow-hidden" class:h-16={compact} class:w-20={compact}>
		{#if trip.image_url}
			<img
				src={trip.image_url}
				alt={trip.title || 'Trip'}
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
			/>
		{:else}
			<!-- Gradient placeholder -->
			<div class="h-full w-full bg-gradient-to-br from-indigo-400 to-purple-500"></div>
		{/if}

		<!-- Country flags overlay -->
		{#if countries.length > 0}
			<div class="absolute bottom-1 right-1 flex gap-0.5">
				{#each countries.slice(0, 3) as country (country)}
					<img
						src="https://flagcdn.com/w20/{country.toLowerCase()}.png"
						alt={country}
						class="h-3 w-4 rounded-sm shadow-sm"
					/>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1 py-2 pr-3">
		<!-- Title with link icon -->
		<h4 class="flex items-center gap-1.5 truncate font-medium text-gray-900 dark:text-gray-100" class:text-sm={compact}>
			<span class="truncate">{trip.title || 'Untitled Trip'}</span>
			<ExternalLink class="h-3 w-3 flex-shrink-0 text-gray-400 group-hover:text-primary dark:group-hover:text-primary-dark" />
		</h4>

		<!-- Date range and duration -->
		<div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
			<span class="flex items-center gap-1">
				<Calendar class="h-3 w-3" />
				{dateRange}
			</span>
			{#if duration}
				<span class="text-gray-400 dark:text-gray-500">({duration})</span>
			{/if}
		</div>

		<!-- Cities -->
		{#if cities && !compact}
			<div class="mt-1 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
				<MapPin class="h-3 w-3" />
				<span class="truncate">{cities}</span>
			</div>
		{/if}

		<!-- Labels -->
		{#if labels.length > 0 && !compact}
			<div class="mt-1.5 flex flex-wrap gap-1">
				{#each labels.slice(0, 3) as label (label)}
					<span class="rounded-full px-1.5 py-0.5 text-xs font-medium {getLabelClass(label)}">
						{label}
					</span>
				{/each}
			</div>
		{/if}
	</div>
</a>
{:else}
<button
	type="button"
	class="group flex w-full items-start gap-3 overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
	onclick={onclick}
>
	<!-- Image thumbnail -->
	<div class="relative h-20 w-24 flex-shrink-0 overflow-hidden" class:h-16={compact} class:w-20={compact}>
		{#if trip.image_url}
			<img
				src={trip.image_url}
				alt={trip.title || 'Trip'}
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
			/>
		{:else}
			<!-- Gradient placeholder -->
			<div class="h-full w-full bg-gradient-to-br from-indigo-400 to-purple-500"></div>
		{/if}

		<!-- Country flags overlay -->
		{#if countries.length > 0}
			<div class="absolute bottom-1 right-1 flex gap-0.5">
				{#each countries.slice(0, 3) as country (country)}
					<img
						src="https://flagcdn.com/w20/{country.toLowerCase()}.png"
						alt={country}
						class="h-3 w-4 rounded-sm shadow-sm"
					/>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1 py-2 pr-3">
		<!-- Title -->
		<h4 class="truncate font-medium text-gray-900 dark:text-gray-100" class:text-sm={compact}>
			{trip.title || 'Untitled Trip'}
		</h4>

		<!-- Date range and duration -->
		<div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
			<span class="flex items-center gap-1">
				<Calendar class="h-3 w-3" />
				{dateRange}
			</span>
			{#if duration}
				<span class="text-gray-400 dark:text-gray-500">({duration})</span>
			{/if}
		</div>

		<!-- Cities -->
		{#if cities && !compact}
			<div class="mt-1 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
				<MapPin class="h-3 w-3" />
				<span class="truncate">{cities}</span>
			</div>
		{/if}

		<!-- Labels -->
		{#if labels.length > 0 && !compact}
			<div class="mt-1.5 flex flex-wrap gap-1">
				{#each labels.slice(0, 3) as label (label)}
					<span class="rounded-full px-1.5 py-0.5 text-xs font-medium {getLabelClass(label)}">
						{label}
					</span>
				{/each}
			</div>
		{/if}
	</div>
</button>
{/if}
