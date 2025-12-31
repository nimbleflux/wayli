<script lang="ts">
	import { X, MapPin, Clock, Navigation } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { getAmenityStyle, getAmenityLabel } from '$lib/utils/amenity-icons';
	import type { Map as LeafletMap } from 'leaflet';

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
		latitude?: number;
		longitude?: number;
	}

	interface Props {
		place: PlaceData | null;
		onClose: () => void;
	}

	let { place, onClose }: Props = $props();

	let mapContainer: HTMLDivElement | undefined = $state();
	let map: LeafletMap | undefined = $state();
	let L: typeof import('leaflet') | undefined = $state();

	const amenityStyle = $derived(place ? getAmenityStyle(place.poi_amenity) : null);

	function formatDate(dateStr: string | undefined): string {
		if (!dateStr) return '';
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
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
			.slice(0, 3)
			.map((c) => c.charAt(0).toUpperCase() + c.slice(1))
			.join(', ');
	}

	async function initMap() {
		if (!browser || !mapContainer || !place?.latitude || !place?.longitude) return;

		L = (await import('leaflet')).default;

		const lat = place.latitude;
		const lng = place.longitude;

		map = L.map(mapContainer, {
			center: [lat, lng],
			zoom: 16,
			zoomControl: true,
			attributionControl: false
		});

		// Use theme-aware tiles
		const isDark = document.documentElement.classList.contains('dark');
		const tileUrl = isDark
			? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
			: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

		L.tileLayer(tileUrl, {
			maxZoom: 19
		}).addTo(map);

		// Add marker at the place location
		const marker = L.marker([lat, lng]).addTo(map);
		marker.bindPopup(`<strong>${place.poi_name || 'Location'}</strong>`).openPopup();

		// Invalidate size after render
		setTimeout(() => map?.invalidateSize(), 100);
	}

	onDestroy(() => {
		if (map) {
			map.remove();
			map = undefined;
		}
	});

	// Initialize map when place and container are ready
	$effect(() => {
		// Track dependencies
		const currentPlace = place;
		const container = mapContainer;

		if (!currentPlace || !container || !browser) return;

		// Clean up previous map if it exists
		if (map) {
			map.remove();
			map = undefined;
		}

		// Small delay to ensure DOM is ready
		const timeoutId = setTimeout(() => {
			initMap();
		}, 50);

		return () => {
			clearTimeout(timeoutId);
		};
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
		}
	}

	function openInMaps() {
		if (!place?.latitude || !place?.longitude) return;
		const url = `https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}&zoom=17`;
		window.open(url, '_blank');
	}
</script>

<svelte:head>
	<link
		rel="stylesheet"
		href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
		integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
		crossorigin=""
	/>
</svelte:head>

{#if place}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="place-map-title"
		onclick={onClose}
		onkeydown={handleKeydown}
		tabindex="0"
	>
		<div
			class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Header -->
			<div
				class="flex items-start justify-between border-b border-gray-200 p-4 dark:border-gray-700"
			>
				<div class="flex items-start gap-3">
					{#if amenityStyle}
						<div
							class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
							style="background-color: {amenityStyle.bgColor}; color: {amenityStyle.color};"
						>
							<amenityStyle.icon class="h-6 w-6" />
						</div>
					{/if}
					<div>
						<h2 id="place-map-title" class="text-lg font-semibold text-gray-900 dark:text-gray-100">
							{place.poi_name || 'Unknown Place'}
						</h2>
						<div
							class="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-gray-500 dark:text-gray-400"
						>
							{#if place.poi_cuisine}
								<span>{formatCuisine(place.poi_cuisine)}</span>
								<span>•</span>
							{/if}
							<span>{getAmenityLabel(place.poi_amenity)}</span>
						</div>
					</div>
				</div>
				<button
					onclick={onClose}
					class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					aria-label="Close"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Map -->
			<div class="relative h-64 w-full sm:h-80">
				{#if place.latitude && place.longitude}
					<div bind:this={mapContainer} class="h-full w-full"></div>
				{:else}
					<div class="flex h-full items-center justify-center bg-gray-100 dark:bg-gray-800">
						<div class="text-center text-gray-500 dark:text-gray-400">
							<MapPin class="mx-auto mb-2 h-8 w-8" />
							<p>No location data available</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- Details -->
			<div class="border-t border-gray-200 p-4 dark:border-gray-700">
				<div
					class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600 dark:text-gray-400"
				>
					{#if place.city || place.country}
						<span class="flex items-center gap-1.5">
							<MapPin class="h-4 w-4" />
							{place.city}{place.city && place.country ? ', ' : ''}{place.country || ''}
						</span>
					{/if}
					{#if place.duration_minutes}
						<span class="flex items-center gap-1.5">
							<Clock class="h-4 w-4" />
							{formatDuration(place.duration_minutes)}
						</span>
					{/if}
					{#if place.started_at}
						<span class="text-gray-500 dark:text-gray-500">
							{formatDate(place.started_at)}
						</span>
					{/if}
				</div>

				<!-- Actions -->
				{#if place.latitude && place.longitude}
					<div class="mt-4 flex gap-2">
						<button
							onclick={openInMaps}
							class="bg-primary hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
						>
							<Navigation class="h-4 w-4" />
							Open in OpenStreetMap
						</button>
						<button
							onclick={onClose}
							class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							Close
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
