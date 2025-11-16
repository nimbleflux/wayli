<script lang="ts">
	console.log('🚀 New Statistics page script loaded');

	import { format } from 'date-fns';
	import {
		MapPin,
		Activity,
		Loader2,
		Route,
		Navigation,
		Globe2,
		Clock,
		Flag,
		Footprints,
		Train,
		BarChart,
		Import,
		AlertTriangle,
		X
	} from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
	import { getCountryNameReactive, translate } from '$lib/i18n';
	import { state as appState } from '$lib/stores/app-state.svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { ClientStatisticsService } from '$lib/services/client-statistics.service';
	import {
		getTransportDetectionReasonLabel,
		type TransportDetectionReason
	} from '$lib/types/transport-detection-reasons';
	import { formatDateInTimezone, getTimezoneFromOffset } from '$lib/utils/timezone-utils';
	import { formatLocalDate } from '$lib/utils/utils';

	import type { Map as LeafletMap } from 'leaflet';
	import { browser } from '$app/environment';
	import { SvelteDate } from 'svelte/reactivity';

	// Use the reactive translation function
	let t = $derived($translate);

	// Interfaces
	interface TrackerLocation {
		id: string;
		name: string;
		description: string;
		type: 'tracker';
		coordinates: { lat: number; lng: number };
		city: string;
		created_at: string;
		updated_at: string;
		recorded_at: string;
		altitude?: number;
		accuracy?: number;
		speed?: number;
		transport_mode: string;
		detectionReason?: TransportDetectionReason | string;
		velocity?: number;
		distance?: number;
		geocode?: any;
		tz_diff?: number;
	}

	interface StatisticsData {
		totalDistance?: string;
		earthCircumferences?: number;
		geopoints?: number;
		timeSpentMoving?: string;
		uniquePlaces?: number;
		countriesVisited?: number;
		steps?: number;
		transport?: Array<{
			mode: string;
			distance: number;
			time: number;
			percentage: number;
			points?: number;
		}>;
		countryTimeDistribution?: Array<{ country_code: string; percent: number }>;
		trainStationVisits?: Array<{ name: string; count: number }>;
		geocodingStats?: {
			total: number;
			geocoded: number;
			successRate: number;
		};
	}

	// Map state
	let map: LeafletMap;
	let L: typeof import('leaflet');
	let mapContainer: HTMLDivElement;
	let currentTileLayer = $state<any>(null);
	let isInitializing = $state(true);
	// Use a regular array instead of $state to avoid triggering effects
	let mapMarkers: any[] = [];
	let selectedPoint: any = $state(null);

	// Loading and progress state
	let isLoading = $state(false);
	let isInitialLoad = $state(true);
	let loadingProgress = $state(0);
	let loadingStage = $state('');
	let progressAnimationId = $state<NodeJS.Timeout | null>(null);
	let isHandlingDateChange = $state(false);

	// Statistics state
	let statisticsData = $state<StatisticsData | null>(null);
	let statisticsLoading = $state(false);
	let statisticsError = $state('');

	// Warning state
	let showLargeDatasetWarning = $state(false);
	let totalPointsCount = $state(0);
	let userConfirmedLargeDataset = $state(false);

	// Service instance
	let statisticsService = $state<ClientStatisticsService | null>(null);

	// Helper to ensure a value is a Date object
	function getDateObject(val: any) {
		if (!val) return null;
		return val instanceof Date ? val : new Date(val);
	}

	// Smooth progress animation function (reused from original)
	function animateProgress(target: number, duration: number = 800, immediate: boolean = false) {
		if (progressAnimationId) {
			clearTimeout(progressAnimationId);
		}

		// If immediate is true or we're starting from 0, set immediately without animation
		if (immediate || (loadingProgress === 0 && target > 0)) {
			loadingProgress = target;
			return;
		}

		const start = loadingProgress;
		const change = target - start;
		const startTime = Date.now();

		function updateProgress() {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const easeOutCubic = 1 - Math.pow(1 - progress, 3);
			const currentProgress = start + change * easeOutCubic;
			loadingProgress = Math.round(currentProgress);

			if (progress < 1) {
				progressAnimationId = setTimeout(updateProgress, 16);
			} else {
				loadingProgress = target;
				progressAnimationId = null;
			}
		}

		updateProgress();
	}

	// Clean up animation on component unmount
	onDestroy(() => {
		if (progressAnimationId) {
			clearTimeout(progressAnimationId);
		}
	});

	// Initialize the statistics service
	function initializeService() {
		if (!statisticsService) {
			statisticsService = new ClientStatisticsService();
		}
	}

	// Check if dataset is large and show warning
	async function checkDatasetSize(): Promise<boolean> {
		if (!statisticsService) return false;

		try {
			// Format dates in local timezone to avoid timezone shifting
			const startDate = formatLocalDate(appState.filtersStartDate);
			const endDate = formatLocalDate(appState.filtersEndDate);

			const {
				data: { session },
				error: sessionError
			} = await fluxbase.auth.getSession();
			if (sessionError || !session) {
				throw new Error('User not authenticated');
			}

			totalPointsCount = await statisticsService.getTotalCount(session.user.id, startDate, endDate);

			if (totalPointsCount > 100000) {
				showLargeDatasetWarning = true;
				return false; // Don't proceed until user confirms
			}

			return true; // Proceed with loading
		} catch (error) {
			console.error('❌ Error checking dataset size:', error);
			toast.error('Failed to check dataset size');
			return false;
		}
	}

	// Handle user confirmation for large dataset
	function handleLargeDatasetConfirmation(proceed: boolean) {
		showLargeDatasetWarning = false;
		if (proceed) {
			userConfirmedLargeDataset = true;
			loadStatisticsData();
		}
	}

	// Main function to load statistics data using the new service
	async function loadStatisticsData(): Promise<void> {
		if (!statisticsService) {
			initializeService();
		}

		try {
			isLoading = true;
			isInitialLoad = false;
			statisticsLoading = true;
			statisticsError = '';
			loadingProgress = 0; // Reset progress to 0 for new loading session

			// Format dates in local timezone to avoid timezone shifting
			const startDate = formatLocalDate(appState.filtersStartDate);
			const endDate = formatLocalDate(appState.filtersEndDate);

			if (!startDate && !endDate) {
				console.log('📅 No date range set, skipping data fetch');
				return;
			}

			const {
				data: { session },
				error: sessionError
			} = await fluxbase.auth.getSession();
			if (sessionError || !session) {
				throw new Error('User not authenticated');
			}

			console.log('📊 Starting client-side statistics processing...');

			// Load and process data with progress tracking
			const statistics = await statisticsService!.loadAndProcessData(
				session.user.id,
				startDate,
				endDate,
				// Progress callback
				(progress) => {
					loadingStage = progress.stage;
					animateProgress(progress.percentage);
					console.log(`📊 Progress: ${progress.percentage}% - ${progress.stage}`);
				},
				// Error callback
				(error, canRetry) => {
					console.error('❌ Error during processing:', error);
					statisticsError = error.message;
					if (canRetry) {
						toast.error(`Processing error: ${error.message}. You can retry.`);
					} else {
						toast.error(`Processing failed: ${error.message}`);
					}
				}
			);

			// Get formatted statistics for display
			statisticsData = statisticsService!.getFormattedStatistics();

			// Draw data points on map
			const rawDataPoints = (statisticsService as any).rawDataPoints;
			if (rawDataPoints && rawDataPoints.length > 0) {
				drawDataPointsOnMap(rawDataPoints);
			}
		} catch (error) {
			console.error('❌ Error loading statistics:', error);
			statisticsError = error instanceof Error ? error.message : 'Unknown error';
			toast.error('Failed to load statistics');
		} finally {
			isLoading = false;
			statisticsLoading = false;
		}
	}

	// Retry loading with resume capability
	async function retryLoading(): Promise<void> {
		if (statisticsService && statisticsService.isCurrentlyProcessing()) {
			console.log('🔄 Already processing, cannot retry');
			return;
		}

		statisticsError = '';
		await loadStatisticsData();
	}

	// Handle date range changes
	async function handleDateRangeChange() {
		// Prevent concurrent calls
		if (isHandlingDateChange || isLoading) {
			console.log('⏭️ Skipping handleDateRangeChange - already processing');
			return;
		}

		isHandlingDateChange = true;

		try {
			// Reset state
			userConfirmedLargeDataset = false;
			statisticsData = null;
			statisticsError = '';

			// Clear map markers before loading new data
			clearMapMarkers();

			// CRITICAL: Reset the service to clear accumulated data
			if (statisticsService) {
				statisticsService.reset();
			}

			// Check dataset size first
			const canProceed = await checkDatasetSize();
			if (canProceed) {
				await loadStatisticsData();
			}
		} finally {
			isHandlingDateChange = false;
		}
	}

	// Get statistics for display (reused from original)
	function getStatistics() {
		if (!statisticsData) return [];

		// Helper to sum green distances
		function getGreenDistance() {
			if (!statisticsData || !statisticsData.transport) return 0;
			// Sum distances in meters and convert to kilometers
			const distanceInMeters = statisticsData.transport
				.filter((t: { mode: string }) => greenModes.includes(t.mode))
				.reduce(
					(sum: number, t: { distance: number }) =>
						sum + (typeof t.distance === 'number' ? t.distance : 0),
					0
				);
			return distanceInMeters / 1000; // Convert meters to kilometers
		}

		const greenDistance = getGreenDistance();

		return [
			{
				id: 'total-distance',
				title: t('statistics.movingDistance'),
				value: statisticsData.totalDistance ?? '0 km',
				icon: Navigation,
				color: 'blue'
			},
			{
				id: 'green-distance',
				title: t('statistics.distanceTravelledGreen'),
				value:
					greenDistance > 0
						? `${greenDistance.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
						: '0 km',
				icon: Activity,
				color: 'green'
			},
			{
				id: 'earth-circumferences',
				title: t('statistics.earthCircumferences'),
				value: formatEarthCircumferences(statisticsData.earthCircumferences),
				icon: Globe2,
				color: 'blue'
			},
			{
				id: 'geopoints-tracked',
				title: t('statistics.geopointsTracked'),
				value: statisticsData.geopoints?.toLocaleString() ?? '0',
				icon: MapPin,
				color: 'blue'
			},
			{
				id: 'time-moving',
				title: t('statistics.timeMoving'),
				value: statisticsData.timeSpentMoving ?? '0h',
				icon: Clock,
				color: 'blue'
			},
			{
				id: 'unique-places',
				title: t('statistics.uniquePlaces'),
				value: statisticsData.uniquePlaces?.toLocaleString() ?? '0',
				icon: Flag,
				color: 'blue'
			},
			{
				id: 'countries-visited',
				title: t('statistics.countriesVisited'),
				value: statisticsData.countriesVisited?.toString() ?? '0',
				icon: Globe2,
				color: 'blue'
			},
			{
				id: 'approximate-steps',
				title: t('statistics.approximateSteps'),
				value: statisticsData.steps?.toLocaleString() ?? '0',
				icon: Footprints,
				color: 'blue'
			}
		];
	}
	let localStartDate = $state(
		appState.filtersStartDate instanceof Date ? appState.filtersStartDate : ''
	);
	let localEndDate = $state(appState.filtersEndDate instanceof Date ? appState.filtersEndDate : '');

	// Sync appState to local dates
	$effect(() => {
		localStartDate = appState.filtersStartDate instanceof Date ? appState.filtersStartDate : '';
		localEndDate = appState.filtersEndDate instanceof Date ? appState.filtersEndDate : '';
	});

	// Use MutationObserver to detect date picker changes and trigger data loads
	onMount(() => {
		let lastText = '';
		const dateField = document.querySelector('.datepicker-statistics-fix .date-field .date');
		if (!dateField) return;

		const observer = new MutationObserver(() => {
			const text = dateField.textContent?.trim();
			if (!text || text === lastText) return;
			lastText = text;

			// Try to parse the date range
			const match = text.match(/([A-Za-z]{3,} \d{1,2}, \d{4}) - ([A-Za-z]{3,} \d{1,2}, \d{4})/);
			if (match) {
				const [, startStr, endStr] = match;
				const start = new Date(startStr);
				const end = new Date(endStr);
				if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
					// Update appState directly to trigger the main $effect
					appState.filtersStartDate = start;
					appState.filtersEndDate = end;
					// The main $effect will handle the data loading
				}
			}
		});

		observer.observe(dateField, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	});

	// Helper functions (reused from original)
	const greenModes = ['walking', 'cycling'];

	function formatEarthCircumferences(circumferences?: number): string {
		if (!circumferences || circumferences === 0) return '0';
		if (circumferences < 0.01) return '< 0.01';
		return circumferences.toFixed(2);
	}

	// Translate transport mode to display name
	function translateTransportMode(mode: string): string {
		// Remove 'transport.' prefix if present
		const cleanMode = mode.replace('transport.', '');

		const modeTranslations: Record<string, string> = {
			walking: t('transport.walking'),
			cycling: t('transport.cycling'),
			car: t('transport.car'),
			train: t('transport.train'),
			airplane: t('transport.airplane'),
			stationary: t('transport.stationary'),
			unknown: t('transport.unknown')
		};
		return modeTranslations[cleanMode] || cleanMode;
	}

	// Get flag emoji for country code
	function getFlagEmoji(countryCode: string): string {
		const codePoints = countryCode
			.toUpperCase()
			.split('')
			.map((char) => 127397 + char.charCodeAt(0));
		return String.fromCodePoint(...codePoints);
	}

	// Transport mode colors
	const transportModeColors: Record<string, string> = {
		car: '#dc2626', // Red
		train: '#7c3aed', // Purple
		airplane: '#000000', // Black
		cycling: '#ea580c', // Orange
		walking: '#16a34a', // Green
		unknown: '#6b7280' // Grey
	};

	// Get color for transport mode
	function getTransportModeColor(mode: string): string {
		const cleanMode = mode.replace('transport.', '');
		return transportModeColors[cleanMode] || transportModeColors.unknown;
	}

	// Clear existing map markers
	function clearMapMarkers() {
		if (!map || !L) return;
		for (const marker of mapMarkers) {
			map.removeLayer(marker);
		}
		mapMarkers.length = 0;
	}

	// Draw data points on map
	function drawDataPointsOnMap(dataPoints: any[]) {
		if (!map || !L || !dataPoints.length) return;

		console.log('🗺️ Drawing', dataPoints.length, 'data points on map');

		// Clear existing markers
		clearMapMarkers();

		// Sort points by recorded_at timestamp to ensure proper order
		const sortedPoints = [...dataPoints].sort(
			(a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
		);

		// Draw lines between consecutive points
		for (let i = 0; i < sortedPoints.length - 1; i++) {
			const currentPoint = sortedPoints[i];
			const nextPoint = sortedPoints[i + 1];

			if (currentPoint.lat && currentPoint.lon && nextPoint.lat && nextPoint.lon) {
				const currentLat = parseFloat(currentPoint.lat);
				const currentLon = parseFloat(currentPoint.lon);
				const nextLat = parseFloat(nextPoint.lat);
				const nextLon = parseFloat(nextPoint.lon);

				if (!isNaN(currentLat) && !isNaN(currentLon) && !isNaN(nextLat) && !isNaN(nextLon)) {
					// Use the transport mode of the NEXT point for the line color
					// The detection at nextPoint tells us what mode was used to REACH that point
					const mode = nextPoint.transport_mode || 'unknown';
					const color = getTransportModeColor(mode);

					// Create polyline between consecutive points
					const polyline = L.polyline(
						[
							[currentLat, currentLon],
							[nextLat, nextLon]
						],
						{
							color: color,
							weight: 3,
							opacity: 0.7
						}
					);

					// Add to map
					polyline.addTo(map);
					mapMarkers.push(polyline);
				}
			}
		}

		// Group points by transport mode for markers
		const pointsByMode: Record<string, any[]> = {};
		sortedPoints.forEach((point) => {
			const mode = point.transport_mode || 'unknown';
			if (!pointsByMode[mode]) {
				pointsByMode[mode] = [];
			}
			pointsByMode[mode].push(point);
		});

		// Draw markers for each transport mode
		Object.entries(pointsByMode).forEach(([mode, points]) => {
			const color = getTransportModeColor(mode);

			points.forEach((point) => {
				if (point.lat && point.lon) {
					const lat = parseFloat(point.lat);
					const lon = parseFloat(point.lon);

					if (!isNaN(lat) && !isNaN(lon)) {
						// Create circle marker
						const marker = L.circleMarker([lat, lon], {
							radius: 4,
							fillColor: color,
							color: color,
							weight: 1,
							opacity: 0.8,
							fillOpacity: 0.6
						});

						// Add click handler
						marker.on('click', () => {
							selectedPoint = point;
						});

						// Add to map
						marker.addTo(map);
						mapMarkers.push(marker);
					}
				}
			});
		});

		// Fit map to show all points
		if (mapMarkers.length > 0) {
			const group = (L as any).featureGroup(mapMarkers);
			map.fitBounds(group.getBounds().pad(0.1));
		}
	}

	// Close point details popup
	function closePointDetails() {
		selectedPoint = null;
	}

	// Format segment duration
	function formatSegmentDuration(hours: number): string {
		if (hours < 1) {
			const minutes = Math.round(hours * 60);
			return `${minutes}m`;
		}
		return `${hours.toFixed(1)}h`;
	}

	// Format distance from meters to a human-readable format
	function formatDistance(meters: number): string {
		const km = meters / 1000;
		if (km < 0.1) {
			return `${Math.round(meters)} m`;
		} else if (km < 10) {
			return `${km.toFixed(2)} km`;
		} else if (km < 100) {
			return `${km.toFixed(1)} km`;
		} else {
			return `${Math.round(km)} km`;
		}
	}

	// Format date with timezone information
	function formatDateWithTimezoneSync(recordedAt: string, tzDiff?: number): string {
		const utcDate = new Date(recordedAt);

		// If we have tz_diff, use it to look up the timezone
		if (tzDiff !== undefined && tzDiff !== null) {
			try {
				const timezone = getTimezoneFromOffset(tzDiff);
				return formatDateInTimezone(utcDate, timezone);
			} catch (error) {
				console.warn('Failed to get timezone, falling back to UTC:', error);
			}
		}

		// Fallback to UTC if no timezone info
		return formatDateInTimezone(utcDate, 'UTC');
	}

	// Initialize on mount
	onMount(async () => {
		initializeService();
		await initializeMap();

		// Set default date range to past 7 days if no date range is set
		if (!appState.filtersStartDate && !appState.filtersEndDate) {
			const endDate = new SvelteDate();
			const startDate = new SvelteDate();
			startDate.setDate(endDate.getDate() - 6); // Last 7 days includes today and 6 days before

			appState.filtersStartDate = startDate;
			appState.filtersEndDate = endDate;
			console.log('📅 Set default date range:', { start: startDate, end: endDate });
		}

		// Don't call handleDateRangeChange() here - the $effect will handle it
		isInitializing = false;
	});

	// Track last processed dates to prevent duplicate processing
	let lastProcessedStart: Date | string | null = null;
	let lastProcessedEnd: Date | string | null = null;

	// Reactive statement for date range changes
	$effect(() => {
		// Only watch the date changes, not other reactive state
		const startDate = appState.filtersStartDate;
		const endDate = appState.filtersEndDate;

		// Convert to comparable strings
		const startStr = startDate instanceof Date ? startDate.toISOString() : String(startDate);
		const endStr = endDate instanceof Date ? endDate.toISOString() : String(endDate);
		const lastStartStr = lastProcessedStart instanceof Date ? lastProcessedStart.toISOString() : String(lastProcessedStart);
		const lastEndStr = lastProcessedEnd instanceof Date ? lastProcessedEnd.toISOString() : String(lastProcessedEnd);

		// Only trigger if dates actually changed and we're not initializing
		if (!isInitializing && (startDate || endDate)) {
			if (startStr !== lastStartStr || endStr !== lastEndStr) {
				console.log('📅 Date range changed, triggering data load');
				lastProcessedStart = startDate;
				lastProcessedEnd = endDate;
				handleDateRangeChange();
			}
		}
	});

	// Initialize map
	async function initializeMap() {
		if (!browser || !mapContainer) return;

		try {
			L = (await import('leaflet')).default;
			if (map) return;

			// Small delay to ensure container is ready
			await new Promise((resolve) => setTimeout(resolve, 100));

			map = L.map(mapContainer, {
				center: [20, 0], // Default center of the world
				zoom: 2, // Default zoom level to show the world
				zoomControl: true,
				attributionControl: false
			});

			// Invalidate map size to ensure proper rendering
			setTimeout(() => {
				if (map) {
					map.invalidateSize();
				}
			}, 200);

			function getTileLayerUrl() {
				const isDark = document.documentElement.classList.contains('dark');
				return isDark
					? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
					: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
			}

			function getAttribution() {
				const isDark = document.documentElement.classList.contains('dark');
				return isDark
					? '&copy; <a href="https://carto.com/attributions">CARTO</a>'
					: '© OpenStreetMap contributors';
			}

			currentTileLayer = L.tileLayer(getTileLayerUrl(), {
				attribution: getAttribution()
			}).addTo(map) as any;

			// Theme switching observer
			const updateMapTheme = () => {
				if (!map || !L) return;
				const isDark = document.documentElement.classList.contains('dark');
				const newUrl = getTileLayerUrl();
				const newAttribution = getAttribution();
				if (currentTileLayer && (currentTileLayer as any)._url !== newUrl) {
					map.removeLayer(currentTileLayer);
					currentTileLayer = L.tileLayer(newUrl, { attribution: newAttribution }).addTo(map) as any;
				}
			};
			const observer = new MutationObserver(updateMapTheme);
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

			// Initial theme sync
			updateMapTheme();

			console.log('🗺️ Map initialized successfully');
		} catch (error) {
			console.error('❌ Error initializing map:', error);
		}
	}
</script>

<svelte:head>
	<link
		rel="stylesheet"
		href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
		integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
		crossorigin=""
	/>
	<style>
		.leaflet-container {
			pointer-events: auto !important;
			touch-action: manipulation !important;
		}
		.leaflet-pane {
			pointer-events: auto !important;
		}
		.leaflet-control {
			pointer-events: auto !important;
		}

		/* Ensure map container doesn't interfere with mouse events */
		.map-container {
			pointer-events: auto !important;
			touch-action: manipulation !important;
		}

		.datepicker-statistics-fix .date-filter {
			position: static !important;
		}
		.datepicker-statistics-fix .datepicker-dropdown {
			position: absolute !important;
			right: 0 !important;
			left: auto !important;
			min-width: 340px;
			max-width: 95vw;
			z-index: 3000 !important;
			margin-top: 8px;
			overflow-x: auto;
		}
		@media (max-width: 600px) {
			.datepicker-statistics-fix .datepicker-dropdown {
				left: 0 !important;
				right: auto !important;
				min-width: 0;
				width: 98vw;
				max-width: 98vw;
			}
		}
		.datepicker-statistics-fix .calendars-container {
			right: 0 !important;
			left: auto !important;
			max-width: 95vw !important;
			overflow-x: auto !important;
			position: absolute !important;
			z-index: 3000 !important;
		}
		@media (max-width: 600px) {
			.datepicker-statistics-fix .calendars-container {
				left: 0 !important;
				right: auto !important;
				width: 98vw !important;
				max-width: 98vw !important;
			}
		}
	</style>
</svelte:head>

<!-- Large Dataset Warning Modal -->
{#if showLargeDatasetWarning}
	<div class="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50">
		<div class="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
			<div class="mb-4 flex items-center">
				<AlertTriangle class="mr-3 h-6 w-6 text-yellow-500" />
				<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
					Large Dataset Warning
				</h3>
			</div>
			<div class="mb-6 text-sm text-gray-600 dark:text-gray-400">
				<p class="mb-2">
					You have <strong>{totalPointsCount.toLocaleString()}</strong> data points in the selected date
					range.
				</p>
				<p class="mb-2">
					Processing this much data may take several minutes and could slow down your browser.
				</p>
				<p>
					Consider selecting a smaller date range for better performance, or proceed if you want to
					process all data.
				</p>
			</div>
			<div class="flex justify-end space-x-3">
				<button
					onclick={() => handleLargeDatasetConfirmation(false)}
					class="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
				>
					Cancel
				</button>
				<button
					onclick={() => handleLargeDatasetConfirmation(true)}
					class="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
				>
					Proceed Anyway
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Header -->
<!-- Header -->
<div class="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
	<div class="flex min-w-0 items-center gap-2">
		<BarChart class="h-8 w-8 flex-shrink-0 text-blue-600 dark:text-gray-400" />
		<h1 class="text-3xl font-bold whitespace-nowrap text-gray-900 dark:text-gray-100">
			{t('common.navigation.statistics')}
		</h1>
	</div>
	<div class="flex flex-1 items-center justify-end gap-6">
		<div class="datepicker-statistics-fix relative">
			<DateRangePicker
				bind:startDate={localStartDate}
				bind:endDate={localEndDate}
				pickLabel={t('datePicker.pickDateRange')}
				showClear={false}
			/>
		</div>
	</div>
</div>

<div class="space-y-6">
	<!-- Map -->
	<div class="relative z-0 h-96 w-full rounded-lg bg-gray-100 md:h-[600px] dark:bg-gray-900">
		<div
			bind:this={mapContainer}
			class="h-full w-full rounded-lg"
			style="pointer-events: auto; touch-action: manipulation;"
		></div>

		<!-- Map Legend -->
		<div class="absolute top-24 left-4 z-10 rounded-lg bg-white p-3 shadow-lg dark:bg-gray-800">
			<h4 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
				{t('statistics.modeColors')}
			</h4>
			<div class="space-y-1">
				{#each Object.entries(transportModeColors) as [mode, color] (mode)}
					<div class="flex items-center space-x-2">
						<div class="h-3 w-3 rounded-full" style="background-color: {color}"></div>
						<span class="text-xs text-gray-600 dark:text-gray-400"
							>{translateTransportMode(mode)}</span
						>
					</div>
				{/each}
			</div>
		</div>

		<!-- Point Details Popup -->
		{#if selectedPoint}
			<div
				class="absolute top-4 right-4 z-10 w-80 max-w-sm rounded-lg bg-white p-4 shadow-lg dark:bg-gray-800"
			>
				<div class="mb-3 flex items-start justify-between">
					<h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
						{t('statistics.pointDetails')}
					</h4>
					<button
						onclick={closePointDetails}
						class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				<div class="space-y-2 text-xs">
					<div class="grid grid-cols-2 gap-2">
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.date')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{formatDateWithTimezoneSync(selectedPoint.recorded_at, selectedPoint.tz_diff)}
							</div>
						</div>
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.mode')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{translateTransportMode(selectedPoint.transport_mode || 'unknown')}
							</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.coordinates')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{selectedPoint.lat}, {selectedPoint.lon}
							</div>
						</div>
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.popupSpeed')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{selectedPoint.speed ? `${selectedPoint.speed.toFixed(1)} km/h` : 'N/A'}
							</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.popupDistance')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{selectedPoint.distance
									? `${(selectedPoint.distance / 1000).toFixed(2)} km`
									: 'N/A'}
							</div>
						</div>
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.type')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">{selectedPoint.type || 'N/A'}</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.class')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">{selectedPoint.class || 'N/A'}</div>
						</div>
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.country')}:</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{selectedPoint.country_code || 'N/A'}
							</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div>
							<span class="font-medium text-gray-600 dark:text-gray-400"
								>{t('statistics.popupReason')}</span
							>
							<div class="text-gray-800 dark:text-gray-200">
								{selectedPoint.detection_reason
									? getTransportDetectionReasonLabel(
											selectedPoint.detection_reason as TransportDetectionReason
										)
									: 'N/A'}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- No Data Message -->
		{#if !isLoading && !isInitialLoad && (!statisticsData || Object.keys(statisticsData).length === 0)}
			<div
				class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80"
			>
				<div class="text-center">
					<MapPin class="mx-auto mb-4 h-12 w-12 text-gray-400 dark:text-gray-500" />
					<h3 class="mb-2 text-lg font-semibold text-gray-700 dark:text-gray-300">
						{t('statistics.noDataMessage')}
					</h3>
					<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
						{t('statistics.noDataMessage')}
					</p>
					<a
						href="/dashboard/import-export"
						class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
					>
						<Import class="h-4 w-4" />
						Import Data
					</a>
				</div>
			</div>
		{/if}
	</div>
	<!-- Loading State -->
	{#if statisticsLoading}
		<div class="mb-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
			{#each Array(8) as _, index (`loading-${index}`)}
				<div
					class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="mb-3 flex items-center gap-2">
						<div class="h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					</div>
					<div class="space-y-3">
						{#each Array(3) as _innerItem, index2 (`loading-inner-${index}-${index2}`)}
							<div class="flex items-center gap-4">
								<div class="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
								<div class="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
								<div class="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else if !statisticsData || Object.keys(statisticsData).length === 0}
		<div class="mb-8 py-8 text-center font-semibold text-gray-500 dark:text-gray-400">
			No statistics available for this period.
		</div>
	{:else}
		<!-- Actual Statistics Content -->
		<div class="mb-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
			{#each getStatistics() as stat, index (`stat-${index}-${stat.id || 'unknown'}`)}
				{@const IconComponent = stat.icon}
				<div
					class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="flex items-center gap-2">
						<IconComponent class="h-5 w-5 text-{stat.color}-500" />
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300">{stat.title}</span>
					</div>
					<div class="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
						{stat.value}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Country Time Distribution and Modes of Transport: Side by Side -->
	{#if statisticsData && !statisticsLoading && !statisticsError}
		<div class="mb-8 flex flex-col gap-6 md:flex-row">
			{#if statisticsData.countryTimeDistribution && statisticsData.countryTimeDistribution.length > 0}
				<div class="w-full md:w-1/2">
					<div
						class="w-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
					>
						<div class="mb-3 flex items-center gap-2">
							<Globe2 class="h-5 w-5 text-blue-500" />
							<span class="text-lg font-semibold text-gray-800 dark:text-gray-100">
								{t('statistics.countryTimeDistribution')}
							</span>
						</div>
						<div class="space-y-4">
							{#each statisticsData.countryTimeDistribution as country, index (`country-${index}-${country.country_code || 'unknown'}`)}
								<div>
									<div class="mb-1 flex items-center gap-2">
										<span class="text-xl">{getFlagEmoji(country.country_code)}</span>
										<span class="text-base text-gray-700 dark:text-gray-300">
											{$getCountryNameReactive(country.country_code)}
										</span>
									</div>
									<div class="relative w-full">
										<div class="h-4 rounded bg-gray-200 dark:bg-gray-700">
											<div
												class="flex h-4 items-center justify-center rounded bg-blue-500 text-xs font-bold text-white transition-all duration-300"
												style="width: {country.percent}%; min-width: 2.5rem;"
											>
												<span>{country.percent}%</span>
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
						<div class="mt-4 text-xs text-gray-500 dark:text-gray-400">
							{t('statistics.ofSelectedPeriod')}
						</div>
					</div>
				</div>
			{/if}

			{#if statisticsData.transport && statisticsData.transport.length > 0}
				<div class="w-full md:w-1/2">
					<div
						class="w-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
					>
						<div class="mb-3 flex items-center gap-2">
							<Route class="h-5 w-5 text-blue-500" />
							<span class="text-lg font-semibold text-gray-800 dark:text-gray-100">
								{t('statistics.transportModes')}
							</span>
						</div>
						<table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
							<thead>
								<tr>
									<th
										class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
									>
										{t('statistics.mode')}
									</th>
									<th
										class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
									>
										{t('statistics.distanceKm')}
									</th>
									<th
										class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
									>
										{t('statistics.time')}
									</th>
									<th
										class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
									>
										{t('statistics.percentOfTotal')}
									</th>
									<th
										class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
									>
										{t('statistics.points')}
									</th>
								</tr>
							</thead>
							<tbody>
								{#each statisticsData.transport
									.slice()
									.filter((mode) => mode.mode !== 'stationary')
									.sort((a, b) => b.distance - a.distance) as mode, index (`transport-${index}-${mode.mode || 'unknown'}`)}
									<tr>
										<td
											class="px-4 py-2 text-sm whitespace-nowrap text-gray-900 dark:text-gray-100"
										>
											{translateTransportMode(mode.mode)}
										</td>
										<td
											class="px-4 py-2 text-sm font-bold whitespace-nowrap text-blue-700 dark:text-blue-300"
										>
											{formatDistance(mode.distance)}
										</td>
										<td
											class="px-4 py-2 text-sm whitespace-nowrap text-gray-700 dark:text-gray-300"
										>
											{formatSegmentDuration(mode.time || 0)}
										</td>
										<td
											class="px-4 py-2 text-sm whitespace-nowrap text-gray-700 dark:text-gray-300"
										>
											{mode.percentage}%
										</td>
										<td
											class="px-4 py-2 text-sm whitespace-nowrap text-gray-700 dark:text-gray-300"
										>
											{mode.points || 0}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Train Station Visits Table -->
	{#if statisticsData && !statisticsLoading && !statisticsError && statisticsData.trainStationVisits && statisticsData.trainStationVisits.length > 0}
		<div
			class="mb-8 w-full rounded-lg border border-gray-200 bg-white p-4 md:w-1/2 dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-3 flex items-center gap-2">
				<Train class="h-5 w-5 text-blue-500" />
				<span class="text-lg font-semibold text-gray-800 dark:text-gray-100">
					{t('statistics.trainStationVisits')}
				</span>
			</div>
			<table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
				<thead>
					<tr>
						<th
							class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
						>
							Station
						</th>
						<th
							class="px-4 py-2 text-left text-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
						>
							Visits
						</th>
					</tr>
				</thead>
				<tbody>
					{#each statisticsData.trainStationVisits
						.slice()
						.sort((a: { count: number }, b: { count: number }) => b.count - a.count) as station, index (`station-${index}-${station.name || 'unknown'}`)}
						<tr>
							<td class="px-4 py-2 text-sm whitespace-nowrap text-gray-900 dark:text-gray-100">
								{station.name}
							</td>
							<td
								class="px-4 py-2 text-sm font-bold whitespace-nowrap text-blue-700 dark:text-blue-300"
							>
								{station.count}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Error Display -->
	{#if statisticsError}
		<div
			class="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
		>
			<div class="flex items-center">
				<X class="mr-3 h-5 w-5 text-red-500" />
				<div>
					<h3 class="text-sm font-medium text-red-800 dark:text-red-200">
						Error loading statistics
					</h3>
					<p class="mt-1 text-sm text-red-700 dark:text-red-300">
						{statisticsError}
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Loading Overlay -->
	{#if isLoading}
		<div
			class="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-white/70 dark:bg-gray-900/70"
		>
			<Loader2 class="h-16 w-16 animate-spin text-blue-500 dark:text-blue-300" />
			<div class="mt-4 text-center">
				<div class="mb-2 text-lg font-medium text-gray-700 dark:text-gray-200">
					{loadingStage || t('statistics.loading')}
				</div>
				{#if loadingProgress > 0}
					<div class="mb-2 h-2 w-64 rounded-full bg-gray-200 dark:bg-gray-700">
						<div
							class="h-2 rounded-full bg-blue-500 transition-all duration-500 ease-out"
							style="width: {Math.round(loadingProgress)}%"
						></div>
					</div>
					<div class="text-sm text-gray-600 dark:text-gray-400">
						{t('statistics.percentComplete', { percent: Math.round(loadingProgress) })}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
