<script lang="ts">
	import { format, formatDistanceToNow } from 'date-fns';
	import {
		MapPin,
		Calendar,
		Route,
		Clock,
		Loader2,
		Plus,
		Search,
		Trash2,
		Edit,
		X,
		RefreshCw,
		BarChart,
		Check
	} from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	import TripGenerationModal from '$lib/components/modals/TripGenerationModal.svelte';
	import GenerateSuggestionsButton from '$lib/components/ui/generate-suggestions-button/index.svelte';
	import Modal from '$lib/components/ui/modal/index.svelte';
	import { translate, getCountryNameReactive } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { uploadTripImage } from '$lib/services/external/image-upload.service';
	import { getTripsService } from '$lib/services/service-layer-adapter';
	import { setDateRange } from '$lib/stores/app-state.svelte';
	import { sessionStore, sessionStoreReady } from '$lib/stores/auth';
	import { tripJobs, type JobStoreJob, addJobToStore, getActiveJobsMap } from '$lib/stores/job-store';
	import { fluxbase } from '$lib/fluxbase';

	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { SvelteDate } from 'svelte/reactivity';

	// Use the reactive translation function
	let t = $derived($translate);

	interface Trip {
		id: string;
		title: string;
		description?: string;
		start_date: string;
		end_date: string;
		total_distance: number;
		point_count: number;
		image_url?: string;
		labels?: string[];
		metadata?: {
			distanceTraveled?: number;
			visited_places_count?: number;
			image_attribution?: {
				source: 'pexels' | 'picsum' | 'placeholder';
				photographer?: string;
				photographerUrl?: string;
				pexelsUrl?: string;
			};
			[key: string]: unknown;
		};
		created_at: string;
		updated_at: string;
	}

	let trips = $state<Trip[]>([]);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let isInitialLoad = $state(true);
	let hasMoreTrips = $state(true);
	let currentPage = $state(1);
	const tripsPerPage = 30;
	let isApprovingTrips = $state(false); // Flag to prevent reactive reloads during approval
	let searchQuery = $state('');
	let selectedFilter = $state('all');
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let filteredTrips = $state<Trip[]>([]);
	let showTripModal = $state(false);
	let isEditing = $state(false);
	let editingTrip = $state<Trip | null>(null);
	let tripForm = $state({
		title: '',
		start_date: '',
		end_date: '',
		description: '',
		labels: [] as string[]
	});
	let newLabel = $state('');
	let formError = $state('');
	let isSubmitting = $state(false);
	let tripToDelete = $state<Trip | null>(null);
	let showDeleteConfirm = $state(false);
	let imageFile = $state<File | null>(null);
	let showSuggestedTripsModal = $state(false);
	let showTripGenerationModal = $state(false);
	let suggestedTrips = $state<any[]>([]);
	let isLoadingSuggestedTrips = $state(false);
	let isLoadingMoreSuggestedTrips = $state(false); // Separate state for "load more"
	let selectedSuggestedTrips = $state<string[]>([]);
	let suggestedTripsPagination = $state({
		limit: 10,
		offset: 0,
		total: 0,
		hasMore: true
	});
	// Custom home address state
	let customHomeAddressInput = $state('');
	let isCustomHomeAddressSearching = $state(false);
	let customHomeAddressSuggestions = $state<any[]>([]);
	let showCustomHomeAddressSuggestions = $state(false);
	let selectedCustomHomeAddress = $state<any | null>(null);
	let selectedCustomHomeAddressIndex = $state(-1);
	let customHomeAddressSearchError = $state<string | null>(null);

	let tripGenerationData = $state({
		startDate: '',
		endDate: '',
		useCustomHomeAddress: false,
		customHomeAddress: '',
		clearExistingSuggestions: false
	});
	let imagePreview = $state<string | null>(null);

	// Auto-focus modal overlay when opened for keyboard events
	$effect(() => {
		if (showTripModal || showDeleteConfirm) {
			// Focus the modal overlay after a brief delay to ensure DOM is ready
			setTimeout(() => {
				const modalOverlay = document.querySelector('.modal-overlay');
				if (modalOverlay instanceof HTMLElement) {
					modalOverlay.focus();
				}
			}, 0);
		}
	});

	// Image state
	let imageError = $state<string>('');
	let uploadedImageUrl = $state<string | null>(null);
	let isUploadingImage = $state(false);
	let isSuggestingImage = $state(false);
	let suggestedImageUrl = $state<string | null>(null);
	let tripAnalysis = $state<any>(null);
	let userPreferences = $state<any>(null);
	let serverPexelsApiKeyAvailable = $state(false);
	let imageAttribution = $state<any>(null);
	let hasAttemptedImageSuggestion = $state(false);

	// Subscribe to pre-filtered trip jobs derived store
	let activeTripJobs = $state<JobStoreJob[]>([]);

	// Subscribe to store changes
	onMount(() => {
		const unsubscribe = tripJobs.subscribe((jobs) => {
			activeTripJobs = jobs;
		});

		return unsubscribe;
	});

	$effect(() => {
		// Find the active trip generation job in the filtered trip jobs
		for (const job of activeTripJobs) {
			if (job.job_name === 'trip-generation' && (job.status === 'pending' || job.status === 'running')) {
				// Update approval progress if we have an active trip generation job
				if (job.status === 'running' && (job.progress_percent || 0) > 0) {
					approvalProgress = {
						step: 'creating-trips',
						message: `Creating trips... ${job.progress_percent || 0}% complete`,
						progress: job.progress_percent || 0,
						totalSteps: 2,
						currentStep: 2,
						imageProgress: {
							processed: 0,
							total: 0,
							currentTrip: null
						}
					};
				}
				return; // Found the active job, no need to continue
			}
		}

		// If no active trip generation job found, clear the progress
		if (approvalProgress.step === 'creating-trips') {
			approvalProgress = {
				step: 'idle',
				message: '',
				progress: 0,
				totalSteps: 0,
				currentStep: 0,
				imageProgress: {
					processed: 0,
					total: 0,
					currentTrip: null
				}
			};
		}
	});

	let filters = $derived([
		{ value: 'all', label: t('trips.allTrips') },
		{ value: 'recent', label: t('trips.recent') },
		{ value: 'long', label: t('trips.longDistance') },
		{ value: 'short', label: t('trips.shortDistance') },
		{ value: 'autogenerated', label: t('trips.autoGenerated') }
	]);

	// Get trip image or return null if no image available
	function getTripImage(trip: Trip): string | null {
		if (!trip.image_url) {
			return null;
		}

		// If it's already a full URL, return as is
		if (trip.image_url.startsWith('http')) {
			return trip.image_url;
		}

		// If it's a path, return the relative path - edge functions will handle the full URL
		if (trip.image_url.startsWith('/')) {
			return trip.image_url;
		}

		return trip.image_url;
	}

	// Handle image loading
	function handleImageLoad(tripId: string) {
		imageLoadingStates.set(tripId, false);
	}

	function handleImageError(tripId: string) {
		imageLoadingStates.set(tripId, false);
	}

	function startImageLoading(tripId: string) {
		imageLoadingStates.set(tripId, true);
	}

	function formatDistance(distance: number): string {
		if (distance < 1000) {
			return `${Math.round(distance)} m`;
		}
		return `${(distance / 1000).toFixed(1)} km`;
	}

	function formatDuration(startDate: string, endDate: string): string {
		const start = new Date(startDate);
		const end = new Date(endDate);

		// Calculate the difference in days and add 1 for inclusive counting
		// This accounts for the fact that both start and end dates are included
		const diffTime = Math.abs(end.getTime() - start.getTime());
		const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

		if (diffDays === 1) {
			return t('trips.oneDayDuration');
		}
		return `${diffDays} days`;
	}

	function getRelativeTime(date: string): string {
		return formatDistanceToNow(new Date(date), { addSuffix: true });
	}

	function showTripStatistics(trip: Trip) {
		// Set the date range to match the trip's start and end dates
		const startDate = new Date(trip.start_date);
		const endDate = new Date(trip.end_date);

		// Set the date range in the global state
		setDateRange(startDate, endDate);

		// Navigate to the statistics page
		goto('/dashboard/statistics');
	}

	function filterTrips() {
		let filtered = trips;

		// Apply category filter (search is now handled server-side)
		switch (selectedFilter) {
			case 'recent':
				filtered = filtered.filter((trip) => {
					const tripDate = new SvelteDate(trip.start_date);
					const thirtyDaysAgo = new SvelteDate();
					thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
					return tripDate >= thirtyDaysAgo;
				});
				break;
			case 'long':
				filtered = filtered.filter((trip) => trip.total_distance > 10000); // > 10km
				break;
			case 'short':
				filtered = filtered.filter((trip) => trip.total_distance <= 10000); // ≤ 10km
				break;
			case 'autogenerated':
				filtered = filtered.filter((trip) => trip.labels?.includes('auto-generated'));
				break;
		}

		filteredTrips = filtered;
	}

	async function loadTrips(userId?: string, loadMore = false) {
		if (isLoading && !loadMore) {
			return;
		}

		if (loadMore && (isLoadingMore || !hasMoreTrips)) {
			return;
		}

		if (loadMore) {
			isLoadingMore = true;
		} else {
			isLoading = true;
		}

		try {
			const session = await fluxbase.auth.getSession();
			if (!session.data.session) {
				throw new Error('No session found');
			}

			const serviceAdapter = new ServiceAdapter({ session: session.data.session });
			const offset = loadMore ? (currentPage - 1) * tripsPerPage : 0;

			const tripsData = await serviceAdapter.getTrips({
				limit: tripsPerPage,
				offset: offset,
				search: searchQuery || undefined
			});

			// Handle both array and paginated response formats
			let newTrips: Trip[] = [];
			if (Array.isArray(tripsData)) {
				newTrips = tripsData;

				hasMoreTrips = newTrips.length === tripsPerPage;
			} else if ((tripsData as any).trips) {
				newTrips = (tripsData as any).trips;

				hasMoreTrips = newTrips.length === tripsPerPage;
			} else {
				newTrips = [];

				hasMoreTrips = false;
			}

			// Sort trips by end_date descending
			newTrips = newTrips.sort(
				(a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime()
			);

			if (loadMore) {
				// Append new trips to existing ones
				trips = [...trips, ...newTrips];
				currentPage++;
			} else {
				// Replace trips for initial load
				trips = newTrips;
				currentPage = 1;
			}

			filterTrips();
		} catch {
			// Only show error if trips is empty after the error
			if (!trips || trips.length === 0) {
				toast.error(t('trips.failedToLoadTrips'));
			}
		} finally {
			if (loadMore) {
				isLoadingMore = false;
			} else {
				isLoading = false;
				isInitialLoad = false;
			}
		}
	}

	async function loadMoreTrips() {
		if (hasMoreTrips && !isLoadingMore) {
			await loadTrips($sessionStore?.user?.id, true);
		}
	}

	// Handle infinite scroll
	function handleScroll() {
		if (!hasMoreTrips || isLoadingMore) return;

		const scrollTop = window.scrollY;
		const scrollHeight = document.documentElement.scrollHeight;
		const clientHeight = window.innerHeight;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

		// Load more when user scrolls to within 300px of the bottom
		if (distanceFromBottom < 300) {
			loadMoreTrips();
		}
	}

	// Handle search with debouncing
	function handleSearchChange() {
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}

		searchTimeout = setTimeout(() => {
			// Reset pagination and reload trips for new search
			currentPage = 1;
			hasMoreTrips = true;
			trips = [];
			loadTrips($sessionStore?.user?.id);
		}, 500); // 500ms debounce
	}

	async function loadUserPreferences() {
		try {
			const session = await fluxbase.auth.getSession();
			if (!session.data.session) {
				throw new Error('No session found');
			}

			const serviceAdapter = new ServiceAdapter({ session: session.data.session });
			const preferencesData = await serviceAdapter.getPreferences();

			userPreferences = preferencesData;
			serverPexelsApiKeyAvailable =
				(preferencesData as any)?.server_pexels_api_key_available || false;
		} catch {
			// Error loading preferences - will use defaults
			userPreferences = null;
			serverPexelsApiKeyAvailable = false;
		}
	}

	$effect(() => {
		if (selectedFilter) {
			filterTrips();
			// Reset pagination when filters change
			if (!isInitialLoad) {
				hasMoreTrips = true;
				currentPage = 1;
			}
		}
	});

	// Reset the image suggestion attempt flag when dates change
	$effect(() => {
		// Track changes to dates - reset flag when dates change
		if (tripForm.start_date || tripForm.end_date) {
			hasAttemptedImageSuggestion = false;
		}
	});

	// Auto-suggest image when both dates are selected and no image is uploaded yet
	$effect(() => {
		if (
			tripForm.start_date &&
			tripForm.end_date &&
			!uploadedImageUrl &&
			!imageFile &&
			!isEditing &&
			showTripModal &&
			!isSuggestingImage &&
			!hasAttemptedImageSuggestion
		) {
			// Add a small delay to avoid too many requests
			const timeoutId = setTimeout(() => {
				suggestTripImage();
			}, 1000);

			// Cleanup timeout if effect re-runs or component unmounts
			return () => clearTimeout(timeoutId);
		}
	});

	// Only load trips on initial mount, not on every session store change
	$effect(() => {
		if (
			browser &&
			$sessionStoreReady &&
			$sessionStore &&
			$sessionStore.user?.id &&
			isInitialLoad &&
			!isApprovingTrips
		) {
			loadTrips($sessionStore.user.id);
		}
	});

	// Add scroll event listener for infinite scroll
	onMount(() => {
		if (browser) {
			// Throttle scroll events to improve performance
			let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
			const throttledHandleScroll = () => {
				if (scrollTimeout) return;
				scrollTimeout = setTimeout(() => {
					handleScroll();
					scrollTimeout = null;
				}, 100); // Throttle to 100ms
			};

			window.addEventListener('scroll', throttledHandleScroll);

			return () => {
				window.removeEventListener('scroll', throttledHandleScroll);
				if (scrollTimeout) clearTimeout(scrollTimeout);
			};
		}
	});

	async function openSuggestedTripsModal() {
		showSuggestedTripsModal = true;
		isLoadingSuggestedTrips = true;
		selectedSuggestedTrips = [];
		suggestedTripsPagination = {
			limit: 10,
			offset: 0,
			total: 0,
			hasMore: true
		};

		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.getSuggestedTrips({
				limit: suggestedTripsPagination.limit,
				offset: suggestedTripsPagination.offset
			})) as any;

			// The API returns { trips: [...], total: number, limit: number, offset: number }
			if (result && result.trips && Array.isArray(result.trips)) {
				// Force reactivity by creating a new array
				suggestedTrips = [];
				suggestedTrips = result.trips;
				suggestedTripsPagination.total = result.total || 0;
				suggestedTripsPagination.hasMore =
					suggestedTripsPagination.offset + suggestedTripsPagination.limit <
					suggestedTripsPagination.total;
			} else {
				suggestedTrips = [];
			}
		} catch {
			// Error loading suggested trips - will show empty state
			toast.error(t('trips.failedToLoadSuggestedTrips'));
		} finally {
			isLoadingSuggestedTrips = false;
		}
	}

	async function loadMoreSuggestedTrips() {
		if (!suggestedTripsPagination.hasMore || isLoadingMoreSuggestedTrips) return;

		isLoadingMoreSuggestedTrips = true;
		suggestedTripsPagination.offset += suggestedTripsPagination.limit;

		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.getSuggestedTrips({
				limit: suggestedTripsPagination.limit,
				offset: suggestedTripsPagination.offset
			})) as any;

			if (result && result.trips && Array.isArray(result.trips)) {
				// Add new trips to existing ones (backend already sorts them)
				suggestedTrips = [...suggestedTrips, ...result.trips];
				suggestedTripsPagination.total = result.total || 0;
				suggestedTripsPagination.hasMore =
					suggestedTripsPagination.offset + suggestedTripsPagination.limit <
					suggestedTripsPagination.total;
			}
		} catch {
			// Error loading more suggested trips
			toast.error(t('trips.failedToLoadMoreSuggestedTrips'));
		} finally {
			isLoadingMoreSuggestedTrips = false;
		}
	}

	function openTripGenerationModal() {
		// Close the current modal first
		showSuggestedTripsModal = false;

		// Then open the trip generation modal
		showTripGenerationModal = true;
		tripGenerationData = {
			startDate: '',
			endDate: '',
			useCustomHomeAddress: false,
			customHomeAddress: '',
			clearExistingSuggestions: false
		};
		// Reset custom home address input state
		customHomeAddressInput = '';
		customHomeAddressSuggestions = [];
		showCustomHomeAddressSuggestions = false;
		selectedCustomHomeAddress = null;
		selectedCustomHomeAddressIndex = -1;
		customHomeAddressSearchError = null;
	}

	async function generateNewTripSuggestions() {
		try {
			console.log('🔍 [TRIPS] Starting trip generation with data:', tripGenerationData);

			// Clear existing suggestions if checkbox is checked
			if (tripGenerationData.clearExistingSuggestions) {
				const session = $sessionStore;
				if (!session) throw new Error('No session found');

				const serviceAdapter = new ServiceAdapter({ session });
				await serviceAdapter.clearAllSuggestedTrips();
			}

			const jobData: Record<string, unknown> = {
				useCustomHomeAddress: tripGenerationData.useCustomHomeAddress,
				clearExistingSuggestions: tripGenerationData.clearExistingSuggestions
			};

			// Include dates if they are provided (individually)
			if (tripGenerationData.startDate) {
				jobData.startDate = tripGenerationData.startDate;
			}
			if (tripGenerationData.endDate) {
				jobData.endDate = tripGenerationData.endDate;
			}

			if (tripGenerationData.useCustomHomeAddress && tripGenerationData.customHomeAddress) {
				jobData.customHomeAddress = tripGenerationData.customHomeAddress;
			}

			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });
			console.log('🔍 [TRIPS] About to create job with data:', jobData);

			const result = (await serviceAdapter.createJob({
				type: 'trip_generation',
				data: jobData
			})) as any;

			// Note: Job will be picked up by SSE stream automatically
			if (result?.id) {
				console.log('✅ [TRIPS] Trip generation job created:', result.id);
				console.log('🔍 [TRIPS] Job result:', result);

				// Immediately add the job to the store so it appears in the sidebar
				// Use the actual job data from the result if available, otherwise use defaults
				const jobUpdate: JobStoreJob = {
					id: result.id,
					job_name: 'trip-generation',
					status: (result.status as JobStoreJob['status']) || 'pending',
					progress_percent: result.progress || 0,
					created_at: result.created_at || new Date().toISOString(),
					updated_at: result.updated_at || new Date().toISOString(),
					result: result.result || undefined,
					error: result.error || undefined,
					created_by: '' // Will be filled by the store
				};
				addJobToStore(jobUpdate);
				console.log('🔍 [TRIPS] Immediately added job to store:', jobUpdate);

				// Check if the job is immediately available in the store
				const currentJobs = getActiveJobsMap();
				console.log('🔍 [TRIPS] Current jobs in store:', currentJobs.size);
				console.log('🔍 [TRIPS] Looking for job:', result.id);

				// Wait a moment and check again
				setTimeout(() => {
					const jobsAfterDelay = getActiveJobsMap();
					console.log('🔍 [TRIPS] Jobs in store after delay:', jobsAfterDelay.size);
					const foundJob = jobsAfterDelay.get(result.id);
					console.log('🔍 [TRIPS] Found job after delay:', foundJob);
				}, 1000);
			}

			let message = 'Trip generation job started!';

			if (tripGenerationData.startDate && tripGenerationData.endDate) {
				message = t('trips.tripGenerationStartedForDateRange', {
					startDate: tripGenerationData.startDate,
					endDate: tripGenerationData.endDate
				});
			} else if (tripGenerationData.startDate) {
				message = t('trips.tripGenerationStartedFromDate', {
					startDate: tripGenerationData.startDate
				});
			} else if (tripGenerationData.endDate) {
				message = t('trips.tripGenerationStartedUntilDate', {
					endDate: tripGenerationData.endDate
				});
			} else {
				message = t('trips.tripGenerationStartedAutomatic');
			}

			if (tripGenerationData.clearExistingSuggestions) {
				message += ' ' + t('trips.existingSuggestionsCleared');
			}

			toast.success(message);

			// Close modals when starting a new job
			showTripGenerationModal = false;
			showSuggestedTripsModal = false;

			// The SSE stream will automatically pick up the new job within 1 second
		} catch {
			// Error generating trip suggestions
			toast.error(t('trips.failedToGenerateNewTripSuggestions'));
		}
	}

	function openAddTripModal() {
		showTripModal = true;
		isEditing = false;
		editingTrip = null;
		tripForm = { title: '', start_date: '', end_date: '', description: '', labels: [] };
		imageFile = null;
		imagePreview = null;
		imageError = '';
		uploadedImageUrl = null;
		isUploadingImage = false;
		isSuggestingImage = false;
		suggestedImageUrl = null;
		tripAnalysis = null;
		hasAttemptedImageSuggestion = false;
		formError = '';
	}

	function openEditTripModal(trip: Trip) {
		showTripModal = true;
		isEditing = true;
		editingTrip = trip;
		tripForm = {
			title: trip.title,
			start_date: trip.start_date,
			end_date: trip.end_date,
			description: trip.description || '',
			labels: trip.labels || []
		};
		// Show existing image if available
		imageFile = null;
		imagePreview = null;
		imageError = '';
		uploadedImageUrl = null;
		isUploadingImage = false;
		isSuggestingImage = false;
		suggestedImageUrl = null;
		tripAnalysis = null;
		imageAttribution = null;
		if (trip.image_url) {
			imagePreview = trip.image_url;
			uploadedImageUrl = trip.image_url;
			// Load existing attribution if available
			if (trip.metadata?.image_attribution) {
				imageAttribution = trip.metadata.image_attribution;
				// If there's attribution, treat it as a suggested image
				if (imageAttribution.source === 'pexels') {
					suggestedImageUrl = trip.image_url;
				}
			}
		} else {
			imagePreview = null;
			uploadedImageUrl = null;
		}
		imageFile = null;
		imageError = '';
		isUploadingImage = false;
		formError = '';
	}

	function closeTripModal() {
		showTripModal = false;
		isEditing = false;
		editingTrip = null;
		tripForm = { title: '', start_date: '', end_date: '', description: '', labels: [] };
		imageFile = null;
		imagePreview = null;
		imageError = '';
		uploadedImageUrl = null;
		isUploadingImage = false;
		isSuggestingImage = false;
		suggestedImageUrl = null;
		tripAnalysis = null;
		imageAttribution = null;
		hasAttemptedImageSuggestion = false;
		formError = '';
	}

	async function submitTrip(event: Event) {
		event.preventDefault();
		if (isSubmitting) return;

		formError = '';

		if (!tripForm.title.trim()) {
			formError = t('trips.titleRequired');
			return;
		}
		if (!tripForm.start_date || !tripForm.end_date) {
			formError = t('trips.startAndEndDatesRequired');
			return;
		}
		if (new Date(tripForm.end_date) < new Date(tripForm.start_date)) {
			formError = t('trips.endDateMustBeAfterStartDate');
			return;
		}

		isSubmitting = true;

		try {
			let imageUrl =
				uploadedImageUrl ||
				(isEditing && editingTrip?.image_url ? editingTrip.image_url : undefined);

			// If we have a suggested Pexels image, use it directly (no need to upload to storage)
			if (suggestedImageUrl && suggestedImageUrl.startsWith('http') && !uploadedImageUrl) {
				imageUrl = suggestedImageUrl;
			}

			// Prepare metadata with attribution if available
			const metadata: {
				image_attribution?: {
					source: 'pexels' | 'picsum' | 'placeholder';
					photographer?: string;
					photographerUrl?: string;
					pexelsUrl?: string;
				};
			} = {};

			// Preserve existing metadata if editing
			if (isEditing && editingTrip?.metadata) {
				Object.assign(metadata, editingTrip.metadata);
			}

			// Add or update attribution if available
			if (imageAttribution && imageAttribution.source === 'pexels') {
				metadata.image_attribution = imageAttribution;
			}

			const tripsService = await getTripsService();
			const tripData = {
				title: tripForm.title.trim(),
				description: tripForm.description?.trim() || '',
				start_date: tripForm.start_date,
				end_date: tripForm.end_date,
				labels: tripForm.labels,
				image_url: imageUrl,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined
			};

			if (isEditing && editingTrip) {
				await tripsService.updateTrip({
					id: editingTrip.id,
					...tripData
				});
			} else {
				// Include user_id for new trip creation
				await tripsService.createTrip({
					...tripData
				});
			}

			// Store the editing state before closing the modal
			const wasEditing = isEditing;
			closeTripModal();
			toast.success(
				wasEditing ? t('trips.tripUpdatedSuccessfully') : t('trips.tripCreatedSuccessfully')
			);

			// Reload trips to show the changes
			await loadTrips();
		} catch (error) {
			// Error submitting trip
			if (error instanceof Error && error.name === 'AbortError') {
				formError = 'Request timed out. Please try again.';
			} else {
				formError =
					error instanceof Error
						? error.message
						: `Failed to ${isEditing ? 'update' : 'create'} trip`;
			}
		} finally {
			isSubmitting = false;
		}
	}

	function addLabel() {
		if (newLabel.trim() && !tripForm.labels.includes(newLabel.trim())) {
			tripForm.labels = [...tripForm.labels, newLabel.trim()];
			newLabel = '';
		}
	}

	function removeLabel(label: string) {
		tripForm.labels = tripForm.labels.filter((l) => l !== label);
	}

	function confirmDeleteTrip(trip: Trip) {
		tripToDelete = trip;
		showDeleteConfirm = true;
	}
	function cancelDeleteTrip() {
		tripToDelete = null;
		showDeleteConfirm = false;
	}
	async function deleteTrip() {
		if (tripToDelete) {
			try {
				const tripsService = await getTripsService();
				await tripsService.deleteTrip(tripToDelete.id);
				trips = trips.filter((t) => t.id !== tripToDelete?.id);
				filterTrips();
				toast.success(t('trips.tripDeletedSuccessfully'));
			} catch {
				// Error deleting trip
				toast.error(t('trips.failedToDeleteTrip'));
			}
		}
		tripToDelete = null;
		showDeleteConfirm = false;
	}

	async function suggestTripImage() {
		if (!tripForm.start_date || !tripForm.end_date || !$sessionStore?.user?.id) {
			return;
		}

		isSuggestingImage = true;
		imageError = '';
		suggestedImageUrl = null; // Clear previous suggestions
		imagePreview = null; // Clear previous preview

		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });
			const suggestResult = (await serviceAdapter.suggestTripImages({
				start_date: tripForm.start_date,
				end_date: tripForm.end_date
			})) as any;

			if (suggestResult.suggestedImageUrl) {
				suggestedImageUrl = suggestResult.suggestedImageUrl;
				imageAttribution = suggestResult.attribution;
				tripAnalysis = suggestResult.analysis;
				imagePreview = suggestResult.suggestedImageUrl;
				uploadedImageUrl = suggestResult.suggestedImageUrl;
				imageError = ''; // Clear any previous errors

				toast.success(t('trips.tripImageSuggestedSuccessfully'));
			} else {
				imageError = t('trips.noImageSuggestionAvailable');
			}
		} catch (error) {
			// Check if this is the "No travel data" error
			const errorMessage = error instanceof Error ? error.message : String(error);

			if (errorMessage.includes('No travel data found')) {
				// Specific error for no travel data - user-friendly message
				imageError = t('trips.noTravelDataForDateRange');
			} else {
				// Generic error
				imageError = t('trips.failedToSuggestImage');
			}
		} finally {
			isSuggestingImage = false;
			hasAttemptedImageSuggestion = true; // Mark that we've attempted for this date range
		}
	}

	async function handleImageChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		imageError = '';
		imageFile = null;
		imagePreview = null;
		uploadedImageUrl = null;
		isUploadingImage = false;
		suggestedImageUrl = null;
		tripAnalysis = null;
		imageAttribution = null;

		if (file) {
			// Validate file
			if (!file.type.startsWith('image/')) {
				imageError = 'Only image files are allowed.';
				return;
			}
			if (file.size > 5 * 1024 * 1024) {
				imageError = 'Image must be less than 5MB.';
				return;
			}

			// Show preview immediately
			imageFile = file;
			const reader = new FileReader();
			reader.onload = (e) => {
				imagePreview = e.target?.result as string;
			};
			reader.readAsDataURL(file);

			// Upload image immediately
			isUploadingImage = true;

			try {
				const uploadedUrl = await uploadTripImage(file);
				if (uploadedUrl) {
					uploadedImageUrl = uploadedUrl;

					toast.success(t('trips.imageUploadedSuccessfully'));
				} else {
					imageError = t('trips.failedToUploadImageTryAgain');
					console.error('❌ [UPLOAD] Image upload returned null');
				}
			} catch (error) {
				console.error('❌ [UPLOAD] Image upload failed:', error);
				imageError = 'Failed to upload image. Please try again.';
				toast.error(t('trips.failedToUploadImage'));
			} finally {
				isUploadingImage = false;
			}
		}
	}

	// Add refreshTripMetadata function
	async function refreshTripMetadata(trip: Trip) {
		try {
			const tripsService = await getTripsService();
			await tripsService.updateTripMetadata(trip.id);
			toast.success(t('trips.tripMetadataRefreshed'));
			await loadTrips();
		} catch (error) {
			console.error('Error refreshing trip metadata:', error);
			toast.error(t('trips.failedToRefreshTripMetadata'));
		}
	}

	// State for tracking image generation progress
	// Image loading state
	let imageLoadingStates = $state(new Map<string, boolean>());

	// Approval progress state
	let isApprovalInProgress = $state(false);
	let approvalProgress = $state({
		step: 'idle' as 'idle' | 'generating-images' | 'creating-trips' | 'complete',
		message: '',
		progress: 0,
		totalSteps: 0,
		currentStep: 0,
		// Image generation progress
		imageProgress: {
			processed: 0,
			total: 0,
			currentTrip: '' as string | null
		}
	});

	async function handleApproveTrips() {
		if (selectedSuggestedTrips.length === 0) {
			return;
		}

		try {
			// Initialize progress
			isApprovalInProgress = true;
			approvalProgress = {
				step: 'generating-images',
				message: 'Generating images for suggested trips...',
				progress: 0,
				totalSteps: 2,
				currentStep: 1,
				imageProgress: {
					processed: 0,
					total: selectedSuggestedTrips.length,
					currentTrip: ''
				}
			};

			// Set flag to prevent reactive reloads
			isApprovingTrips = true;

			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });

			// Step 1: Generate images for suggested trips (one by one for granular progress)

			approvalProgress.message = 'Generating images for suggested trips...';
			approvalProgress.progress = 0; // Start at 0%

			const imageResults: any[] = [];
			let successfulImageCount = 0;

			// Process each trip individually for granular progress updates
			for (let i = 0; i < selectedSuggestedTrips.length; i++) {
				const tripId = selectedSuggestedTrips[i];

				// Update progress message to show current trip being processed
				approvalProgress.message = `Generating image for trip ${i + 1}/${selectedSuggestedTrips.length}...`;
				approvalProgress.imageProgress.currentTrip = `Trip ${i + 1}`;

				try {
					// Call the API for a single trip
					const singleImageResult = (await serviceAdapter.generateSuggestedTripImages([
						tripId
					])) as any;

					if (singleImageResult?.results?.[0]?.success) {
						successfulImageCount++;
						imageResults.push(singleImageResult.results[0]);

						// Update progress based on successful image generation (90% of total work)
						const imageProgressPercent =
							(successfulImageCount / selectedSuggestedTrips.length) * 90;
						approvalProgress.progress = Math.round(imageProgressPercent);
						approvalProgress.imageProgress.processed = successfulImageCount;

						// Update message with current progress
						approvalProgress.message = `Generated image for trip ${i + 1}/${selectedSuggestedTrips.length} (${successfulImageCount} successful)`;

						// Show which trip was just processed
						if (singleImageResult.results[0].trip_title) {
							approvalProgress.imageProgress.currentTrip = singleImageResult.results[0].trip_title;
							approvalProgress.message = `Generated image for "${singleImageResult.results[0].trip_title}" (${successfulImageCount}/${selectedSuggestedTrips.length} trips)`;
						}
					} else {
						// Check if the result contains a specific error message
						const resultError = singleImageResult?.results?.[0]?.error || 'Failed to generate image';
						const isNoTravelDataError = resultError.includes('No travel data found');

						imageResults.push(
							singleImageResult?.results?.[0] || {
								suggested_trip_id: tripId,
								success: false,
								error: isNoTravelDataError ? 'No travel data found for this date range' : resultError
							}
						);
					}
				} catch (error) {
					console.error(`❌ Error generating image for trip ${tripId}:`, error);

					// Check if this is the "No travel data" error
					const errorMessage = error instanceof Error ? error.message : String(error);
					const specificError = errorMessage.includes('No travel data found')
						? 'No travel data found for this date range'
						: 'Failed to generate image';

					imageResults.push({
						suggested_trip_id: tripId,
						success: false,
						error: specificError
					});
				}
			}

			const imageResult = { results: imageResults };

			// Progress is now updated in the loop above

			// Step 2: Approve trips with generated images

			approvalProgress.step = 'creating-trips';
			approvalProgress.message = 'Creating trips with generated images...';
			approvalProgress.currentStep = 2;

			// Prepare pre-generated images data
			const preGeneratedImages: Record<string, { image_url: string; attribution?: any }> = {};
			if (imageResult?.results) {
				imageResult.results.forEach((result: any) => {
					if (result.success && result.image_url) {
						preGeneratedImages[result.suggested_trip_id] = {
							image_url: result.image_url,
							attribution: result.attribution
						};
					}
				});
			}

			const approveResult = (await serviceAdapter.approveSuggestedTrips(
				selectedSuggestedTrips,
				preGeneratedImages
			)) as any;

			// Calculate final progress based on successful approvals
			const approvalResults = approveResult.results || [];
			const successfulApprovals = approvalResults.filter((result: any) => result.success);
			const approvedCount = successfulApprovals.length;

			// Progress calculation: 90% for image generation + 10% for approval
			// Each approved trip adds its proportional share to the final 10%
			const approvalProgressPercent = 90 + (approvedCount / selectedSuggestedTrips.length) * 10;
			approvalProgress.progress = Math.round(approvalProgressPercent);

			// Update message to show approval progress
			approvalProgress.message = `Approved ${approvedCount}/${selectedSuggestedTrips.length} trips with images`;

			// Complete the process
			approvalProgress.step = 'complete';
			approvalProgress.message = `Approval completed successfully! ${approvedCount}/${selectedSuggestedTrips.length} trips approved with images.`;
			approvalProgress.progress = 100;

			// Close modal and clear the list
			showSuggestedTripsModal = false;
			suggestedTrips = [];

			// Get the created trip IDs from the approve result

			const createdTripIds = successfulApprovals
				.filter((result: any) => result.tripId)
				.map((result: any) => result.tripId);

			if (createdTripIds.length > 0) {
				// Reload trips to show the newly created trips
				await loadTrips();

				// Verify image attachment by checking the loaded trips
				const approvedTrips = trips.filter((trip) => createdTripIds.includes(trip.id));
				const tripsWithImages = approvedTrips.filter((trip) => trip.image_url);

				// Show success message
				toast.success(
					t('trips.tripsApprovedWithImages', {
						withImages: tripsWithImages.length,
						total: approvedTrips.length
					})
				);
			} else {
				toast.success(t('trips.tripsApprovedSuccessfully'));
			}
		} catch (error) {
			console.error('❌ Error approving trips:', error);
			approvalProgress.message = 'Error occurred during approval process';
			toast.error(t('trips.failedToApproveTrips'));
		} finally {
			// Reset flags to allow reactive reloads again
			isApprovingTrips = false;
			isApprovalInProgress = false;
		}
	}

	async function handleRejectTrips() {
		if (selectedSuggestedTrips.length === 0) return;

		try {
			const session = $sessionStore;
			if (!session) throw new Error('No session found');

			const serviceAdapter = new ServiceAdapter({ session });
			await serviceAdapter.rejectSuggestedTrips(selectedSuggestedTrips);

			// Close modal and clear the list
			showSuggestedTripsModal = false;
			suggestedTrips = [];

			// Reload trips to ensure UI is updated
			await loadTrips();

			toast.success(t('trips.tripsRejectedSuccessfully'));
		} catch (error) {
			console.error('Error rejecting trips:', error);
			toast.error(t('trips.failedToRejectTrips'));
		}
	}

	// Custom home address geocoding functions

	function handleCustomHomeAddressToggle() {
		if (!tripGenerationData.useCustomHomeAddress) {
			// Reset custom home address when unchecking
			customHomeAddressInput = '';
			tripGenerationData.customHomeAddress = '';
			customHomeAddressSuggestions = [];
			showCustomHomeAddressSuggestions = false;
			selectedCustomHomeAddress = null;
			selectedCustomHomeAddressIndex = -1;
			customHomeAddressSearchError = null;
		}
	}

	onMount(async () => {
		if (browser) {
			await loadUserPreferences();
		}
	});

	// Image polling is no longer needed since image generation is synchronous

	onDestroy(() => {
		// Cleanup handled by global job tracking
	});

	function getImageUrl(trip: Trip): string {
		if (!trip.image_url) {
			return '';
		}

		// If it's already a full URL, return as is
		if (trip.image_url.startsWith('http')) {
			return trip.image_url;
		}

		// If it's a path, return the relative path - edge functions will handle the full URL
		if (trip.image_url.startsWith('/')) {
			return trip.image_url;
		}

		return trip.image_url;
	}
</script>

<svelte:head>
	<title>{t('common.navigation.trips')} - Wayli</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div class="flex items-center gap-3">
			<Route class="h-8 w-8 text-blue-600 dark:text-gray-400" />
			<h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">{t('common.navigation.trips')}</h1>
		</div>
		<div class="flex gap-2">
			<button
				class="flex cursor-pointer items-center gap-2 rounded-lg bg-green-500 px-4 py-2 font-medium text-white transition-colors hover:bg-green-600"
				onclick={openSuggestedTripsModal}
			>
				<BarChart class="h-4 w-4" />
				{t('trips.reviewSuggestedTrips')}
			</button>
			<button
				class="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-600"
				onclick={openAddTripModal}
			>
				<Plus class="h-4 w-4" />
				{t('trips.newTrip')}
			</button>
		</div>
	</div>

	<!-- Search and Filters -->
	<div class="flex flex-col gap-4 md:flex-row">
		<div class="relative flex-1">
			<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
			<input
				type="text"
				placeholder={t('trips.searchTrips')}
				bind:value={searchQuery}
				oninput={handleSearchChange}
				class="w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-10 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			/>
		</div>
		<div class="flex gap-2">
			{#each filters as filter (filter.value)}
				<button
					onclick={() => {
						selectedFilter = filter.value;
						// Reset pagination when filter changes
						currentPage = 1;
						hasMoreTrips = true;
						trips = [];
						loadTrips($sessionStore?.user?.id);
					}}
					class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {selectedFilter ===
					filter.value
						? 'bg-blue-500 text-white'
						: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
				>
					{filter.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Trip Modal -->
	{#if showTripModal}
		<div
			class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					closeTripModal();
				}
			}}
			tabindex="-1"
		>
			<div
				class="relative max-h-[90vh] w-full max-w-lg cursor-default overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
				role="document"
			>
				<div class="p-8">
					<button
						class="absolute top-4 right-4 cursor-pointer text-gray-400 transition-colors hover:text-red-500"
						onclick={closeTripModal}
						aria-label={t('common.actions.close')}>&times;</button
					>
					<h2 id="modal-title" class="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
						{isEditing ? t('trips.editTrip') : t('trips.addNewTrip')}
					</h2>
					<form onsubmit={(e) => submitTrip(e)} class="space-y-5">
						<div>
							<label
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								for="title">{t('trips.tripTitle')}</label
							>
							<input
								type="text"
								id="title"
								bind:value={tripForm.title}
								class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
								placeholder={t('trips.tripTitle')}
								required
								disabled={isSubmitting}
							/>
						</div>
						<div class="flex gap-4">
							<div class="flex-1">
								<label
									class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
									for="start_date">{t('trips.startDate')}</label
								>
								<input
									type="date"
									id="start_date"
									bind:value={tripForm.start_date}
									class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
									required
									disabled={isSubmitting}
								/>
							</div>
							<div class="flex-1">
								<label
									class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
									for="end_date">{t('trips.endDate')}</label
								>
								<input
									type="date"
									id="end_date"
									bind:value={tripForm.end_date}
									class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
									required
									disabled={isSubmitting}
								/>
							</div>
						</div>
						<div>
							<label
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								for="description">{t('trips.description')}</label
							>
							<textarea
								id="description"
								bind:value={tripForm.description}
								rows="3"
								class="w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
								placeholder={t('trips.describeTripPlaceholder')}
								disabled={isSubmitting}
							></textarea>
						</div>

						<!-- Labels Section -->
						<div>
							<label
								for="new-label"
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>{t('trips.labels')}</label
							>
							<div class="space-y-3">
								<!-- Add new label -->
								<div class="flex gap-2">
									<input
										id="new-label"
										type="text"
										bind:value={newLabel}
										onkeydown={(e) => e?.key === 'Enter' && (e.preventDefault(), addLabel())}
										placeholder={t('trips.addLabelPlaceholder')}
										class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
									/>
									<button
										type="button"
										onclick={addLabel}
										class="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
									>
										{t('common.actions.add')}
									</button>
								</div>

								<!-- Display existing labels -->
								{#if tripForm.labels.length > 0}
									<div class="flex flex-wrap gap-2">
										{#each tripForm.labels as label (label)}
											<div
												class="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
											>
												<span>{label}</span>
												<button
													type="button"
													onclick={() => removeLabel(label)}
													class="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
												>
													<X class="h-3 w-3" />
												</button>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<div>
							<label
								for="trip-image"
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>{t('trips.tripImage')}</label
							>

							<!-- Image suggestion section - only show when no image is available -->
							{#if !uploadedImageUrl && !imageFile && !suggestedImageUrl && !imagePreview && tripForm.start_date && tripForm.end_date}
								<div
									class="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20"
								>
									<div class="mb-2 flex items-center justify-between">
										<span class="text-sm font-medium text-blue-700 dark:text-blue-300"
											>{t('trips.autoSuggestedImage')}</span
										>
										{#if isSuggestingImage}
											<Loader2 class="h-4 w-4 animate-spin text-blue-600" />
										{/if}
									</div>

									{#if tripAnalysis && tripAnalysis.primaryCountry}
										<div class="mb-2 text-xs text-blue-600 dark:text-blue-400">
											Based on your travel to: <strong
												>{tripAnalysis.primaryCity || tripAnalysis.primaryCountry}</strong
											>
										</div>
									{/if}

									{#if suggestedImageUrl}
										<div class="flex items-center gap-2 text-green-600 dark:text-green-400">
											<span class="text-sm">✅ Image suggested successfully</span>
										</div>
									{/if}

									{#if imageError}
										<div class="text-xs text-red-500">{imageError}</div>
									{/if}
								</div>
							{/if}

							{#if isEditing && tripForm.start_date && tripForm.end_date && !uploadedImageUrl && !imageFile}
								<div class="mb-3">
									{#if serverPexelsApiKeyAvailable || userPreferences?.pexels_api_key}
										<button
											type="button"
											class="text-sm font-medium text-blue-600 underline hover:text-blue-700"
											onclick={suggestTripImage}
											disabled={isSuggestingImage}
										>
											{isSuggestingImage ? t('trips.suggesting') : t('trips.autoSuggestImage')}
										</button>
										{#if serverPexelsApiKeyAvailable}
											<p class="mt-1 text-xs text-green-600 dark:text-green-400">
												✅ Using server API key for high-quality suggestions
											</p>
										{/if}
									{:else}
										<div class="flex items-center gap-2">
											<button
												type="button"
												class="text-sm font-medium text-blue-600 underline hover:text-blue-700"
												onclick={suggestTripImage}
												disabled={isSuggestingImage}
											>
												{isSuggestingImage ? t('trips.suggesting') : t('trips.autoSuggestImage')}
											</button>
											<span class="text-xs text-gray-500 dark:text-gray-400">
												(Using fallback image service)
											</span>
										</div>
									{/if}
									<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
										Analyzes your travel data to suggest relevant images for this trip
									</p>
								</div>
							{/if}

							<!-- Manual upload section -->
							<div class="space-y-2">
								<input
									id="trip-image"
									type="file"
									accept="image/*"
									onchange={handleImageChange}
									class="block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
									disabled={isUploadingImage}
								/>

								{#if tripForm.start_date && tripForm.end_date}
									<div class="text-xs text-gray-500 dark:text-gray-400">
										{#if !uploadedImageUrl && !imageFile}
											{t('trips.orText')}
											<button
												type="button"
												class="text-blue-600 underline hover:text-blue-700"
												onclick={suggestTripImage}
												disabled={isSuggestingImage}
											>
												{isSuggestingImage ? t('trips.suggesting') : t('trips.suggestAnImage')}
											</button>
											{t('trips.basedOnTravelData')}
										{:else if suggestedImageUrl}
											<button
												type="button"
												class="text-blue-600 underline hover:text-blue-700"
												onclick={suggestTripImage}
												disabled={isSuggestingImage}
											>
												{isSuggestingImage
													? t('trips.suggesting')
													: t('trips.suggestDifferentImage')}
											</button>
											{t('trips.basedOnTravelData')}
										{/if}
									</div>
								{/if}
							</div>

							{#if isUploadingImage}
								<div class="mt-2 flex items-center gap-2 text-blue-600 dark:text-blue-400">
									<Loader2 class="h-4 w-4 animate-spin" />
									<span class="text-sm">Uploading image...</span>
								</div>
							{/if}

							{#if uploadedImageUrl && !suggestedImageUrl}
								<div class="mt-2 flex items-center gap-2 text-green-600 dark:text-green-400">
									<span class="text-sm">✅ Image uploaded successfully</span>
								</div>
							{/if}

							<!-- Stable image suggestion area with fixed height -->
							<div
								class="relative mt-2 flex h-40 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800"
							>
								{#if isSuggestingImage}
									<Loader2 class="h-10 w-10 animate-spin text-blue-500" />
								{:else if imagePreview}
									<img
										src={imagePreview}
										alt="Preview"
										class="mx-auto max-h-40 rounded-lg"
										style="max-width:100%; max-height:100%;"
									/>
								{/if}
								{#if isUploadingImage || isSuggestingImage}
									<div
										class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/20"
									>
										<Loader2 class="h-6 w-6 animate-spin text-white" />
									</div>
								{/if}
								{#if suggestedImageUrl && !isSuggestingImage}
									<div
										class="absolute top-2 right-2 rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white"
									>
										Suggested
									</div>
								{/if}
								<!-- Auto-suggest new image button when editing -->
								{#if isEditing && tripForm.start_date && tripForm.end_date}
									<div class="absolute top-2 left-2">
										<button
											type="button"
											class="rounded bg-white/95 px-3 py-1.5 text-xs font-medium text-blue-600 shadow-lg transition-all duration-200 hover:bg-white hover:text-blue-700 dark:bg-gray-800/95 dark:text-blue-400 dark:hover:bg-gray-800"
											onclick={suggestTripImage}
											disabled={isSuggestingImage}
											title="Get a new suggested image based on your travel data"
										>
											{isSuggestingImage ? 'Suggesting...' : '🔄 New suggestion'}
										</button>
									</div>
								{/if}
							</div>

							<!-- Attribution for suggested images -->
							{#if imageAttribution && imageAttribution.source === 'pexels' && imageAttribution.photographer}
								<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
									Photo by
									{#if imageAttribution.photographerUrl}
										<a
											href={imageAttribution.photographerUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="text-blue-600 underline hover:text-blue-700"
										>
											{imageAttribution.photographer}
										</a>
									{:else}
										{imageAttribution.photographer}
									{/if}
									on
									<a
										href="https://www.pexels.com"
										target="_blank"
										rel="noopener noreferrer"
										class="text-blue-600 underline hover:text-blue-700"
									>
										Pexels
									</a>
								</div>
							{/if}
						</div>
						{#if formError}
							<div class="text-sm font-medium text-red-500">{formError}</div>
						{/if}
						<div class="flex justify-end gap-3 pt-2">
							<button
								type="button"
								class="cursor-pointer rounded-lg bg-gray-200 px-5 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
								onclick={closeTripModal}
								disabled={isSubmitting}>{t('common.actions.cancel')}</button
							>
							<button
								type="submit"
								class="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-500 px-5 py-2 font-medium text-white transition-colors hover:bg-blue-600"
								disabled={isSubmitting}
							>
								{#if isSubmitting}
									<Loader2 class="h-4 w-4 animate-spin" />
								{/if}
								{isSubmitting ? t('trips.savingTrip') : t('trips.saveTrip')}
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	{/if}

	<!-- Loading State -->
	{#if isLoading || isInitialLoad}
		<div class="flex items-center justify-center py-12">
			<div class="text-center">
				<Loader2 class="mx-auto mb-4 h-8 w-8 animate-spin text-blue-500" />
				<p class="text-gray-600 dark:text-gray-400">Loading trips...</p>
			</div>
		</div>
	{:else if filteredTrips.length === 0}
		<div class="py-12 text-center">
			<Route class="mx-auto mb-4 h-12 w-12 text-gray-400" />
			<h3 class="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
				{t('trips.noTripsFound')}
			</h3>
			<p class="mb-4 text-gray-600 dark:text-gray-400">
				{searchQuery || selectedFilter !== 'all'
					? t('trips.tryAdjustingFilters')
					: t('trips.startCreatingFirstTrip')}
			</p>
			<button
				class="cursor-pointer rounded-lg bg-blue-500 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-600"
				onclick={openAddTripModal}
			>
				<Plus class="mr-2 inline h-4 w-4" />
				{t('trips.createTrip')}
			</button>
		</div>
	{:else}
		<!-- Trips Grid -->
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			{#each filteredTrips as trip (trip.id)}
				<div
					class="relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<!-- Action Buttons -->
					<div class="absolute top-3 right-3 z-10 flex gap-2">
						<button
							class="cursor-pointer rounded-full bg-gray-100 p-2 text-gray-400 transition-colors hover:bg-blue-100 hover:text-blue-500 dark:bg-gray-700 dark:hover:bg-blue-900/30"
							onclick={() => refreshTripMetadata(trip)}
							aria-label="Refresh trip metadata"
						>
							<RefreshCw class="h-5 w-5" />
						</button>
						<button
							class="cursor-pointer rounded-full bg-gray-100 p-2 text-gray-400 transition-colors hover:bg-blue-100 hover:text-blue-500 dark:bg-gray-700 dark:hover:bg-blue-900/30"
							onclick={() => openEditTripModal(trip)}
							aria-label="Edit trip"
						>
							<Edit class="h-5 w-5" />
						</button>
						<button
							class="cursor-pointer rounded-full bg-gray-100 p-2 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-500 dark:bg-gray-700 dark:hover:bg-red-900/30"
							onclick={() => confirmDeleteTrip(trip)}
							aria-label="Delete trip"
						>
							<Trash2 class="h-5 w-5" />
						</button>
					</div>
					<!-- Trip Image -->
					<div class="relative h-48 bg-gray-200 dark:bg-gray-700">
						{#if getTripImage(trip)}
							{#if imageLoadingStates.get(trip.id) === true}
								<!-- Loading placeholder -->
								<div class="flex h-full w-full items-center justify-center">
									<div class="text-center">
										<Loader2 class="mx-auto h-12 w-12 animate-spin text-blue-500" />
										<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading image...</p>
									</div>
								</div>
							{/if}
							<!-- Actual image (hidden while loading) -->
							<img
								src={getTripImage(trip)}
								alt={trip.title}
								class="h-full w-full object-cover {imageLoadingStates.get(trip.id) === true
									? 'hidden'
									: ''}"
								onload={() => handleImageLoad(trip.id)}
								onerror={() => handleImageError(trip.id)}
								onloadstart={() => startImageLoading(trip.id)}
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<div class="text-center">
									<Route class="mx-auto h-12 w-12 text-gray-400" />
									<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
										{t('trips.noImageAvailable')}
									</p>
								</div>
							</div>
						{/if}
						<!-- Distance label at bottom right -->
						<div
							class="absolute right-3 bottom-3 flex items-center gap-1 rounded bg-black/60 px-3 py-1 text-xs font-medium text-white shadow"
						>
							<Route class="h-4 w-4 text-blue-400" />
							{formatDistance(trip.metadata?.distanceTraveled ?? 0)}
						</div>
						<!-- Autogenerated label at top left -->
						{#if trip.labels?.includes('auto-generated')}
							<div
								class="absolute top-3 left-3 rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white shadow"
							>
								{t('trips.autoGeneratedLabel')}
							</div>
						{/if}
						<!-- Note: Removed image generation status indicators since images are now generated before trip creation -->
					</div>
					<!-- Trip Details and Footer -->
					<div class="flex min-h-0 flex-1 flex-col p-4">
						<div class="mb-2 flex flex-wrap items-start justify-between gap-2">
							<h3
								class="line-clamp-2 flex-1 text-lg font-semibold text-gray-900 dark:text-gray-100"
							>
								{trip.title}
							</h3>
							<!-- Trip type badges -->
							<div class="flex gap-1">
								{#if trip.metadata?.isMultiCountryTrip}
									<span
										class="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300"
									>
										Multi-Country
									</span>
								{/if}
								{#if trip.metadata?.isMultiCityTrip}
									<span
										class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
									>
										Multi-City
									</span>
								{/if}
							</div>
						</div>
						{#if trip.description}
							<p class="mb-3 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
								{trip.description}
							</p>
						{/if}
						<!-- Trip Stats -->
						<div class="mb-4 space-y-2">
							<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
								<Calendar class="h-4 w-4" />
								<span
									>{format(new Date(trip.start_date), 'MMM d, yyyy')} - {format(
										new Date(trip.end_date),
										'MMM d, yyyy'
									)}</span
								>
							</div>
							<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
								<Clock class="h-4 w-4" />
								<span>{formatDuration(trip.start_date, trip.end_date)}</span>
							</div>
							<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
								<MapPin class="h-4 w-4" />
								<span>{trip.metadata?.dataPoints ?? 0} {t('trips.points')}</span>
							</div>

							<!-- Pexels attribution -->
							{#if trip.metadata?.image_attribution?.source === 'pexels' && trip.metadata?.image_attribution?.photographer}
								<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
									<span class="text-xs">📸</span>
									<span class="text-xs">
										{t('trips.photoBy')}
										{#if trip.metadata?.image_attribution?.photographerUrl}
											<a
												href={trip.metadata.image_attribution.photographerUrl}
												target="_blank"
												rel="noopener noreferrer"
												class="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
											>
												{trip.metadata.image_attribution.photographer}
											</a>
										{:else}
											{trip.metadata.image_attribution.photographer}
										{/if}
										{t('trips.on')}
										<a
											href="https://www.pexels.com"
											target="_blank"
											rel="noopener noreferrer"
											class="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
										>
											Pexels
										</a>
									</span>
								</div>
							{/if}
							<!-- Labels -->
							{#if trip.labels && trip.labels.length > 0}
								<div class="flex flex-wrap gap-1">
									{#each trip.labels as label (label)}
										<span
											class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium
											{label === 'auto-generated'
												? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
												: label === 'suggested'
													? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
													: label === 'vacation'
														? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
														: label === 'business'
															? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
															: label === 'adventure'
																? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
																: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}"
										>
											{label}
										</span>
									{/each}
								</div>
							{/if}
						</div>
						<!-- Footer: always at the bottom -->
						<div
							class="mt-auto flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-700"
						>
							<span class="text-xs text-gray-500 dark:text-gray-400">
								{t('trips.updated')}
								{getRelativeTime(trip.updated_at)}
							</span>
							<button
								class="flex cursor-pointer items-center gap-1 text-sm font-medium text-blue-500 transition-colors hover:text-blue-600"
								onclick={() => showTripStatistics(trip)}
							>
								<BarChart class="h-4 w-4" />
								{t('trips.showStatistics')}
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Loading indicator for infinite scroll -->
		{#if isLoadingMore}
			<div class="mt-6 flex justify-center">
				<div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
					<Loader2 class="h-5 w-5 animate-spin" />
					<span>Loading more trips...</span>
				</div>
			</div>
		{/if}

		<!-- Results Summary -->
		<div class="py-4 text-center">
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{t('trips.showingTripsOf', { filtered: filteredTrips.length, total: trips.length })}
			</p>
		</div>
	{/if}

	<!-- Suggested Trips Modal -->
	<Modal
		open={showSuggestedTripsModal}
		title={t('trips.reviewSuggestedTripsModal')}
		size="xl"
		onClose={() => (showSuggestedTripsModal = false)}
	>
		<div class="flex h-full max-h-[70vh] flex-col">
			<!-- Scrollable content area -->
			<div
				class="min-h-0 flex-1 space-y-6 overflow-y-auto"
				onscroll={(e) => {
					const target = e.currentTarget;
					const scrollTop = target.scrollTop;
					const scrollHeight = target.scrollHeight;
					const clientHeight = target.clientHeight;

					// Load more when user scrolls to within 100px of the bottom
					if (
						scrollHeight - scrollTop - clientHeight < 100 &&
						suggestedTripsPagination.hasMore &&
						!isLoadingMoreSuggestedTrips
					) {
						loadMoreSuggestedTrips();
					}
				}}
			>
				<!-- Header with Generate New Suggestions button -->
				<div class="flex items-center justify-between">
					<div></div>
					<!-- Empty div for spacing -->
					<GenerateSuggestionsButton onClick={openTripGenerationModal} />
				</div>

				{#if isLoadingSuggestedTrips && suggestedTrips.length === 0}
					<div class="flex items-center justify-center py-12">
						<Loader2 class="h-8 w-8 animate-spin text-blue-500" />
						<span class="ml-2 text-gray-600 dark:text-gray-400"
							>{t('trips.loadingSuggestedTrips')}</span
						>
					</div>
				{:else if suggestedTrips.length === 0}
					<div class="py-12 text-center">
						<Route class="mx-auto mb-4 h-12 w-12 text-gray-400" />
						<h3 class="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
							{t('trips.noSuggestedTrips')}
						</h3>
						<p class="text-gray-600 dark:text-gray-400">{t('trips.noPendingTripSuggestions')}</p>
					</div>
				{:else}
					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<p class="text-sm text-gray-600 dark:text-gray-400">
								{suggestedTrips.length} suggested trip{suggestedTrips.length !== 1 ? 's' : ''} found
							</p>
							<div class="flex gap-2">
								<button
									class="cursor-pointer rounded-lg bg-gray-200 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
									onclick={() => (selectedSuggestedTrips = suggestedTrips.map((t) => t.id))}
								>
									{t('trips.selectAll')}
								</button>
								<button
									class="cursor-pointer rounded-lg bg-gray-200 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
									onclick={() => (selectedSuggestedTrips = [])}
								>
									{t('trips.clearSelection')}
								</button>
							</div>
						</div>

						<div class="grid gap-4">
							{#each suggestedTrips as trip (trip.id)}
								<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
									<div class="flex items-start gap-4">
										<input
											type="checkbox"
											id={`trip-${trip.id}`}
											checked={selectedSuggestedTrips.includes(trip.id)}
											onchange={(e) => {
												const target = e.target as HTMLInputElement;
												if (target.checked) {
													selectedSuggestedTrips = [...selectedSuggestedTrips, trip.id];
												} else {
													selectedSuggestedTrips = selectedSuggestedTrips.filter(
														(id) => id !== trip.id
													);
												}
											}}
											class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
										/>
										<div class="flex-1">
											<div class="mb-2 flex items-center justify-between">
												<label
													for={`trip-${trip.id}`}
													class="cursor-pointer text-lg font-semibold text-gray-900 hover:text-blue-600 dark:text-gray-100"
												>
													{trip.title}
												</label>
												<!-- Trip type badges -->
												<div class="flex gap-2">
													{#if trip.metadata?.isMultiCountryTrip}
														<span
															class="rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700 dark:bg-purple-900 dark:text-purple-300"
														>
															Multi-Country
														</span>
													{/if}
													{#if trip.metadata?.isMultiCityTrip}
														<span
															class="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
														>
															Multi-City
														</span>
													{/if}
												</div>
											</div>
											<p class="mb-2 text-sm text-gray-600 dark:text-gray-400">
												{trip.description}
											</p>
											<div
												class="mb-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400"
											>
												<span
													>{t('trips.start')}: {format(
														new Date(trip.start_date),
														'MMM d, yyyy'
													)}</span
												>
												<span
													>{t('trips.end')}: {format(new Date(trip.end_date), 'MMM d, yyyy')}</span
												>
												<span>{trip.metadata?.dataPoints || 0} {t('trips.dataPoints')}</span>
											</div>

											<!-- Visited Cities -->
											{#if trip.metadata?.visitedCitiesDetailed && trip.metadata.visitedCitiesDetailed.length > 0}
												{@const significantCities = trip.metadata.visitedCitiesDetailed.filter(
													(city) => city.durationHours >= 12 && city.city !== 'Unknown'
												)}
												{#if significantCities.length > 0}
													<div class="mb-2 rounded-md bg-gray-50 p-3 dark:bg-gray-800">
														<div
															class="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300"
														>
															{t('trips.visitedCities')}:
														</div>
														<div class="flex flex-wrap gap-2">
															{#each significantCities as city (city.city)}
																<span
																	class="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-300"
																>
																	<MapPin class="h-3 w-3" />
																	<span class="font-medium">{city.city}</span>
																</span>
															{/each}
														</div>
													</div>
												{/if}
											{/if}

											<!-- Visited Countries (for multi-country trips) -->
											{#if trip.metadata?.visitedCountriesDetailed && trip.metadata.visitedCountriesDetailed.length > 1}
												{@const validCountries = trip.metadata.visitedCountriesDetailed.filter(
													(country) => country.countryCode !== 'Unknown'
												)}
												{#if validCountries.length > 1}
													<div class="rounded-md bg-gray-50 p-3 dark:bg-gray-800">
														<div
															class="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300"
														>
															{t('trips.visitedCountries')}:
														</div>
														<div class="flex flex-wrap gap-2">
															{#each validCountries as country (country.countryCode)}
																<span
																	class="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-300"
																>
																	<span class="font-medium"
																		>{$getCountryNameReactive(country.countryCode)}</span
																	>
																</span>
															{/each}
														</div>
													</div>
												{/if}
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>

						<!-- Loading indicator for infinite scroll -->
						{#if isLoadingMoreSuggestedTrips}
							<div class="flex items-center justify-center py-4">
								<div
									class="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
								></div>
								<span class="ml-3 text-sm text-gray-600 dark:text-gray-400"
									>Loading more trips...</span
								>
							</div>
						{/if}

						<!-- End of list indicator -->
						{#if !suggestedTripsPagination.hasMore && suggestedTrips.length > 0}
							<div class="py-4 text-center">
								<span class="text-sm text-gray-500 dark:text-gray-400">
									All {suggestedTripsPagination.total} suggested trips loaded
								</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Sticky Action Buttons -->
			<div class="mt-4 flex gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
				<button
					onclick={() => (showSuggestedTripsModal = false)}
					class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					{t('common.actions.cancel')}
				</button>
				<button
					onclick={handleRejectTrips}
					disabled={selectedSuggestedTrips.length === 0}
					class="flex flex-1 items-center justify-center rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700"
				>
					<X class="mr-2 h-4 w-4 flex-shrink-0" />
					<span class="truncate">
						{t('trips.rejectTrips', {
							count: selectedSuggestedTrips.length,
							plural: selectedSuggestedTrips.length !== 1 ? 's' : ''
						})}
					</span>
				</button>
				<button
					onclick={() => {
						handleApproveTrips();
					}}
					disabled={selectedSuggestedTrips.length === 0}
					class="flex flex-1 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
				>
					<Plus class="mr-2 h-4 w-4 flex-shrink-0" />
					<span class="truncate">
						{t('trips.approveTrips', {
							count: selectedSuggestedTrips.length,
							plural: selectedSuggestedTrips.length !== 1 ? 's' : ''
						})}
					</span>
				</button>
			</div>
		</div>
	</Modal>

	<!-- Trip Generation Modal -->
	<TripGenerationModal
		open={showTripGenerationModal}
		bind:startDate={tripGenerationData.startDate}
		bind:endDate={tripGenerationData.endDate}
		bind:useCustomHomeAddress={tripGenerationData.useCustomHomeAddress}
		bind:customHomeAddress={tripGenerationData.customHomeAddress}
		bind:customHomeAddressInput
		bind:isCustomHomeAddressSearching
		bind:customHomeAddressSuggestions
		bind:showCustomHomeAddressSuggestions
		bind:selectedCustomHomeAddressIndex
		bind:customHomeAddressSearchError
		bind:selectedCustomHomeAddress
		bind:clearExistingSuggestions={tripGenerationData.clearExistingSuggestions}
		onClose={() => (showTripGenerationModal = false)}
		onGenerate={generateNewTripSuggestions}
		onCustomHomeAddressToggle={handleCustomHomeAddressToggle}
	/>

	<!-- Delete Confirmation Modal -->
	{#if showDeleteConfirm && tripToDelete}
		<div
			class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-modal-title"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					showDeleteConfirm = false;
					tripToDelete = null;
				}
			}}
			tabindex="-1"
		>
			<div
				class="relative mx-4 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl dark:bg-gray-900"
				role="document"
			>
				<h2 id="delete-modal-title" class="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">
					{t('trips.deleteTrip')}
				</h2>
				<p class="mb-6 text-gray-700 dark:text-gray-300">
					{t('trips.deleteConfirmation', { title: tripToDelete?.title || '' })}
				</p>
				<div class="flex justify-end gap-3">
					<button
						class="cursor-pointer rounded-lg bg-gray-200 px-5 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
						onclick={cancelDeleteTrip}>{t('common.actions.cancel')}</button
					>
					<button
						class="cursor-pointer rounded-lg bg-red-500 px-5 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={deleteTrip}>{t('common.actions.delete')}</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Approval Progress Modal -->
	{#if isApprovalInProgress}
		<div
			class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="progress-modal-title"
		>
			<div
				class="relative mx-4 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl dark:bg-gray-900"
				role="document"
			>
				<h2
					id="progress-modal-title"
					class="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100"
				>
					{t('trips.approvingTrips')}
				</h2>

				<!-- Progress Steps -->
				<div class="mb-6">
					<div class="mb-2 flex items-center justify-between">
						<span class="text-sm font-medium text-gray-700 dark:text-gray-300"
							>{t('trips.stepOf', {
								current: approvalProgress.currentStep,
								total: approvalProgress.totalSteps
							})}</span
						>
						<span class="text-sm text-gray-500 dark:text-gray-400"
							>{approvalProgress.progress}%</span
						>
					</div>

					<!-- Progress Bar -->
					<div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
						<div
							class="h-2 rounded-full bg-blue-600 transition-all duration-300 ease-out"
							style="width: {approvalProgress.progress}%"
						></div>
					</div>
				</div>

				<!-- Step Indicators -->
				<div class="mb-6 space-y-3">
					<div class="flex items-center">
						<div class="flex-shrink-0">
							{#if approvalProgress.step === 'generating-images' || approvalProgress.step === 'creating-trips' || approvalProgress.step === 'complete'}
								<div class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600">
									<Check class="h-4 w-4 text-white" />
								</div>
							{:else}
								<div class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-300">
									<span class="text-xs text-gray-600">1</span>
								</div>
							{/if}
						</div>
						<div class="ml-3">
							<p class="text-sm font-medium text-gray-900 dark:text-gray-100">
								{t('trips.generateImages')}
							</p>
							<p class="text-xs text-gray-500 dark:text-gray-400">
								{t('trips.creatingImagesDescription')}
							</p>
						</div>
					</div>

					<div class="flex items-center">
						<div class="flex-shrink-0">
							{#if approvalProgress.step === 'creating-trips' || approvalProgress.step === 'complete'}
								<div class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600">
									<Check class="h-4 w-4 text-white" />
								</div>
							{:else}
								<div class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-300">
									<span class="text-xs text-gray-600">2</span>
								</div>
							{/if}
						</div>
						<div class="ml-3">
							<p class="text-sm font-medium text-gray-900 dark:text-gray-100">
								{t('trips.createTripsStep')}
							</p>
							<p class="text-xs text-gray-500 dark:text-gray-400">
								{t('trips.approvingTripsWithImages')}
							</p>
						</div>
					</div>
				</div>

				<!-- Current Status Message -->
				<div class="mb-6 rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
					<div class="flex items-center">
						{#if approvalProgress.step === 'generating-images'}
							<Loader2 class="mr-3 h-5 w-5 animate-spin text-blue-600" />
						{:else if approvalProgress.step === 'creating-trips'}
							<Loader2 class="mr-3 h-5 w-5 animate-spin text-blue-600" />
						{:else if approvalProgress.step === 'complete'}
							<Check class="mr-3 h-5 w-5 text-green-600" />
						{/if}
						<p class="text-sm text-blue-800 dark:text-blue-200">{approvalProgress.message}</p>
					</div>

					{#if approvalProgress.imageProgress.currentTrip}
						<p class="mt-1 text-xs text-blue-600 dark:text-blue-400">
							{t('trips.lastProcessed', { title: approvalProgress.imageProgress.currentTrip })}
						</p>
					{/if}
				</div>

				<!-- Action Buttons -->
				{#if approvalProgress.step === 'complete'}
					<div class="flex justify-end">
						<button
							class="cursor-pointer rounded-lg bg-blue-600 px-5 py-2 font-medium text-white transition-colors hover:bg-blue-700"
							onclick={() => (isApprovalInProgress = false)}
						>
							{t('common.actions.close')}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Powered by Pexels Footer -->
	<div class="mt-12 text-center">
		<div
			class="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-400"
		>
			{t('trips.poweredByPexels')}
		</div>
	</div>
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.modal-overlay {
		margin: 0 !important;
		height: 100vh;
		min-height: 100vh;
	}
</style>
