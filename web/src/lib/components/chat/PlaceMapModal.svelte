<script lang="ts">
	import { X, MapPin, Clock, Navigation } from 'lucide-svelte';
	import { onDestroy, untrack } from 'svelte';
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
	let mapLoading = $state(true);
	let mapError = $state(false);

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

		mapLoading = true;
		mapError = false;
		const loadStartTime = Date.now();

		try {
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

			const tileLayer = L.tileLayer(tileUrl, {
				maxZoom: 19
			}).addTo(map);

			let loadCompleted = false;

			// Handle successful tile load
			tileLayer.once('load', () => {
				if (loadCompleted) return;
				loadCompleted = true;

				// Ensure minimum 300ms loading time for smooth UX
				const elapsed = Date.now() - loadStartTime;
				const remainingTime = Math.max(0, 300 - elapsed);

				setTimeout(() => {
					mapLoading = false;
					// Single invalidateSize call after fade-in completes
					setTimeout(() => map?.invalidateSize(), 250);
				}, remainingTime);
			});

			// Handle tile loading errors
			tileLayer.on('tileerror', (e) => {
				if (loadCompleted) return;
				console.warn('Tile loading error:', e);
				// Don't immediately fail - some tiles may still load
			});

			// Fallback timeout (increased from 500ms to 1500ms)
			setTimeout(() => {
				if (loadCompleted) return;
				loadCompleted = true;
				mapLoading = false;
				setTimeout(() => map?.invalidateSize(), 250);
			}, 1500);

			// Add marker at the place location
			const marker = L.marker([lat, lng]).addTo(map);
			marker.bindPopup(`<strong>${place.poi_name || 'Location'}</strong>`).openPopup();
		} catch (error) {
			console.error('Failed to initialize map:', error);
			mapError = true;
			mapLoading = false;
		}
	}

	$effect(() => {
		// Only track place and mapContainer as dependencies
		const currentPlace = place;
		const container = mapContainer;

		if (currentPlace && container && browser) {
			// Use untrack to read/write map without creating a dependency loop
			untrack(() => {
				// Clean up existing map before creating a new one
				if (map) {
					map.remove();
					map = undefined;
				}
				// Wait for next tick to ensure DOM is ready
				requestAnimationFrame(() => {
					initMap();
				});
			});
		}
	});

	onDestroy(() => {
		if (map) {
			map.remove();
			map = undefined;
		}
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
		rel="preload"
		as="style"
		href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
	/>
	<link
		rel="stylesheet"
		href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
		integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
		crossorigin=""
	/>
</svelte:head>

{#if place}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="place-map-title"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={handleKeydown}
		tabindex="0"
	>
		<div
			class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
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
							{place.poi_name || place.city || 'Unknown Place'}
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
					<div
						bind:this={mapContainer}
						class="h-full w-full transition-opacity duration-200"
						class:opacity-0={mapLoading}
						class:opacity-100={!mapLoading}
						style="min-height: 256px;"
					></div>
					{#if mapLoading}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
							<div class="text-center text-gray-500 dark:text-gray-400">
								<div class="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500"></div>
								<p>Loading map...</p>
							</div>
						</div>
					{/if}
					{#if mapError}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
							<div class="text-center text-gray-500 dark:text-gray-400">
								<MapPin class="mx-auto mb-2 h-8 w-8" />
								<p>Failed to load map</p>
							</div>
						</div>
					{/if}
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
