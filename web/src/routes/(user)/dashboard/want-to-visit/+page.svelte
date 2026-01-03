<script lang="ts">
	import { browser } from '$app/environment';

	import type { Map as LeafletMap } from 'leaflet';

	import { debounce } from 'lodash-es';
	import {
		Search,
		Plus,
		X,
		MapPin,
		Heart,
		Globe2,
		Trash2,
		Edit,
		Home,
		Utensils,
		Building2,
		Camera,
		TreePine,
		Coffee,
		ShoppingBag,
		Umbrella,
		BedDouble,
		Flag
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	import { reverseGeocode } from '$lib/services/external/pelias.service';

	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';

	// Use the reactive translation function
	let t = $derived($translate);
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { WantToVisitService } from '$lib/services/want-to-visit.service';
	import { fluxbase } from '$lib/fluxbase';

	import type { UserProfile } from '$lib/types/user.types';
	import type { Place } from '$lib/types/want-to-visit.types';

	// Lucide icon mapping for SVG URLs
	const lucideIcons = {
		default: 'map-pin',
		home: 'home',
		restaurant: 'utensils',
		hotel: 'bed-double',
		camera: 'camera',
		tree: 'tree-pine',
		coffee: 'coffee',
		shopping: 'shopping-bag',
		umbrella: 'umbrella-off', // Beach/umbrella icon
		building: 'building-2',
		flag: 'flag'
	};

	let map: LeafletMap;
	let L: typeof import('leaflet');
	let mapContainer: HTMLDivElement;
	let currentTileLayer = $state<any>(null);
	let searchQuery = $state(''); // Search query for location lookup and filtering
	let markerClusterGroup = $state<any>(null); // Add cluster group variable
	let showAddForm = $state(false);
	let showEditForm = $state(false);
	let tempMarker = $state<any>(null);
	let isReverseGeocoding = $state(false);
	let isLoading = $state(true);

	// Form fields
	let title = $state('');
	let latitude = $state('');
	let longitude = $state('');
	let description = $state('');
	let address = $state('');
	let placeType = $state('');
	let searchResults = $state<any[]>([]);
	let showSearchResults = $state(false);
	let isSearching = $state(false);

	// Marker customization
	let selectedMarkerType = $state('default');
	let selectedMarkerColor = $state('#22335F'); // primary rgb(34,51,95)

	// Edit mode
	let editingPlace = $state<Place | null>(null);

	// Auto-focus modal overlay when opened for keyboard events
	$effect(() => {
		if (showAddForm || showEditForm) {
			// Focus the modal overlay after a brief delay to ensure DOM is ready
			setTimeout(() => {
				const modalOverlay = document.querySelector('.modal-overlay');
				if (modalOverlay instanceof HTMLElement) {
					modalOverlay.focus();
				}
			}, 0);
		}
	});

	// Marker options - updated to use translation keys
	let markerTypes = $derived([
		{
			id: 'default',
			name: t('wantToVisit.markerTypes.default'),
			icon: MapPin,
			iconName: 'default',
			color: '#3B82F6'
		},
		{
			id: 'home',
			name: t('wantToVisit.markerTypes.home'),
			icon: Home,
			iconName: 'home',
			color: '#10B981'
		},
		{
			id: 'restaurant',
			name: t('wantToVisit.markerTypes.restaurant'),
			icon: Utensils,
			iconName: 'restaurant',
			color: '#F59E0B'
		},
		{
			id: 'hotel',
			name: t('wantToVisit.markerTypes.hotel'),
			icon: BedDouble,
			iconName: 'hotel',
			color: '#8B5CF6'
		},
		{
			id: 'camera',
			name: t('wantToVisit.markerTypes.camera'),
			icon: Camera,
			iconName: 'camera',
			color: '#EF4444'
		},
		{
			id: 'tree',
			name: t('wantToVisit.markerTypes.tree'),
			icon: TreePine,
			iconName: 'tree',
			color: '#059669'
		},
		{
			id: 'coffee',
			name: t('wantToVisit.markerTypes.coffee'),
			icon: Coffee,
			iconName: 'coffee',
			color: '#D97706'
		},
		{
			id: 'shopping',
			name: t('wantToVisit.markerTypes.shopping'),
			icon: ShoppingBag,
			iconName: 'shopping',
			color: '#EC4899'
		},
		{
			id: 'umbrella',
			name: t('wantToVisit.markerTypes.umbrella'),
			icon: Umbrella,
			iconName: 'umbrella',
			color: '#06B6D4'
		},
		{
			id: 'building',
			name: t('wantToVisit.markerTypes.building'),
			icon: Building2,
			iconName: 'building',
			color: '#6B7280'
		},
		{
			id: 'flag',
			name: t('wantToVisit.markerTypes.flag'),
			icon: Flag,
			iconName: 'flag',
			color: '#DC2626'
		}
	]);

	const markerColors = [
		'#3B82F6', // blue
		'#10B981', // emerald
		'#F59E0B', // amber
		'#EF4444', // red
		'#8B5CF6', // violet
		'#EC4899', // pink
		'#06B6D4', // cyan
		'#059669', // green
		'#D97706', // orange
		'#DC2626', // red-600
		'#6B7280', // gray
		'#000000' // black
	];

	// Database data
	let places = $state<Place[]>([]);

	// Add label state for the form
	let labelInput = $state('');
	let labels = $state<string[]>([]);

	// Search and filter state
	let selectedTypes = $state<string[]>(['All']); // Array to support multiple selections
	let showFavouritedOnly = $state(false); // Filter for favourited places only

	// User profile and loading states
	let userProfile = $state<UserProfile | null>(null);
	let hasHomeAddress = $state(false);
	let isLoadingProfile = $state(false);

	// Map markers
	let markers = $state<any[]>([]);

	// Available types based on marker types - using translation keys
	let availableTypes = $derived([
		{ id: 'All', name: t('wantToVisit.markerTypes.all'), icon: MapPin },
		{ id: 'default', name: t('wantToVisit.markerTypes.default'), icon: MapPin },
		{ id: 'home', name: t('wantToVisit.markerTypes.home'), icon: Home },
		{ id: 'restaurant', name: t('wantToVisit.markerTypes.restaurant'), icon: Utensils },
		{ id: 'hotel', name: t('wantToVisit.markerTypes.hotel'), icon: BedDouble },
		{ id: 'camera', name: t('wantToVisit.markerTypes.camera'), icon: Camera },
		{ id: 'tree', name: t('wantToVisit.markerTypes.tree'), icon: TreePine },
		{ id: 'coffee', name: t('wantToVisit.markerTypes.coffee'), icon: Coffee },
		{ id: 'shopping', name: t('wantToVisit.markerTypes.shopping'), icon: ShoppingBag },
		{ id: 'umbrella', name: t('wantToVisit.markerTypes.umbrella'), icon: Umbrella },
		{ id: 'building', name: t('wantToVisit.markerTypes.building'), icon: Building2 },
		{ id: 'flag', name: t('wantToVisit.markerTypes.flag'), icon: Flag }
	]);

	// Helper function to get translated marker type name
	function getMarkerTypeName(markerId: string): string {
		const markerType = markerTypes.find((m) => m.id === markerId);
		return markerType ? markerType.name : t('wantToVisit.markerTypes.default');
	}

	function addLabel() {
		const trimmed = labelInput.trim();
		if (trimmed && !labels.includes(trimmed)) {
			labels = [...labels, trimmed];
		}
		labelInput = '';
	}

	function removeLabel(label: string) {
		labels = labels.filter((l) => l !== label);
	}

	function resetForm() {
		title = '';
		latitude = '';
		longitude = '';
		description = '';
		address = '';
		placeType = 'default'; // Use marker ID instead of hardcoded string
		selectedMarkerType = 'default';
		selectedMarkerColor = '#3B82F6';
		labels = [];
		editingPlace = null;
		searchQuery = '';
		searchResults = [];
		showSearchResults = false;
		showFavouritedOnly = false;
	}

	async function loadUserProfile() {
		if (!browser) return;

		isLoadingProfile = true;
		try {
			const session = await fluxbase.auth.getSession();
			if (!session.data.session?.user) {
				console.error('No session found');
				return;
			}

			// Get user profile using ServiceAdapter (now uses SDK internally)
			const serviceAdapter = new ServiceAdapter({ session: session.data.session });
			const profile = (await serviceAdapter.getProfile()) as any;

			userProfile = profile as UserProfile;

			// Check if user has a home address
			hasHomeAddress = !!profile?.home_address;
		} catch (error) {
			console.error('Error loading user profile:', error);
		} finally {
			isLoadingProfile = false;
		}
	}

	function loadPlaces() {
		WantToVisitService.getPlaces()
			.then((data) => {
				places = data;
				updateMarkers();
			})
			.catch((error) => {
				console.error('Error loading places:', error);
				toast.error('Failed to load places');
			})
			.finally(() => {
				isLoading = false;
			});
	}

	function editPlace(place: Place) {
		editingPlace = place;
		title = place.title;
		const [lat, lng] = place.coordinates.split(',').map(Number);
		latitude = lat.toString();
		longitude = lng.toString();
		description = place.description || '';
		address = place.address || '';
		placeType = place.markerType || place.type || 'default'; // Use markerType if available, fallback to type or default
		selectedMarkerType = place.markerType || 'default';
		selectedMarkerColor = place.markerColor || '#3B82F6';
		labels = place.labels || [];
		showEditForm = true;
		// Reset search fields for edit mode
		searchQuery = '';
		searchResults = [];
		showSearchResults = false;
	}

	let filteredPlaces = $derived(
		places.filter((place) => {
			// Type filter - match by markerType ID
			const typeMatch =
				(selectedTypes.length === 1 && selectedTypes[0] === 'All') ||
				selectedTypes.some((selectedType) => place.markerType && place.markerType === selectedType);

			// Search filter - search in title, description, labels, and address
			const searchLower = searchQuery.toLowerCase();
			const searchMatch =
				!searchQuery ||
				place.title.toLowerCase().includes(searchLower) ||
				(place.description && place.description.toLowerCase().includes(searchLower)) ||
				(place.labels && place.labels.some((label) => label.toLowerCase().includes(searchLower))) ||
				(place.address && place.address.toLowerCase().includes(searchLower)) ||
				(place.coordinates && place.coordinates.toLowerCase().includes(searchLower));

			// Favourited filter - show only favourited places when enabled
			const favouritedMatch = !showFavouritedOnly || place.favorite;

			return typeMatch && searchMatch && favouritedMatch;
		})
	);

	// Update markers when filtered places change
	$effect(() => {
		if (places.length > 0 && filteredPlaces.length >= 0) {
			updateMarkers();
		}
	});

	// Get marker icon based on type and color
	function getMarkerIcon(markerType: string = 'default', color: string = '#3B82F6') {
		if (!L) return null;

		// Use standard Leaflet marker icons - much simpler and more reliable
		return getOSMIcon(markerType, color);
	}

	// Utility function to get Lucide SVG icon with custom color
	function getOSMIcon(markerType: string = 'default', color: string = '#3B82F6'): any {
		if (!L) return null;

		const iconName = lucideIcons[markerType as keyof typeof lucideIcons] || 'map-pin';

		// Use Lucide SVG icons from a reliable CDN
		const iconUrl = `https://unpkg.com/lucide-static@latest/icons/${iconName}.svg`;

		return L.divIcon({
			className: 'custom-lucide-marker',
			html: `<div style="
				width: 24px;
				height: 24px;
				background-color: ${color};
				mask: url('${iconUrl}');
				-webkit-mask: url('${iconUrl}');
				background-size: contain;
				background-repeat: no-repeat;
				background-position: center;
			"></div>`,
			iconSize: [24, 24],
			iconAnchor: [12, 24]
		});
	}

	onMount(async () => {
		// Load user profile to check for home address
		await loadUserProfile();

		L = (await import('leaflet')).default;
		// Import markercluster plugin
		await import('leaflet.markercluster');
		if (map) return;

		map = L.map(mapContainer, {
			center: [20, 0],
			zoom: 2,
			minZoom: 1,
			maxZoom: 18,
			zoomControl: true,
			attributionControl: false,
			doubleClickZoom: true,
			tapTolerance: 15,
			touchZoom: true,
			bounceAtZoomLimits: false,
			scrollWheelZoom: true,
			keyboard: true,
			dragging: true,
			inertia: true,
			inertiaDeceleration: 3000,
			inertiaMaxSpeed: 3000,
			worldCopyJump: false,
			maxBounds: undefined,
			maxBoundsViscosity: 0.0
		});

		// Initialize marker cluster group
		markerClusterGroup = L.markerClusterGroup({
			chunkedLoading: true,
			spiderfyOnMaxZoom: true,
			showCoverageOnHover: false,
			zoomToBoundsOnClick: true,
			disableClusteringAtZoom: 16, // Disable clustering when zoomed in close
			maxClusterRadius: 50, // Maximum radius for clustering
			iconCreateFunction: function (cluster: any) {
				const count = cluster.getChildCount();
				let className = 'marker-cluster-';

				if (count < 5) {
					className += 'small';
				} else if (count < 10) {
					className += 'medium';
				} else {
					className += 'large';
				}

				return L.divIcon({
					html: `<div><span>${count}</span></div>`,
					className: className,
					iconSize: L.point(40, 40)
				});
			}
		});

		// Add cluster group to map
		map.addLayer(markerClusterGroup);

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
		}).addTo(map);

		// Load places from database
		loadPlaces();

		// Add double-click handler to map
		map.on('dblclick', async (e: L.LeafletMouseEvent) => {
			const { lat, lng } = e.latlng;

			// Remove previous temporary marker
			if (tempMarker) {
				tempMarker.remove();
			}

			// Add new temporary marker
			tempMarker = L.marker([lat, lng], {
				icon: getMarkerIcon(selectedMarkerType, selectedMarkerColor)
			}).addTo(map);

			// Update form coordinates
			latitude = lat.toFixed(6);
			longitude = lng.toFixed(6);

			// Perform reverse geocoding
			await performReverseGeocoding(lat, lng);

			// Show the add form
			showAddForm = true;
		});

		// Listen for theme changes
		const observer = new MutationObserver(() => {
			const newUrl = getTileLayerUrl();
			const newAttribution = getAttribution();
			if (currentTileLayer && currentTileLayer._url !== newUrl) {
				map.removeLayer(currentTileLayer);
				currentTileLayer = L.tileLayer(newUrl, { attribution: newAttribution }).addTo(map);
			}
			// Also update all marker icons to match the new theme
			updateMarkers();
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	});

	async function performReverseGeocoding(lat: number, lng: number) {
		isReverseGeocoding = true;
		try {
			const result = await reverseGeocode(lat, lng);

			// Extract place name from display_name
			const displayName = result.display_name;
			const nameParts = displayName.split(',');
			const primaryName = nameParts[0].trim();

			// Determine marker type based on address components
			let markerType = 'default';
			if (result.address) {
				if (result.address.restaurant || result.address.cafe) {
					markerType = result.address.cafe ? 'coffee' : 'restaurant';
				} else if (result.address.hotel || result.address.hostel) {
					markerType = 'hotel';
				} else if (result.address.museum) {
					markerType = 'camera';
				} else if (result.address.park) {
					markerType = 'tree';
				} else if (result.address.shop || result.address.store) {
					markerType = 'shopping';
				} else if (result.address.beach) {
					markerType = 'umbrella';
				} else if (result.address.city) {
					markerType = 'building';
				} else if (result.address.country) {
					markerType = 'flag';
				}
			}

			// Set title to primary name from reverse geocoding
			title = primaryName;
			address = displayName;
			placeType = markerType; // Use marker ID for consistent storage
			selectedMarkerType = markerType;
			description = t('wantToVisit.addedFromMap', { date: new Date().toLocaleDateString() });
		} catch (error) {
			console.error('Reverse geocoding failed:', error);
			title = `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
			address = `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
			placeType = 'default'; // Use marker ID for consistent storage
			selectedMarkerType = 'default';
			description = t('wantToVisit.locationAddedFromMap');
		} finally {
			isReverseGeocoding = false;
		}
	}

	function updateMarkers() {
		// Clear existing markers from cluster group
		if (markerClusterGroup) {
			markerClusterGroup.clearLayers();
		}

		// Clear markers array
		markers = [];

		// Add markers to cluster group (only filtered places)
		markers = filteredPlaces.map((place) => {
			const [lat, lng] = place.coordinates.split(',').map(Number);

			const markerIcon = getMarkerIcon(
				place.markerType || 'default',
				place.markerColor || '#3B82F6'
			);
			const marker = L.marker([lat, lng] as [number, number], { icon: markerIcon }).bindPopup(
				createPopupContent(place)
			);

			// Add marker to cluster group instead of directly to map
			markerClusterGroup.addLayer(marker);
			return marker;
		});

		// Don't change zoom level when filters change - let user control the view
		// Only fit bounds on initial load when places are first loaded
	}

	function createPopupContent(place: Place) {
		return `
			<div class="p-2">
				<h3 class="font-semibold text-sm">${place.title}</h3>
				<p class="text-xs text-gray-500 mt-1">${place.address}</p>
				${place.description ? `<p class="text-xs text-gray-700 mt-2 italic">"${place.description}"</p>` : ''}
			</div>
		`;
	}

	const searchPlaces = debounce(async () => {
		if (!searchQuery || searchQuery.length < 3) {
			searchResults = [];
			showSearchResults = false;
			return;
		}

		isSearching = true;
		try {
			// Get Pelias endpoint from database settings
			const { getPeliasEndpoint } = await import('$lib/services/external/pelias.service');
			const peliasEndpoint = await getPeliasEndpoint();

			// Use Pelias autocomplete endpoint for faster results
			const response = await fetch(
				`${peliasEndpoint}/v1/autocomplete?text=${encodeURIComponent(searchQuery)}&size=5`,
				{
					headers: {
						'User-Agent': 'WayliApp/1.0',
						Accept: 'application/json'
					}
				}
			);
			const data = await response.json();
			searchResults = (data.features || []).map((feature: any) => ({
				name: feature.properties?.label || '',
				lat: feature.geometry?.coordinates?.[1],
				lon: feature.geometry?.coordinates?.[0],
				address: {
					city: feature.properties?.locality,
					state: feature.properties?.region,
					country: feature.properties?.country,
					country_code: feature.properties?.country_a,
					neighbourhood: feature.properties?.neighbourhood,
					road: feature.properties?.street,
					house_number: feature.properties?.housenumber
				}
			}));
			showSearchResults = true;
		} catch (error) {
			console.error('Error searching places:', error);
			searchResults = [];
			showSearchResults = false;
		} finally {
			isSearching = false;
		}
	}, 300);

	function handleSearchInput() {
		searchPlaces();
	}

	function selectPlace(result: any) {
		// Don't set the title from search - let user edit it separately
		latitude = result.lat;
		longitude = result.lon;
		address = result.name;

		// Determine marker type
		let markerType = 'default';
		if (result.address) {
			if (result.address.restaurant || result.address.cafe) {
				markerType = result.address.cafe ? 'coffee' : 'restaurant';
			} else if (result.address.hotel || result.address.hostel) {
				markerType = 'hotel';
			} else if (result.address.museum) {
				markerType = 'camera';
			} else if (result.address.park) {
				markerType = 'tree';
			} else if (result.address.shop || result.address.store) {
				markerType = 'shopping';
			} else if (result.address.beach) {
				markerType = 'umbrella';
			} else if (result.address.city) {
				markerType = 'building';
			} else if (result.address.country) {
				markerType = 'flag';
			}
		}
		placeType = markerType; // Use marker ID for consistent storage
		selectedMarkerType = markerType;

		// Set a default title based on the search result, but user can edit it
		if (!title) {
			title = result.name.split(',')[0];
		}

		description = t('wantToVisit.addedViaSearch', { date: new Date().toLocaleDateString() });
		showSearchResults = false;

		// Update map view and add marker
		if (map) {
			map.setView([result.lat, result.lon], 15);
			if (tempMarker) tempMarker.remove();
			tempMarker = L.marker([result.lat, result.lon], {
				icon: getMarkerIcon(selectedMarkerType, selectedMarkerColor)
			}).addTo(map);
		}
	}

	function selectType(typeId: string) {
		if (typeId === 'All') {
			// If "All" is clicked, clear all other selections
			selectedTypes = ['All'];
		} else {
			// Remove "All" if it's selected and add the new type
			selectedTypes = selectedTypes.filter((t) => t !== 'All');

			if (selectedTypes.includes(typeId)) {
				// Remove the type if it's already selected
				selectedTypes = selectedTypes.filter((t) => t !== typeId);
				// If no types are selected, default back to "All"
				if (selectedTypes.length === 0) {
					selectedTypes = ['All'];
				}
			} else {
				// Add the new type
				selectedTypes = [...selectedTypes, typeId];
			}
		}
	}

	function clearFilters() {
		selectedTypes = ['All'];
		searchQuery = '';
		showFavouritedOnly = false;
	}

	async function addPlace() {
		if (!title || !latitude || !longitude) {
			toast.error('Please fill in all required fields');
			return;
		}

		try {
			const newPlace = await WantToVisitService.addPlace({
				title,
				type: placeType, // This will now be the marker ID
				coordinates: `${latitude}, ${longitude}`,
				description,
				address,
				markerType: selectedMarkerType,
				markerColor: selectedMarkerColor,
				labels: [...labels],
				favorite: false
			});

			places = [newPlace, ...places];

			resetForm();

			// Remove temp marker and close form
			if (tempMarker) {
				tempMarker.remove();
				tempMarker = null;
			}
			showAddForm = false;

			// Update markers
			updateMarkers();

			toast.success('Place added to your list!');
		} catch (error) {
			console.error('Error adding place:', error);
			toast.error('Failed to add place');
		}
	}

	async function updatePlace() {
		if (!editingPlace || !title || !latitude || !longitude) {
			toast.error('Please fill in all required fields');
			return;
		}

		try {
			const updatedPlace = await WantToVisitService.updatePlace(editingPlace.id, {
				title,
				type: placeType,
				coordinates: `${latitude}, ${longitude}`,
				description,
				address,
				markerType: selectedMarkerType,
				markerColor: selectedMarkerColor,
				labels: [...labels]
			});

			places = places.map((p) => (p.id === editingPlace!.id ? updatedPlace : p));

			resetForm();
			showEditForm = false;

			// Update markers
			updateMarkers();

			toast.success('Place updated successfully!');
		} catch (error) {
			console.error('Error updating place:', error);
			toast.error('Failed to update place');
		}
	}

	async function deletePlace(placeId: string) {
		try {
			await WantToVisitService.deletePlace(placeId);
			places = places.filter((p) => p.id !== placeId);
			updateMarkers();
			toast.success('Place removed from your list');
		} catch (error) {
			console.error('Error deleting place:', error);
			toast.error('Failed to delete place');
		}
	}

	async function toggleFavorite(place: Place) {
		try {
			const toggledPlace = await WantToVisitService.toggleFavorite(place.id, !place.favorite);
			places = places.map((p) => (p.id === place.id ? toggledPlace : p));
			updateMarkers();
		} catch (error) {
			console.error('Error toggling favorite:', error);
			toast.error('Failed to update favorite status');
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
		.temp-marker {
			background: transparent !important;
			border: none !important;
		}

		.custom-marker {
			background: transparent !important;
			border: none !important;
		}

		.marker-preview {
			width: 32px;
			height: 32px;
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: 50%;
			background: white;
			border: 2px solid #e5e7eb;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		}

		.color-option {
			width: 24px;
			height: 24px;
			border-radius: 50%;
			border: 2px solid transparent;
			cursor: pointer;
			transition: all 0.2s;
		}

		.color-option:hover {
			transform: scale(1.1);
		}

		.color-option.selected {
			border-color: #000;
			transform: scale(1.2);
		}

		/* Marker Cluster Styles */
		.marker-cluster-small {
			background-color: rgba(59, 130, 246, 0.8);
			border: 2px solid rgba(59, 130, 246, 0.9);
			border-radius: 50% !important;
		}

		.marker-cluster-small div {
			background-color: rgba(59, 130, 246, 0.9);
			border-radius: 50% !important;
		}

		.marker-cluster-medium {
			background-color: rgba(245, 158, 11, 0.8);
			border: 2px solid rgba(245, 158, 11, 0.9);
			border-radius: 50% !important;
		}

		.marker-cluster-medium div {
			background-color: rgba(245, 158, 11, 0.9);
			border-radius: 50% !important;
		}

		.marker-cluster-large {
			background-color: rgba(239, 68, 68, 0.8);
			border: 2px solid rgba(239, 68, 68, 0.9);
			border-radius: 50% !important;
		}

		.marker-cluster-large div {
			background-color: rgba(239, 68, 68, 0.9);
			border-radius: 50% !important;
		}

		/* Dark mode cluster styles */
		:global(.dark) .marker-cluster-small {
			background-color: rgba(59, 130, 246, 0.9);
			border: 2px solid rgba(59, 130, 246, 1);
			border-radius: 50% !important;
		}

		:global(.dark) .marker-cluster-small div {
			background-color: rgba(59, 130, 246, 1);
			border-radius: 50% !important;
		}

		:global(.dark) .marker-cluster-medium {
			background-color: rgba(245, 158, 11, 0.9);
			border: 2px solid rgba(245, 158, 11, 1);
			border-radius: 50% !important;
		}

		:global(.dark) .marker-cluster-medium div {
			background-color: rgba(245, 158, 11, 1);
			border-radius: 50% !important;
		}

		:global(.dark) .marker-cluster-large {
			background-color: rgba(239, 68, 68, 0.9);
			border: 2px solid rgba(239, 68, 68, 1);
			border-radius: 50% !important;
		}

		:global(.dark) .marker-cluster-large div {
			background-color: rgba(239, 68, 68, 1);
			border-radius: 50% !important;
		}

		/* Cluster text styling */
		.marker-cluster-small div,
		.marker-cluster-medium div,
		.marker-cluster-large div {
			color: white;
			font-weight: bold;
			font-size: 12px;
			text-align: center;
			line-height: 36px;
			border-radius: 50% !important;
			width: 36px;
			height: 36px;
		}
	</style>
	<title>{t('common.navigation.wantToVisit')} - Wayli</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
		<div class="flex items-center gap-3">
			<Heart class="h-8 w-8 text-red-500" />
			<h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">
				{t('common.navigation.wantToVisit')}
			</h1>
		</div>
		<button
			class="bg-primary hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
			onclick={() => {
				showAddForm = true;
				// Clear form data when opening
				title = '';
				latitude = '';
				longitude = '';
				description = '';
				address = '';
				placeType = 'default';
				searchResults = [];
				showSearchResults = false;
				labels = []; // Clear labels when opening
				labelInput = ''; // Clear input when opening
			}}
		>
			<Plus class="h-4 w-4" />
			{t('wantToVisit.addNewPlace')}
		</button>
	</div>

	<!-- Map -->
	<div
		class="relative isolate z-0 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
	>
		<div bind:this={mapContainer} class="h-96 w-full md:h-[500px]"></div>

		<!-- Map Instructions -->
		{#if !showAddForm}
			<div
				class="absolute top-4 left-4 z-10 rounded-lg bg-white/90 p-3 shadow-lg backdrop-blur-sm dark:bg-gray-800/90"
			>
				<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
					<MapPin class="h-4 w-4" />
					{t('wantToVisit.clickOnMapToAdd')}
				</div>
			</div>
		{/if}
	</div>

	<!-- Simple Modal Overlay -->
	{#if showAddForm}
		<div
			class="modal-overlay fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					showAddForm = false;
					if (tempMarker) {
						tempMarker.remove();
						tempMarker = null;
					}
				}
			}}
			onclick={(e) => {
				// Close modal if clicking the backdrop
				if (e.target === e.currentTarget) {
					showAddForm = false;
					if (tempMarker) {
						tempMarker.remove();
						tempMarker = null;
					}
				}
			}}
			tabindex="-1"
		>
			<div
				class="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 dark:bg-gray-800"
				role="dialog"
				tabindex="0"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<div class="mb-4 flex items-center justify-between">
					<h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
						{t('wantToVisit.addNewPlace')}
					</h3>
					<button
						onclick={() => {
							showAddForm = false;
							if (tempMarker) {
								tempMarker.remove();
								tempMarker = null;
							}
						}}
						class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<!-- Full form with proper z-index -->
				<div class="space-y-4">
					<!-- Title Input (required) -->
					<div>
						<label
							for="titleInput"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.title')} <span class="text-red-500">*</span></label
						>
						<input
							id="titleInput"
							type="text"
							bind:value={title}
							class="focus:ring-primary w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							placeholder={t('wantToVisit.titlePlaceholder')}
							required
						/>
					</div>

					<!-- Search Input -->
					<div>
						<label
							for="searchPlace"
							class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t('wantToVisit.searchForPlace')}
						</label>
						<div class="relative">
							<div class="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2">
								<Search class="h-4 w-4 text-gray-400" />
							</div>
							<input
								type="text"
								id="searchPlace"
								bind:value={searchQuery}
								oninput={handleSearchInput}
								class="focus:ring-primary w-full rounded-lg border border-gray-300 py-2 pr-10 pl-10 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder={t('wantToVisit.searchPlaceholder')}
							/>
							{#if isSearching}
								<div class="pointer-events-none absolute top-1/2 right-3 z-10 -translate-y-1/2">
									<div
										class="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(34,51,95)] border-t-transparent"
									></div>
								</div>
							{/if}
						</div>

						<!-- Search Results -->
						{#if showSearchResults && searchResults.length > 0}
							<div
								class="relative z-[10002] mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700"
							>
								{#each searchResults as result, index (index)}
									<button
										type="button"
										class="w-full border-b border-gray-100 p-3 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-600"
										onclick={() => selectPlace(result)}
									>
										<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
											{result.name.split(',')[0]}
										</div>
										<div class="truncate text-xs text-gray-500 dark:text-gray-400">
											{result.name}
										</div>
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Coordinates Display -->
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label
								for="latitudeInput"
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>{t('wantToVisit.latitude')}</label
							>
							<input
								id="latitudeInput"
								type="text"
								bind:value={latitude}
								readonly
								class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
							/>
						</div>
						<div>
							<label
								for="longitudeInput"
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>{t('wantToVisit.longitude')}</label
							>
							<input
								id="longitudeInput"
								type="text"
								bind:value={longitude}
								readonly
								class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
							/>
						</div>
					</div>

					<!-- Address Display -->
					<div>
						<label
							for="addressDisplay"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.address')}</label
						>
						<div
							id="addressDisplay"
							class="flex min-h-[2.5rem] w-full items-center rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
						>
							{#if isReverseGeocoding}
								<div class="flex items-center gap-2 text-gray-500">
									<div
										class="h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent"
									></div>
									{t('wantToVisit.lookingUpAddress')}
								</div>
							{:else}
								{address || t('wantToVisit.clickMapOrSearch')}
							{/if}
						</div>
					</div>

					<!-- Type Selection via Icons -->
					<fieldset>
						<legend class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.type')}</legend
						>
						<div class="flex flex-wrap gap-2" role="group" aria-label="Place type selection">
							{#each markerTypes as marker (marker.id)}
								<button
									type="button"
									aria-label="Select {marker.name} type"
									onclick={() => {
										placeType = marker.id; // Store marker ID, not name
										selectedMarkerType = marker.id;
									}}
									class="flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 transition-colors {placeType ===
									marker.id
										? 'bg-primary border-[rgb(34,51,95)] text-white'
										: 'border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								>
									<marker.icon class="h-5 w-5" />
									<span class="text-xs">{marker.name}</span>
								</button>
							{/each}
						</div>
					</fieldset>

					<!-- Marker Color -->
					<fieldset>
						<legend class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.markerColor')}</legend
						>
						<div class="flex flex-wrap gap-1" role="group" aria-label="Marker color selection">
							{#each markerColors as color (color)}
								<button
									type="button"
									aria-label="Select {color} color"
									onclick={() => (selectedMarkerColor = color)}
									class="color-option {selectedMarkerColor === color ? 'selected' : ''}"
									style="background-color: {color}"
								></button>
							{/each}
						</div>
					</fieldset>

					<!-- Custom Labels -->
					<div>
						<label
							for="labelInput"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.labels')}</label
						>
						<div class="mb-2 flex flex-wrap gap-2">
							{#each labels as label (label)}
								<span
									class="bg-primary/10 text-primary dark:bg-primary/30 mr-1 mb-1 inline-flex items-center rounded-full px-2 py-1 text-xs dark:text-gray-300"
								>
									{label}
									<button
										type="button"
										aria-label="Remove {label} label"
										class="text-primary ml-1 hover:text-red-500"
										onclick={() => removeLabel(label)}
									>
										<X class="h-3 w-3" />
									</button>
								</span>
							{/each}
						</div>
						<div class="flex gap-2">
							<input
								id="labelInput"
								type="text"
								bind:value={labelInput}
								class="focus:ring-primary flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder={t('wantToVisit.addLabelPlaceholder')}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addLabel();
									}
								}}
							/>
							<button
								type="button"
								class="bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors"
								onclick={addLabel}
							>
								{t('common.actions.add')}
							</button>
						</div>
					</div>

					<!-- Description -->
					<div>
						<label
							for="descriptionInput"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.notes')}</label
						>
						<textarea
							id="descriptionInput"
							bind:value={description}
							rows="3"
							class="focus:ring-primary relative z-[10001] w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							placeholder={t('wantToVisit.notesPlaceholder')}
						></textarea>
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-3 pt-2">
						<button
							type="button"
							onclick={() => {
								showAddForm = false;
								if (tempMarker) {
									tempMarker.remove();
									tempMarker = null;
								}
							}}
							class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							{t('common.actions.cancel')}
						</button>
						<button
							type="button"
							onclick={addPlace}
							class="bg-primary hover:bg-primary/90 flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
						>
							{t('wantToVisit.addToList')}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Edit Modal Overlay -->
	{#if showEditForm}
		<div
			class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					showEditForm = false;
					resetForm();
				}
			}}
			onclick={(e) => {
				// Close modal if clicking the backdrop
				if (e.target === e.currentTarget) {
					showEditForm = false;
					resetForm();
				}
			}}
			tabindex="-1"
		>
			<div
				class="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 dark:bg-gray-800"
				role="dialog"
				tabindex="0"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<div class="mb-4 flex items-center justify-between">
					<h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
						{t('wantToVisit.editPlace')}
					</h3>
					<button
						onclick={() => {
							showEditForm = false;
							resetForm();
						}}
						class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<!-- Edit form with same fields as add form -->
				<div class="space-y-4">
					<!-- Title Input (required) -->
					<div>
						<label
							for="titleInput"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.title')} <span class="text-red-500">*</span></label
						>
						<input
							id="titleInput"
							type="text"
							bind:value={title}
							class="focus:ring-primary w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							placeholder={t('wantToVisit.titlePlaceholder')}
							required
						/>
					</div>

					<!-- Coordinates Display -->
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label
								for="latitudeInput"
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>{t('wantToVisit.latitude')}</label
							>
							<input
								id="latitudeInput"
								type="text"
								bind:value={latitude}
								readonly
								class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
							/>
						</div>
						<div>
							<label
								for="longitudeInput"
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>{t('wantToVisit.longitude')}</label
							>
							<input
								id="longitudeInput"
								type="text"
								bind:value={longitude}
								readonly
								class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
							/>
						</div>
					</div>

					<!-- Address Display -->
					<div>
						<label
							for="addressDisplay"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.address')}</label
						>
						<input
							id="addressDisplay"
							type="text"
							bind:value={address}
							class="focus:ring-primary w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							placeholder={t('wantToVisit.addressPlaceholder')}
						/>
					</div>

					<!-- Type Selection via Icons -->
					<fieldset>
						<legend class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.type')}</legend
						>
						<div class="flex flex-wrap gap-2" role="group" aria-label="Place type selection">
							{#each markerTypes as marker (marker.id)}
								<button
									type="button"
									aria-label="Select {marker.name} type"
									onclick={() => {
										placeType = marker.id; // Store marker ID, not name
										selectedMarkerType = marker.id;
									}}
									class="flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 transition-colors {placeType ===
									marker.id
										? 'bg-primary border-[rgb(34,51,95)] text-white'
										: 'border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								>
									<marker.icon class="h-5 w-5" />
									<span class="text-xs">{marker.name}</span>
								</button>
							{/each}
						</div>
					</fieldset>

					<!-- Marker Color -->
					<fieldset>
						<legend class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.markerColor')}</legend
						>
						<div class="flex flex-wrap gap-1" role="group" aria-label="Marker color selection">
							{#each markerColors as color (color)}
								<button
									type="button"
									aria-label="Select {color} color"
									onclick={() => (selectedMarkerColor = color)}
									class="color-option {selectedMarkerColor === color ? 'selected' : ''}"
									style="background-color: {color}"
								></button>
							{/each}
						</div>
					</fieldset>

					<!-- Custom Labels -->
					<div>
						<label
							for="labelInput"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.labels')}</label
						>
						<div class="mb-2 flex flex-wrap gap-2">
							{#each labels as label (label)}
								<span
									class="bg-primary/10 text-primary dark:bg-primary/30 mr-1 mb-1 inline-flex items-center rounded-full px-2 py-1 text-xs dark:text-gray-300"
								>
									{label}
									<button
										type="button"
										aria-label="Remove {label} label"
										class="text-primary ml-1 hover:text-red-500"
										onclick={() => removeLabel(label)}
									>
										<X class="h-3 w-3" />
									</button>
								</span>
							{/each}
						</div>
						<div class="flex gap-2">
							<input
								id="labelInput"
								type="text"
								bind:value={labelInput}
								class="focus:ring-primary flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
								placeholder={t('wantToVisit.addLabelPlaceholder')}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addLabel();
									}
								}}
							/>
							<button
								type="button"
								class="bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors"
								onclick={addLabel}
							>
								{t('common.actions.add')}
							</button>
						</div>
					</div>

					<!-- Description -->
					<div>
						<label
							for="descriptionInput"
							class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('wantToVisit.notes')}</label
						>
						<textarea
							id="descriptionInput"
							bind:value={description}
							rows="3"
							class="focus:ring-primary relative z-[10001] w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							placeholder={t('wantToVisit.notesPlaceholder')}
						></textarea>
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-3 pt-2">
						<button
							type="button"
							onclick={() => {
								showEditForm = false;
								resetForm();
							}}
							class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							{t('common.actions.cancel')}
						</button>
						<button
							type="button"
							onclick={updatePlace}
							class="bg-primary hover:bg-primary/90 flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
						>
							{t('wantToVisit.updatePlace')}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Filters and Search -->
	<div class="space-y-4">
		<!-- Filter Controls -->
		<div class="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
			<!-- Type Filter -->
			<div class="flex flex-col gap-2">
				<label for="type-filter" class="text-sm font-medium text-gray-700 dark:text-gray-300"
					>{t('wantToVisit.type')}</label
				>
				<div id="type-filter" class="flex flex-wrap gap-2">
					{#each availableTypes as type (type.id)}
						<button
							class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {selectedTypes.includes(
								type.id
							)
								? 'bg-primary text-white'
								: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
							onclick={() => {
								selectType(type.id);
							}}
						>
							<type.icon class="h-4 w-4" />
							{type.name}
						</button>
					{/each}
					<button
						class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {showFavouritedOnly
							? 'bg-red-600 text-white'
							: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
						onclick={() => {
							showFavouritedOnly = !showFavouritedOnly;
						}}
					>
						<Heart class="h-4 w-4 {showFavouritedOnly ? 'fill-current' : ''}" />
						{t('wantToVisit.favourited')}
					</button>
				</div>
			</div>

			<!-- Search -->
			<div class="relative w-full lg:w-64">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400"
				/>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder={t('wantToVisit.searchTitlesPlaceholder')}
					class="focus:ring-primary w-full rounded-lg border border-gray-300 py-2 pr-4 pl-10 text-sm focus:border-[rgb(34,51,95)] focus:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
				/>
			</div>
		</div>

		<!-- Results Count -->
		<div class="flex items-center justify-between">
			<div class="text-sm text-gray-500 dark:text-gray-400">
				{t('wantToVisit.showingPlacesOf', {
					filtered: filteredPlaces.length.toLocaleString(),
					total: places.length.toLocaleString()
				})}
			</div>
			{#if searchQuery || selectedTypes.length > 1 || showFavouritedOnly}
				<button
					onclick={clearFilters}
					class="flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
				>
					<X class="h-3 w-3" />
					{t('wantToVisit.clearFilters')}
				</button>
			{/if}
		</div>
	</div>

	<!-- Places List -->
	{#if isLoading}
		<div class="py-12 text-center">
			<div
				class="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-[rgb(34,51,95)]"
			></div>
			<p class="mt-4 text-gray-500 dark:text-gray-400">{t('wantToVisit.loadingPlaces')}</p>
		</div>
	{:else if filteredPlaces.length === 0}
		<div class="py-12 text-center">
			<Globe2 class="mx-auto mb-4 h-12 w-12 text-gray-400" />
			<h3 class="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
				{t('wantToVisit.noPlacesFound')}
			</h3>
			<p class="text-gray-500 dark:text-gray-400">
				{searchQuery || selectedTypes.length > 1
					? t('wantToVisit.tryAdjustingFilters')
					: t('wantToVisit.addFirstPlace')}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			{#each filteredPlaces as place (place.id)}
				<div
					class="group relative rounded-xl border border-gray-200 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800"
				>
					<!-- Favorite Button -->
					<button
						onclick={() => toggleFavorite(place)}
						class="absolute top-4 right-4 rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
					>
						<Heart class="h-5 w-5 {place.favorite ? 'fill-red-500 text-red-500' : ''}" />
					</button>

					<!-- Place Info -->
					<div class="mb-4">
						<div class="text-primary mb-1 text-base font-bold dark:text-gray-300">
							{place.title}
						</div>
						<div class="mb-2 flex items-start justify-between">
							<!-- Remove name display -->
						</div>
						<div class="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
							<MapPin class="h-4 w-4" />
							{place.address || place.coordinates}
						</div>
						<span
							class="bg-primary/10 text-primary dark:bg-primary/30 inline-block rounded-full px-2 py-1 text-xs font-medium dark:text-gray-300"
						>
							{getMarkerTypeName(place.markerType || place.type || 'default')}
						</span>
						<!-- Labels -->
						{#if place.labels && place.labels.length > 0}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each place.labels as label (label)}
									<span
										class="bg-primary/5 text-primary dark:bg-primary/40 inline-flex items-center rounded-full px-2 py-1 text-xs dark:text-gray-200"
									>
										{label}
									</span>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Description -->
					{#if place.description}
						<div class="mb-4">
							<p class="line-clamp-2 text-sm text-gray-600 dark:text-gray-300">
								{place.description}
							</p>
						</div>
					{/if}

					<!-- Coordinates -->
					<div class="mb-4 text-xs text-gray-500 dark:text-gray-400">
						{place.coordinates}
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-2">
						<button
							onclick={() => {
								const [lat, lng] = place.coordinates.split(',').map(Number);
								map.setView([lat, lng], 15);
							}}
							class="text-primary hover:bg-primary/5 dark:hover:bg-primary/20 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
						>
							<MapPin class="h-4 w-4" />
							{t('wantToVisit.showOnMap')}
						</button>
						<button
							onclick={() => editPlace(place)}
							class="hover:bg-primary/5 hover:text-primary dark:hover:bg-primary/20 rounded-lg p-2 text-gray-400 transition-colors"
						>
							<Edit class="h-4 w-4" />
						</button>
						<button
							onclick={() => deletePlace(place.id)}
							class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.modal-overlay {
		margin: 0 !important;
		height: 100vh;
		min-height: 100vh;
	}
</style>
