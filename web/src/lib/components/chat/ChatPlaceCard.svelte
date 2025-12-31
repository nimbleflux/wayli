<script lang="ts">
	import { MapPin, Clock } from 'lucide-svelte';
	import { getAmenityStyle, getAmenityLabel } from '$lib/utils/amenity-icons';

	interface PlaceData {
		id?: string;
		poi_name?: string;
		poi_amenity?: string;
		poi_cuisine?: string;
		poi_category?: string;
		city?: string;
		country?: string;
		started_at?: string;
		duration_minutes?: number;
		confidence_score?: number;
		latitude?: number;
		longitude?: number;
	}

	interface Props {
		place: PlaceData;
		compact?: boolean;
		onclick?: () => void;
	}

	let { place, compact = false, onclick }: Props = $props();

	const amenityStyle = $derived(getAmenityStyle(place.poi_amenity));
	const AmenityIcon = $derived(amenityStyle.icon);

	function formatDate(dateStr: string): string {
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	function formatDuration(minutes: number | undefined): string {
		if (!minutes) return '';
		if (minutes < 60) return `${minutes} min`;
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	}

	function formatCuisine(cuisine: string | undefined): string {
		if (!cuisine) return '';
		return cuisine
			.split(/[,;]/)
			.map((c) => c.trim())
			.filter(Boolean)
			.slice(0, 2)
			.map((c) => c.charAt(0).toUpperCase() + c.slice(1))
			.join(', ');
	}
</script>

<button
	type="button"
	class="group flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
	class:p-2={compact}
	{onclick}
>
	<!-- Icon anchor -->
	<div
		class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
		class:h-10={compact}
		class:w-10={compact}
		style="background-color: {amenityStyle.bgColor}; color: {amenityStyle.color};"
	>
		<AmenityIcon class={compact ? 'h-5 w-5' : 'h-6 w-6'} />
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1">
		<!-- Name -->
		<h4 class="truncate font-medium text-gray-900 dark:text-gray-100" class:text-sm={compact}>
			{place.poi_name || 'Unknown Place'}
		</h4>

		<!-- Subtitle: cuisine + amenity type -->
		<div class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
			{#if place.poi_cuisine}
				<span>{formatCuisine(place.poi_cuisine)}</span>
				<span>•</span>
			{/if}
			<span>{getAmenityLabel(place.poi_amenity)}</span>
		</div>

		<!-- Location and time info -->
		<div
			class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400 dark:text-gray-500"
		>
			{#if place.city || place.country}
				<span class="flex items-center gap-1">
					<MapPin class="h-3 w-3" />
					{place.city}{place.city && place.country ? ', ' : ''}{place.country || ''}
				</span>
			{/if}
			{#if place.duration_minutes}
				<span class="flex items-center gap-1">
					<Clock class="h-3 w-3" />
					{formatDuration(place.duration_minutes)}
				</span>
			{/if}
			{#if place.started_at && !compact}
				<span>{formatDate(place.started_at)}</span>
			{/if}
		</div>
	</div>
</button>
