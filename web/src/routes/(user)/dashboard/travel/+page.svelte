<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fluxbase } from '$lib/fluxbase';
	import { userStore, sessionStore } from '$lib/stores/auth';
	import { pendingTripCount } from '$lib/stores/trip-suggestions';
	import {
		listAllEntries,
		createEntry,
		updateEntry,
		deleteEntry
	} from '$lib/services/trip-entry.service';
	import { fetchTrackPoints } from '$lib/services/gps.service';
	import { fromStoredSegments } from '$lib/services/trip-route/trip-route-geometry';
	import { isValhallaBetaEnabled, loadValhallaBeta } from '$lib/stores/valhalla-beta.svelte';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { getTripsService } from '$lib/services/service-layer-adapter';
	import { aiDrawer, type PlanSuggestion } from '$lib/stores/ai-drawer';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import {
		effectiveBlocks,
		legacyBodyFromBlocks,
		normalizeEntryBlocks,
		type BlockMedia
	} from '$lib/utils/entry-blocks';
	import type { EntryBlock, EntryBlocks } from '$lib/types/journal.types';
	import { compressImage } from '$lib/utils/image-compress';
	import {
		uploadMedia,
		createMedia,
		deleteMedia as deleteMediaRow,
		listMedia,
		reorderMedia,
		attachMediaToEntry
	} from '$lib/services/trip-media.service';
	import TripMap from '$lib/components/TripMap.svelte';
	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
	import EntryBlockEditor from '$lib/components/EntryBlockEditor.svelte';
	import EntryBlocksView from '$lib/components/EntryBlocksView.svelte';
	import EntryLikeButton from '$lib/components/EntryLikeButton.svelte';
	import EntryComments from '$lib/components/EntryComments.svelte';
	import TripGenerationModal from '$lib/components/modals/TripGenerationModal.svelte';
	import ConfirmationModal from '$lib/components/modals/ConfirmationModal.svelte';
	import PannableCover from '$lib/components/PannableCover.svelte';
	import WorldMap from '$lib/components/WorldMap.svelte';
	import {
		Plus,
		ChevronDown,
		ChevronRight,
		MapPin,
		Calendar,
		Route,
		Globe,
		Sparkles,
		Check,
		X,
		Pencil,
		Trash2,
		Share2,
		Eye,
		EyeOff,
		Loader2,
		RefreshCw,
		ExternalLink,
		Star,
		Save,
		ImagePlus,
		Upload,
		Users
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { translate } from '$lib/i18n';
	import { getFriends, type UserConnection } from '$lib/services/friend.service';
	import {
		getTripShares,
		shareTrip,
		unshareTrip,
		type TripShare
	} from '$lib/services/trip-share.service';

	type Trip = {
		id: string;
		title: string;
		description: string | null;
		start_date: string;
		end_date: string;
		image_url: string | null;
		visibility: string;
		status: string;
		metadata: Record<string, any> | null;
	};

	type JournalEntry = {
		id: string;
		trip_id: string;
		user_id: string;
		title: string;
		body: string;
		blocks?: EntryBlocks | null;
		entry_date: string;
		end_date?: string | null;
		status?: string;
		cover_media_id?: string | null;
		created_at: string;
		updated_at: string;
		trip_title: string;
		trip_image_url: string | null;
		cover_image_url: string | null;
	};

	type GpsPoint = { lat: number; lng: number; trip_id: string; date: string };

	// ── State ──
	let trips = $state<Trip[]>([]);
	let entries = $state<JournalEntry[]>([]);
	let pendingTrips = $state<Trip[]>([]);
	// GPS points are loaded lazily per trip (on expand), not eagerly for all
	// trips. The cache maps tripId → points; the Set tracks in-flight loads so
	// the UI can show a spinner. Loading all points for every trip on mount was
	// the main cause of the slow Travel page — cards only need trip.metadata.
	let gpsCache = $state<Map<string, GpsPoint[]>>(new Map());
	let loadingTripGps = $state<Set<string>>(new Set());
	let cityMarkers = $state<Array<{ lat: number; lng: number; label: string }>>([]);
	let isLoading = $state(true);
	let activeTripId = $state<string | null>(null);
	let activeEntryId = $state<string | null>(null);
	let expandedTrips = $state<Set<string>>(new Set());
	let suggestionsExpanded = $state(false);
	let currentPage = $state(1);
	const TRIPS_PER_PAGE = 25;
	let activeFilter = $state<'all' | 'withJournal' | 'withDrafts' | 'hasPhotos'>('all');
	let publicJournalUrl = $state('');
	let searchQuery = $state('');
	let approvingIds = $state<Set<string>>(new Set());

	// ── Editor state ──
	let showEditor = $state(false);
	let editingEntry = $state<JournalEntry | null>(null);
	let editorTripId = $state('');
	let editorTitle = $state('');
	/** Block list — the source of truth while editing. */
	let editorBlocks = $state<EntryBlock[]>([]);
	/** Media rows relevant to the editor entry (drives projection + thumbs). */
	let editorMedia = $state<import('$lib/types/media.types').TripMedia[]>([]);
	/** Cover pick for entries that don't exist yet (persisted on save). */
	let editorCoverId = $state<string | null>(null);
	let editorDate = $state('');
	let editorStatus = $state<'published' | 'draft'>('published');
	let editorEndDate = $state('');
	let isSaving = $state(false);
	/** Media uploaded while composing a NEW entry (entry_id still null) —
	 * attached to the entry once it is saved. */
	let editorInlineMediaIds = $state<string[]>([]);
	/** Read-view media, lazily loaded per expanded trip (like gpsCache). */
	let mediaCache = $state<Map<string, import('$lib/types/media.types').TripMedia[]>>(new Map());

	// ── New trip modal state ──
	let showTripModal = $state(false);
	let editingTrip = $state<Trip | null>(null);
	let tripTitle = $state('');
	let tripStartDate = $state('');
	let tripEndDate = $state('');
	let tripDescription = $state('');
	let tripImageUrl = $state<string | null>(null);
	let tripImageAttribution = $state<any>(null);
	let tripCostsVisible = $state<'private' | 'friends' | 'public'>('private');
	let tripGpsVisible = $state<'private' | 'friends' | 'public'>('private');
	let tripCommentsAllowed = $state<'owner' | 'friends' | 'public'>('friends');
	let tripShares = $state<TripShare[]>([]);
	let tripFriends = $state<UserConnection[]>([]);
	let isCreatingTrip = $state(false);
	let isUploadingImage = $state(false);
	let tripImageInput = $state<HTMLInputElement | null>(null);

	// ── Service ──
	let serviceAdapter: ServiceAdapter | null = null;

	// ── Derived ──
	const entriesByTrip = $derived.by(() => {
		const map = new Map<string, JournalEntry[]>();
		for (const e of entries) {
			const list = map.get(e.trip_id) ?? [];
			list.push(e);
			map.set(e.trip_id, list);
		}
		return map;
	});

	const filteredTrips = $derived.by(() => {
		switch (activeFilter) {
			case 'withJournal':
				return trips.filter((t) => (entriesByTrip.get(t.id)?.length ?? 0) > 0);
			case 'withDrafts':
				return trips.filter((t) =>
					(entriesByTrip.get(t.id) ?? []).some((e) => e.status === 'draft')
				);
			case 'hasPhotos':
				return trips.filter((t) => (t.image_url ?? '').length > 0);
			default:
				return trips;
		}
	});

	const totalTripPages = $derived(Math.max(1, Math.ceil(filteredTrips.length / TRIPS_PER_PAGE)));
	const visibleTrips = $derived(
		filteredTrips.slice((currentPage - 1) * TRIPS_PER_PAGE, currentPage * TRIPS_PER_PAGE)
	);

	// Reset to page 1 when filter changes
	$effect(() => {
		void activeFilter;
		currentPage = 1;
	});

	const activeTripGpsPoints = $derived(
		activeTripId ? (gpsCache.get(activeTripId) ?? []).map((p) => ({ lat: p.lat, lng: p.lng })) : []
	);

	// Valhalla-snapped route for the active trip (trips.metadata.routeShape),
	// preferred over the raw points for opted-in (beta) users. Already
	// privacy-clipped server-side.
	const activeTripRouteSegments = $derived.by(() => {
		if (!activeTripId) return [];
		if (!isValhallaBetaEnabled()) return [];
		const trip = trips.find((t) => t.id === activeTripId);
		const stored = (trip?.metadata as any)?.routeShape?.segments;
		if (!Array.isArray(stored) || stored.length === 0) return [];
		return fromStoredSegments(stored);
	});

	const highlightPoints = $derived.by(() => {
		if (!activeEntryId) return [];
		const entry = entries.find((e) => e.id === activeEntryId);
		if (!entry) return [];
		const startDay = (entry.entry_date || '').slice(0, 10);
		const endDay = (entry.end_date || entry.entry_date || '').slice(0, 10);
		return (gpsCache.get(entry.trip_id) ?? [])
			.filter((p) => p.date >= startDay && p.date <= endDay)
			.map((p) => ({ lat: p.lat, lng: p.lng }));
	});

	const pendingCount = $derived(pendingTrips.length);

	// Sync pending count to shared store for AppNav badge
	$effect(() => {
		pendingTripCount.set(pendingTrips.length);
	});

	// ── Map state: overview (markers only) vs trip-detail (track) ──
	const mapPoints = $derived(activeTripId ? activeTripGpsPoints : []);
	const mapMarkers = $derived(activeTripId ? [] : cityMarkers);

	// Visited countries for world map. Source of truth is the visited-countries
	// RPC (all tracker data with a ≥1h dwell rule — includes pending trips and
	// countries the geocoder missed). Falls back to trip-metadata-derived codes
	// until the cache has been built (empty RPC result, e.g. fresh account).
	let trackedCountries = $state<string[] | null>(null); // null = not loaded yet

	const visitedCountries = $derived.by(() => {
		if (trackedCountries && trackedCountries.length > 0) return trackedCountries;
		const codes = new Set<string>();
		for (const trip of trips) {
			const meta = trip.metadata;
			if (meta?.visitedCountryCodes) {
				for (const c of meta.visitedCountryCodes) codes.add(String(c).toUpperCase());
			}
			if (meta?.visitedCitiesDetailed) {
				for (const c of meta.visitedCitiesDetailed) {
					if (c.countryCode) codes.add(String(c.countryCode).toUpperCase());
				}
			}
		}
		return [...codes];
	});

	/** Load cached per-country presence (dwell ≥ 1h). Silent on failure — the
	 *  metadata fallback above keeps the map populated. */
	async function loadTrackedCountries() {
		try {
			const { data, error } = await (fluxbase.rpc as any).invoke(
				'visited-countries',
				{},
				{ namespace: 'wayli' }
			);
			if (error) return;
			trackedCountries = ((data as any[]) ?? [])
				.map((r) => String(r.country_code).toUpperCase())
				.filter(Boolean);
		} catch {
			// cache not built / RPC unavailable — fallback stays active
		}
	}

	onMount(() => {
		// Fire-and-forget: road-snapping beta opt-in gates snapped map rendering.
		void loadValhallaBeta();

		// Svelte never runs a cleanup returned from an async onMount — wrap the
		// async body so the handler reset in the real cleanup below fires.
		(async () => {
			try {
				const session = await fluxbase.auth.getSession();
				if (session.data?.session) {
					serviceAdapter = new ServiceAdapter({ session: session.data.session });
				}
			} catch {
				// not logged in
			}

			// Mark that the user has visited the Travel page so the dashboard
			// sidebar can stop showing the suggested-trips count badge (they've
			// now seen that suggestions exist).
			try {
				localStorage.setItem('wayli.travel_visited', '1');
				// Notify other tabs/windows (e.g. an open dashboard) so the badge
				// disappears without a reload.
				window.dispatchEvent(new StorageEvent('storage', { key: 'wayli.travel_visited' }));
			} catch {
				// localStorage unavailable (private mode, etc.) — non-critical
			}

			await loadTrips();
			await Promise.all([
				loadEntries(),
				loadGpsData(),
				loadPendingTrips(),
				loadPublicUrl(),
				loadTrackedCountries()
			]);

			// Check URL for deep-link ?trip={id}
			const urlTripId = page.url.searchParams.get('trip');
			if (urlTripId) {
				expandedTrips = new Set([...expandedTrips, urlTripId]);
				activeTripId = urlTripId;
				// Deep-linked straight to a trip — fetch its track so the map shows.
				loadTripGps(urlTripId);
				setTimeout(() => {
					document
						.querySelector(`[data-trip-id="${urlTripId}"]`)
						?.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}, 200);

				// Auto-open edit modal if requested
				if (page.url.searchParams.get('edit') === '1') {
					const trip = trips.find((t) => t.id === urlTripId);
					if (trip) openEditTripModal(trip);
					// Clean URL
					history.replaceState({}, '', '/dashboard/travel?trip=' + urlTripId);
				}
			}

			isLoading = false;
			setupObserver();

			// ponytail: register this page with the AI assistant as the 'trips'
			// surface so trip-composition suggestions route here. The dashboard
			// layout already sets page context 'trips' for this route; we register
			// the accept handler and reset it on navigation.
			aiDrawer.setAcceptHandler('trip', handleTripSuggestion);
		})();

		return () => {
			aiDrawer.setAcceptHandler('trip', null);
		};
	});

	// ── Data loaders ──

	async function loadTrips() {
		try {
			const { data } = await fluxbase
				.from('trips')
				.select(
					'id, title, description, start_date, end_date, image_url, visibility, status, metadata'
				)
				.in('status', ['active', 'planned', 'completed'])
				.order('start_date', { ascending: false });
			trips = (data as unknown as Trip[]) ?? [];
		} catch {
			// empty
		}
	}

	async function loadPendingTrips() {
		try {
			const { data } = await fluxbase
				.from('trips')
				.select(
					'id, title, description, start_date, end_date, image_url, visibility, status, metadata'
				)
				.eq('status', 'pending')
				.order('start_date', { ascending: false });
			pendingTrips = (data as unknown as Trip[]) ?? [];
			pendingTripCount.set(pendingTrips.length);
		} catch {
			// empty
		}
	}

	async function loadEntries() {
		try {
			entries = await listAllEntries();
		} catch (err) {
			console.error('Failed to load entries:', err);
		}
	}

	// Build the overview city markers from trip metadata only (cheap — no GPS
	// fetch). Previously this also eagerly loaded raw tracker points for EVERY
	// trip, which was the main cause of the slow Travel page load: cards and
	// the overview map don't need raw points, only the active/expanded trip's
	// map does (loaded on demand by loadTripGps).
	async function loadGpsData() {
		try {
			for (const trip of trips) {
				if (trip.metadata?.visitedCitiesDetailed) {
					for (const c of trip.metadata.visitedCitiesDetailed) {
						if (c.lat && c.lng && !cityMarkers.some((m) => m.lat === c.lat && m.lng === c.lng)) {
							cityMarkers = [
								...cityMarkers,
								{ lat: c.lat, lng: c.lng, label: c.city || 'Unknown' }
							];
						}
					}
				}
			}
		} catch (err) {
			console.error('Failed to load city markers:', err);
		}
	}

	// Lazily fetch the raw GPS track for a single trip, memoized in gpsCache.
	// Triggered when a trip is expanded/deep-linked. No-op if already loaded or
	// in-flight. Mirrors the per-trip fetch the page did before, just on demand.
	async function loadTripGps(tripId: string) {
		if (gpsCache.has(tripId) || loadingTripGps.has(tripId)) return;
		const trip = trips.find((t) => t.id === tripId);
		if (!trip) return;
		try {
			const { data: userData } = await fluxbase.auth.getUser();
			const userId = userData?.user?.id;
			if (!userId) return;

			loadingTripGps = new Set(loadingTripGps).add(tripId);
			const pts = (await fetchTrackPoints(userId, trip.start_date, trip.end_date, 500)).map(
				(p) => ({ ...p, trip_id: trip.id })
			);
			const next = new Map(gpsCache);
			next.set(tripId, pts);
			gpsCache = next;
		} catch (err) {
			console.error('Failed to load trip GPS:', err);
		} finally {
			const next = new Set(loadingTripGps);
			next.delete(tripId);
			loadingTripGps = next;
		}
	}

	async function loadPublicUrl() {
		try {
			const { data: userData } = await fluxbase.auth.getUser();
			if (!userData?.user) return;
			const { data: profile } = await fluxbase
				.from('user_profiles')
				.select('username')
				.eq('id', userData.user.id)
				.single();
			const profileData = profile as any;
			if (profileData?.username) {
				publicJournalUrl = `${window.location.origin}/u/${profileData.username}`;
			}
		} catch {
			// empty
		}
	}

	// ── IntersectionObserver for entry highlighting ──
	let observer: IntersectionObserver | null = null;

	function setupObserver() {
		if (observer) observer.disconnect();
		observer = new IntersectionObserver(
			(els) => {
				for (const e of els) {
					if (e.isIntersecting) {
						const entryId = (e.target as HTMLElement).dataset.entryId;
						const tripId = (e.target as HTMLElement).dataset.tripId;
						if (entryId) activeEntryId = entryId;
						if (tripId) activeTripId = tripId;
					}
				}
			},
			{ rootMargin: '-30% 0px -50% 0px', threshold: 0 }
		);
		document.querySelectorAll('[data-entry-id]').forEach((el) => observer?.observe(el));
	}

	// ── Trip section expand/collapse ──
	function toggleTrip(tripId: string) {
		const next = new Set(expandedTrips);
		if (next.has(tripId)) {
			next.delete(tripId);
		} else {
			next.add(tripId);
			activeTripId = tripId;
			// Lazily fetch this trip's GPS track + media now that it's expanded.
			loadTripGps(tripId);
			loadTripMedia(tripId);
		}
		expandedTrips = next;
		setTimeout(() => setupObserver(), 50);
	}

	async function loadTripMedia(tripId: string) {
		if (mediaCache.has(tripId)) return;
		try {
			const rows = await listMedia(tripId);
			mediaCache.set(tripId, rows);
			mediaCache = new Map(mediaCache); // trigger reactivity
		} catch (err) {
			console.error('Failed to load trip media:', err);
		}
	}

	/** The entry's media rows for block derivation (BlockMedia compatible). */
	function mediaForEntry(tripId: string, entryId: string): BlockMedia[] {
		return (mediaCache.get(tripId) ?? []).filter((m) => m.entry_id === entryId);
	}

	/** Resolved display URLs for EntryBlocksView. */
	function viewMediaMap(
		list: BlockMedia[] | import('$lib/types/media.types').TripMedia[]
	): Map<string, { url: string; fullUrl?: string; caption?: string | null }> {
		return new Map(
			list.map((m) => {
				const full = m as import('$lib/types/media.types').TripMedia;
				return [
					m.id,
					{
						url: storageRefToUrl(full.thumbnail_path ?? m.storage_path),
						fullUrl: storageRefToUrl(m.storage_path),
						caption: m.caption ?? null
					}
				];
			})
		);
	}

	let isGenerating = $state(false);
	let t = $derived($translate);
	let isRecalculating = $state(false);

	// ── Suggestion modal state ──
	let showGenerationModal = $state(false);
	let genStartDate = $state('');
	let genEndDate = $state('');
	let genUseCustomHome = $state(false);
	let genCustomHomeInput = $state('');
	let genHomeSuggestions = $state<any[]>([]);
	let genShowSuggestions = $state(false);
	let genSelectedSuggestionIdx = $state(-1);
	let genHomeError = $state<string | null>(null);
	let genSelectedHome = $state<any>(null);
	let genIsSearching = $state(false);
	let genClearExisting = $state(false);

	async function generateSuggestions(data: {
		startDate: string;
		endDate: string;
		useCustomHomeAddress: boolean;
		customHomeAddress: string | null;
		customHomeAddressGeocode: any | null;
		clearExistingSuggestions: boolean;
	}) {
		isGenerating = true;
		showGenerationModal = false;
		try {
			if (data.clearExistingSuggestions && serviceAdapter) {
				await serviceAdapter.clearAllSuggestedTrips();
				pendingTrips = [];
			}

			const jobData: Record<string, unknown> = {};
			if (data.startDate) jobData.startDate = data.startDate;
			if (data.endDate) jobData.endDate = data.endDate;
			if (data.useCustomHomeAddress && data.customHomeAddressGeocode) {
				jobData.home_address = data.customHomeAddressGeocode;
			}

			const { error } = await fluxbase.jobs.submit('trip-generation', jobData, {
				namespace: 'wayli',
				priority: 5
			});
			if (error) throw error;

			toast.success(t('travel.generatingSuggestions'));

			// Poll for new pending trips until they appear
			const prevCount = pendingTrips.length;
			let attempts = 0;
			const poll = setInterval(async () => {
				attempts++;
				await loadPendingTrips();
				if (pendingTrips.length > prevCount || attempts > 60) {
					clearInterval(poll);
					if (pendingTrips.length > prevCount) {
						toast.success(`${pendingTrips.length - prevCount} new trip suggestion(s) ready!`);
					}
				}
			}, 5000);
		} catch (err) {
			console.error('Generation failed:', err);
			toast.error(t('travel.generationFailed'));
		} finally {
			isGenerating = false;
		}
	}

	// ── Entry editor ──
	function openNewEditor(tripId: string) {
		editingEntry = null;
		editorTripId = tripId;
		editorTitle = '';
		editorBlocks = [{ t: 'text', md: '' }];
		editorMedia = [];
		editorCoverId = null;
		editorDate = new Date().toISOString().slice(0, 10);
		editorEndDate = '';
		editorStatus = 'published';
		editorInlineMediaIds = [];
		showEditor = true;
	}

	async function openEditEditor(entry: JournalEntry) {
		editingEntry = entry;
		editorTripId = entry.trip_id;
		editorTitle = entry.title;
		editorDate = entry.entry_date?.slice(0, 10) ?? '';
		editorEndDate = entry.end_date?.slice(0, 10) ?? '';
		editorStatus = (entry.status as 'published' | 'draft') ?? 'published';
		editorCoverId = entry.cover_media_id ?? null;
		editorInlineMediaIds = [];
		try {
			editorMedia = (await listMedia(entry.trip_id)).filter((m) => m.entry_id === entry.id);
		} catch (err) {
			console.error('Failed to load entry media:', err);
			editorMedia = [];
		}
		const effective = effectiveBlocks(
			{ body: entry.body, blocks: normalizeEntryBlocks(entry.blocks) },
			editorMedia
		);
		editorBlocks = effective.map((b) => ({ ...b }));
		if (editorBlocks.length === 0) editorBlocks = [{ t: 'text', md: '' }];
		showEditor = true;
	}

	/**
	 * Upload picked photos for the editor. Existing entries link the media
	 * rows immediately; new entries attach theirs when the entry is saved.
	 * Resolves with the created media ids (appended as a photo block).
	 */
	async function handleAddPhotos(files: File[]): Promise<string[]> {
		if (!$userStore?.id || !editorTripId) throw new Error('No trip selected');
		const createdIds: string[] = [];
		for (const file of files) {
			const { full, thumbnail } = await compressImage(file);
			const timestamp = Date.now();
			const fullPath = await uploadMedia(
				$userStore.id,
				editorTripId,
				full.blob,
				`${timestamp}-${file.name}`
			);
			const thumbPath = await uploadMedia(
				$userStore.id,
				editorTripId,
				thumbnail.blob,
				`${timestamp}-thumb-${file.name}`
			);
			const created = await createMedia({
				user_id: $userStore.id,
				trip_id: editorTripId,
				entry_id: editingEntry?.id ?? undefined,
				storage_path: fullPath,
				thumbnail_path: thumbPath,
				width: full.width,
				height: full.height,
				taken_at: full.takenAt ?? undefined,
				exif: full.exif ?? undefined
			});
			if (!editingEntry) editorInlineMediaIds = [...editorInlineMediaIds, created.id];
			editorMedia = [...editorMedia, created];
			createdIds.push(created.id);
		}
		return createdIds;
	}

	/** Delete a media row removed from a photo block (after inline confirm). */
	async function handleEditorDeletePhoto(mediaId: string): Promise<void> {
		const row = editorMedia.find((m) => m.id === mediaId);
		editorMedia = editorMedia.filter((m) => m.id !== mediaId);
		editorInlineMediaIds = editorInlineMediaIds.filter((id) => id !== mediaId);
		if (editorCoverId === mediaId) editorCoverId = null;
		if (row) {
			await deleteMediaRow(row);
			const cached = mediaCache.get(row.trip_id);
			if (cached) {
				mediaCache.set(
					row.trip_id,
					cached.filter((m) => m.id !== mediaId)
				);
			}
		}
	}

	function handleEditorSetCover(mediaId: string) {
		editorCoverId = mediaId;
		handleSetCover(mediaId);
	}

	/** Drop blank text blocks and empty photo blocks before saving. */
	function cleanEditorBlocks(): EntryBlock[] {
		return editorBlocks
			.map((b) => (b.t === 'text' ? { t: 'text' as const, md: b.md.trim() } : b))
			.filter((b) => b.t === 'photos' || b.md !== '')
			.filter((b) => b.t === 'text' || b.ids.length > 0);
	}

	async function saveEntry(status?: 'published' | 'draft') {
		const saveAs = status ?? editorStatus;
		if (!$userStore?.id || !editorTripId || !editorDate) return;
		isSaving = true;
		try {
			const cleaned = cleanEditorBlocks();
			const mediaMap = new Map<string, BlockMedia>(
				editorMedia.map((m) => [
					m.id,
					{ id: m.id, storage_path: m.storage_path, caption: m.caption }
				])
			);
			const body = legacyBodyFromBlocks(cleaned, mediaMap);
			const blocksPayload = cleaned.length > 0 ? { v: 1 as const, blocks: cleaned } : null;
			if (editingEntry) {
				const updated = await updateEntry(editingEntry.id, {
					title: editorTitle,
					body,
					blocks: blocksPayload,
					entry_date: editorDate,
					end_date: editorEndDate || null,
					status: saveAs
				});
				entries = entries.map((e) => (e.id === updated.id ? { ...e, ...updated } : e));
			} else {
				const created = await createEntry($userStore.id, {
					trip_id: editorTripId,
					title: editorTitle,
					body,
					blocks: blocksPayload,
					entry_date: editorDate,
					end_date: editorEndDate || null,
					status: saveAs,
					cover_media_id: editorCoverId
				} as any);
				// Photos placed before the entry existed — link them now.
				await attachMediaToEntry(created.id, editorInlineMediaIds);
				editorInlineMediaIds = [];
				await loadEntries();
			}
			// Keep trip_media.sort_order aligned with the block order so legacy
			// cover-from-first-media fallbacks match the visual order.
			const orderedIds: string[] = [];
			for (const b of cleaned) if (b.t === 'photos') orderedIds.push(...b.ids);
			const orderedRows = editorMedia
				.filter((m) => orderedIds.includes(m.id))
				.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
			if (orderedRows.length > 0) {
				await reorderMedia(orderedRows).catch(() => {});
				const tripId = orderedRows[0].trip_id;
				mediaCache.delete(tripId);
			}
			showEditor = false;
			setTimeout(() => setupObserver(), 100);
		} catch (err) {
			console.error('Save failed:', err);
			toast.error(t('travel.saveEntryFailed'));
		} finally {
			isSaving = false;
		}
	}

	// ── Destructive actions ask through the styled modal, not window.confirm ──
	let pendingDeleteEntry = $state<JournalEntry | null>(null);
	let pendingDeleteTripId = $state<string | null>(null);

	async function handleDeleteEntry(entry: JournalEntry) {
		pendingDeleteEntry = entry;
	}

	async function confirmDeleteEntry() {
		const entry = pendingDeleteEntry;
		pendingDeleteEntry = null;
		if (!entry) return;
		try {
			await deleteEntry(entry.id);
			entries = entries.filter((e) => e.id !== entry.id);
		} catch (err) {
			console.error('Delete failed:', err);
		}
	}

	async function handleSetCover(mediaId: string, photoUrl?: string) {
		if (!editingEntry) return;
		try {
			await updateEntry(editingEntry!.id, { cover_media_id: mediaId });
			editingEntry = { ...editingEntry!, cover_media_id: mediaId };
			entries = entries.map((e) =>
				e.id === editingEntry!.id
					? { ...e, cover_media_id: mediaId, cover_image_url: photoUrl ?? e.cover_image_url }
					: e
			);
		} catch (err) {
			console.error('Failed to set cover:', err);
		}
	}

	// ── Suggestion approve/reject ──
	async function approveSuggestion(tripId: string) {
		approvingIds = new Set([...approvingIds, tripId]);
		try {
			if (serviceAdapter) {
				const imageResults = await serviceAdapter.generateSuggestedTripImages([tripId]);
				const preGenerated: Record<string, { image_url: string; attribution?: unknown }> = {};
				for (const r of imageResults.results) {
					if (r.success && r.image_url) {
						preGenerated[r.suggested_trip_id] = {
							image_url: r.image_url,
							attribution: r.attribution
						};
					}
				}
				await serviceAdapter.approveSuggestedTrips([tripId], preGenerated);
			}
			pendingTrips = pendingTrips.filter((t) => t.id !== tripId);
			await loadTrips();
			await loadGpsData(); // rebuilds city markers from the new trip's metadata
			toast.success(t('travel.tripApproved'));
		} catch (err) {
			console.error('Approve failed:', err);
			toast.error(t('travel.approveFailed'));
		} finally {
			const next = new Set(approvingIds);
			next.delete(tripId);
			approvingIds = next;
		}
	}

	async function rejectSuggestion(tripId: string) {
		try {
			if (serviceAdapter) {
				await serviceAdapter.rejectSuggestedTrips([tripId]);
			}
			pendingTrips = pendingTrips.filter((t) => t.id !== tripId);
		} catch (err) {
			console.error('Reject failed:', err);
		}
	}

	async function approveAll() {
		const ids = pendingTrips.map((t) => t.id);
		if (ids.length === 0) return;
		approvingIds = new Set(ids);
		try {
			if (serviceAdapter) {
				const imageResults = await serviceAdapter.generateSuggestedTripImages(ids);
				const preGenerated: Record<string, { image_url: string; attribution?: unknown }> = {};
				for (const r of imageResults.results) {
					if (r.success && r.image_url) {
						preGenerated[r.suggested_trip_id] = {
							image_url: r.image_url,
							attribution: r.attribution
						};
					}
				}
				await serviceAdapter.approveSuggestedTrips(ids, preGenerated);
			}
			pendingTrips = [];
			await loadTrips();
			await loadGpsData();
			toast.success(t('travel.tripsApproved').replace('{count}', String(ids.length)));
		} catch (err) {
			console.error('Approve all failed:', err);
		} finally {
			approvingIds = new Set();
		}
	}

	async function rejectAll() {
		const ids = pendingTrips.map((t) => t.id);
		if (ids.length === 0) return;
		try {
			if (serviceAdapter) {
				await serviceAdapter.rejectSuggestedTrips(ids);
			}
			pendingTrips = [];
		} catch (err) {
			console.error('Reject all failed:', err);
		}
	}

	// ponytail: AI assistant accept handler for trip suggestions (target:'trip').
	// Approve/reject delegate to the existing approveSuggestion/rejectSuggestion
	// so the FULL pipeline runs (cover image, embeddings, visit re-detect) — the
	// assistant never short-circuits those side effects. Create uses the
	// create-trip RPC; update uses the trips service.
	async function handleTripSuggestion(item: PlanSuggestion) {
		try {
			if (item.action === 'approve' && item.item_id) {
				await approveSuggestion(item.item_id);
				return;
			}
			if (item.action === 'reject' && item.item_id) {
				await rejectSuggestion(item.item_id);
				return;
			}
			if (item.action === 'create') {
				const { data, error } = await fluxbase.rpc.invoke('create-trip', {
					title: item.title,
					start_date: item.start_date,
					end_date: item.end_date || item.start_date,
					description: item.description || null,
					primary_city: item.primary_city || null
				});
				if (error) throw error;
				await loadTrips();
				toast.success(t('travel.tripCreated'));
				return;
			}
			if (item.action === 'update' && item.item_id) {
				const tripsService = await getTripsService();
				const changes = item.changes ?? {};
				await tripsService.updateTrip({
					id: item.item_id,
					title: changes.title,
					description: undefined as any
				} as any);
				await loadTrips();
				toast.success(t('travel.tripUpdated'));
				return;
			}
		} catch (err) {
			console.error('AI trip suggestion failed:', err);
			toast.error(t('travel.saveTripFailed'));
		}
	}

	// ── New trip creation ──
	function openTripModal() {
		editingTrip = null;
		tripTitle = '';
		tripStartDate = '';
		tripEndDate = '';
		tripDescription = '';
		tripImageUrl = null;
		tripImageAttribution = null;
		tripCostsVisible = 'private';
		tripGpsVisible = 'private';
		tripCommentsAllowed = 'friends';
		tripShares = [];
		showTripModal = true;
	}

	async function loadTripSharingData(trip: Trip) {
		try {
			const [shares, friends] = await Promise.all([
				getTripShares(trip.id),
				$userStore?.id ? getFriends($userStore.id) : Promise.resolve([])
			]);
			tripShares = shares;
			tripFriends = friends;
			tripCostsVisible = (trip as any).costs_visible_to ?? 'private';
			tripGpsVisible = (trip as any).gps_visible_to ?? 'private';
			tripCommentsAllowed = (trip as any).comments_allowed ?? 'friends';
		} catch {
			// non-critical
		}
	}

	function openEditTripModal(trip: Trip) {
		editingTrip = trip;
		tripTitle = trip.title;
		tripStartDate = (trip.start_date || '').slice(0, 10);
		tripEndDate = (trip.end_date || '').slice(0, 10);
		tripDescription = trip.description ?? '';
		tripImageUrl = trip.image_url;
		tripImageAttribution = trip.metadata?.image_attribution ?? null;
		showTripModal = true;
		loadTripSharingData(trip);
	}

	async function saveTrip() {
		if (!tripTitle || !tripStartDate) return;
		isCreatingTrip = true;
		try {
			const tripsService = await getTripsService();
			if (editingTrip) {
				const editId = editingTrip.id;
				const editMeta = editingTrip.metadata;
				const newMetadata = {
					...(editMeta ?? {}),
					image_attribution: tripImageAttribution
				};
				await tripsService.updateTrip({
					id: editId,
					title: tripTitle,
					start_date: tripStartDate,
					end_date: tripEndDate || tripStartDate,
					description: tripDescription,
					image_url: tripImageUrl,
					metadata: newMetadata,
					costs_visible_to: tripCostsVisible,
					gps_visible_to: tripGpsVisible,
					comments_allowed: tripCommentsAllowed
				} as any);
				trips = trips.map((t) =>
					t.id === editId
						? {
								...t,
								title: tripTitle,
								start_date: tripStartDate,
								end_date: tripEndDate || tripStartDate,
								description: tripDescription,
								image_url: tripImageUrl,
								metadata: newMetadata,
								costs_visible_to: tripCostsVisible,
								gps_visible_to: tripGpsVisible,
								comments_allowed: tripCommentsAllowed
							}
						: t
				);
			} else {
				const { data: userData } = await fluxbase.auth.getUser();
				const userId = userData?.user?.id;
				if (!userId) throw new Error('Not authenticated');

				const { error: createError } = await fluxbase.from('trips').insert({
					user_id: userId,
					title: tripTitle,
					start_date: tripStartDate,
					end_date: tripEndDate || tripStartDate,
					description: tripDescription || null,
					image_url: tripImageUrl || null,
					status: 'planned',
					visibility: 'private'
				});
				if (createError) throw createError;
				await loadTrips();
			}
			showTripModal = false;
			toast.success(editingTrip ? t('travel.tripUpdated') : t('travel.tripCreated'));
		} catch (err) {
			console.error('Save trip failed:', err);
			toast.error(t('travel.saveTripFailed'));
		} finally {
			isCreatingTrip = false;
		}
	}

	async function handleTripImageUpload(file: File) {
		if (!$userStore?.id) return;
		isUploadingImage = true;
		try {
			const { data: userData } = await fluxbase.auth.getUser();
			const userId = userData?.user?.id;
			if (!userId) return;

			const compressed = await compressImage(file, { maxEdge: 1200, quality: 0.8 });
			const filename = `cover-${Date.now()}.jpg`;
			const url = await uploadMedia(userId, 'covers', compressed.full.blob, filename);
			tripImageUrl = url;
			tripImageAttribution = null;
			toast.success(t('travel.imageUploaded'));
		} catch (err) {
			console.error('Upload failed:', err);
			toast.error(t('travel.uploadFailed'));
		} finally {
			isUploadingImage = false;
		}
	}

	async function fetchPexelsImage() {
		try {
			if (!serviceAdapter) {
				toast.error(t('travel.serviceUnavailable'));
				return;
			}

			// Pexels fetch requires a saved trip (needs trip_id for the suggestion API).
			// For new trips, tell the user to save first instead of silently inserting.
			let tripIdForFetch = editingTrip?.id;
			if (!tripIdForFetch) {
				toast.info(
					t('travel.saveBeforePexels') || 'Save the trip first, then fetch a cover image.'
				);
				return;
			}
			toast.info(t('travel.fetchingFromPexels'));
			const result = await serviceAdapter.suggestTripImages(tripIdForFetch!);
			const data =
				result && typeof result === 'object' && 'data' in result ? (result as any).data : result;
			if (data?.suggestedImageUrl) {
				tripImageUrl = data.suggestedImageUrl;
				tripImageAttribution = data.attribution ?? null;
				toast.success(t('travel.imageFound'));
			} else {
				toast.error(t('travel.noImageFound'));
			}
		} catch (err) {
			console.error('Pexels fetch failed:', err);
			toast.error(t('travel.fetchImageFailed'));
		}
	}

	// ── Trip management ──
	async function fetchTripImage(trip: Trip) {
		try {
			if (!serviceAdapter) {
				toast.error(t('travel.serviceUnavailable'));
				return;
			}
			toast.info(t('travel.fetchingCoverImage'));
			const result = await serviceAdapter.suggestTripImages(trip.id);
			const data =
				result && typeof result === 'object' && 'data' in result ? (result as any).data : result;
			const imageUrl = data?.suggestedImageUrl;
			if (!imageUrl) {
				toast.error(t('travel.noImageFound'));
				return;
			}
			const attribution = data?.attribution;
			const newMetadata = { ...(trip.metadata ?? {}), image_attribution: attribution };
			await fluxbase
				.from('trips')
				.update({ image_url: imageUrl, metadata: newMetadata })
				.eq('id', trip.id);
			trips = trips.map((t) =>
				t.id === trip.id ? { ...t, image_url: imageUrl, metadata: newMetadata } : t
			);
			toast.success(t('travel.coverImageAdded'));
		} catch (err) {
			console.error('Fetch image failed:', err);
			toast.error(t('travel.fetchCoverFailed'));
		}
	}

	async function deleteTrip(tripId: string) {
		pendingDeleteTripId = tripId;
	}

	async function confirmDeleteTrip() {
		const tripId = pendingDeleteTripId;
		pendingDeleteTripId = null;
		if (!tripId) return;
		try {
			const tripsService = await getTripsService();
			await tripsService.deleteTrip(tripId);
			trips = trips.filter((t) => t.id !== tripId);
			entries = entries.filter((e) => e.trip_id !== tripId);
			if (activeTripId === tripId) activeTripId = null;
			toast.success(t('travel.tripDeleted'));
		} catch (err) {
			console.error('Delete trip failed:', err);
		}
	}

	// Sum total distance (meters) for a trip's date window. Prefer the
	// tracker_daily_activity cache (one indexed range scan) over paging raw
	// tracker_data rows — it's the same source the Statistics page relies on.
	// Falls back to the raw per-row distance sum when the cache is empty for the
	// range (e.g. a fresh user whose refresh-daily-activity job hasn't run yet).
	async function sumTripDistance(
		userId: string,
		startDate: string,
		endDate: string
	): Promise<number> {
		const sd = (startDate || '').slice(0, 10);
		const ed = (endDate || '').slice(0, 10);

		// 1. Try the daily aggregate cache.
		try {
			const { data, error } = await fluxbase
				.from<Record<string, any>>('tracker_daily_activity')
				.select('distance')
				.eq('user_id', userId)
				.gte('day', sd)
				.lte('day', ed);
			if (!error && data && data.length > 0) {
				return data.reduce(
					(sum: number, row: Record<string, any>) =>
						sum + (typeof row.distance === 'number' ? row.distance : 0),
					0
				);
			}
		} catch {
			// fall through to raw paging
		}

		// 2. Fallback: page raw tracker_data.distance (legacy path).
		let total = 0;
		let offset = 0;
		while (true) {
			const { data } = await fluxbase
				.from<Record<string, any>>('tracker_data')
				.select('distance')
				.eq('user_id', userId)
				.gte('recorded_at', `${sd}T00:00:00Z`)
				.lte('recorded_at', `${ed}T23:59:59Z`)
				.range(offset, offset + 999);
			const batch = (data as any[]) ?? [];
			if (batch.length === 0) break;
			total += batch.reduce(
				(sum, row) => sum + (typeof row.distance === 'number' ? row.distance : 0),
				0
			);
			if (batch.length < 1000) break;
			offset += 1000;
		}
		return total;
	}

	async function recalculateDistance(trip: Trip) {
		try {
			const { data: userData } = await fluxbase.auth.getUser();
			const userId = userData?.user?.id;
			if (!userId) return;

			const total = await sumTripDistance(userId, trip.start_date, trip.end_date);

			const newMetadata = { ...(trip.metadata ?? {}), distanceTraveled: Math.round(total) };
			await fluxbase.from('trips').update({ metadata: newMetadata }).eq('id', trip.id);
			trips = trips.map((t) => (t.id === trip.id ? { ...t, metadata: newMetadata } : t));
			toast.success(`Distance updated: ${(total / 1000).toFixed(0)} km`);
		} catch (err) {
			console.error('Recalculate failed:', err);
			toast.error(t('travel.recalcDistanceFailed'));
		}
	}

	async function recalculateAllDistances() {
		isRecalculating = true;
		try {
			const { data: userData } = await fluxbase.auth.getUser();
			const userId = userData?.user?.id;
			if (!userId) return;

			for (const trip of trips) {
				const total = await sumTripDistance(userId, trip.start_date, trip.end_date);
				const newMetadata = { ...(trip.metadata ?? {}), distanceTraveled: Math.round(total) };
				await fluxbase.from('trips').update({ metadata: newMetadata }).eq('id', trip.id);
			}

			await loadTrips();
			toast.success(`Recalculated distance for ${trips.length} trips`);
		} catch (err) {
			console.error('Recalculate all failed:', err);
			toast.error(t('travel.recalcFailed'));
		} finally {
			isRecalculating = false;
		}
	}

	async function toggleVisibility(tripId: string, current: string) {
		const next = current === 'private' ? 'friends' : current === 'friends' ? 'public' : 'private';
		try {
			await fluxbase.from('trips').update({ visibility: next }).eq('id', tripId);
			trips = trips.map((t) => (t.id === tripId ? { ...t, visibility: next } : t));
		} catch (err) {
			console.error('Visibility toggle failed:', err);
		}
	}

	// ── Helpers ──
	function formatDistance(meters: number): string {
		if (!meters) return '';
		if (meters < 1000) return `${Math.round(meters)} m`;
		return `${(meters / 1000).toFixed(0)} km`;
	}

	function tripDuration(start: string, end: string): number {
		const days = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
		return Math.max(1, days + 1);
	}
</script>

<svelte:head>
	<title>{t('travel.pageTitle')}</title>
</svelte:head>

{#if isLoading}
	<div class="flex min-h-[60vh] items-center justify-center">
		<div class="border-primary h-10 w-10 animate-spin rounded-full border-2"></div>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-3">
				<Globe class="text-primary h-6 w-6" />
				<div>
					<h1 class="text-foreground text-xl font-bold">{t('travel.heading')}</h1>
					<p class="text-muted-foreground text-sm">
						{trips.length}
						{trips.length === 1 ? 'trip' : 'trips'}
						{#if entries.length > 0}· {entries.length} entries{/if}
						{#if pendingCount > 0}
							· <span class="font-medium text-amber-500">{pendingCount} suggested</span>
						{/if}
					</p>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if publicJournalUrl}
					<a
						href={publicJournalUrl}
						target="_blank"
						rel="noopener"
						aria-label="Public journal"
						class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
					>
						<ExternalLink class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Public</span>
					</a>
				{/if}
				<button
					type="button"
					onclick={() => (showGenerationModal = true)}
					disabled={isGenerating}
					aria-label="Auto-detect trips"
					class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
					title="Detect new trips from your location data"
				>
					{#if isGenerating}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						<span class="hidden sm:inline">Generating...</span>
					{:else}
						<Sparkles class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Auto-detect Trips</span>
					{/if}
				</button>
				{#if trips.length > 0}
					<button
						type="button"
						onclick={recalculateAllDistances}
						disabled={isRecalculating}
						aria-label="Refresh all"
						class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
						title="Recalculate distance for all trips"
					>
						{#if isRecalculating}
							<Loader2 class="h-3.5 w-3.5 animate-spin" />
						{:else}
							<RefreshCw class="h-3.5 w-3.5" />
						{/if}
						<span class="hidden sm:inline">Refresh All</span>
					</button>
				{/if}
				<button
					type="button"
					onclick={openTripModal}
					class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
				>
					<Plus class="h-4 w-4" />
					New Trip
				</button>
			</div>
		</div>

		<!-- World map of visited countries -->
		{#if visitedCountries.length > 0}
			<div class="bg-card border-border mb-4 rounded-2xl border p-4">
				<div class="mb-3 flex items-center justify-between">
					<h3 class="text-foreground text-sm font-bold tracking-wide uppercase">Where I've Been</h3>
					<span class="text-muted-foreground text-xs">
						{visitedCountries.length}
						{visitedCountries.length === 1 ? 'country' : 'countries'}
					</span>
				</div>
				<WorldMap {visitedCountries} class="h-64" />
			</div>
		{/if}

		<!-- Split layout: timeline + sticky map -->
		<div class="grid gap-6 lg:grid-cols-[1fr_400px]">
			<!-- Timeline (scrollable, left) -->
			<div class="space-y-5">
				<!-- Pending suggestions (collapsible) -->
				{#if pendingTrips.length > 0}
					<div
						class="rounded-2xl border-2 border-dashed border-amber-300/40 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-950/10"
					>
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<div
							role="button"
							tabindex="0"
							onclick={() => (suggestionsExpanded = !suggestionsExpanded)}
							onkeydown={(e) => e.key === 'Enter' && (suggestionsExpanded = !suggestionsExpanded)}
							class="flex w-full cursor-pointer items-center justify-between p-4 transition-colors hover:bg-amber-100/30 dark:hover:bg-amber-950/20"
						>
							<div class="flex items-center gap-2">
								<Sparkles class="h-4 w-4 text-amber-500" />
								<span class="text-foreground text-sm font-semibold">
									{pendingCount} suggested {pendingCount === 1 ? 'trip' : 'trips'}
								</span>
							</div>
							<div class="flex items-center gap-3">
								{#if suggestionsExpanded}
									<button
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											rejectAll();
										}}
										class="border-border text-muted-foreground hover:text-destructive rounded-lg border px-3 py-1 text-xs font-medium transition-colors"
									>
										Reject All
									</button>
									<button
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											approveAll();
										}}
										class="rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-600"
									>
										Approve All
									</button>
								{/if}
								{#if suggestionsExpanded}
									<ChevronDown class="text-muted-foreground h-5 w-5" />
								{:else}
									<ChevronRight class="text-muted-foreground h-5 w-5" />
								{/if}
							</div>
						</div>
						{#if suggestionsExpanded}
							<div class="space-y-3 px-4 pb-4">
								{#each pendingTrips as trip (trip.id)}
									<div class="bg-card border-border flex items-center gap-3 rounded-xl border p-3">
										<div class="flex-1">
											<h3 class="text-foreground text-sm font-semibold">{trip.title}</h3>
											<p class="text-muted-foreground text-xs">
												{new Date(trip.start_date).toLocaleDateString(undefined, {
													month: 'short',
													day: 'numeric',
													year: 'numeric'
												})}
												– {new Date(trip.end_date).toLocaleDateString(undefined, {
													month: 'short',
													day: 'numeric',
													year: 'numeric'
												})}
												{#if trip.metadata?.distanceTraveled}
													· {formatDistance(trip.metadata.distanceTraveled)}
												{/if}
												{#if trip.metadata?.primaryCity}
													· {trip.metadata.primaryCity}
												{/if}
											</p>
										</div>
										{#if approvingIds.has(trip.id)}
											<Loader2 class="text-muted-foreground h-4 w-4 animate-spin" />
										{:else}
											<button
												type="button"
												onclick={() => approveSuggestion(trip.id)}
												class="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-3 py-1 text-xs font-medium transition-colors"
											>
												Approve
											</button>
											<button
												type="button"
												onclick={() => rejectSuggestion(trip.id)}
												class="text-muted-foreground hover:text-destructive rounded-lg px-2 py-1 text-xs transition-colors"
											>
												<X class="h-4 w-4" />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Filter chips -->
				{#if trips.length > 0}
					<div class="mb-4 flex flex-wrap gap-2">
						{#each [['all', 'All trips'], ['withJournal', 'With journal'], ['withDrafts', 'Drafts'], ['hasPhotos', 'With photos']] as [value, label] (value)}
							<button
								type="button"
								onclick={() => (activeFilter = value as typeof activeFilter)}
								class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {activeFilter ===
								value
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border text-muted-foreground hover:text-foreground'}"
							>
								{label}
							</button>
						{/each}
					</div>
				{/if}

				<!-- Trip sections -->
				{#if filteredTrips.length === 0}
					<div class="flex flex-col items-center justify-center py-20 text-center">
						<Route class="text-muted-foreground mb-4 h-12 w-12 opacity-30" />
						<p class="text-muted-foreground text-lg">{t('travel.noTrips')}</p>
						<p class="text-muted-foreground mt-1 text-sm">
							Import location data or create a trip manually.
						</p>
					</div>
				{:else}
					{#each visibleTrips as trip, i (trip.id)}
						<div
							data-trip-id={trip.id}
							class="bg-card border-border animate-fade-in-up scroll-mt-4 overflow-hidden rounded-2xl border"
							style="animation-delay: {Math.min(i * 60, 400)}ms"
						>
							<!-- Trip header -->
							<button
								type="button"
								onclick={() => toggleTrip(trip.id)}
								class="hover:bg-muted/50 flex w-full items-center gap-4 p-4 text-left transition-colors"
							>
								<!-- Cover thumbnail -->
								<div class="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl">
									{#if trip.image_url}
										<img
											src={storageRefToUrl(trip.image_url)}
											alt={trip.title}
											class="h-full w-full object-cover"
											loading="eager"
											onerror={(e) => {
												(e.target as HTMLImageElement).style.display = 'none';
												(e.target as HTMLImageElement).nextElementSibling?.classList.remove(
													'hidden'
												);
											}}
										/>
									{:else}
										<div
											class="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-500 to-slate-700"
										>
											<Route class="h-6 w-6 text-white/50" />
										</div>
									{/if}
								</div>

								<!-- Trip info -->
								<div class="min-w-0 flex-1">
									<h2 class="text-foreground truncate font-bold">{trip.title}</h2>
									<div
										class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
									>
										<span class="flex items-center gap-1">
											<Calendar class="h-3 w-3" />
											{new Date(trip.start_date).toLocaleDateString(undefined, {
												month: 'short',
												day: 'numeric',
												year: 'numeric'
											})}
											– {new Date(trip.end_date).toLocaleDateString(undefined, {
												month: 'short',
												day: 'numeric',
												year: 'numeric'
											})}
										</span>
										{#if trip.metadata?.distanceTraveled}
											<span class="flex items-center gap-1">
												<Route class="h-3 w-3" />
												{formatDistance(trip.metadata.distanceTraveled)}
											</span>
										{/if}
										{#if trip.metadata?.primaryCity}
											<span class="flex items-center gap-1">
												<MapPin class="h-3 w-3" />
												{trip.metadata.primaryCity}
											</span>
										{/if}
										{#if trip.metadata?.image_attribution?.photographer}
											<span class="text-muted-foreground/60 text-[10px]">
												Photo: {trip.metadata.image_attribution.photographer}/Pexels
											</span>
										{/if}
									</div>
								</div>

								<!-- Expand/collapse chevron -->
								{#if expandedTrips.has(trip.id)}
									<ChevronDown class="text-muted-foreground h-5 w-5 flex-shrink-0" />
								{:else}
									<ChevronRight class="text-muted-foreground h-5 w-5 flex-shrink-0" />
								{/if}
							</button>

							<!-- Trip actions bar (always visible) -->
							<div
								class="border-border bg-muted/30 flex flex-wrap items-center gap-1 border-t px-3 py-2 sm:gap-2 sm:px-4"
							>
								<button
									type="button"
									onclick={() => openNewEditor(trip.id)}
									class="text-primary hover:bg-primary/10 inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors"
								>
									<Plus class="h-3 w-3" />
									Add Entry
								</button>
								<a
									href="/dashboard/travel/{trip.id}/plan"
									class="text-primary hover:bg-primary/10 inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors"
								>
									<Calendar class="h-3 w-3" /> Plan
								</a>
								<div class="ml-auto flex flex-wrap items-center gap-1 sm:gap-2">
									<button
										type="button"
										onclick={async () => {
											await recalculateDistance(trip);
											const sd = (trip.start_date || '').slice(0, 10);
											const ed = (trip.end_date || '').slice(0, 10);
											goto(`/dashboard/location-data?trip=${trip.id}&start=${sd}&end=${ed}`);
										}}
										class="text-muted-foreground hover:text-foreground inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
										title="View location data for this trip"
										aria-label="Location data"
									>
										<MapPin class="h-3 w-3" />
										<span class="hidden sm:inline">Location Data</span>
									</button>
									<button
										type="button"
										onclick={() => openEditTripModal(trip)}
										class="text-muted-foreground hover:text-foreground inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
										title="Edit trip"
										aria-label="Edit trip"
									>
										<Pencil class="h-3 w-3" />
										<span class="hidden sm:inline">Edit</span>
									</button>
									<button
										type="button"
										onclick={() => toggleVisibility(trip.id, trip.visibility)}
										class="text-muted-foreground hover:text-foreground inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
										title="Click to cycle: private → friends → public"
										aria-label="Visibility: {trip.visibility}"
									>
										{#if trip.visibility === 'public'}
											<Eye class="h-3 w-3" />
											<span class="hidden sm:inline">Public</span>
										{:else if trip.visibility === 'friends'}
											<Users class="h-3 w-3" />
											<span class="hidden sm:inline">Friends</span>
										{:else}
											<EyeOff class="h-3 w-3" />
											<span class="hidden sm:inline">Private</span>
										{/if}
									</button>
									<button
										type="button"
										onclick={() => deleteTrip(trip.id)}
										class="text-muted-foreground hover:text-destructive inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1 transition-colors"
										title="Delete trip"
										aria-label="Delete trip"
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								</div>
							</div>

							<!-- Expanded entries -->
							{#if expandedTrips.has(trip.id)}
								<div class="border-border border-t">
									<!-- Mobile map inside expanded section. The {#key} forces a
									     clean remount when the active trip changes — otherwise the
									     reused Leaflet container keeps the previous trip's points
									     (invalidateSize never re-runs on the re-parented div). -->
									{#if activeTripId === trip.id && loadingTripGps.has(trip.id)}
										<div
											class="text-muted-foreground border-border flex items-center justify-center gap-2 border-b py-6 text-xs lg:hidden"
										>
											<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{t('common.status.loading')}
										</div>
									{:else if activeTripId === trip.id && (mapPoints.length > 0 || mapMarkers.length > 0 || activeTripRouteSegments.length > 0)}
										<div class="border-border border-b lg:hidden">
											{#key activeTripId}
												<TripMap
													points={mapPoints}
													segments={activeTripRouteSegments}
													markers={mapMarkers}
													{highlightPoints}
													class="h-48"
												/>
											{/key}
										</div>
									{/if}

									<!-- Entries for this trip -->
									{#if (entriesByTrip.get(trip.id) ?? []).length === 0}
										<div class="text-muted-foreground px-4 py-6 text-center text-sm">
											No entries yet. Click "Add Entry" to start writing.
										</div>
									{:else}
										<div class="space-y-3 p-4">
											{#each entriesByTrip.get(trip.id) ?? [] as entry (entry.id)}
												<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
												<div
													data-entry-id={entry.id}
													data-trip-id={trip.id}
													role="button"
													tabindex="0"
													onclick={() => {
														activeEntryId = entry.id;
														activeTripId = trip.id;
													}}
													onkeydown={(e) =>
														e.key === 'Enter' &&
														((activeEntryId = entry.id), (activeTripId = trip.id))}
													class="border-border bg-background rounded-xl border p-4 transition-all {activeEntryId ===
													entry.id
														? 'ring-primary/20 ring-2'
														: ''}"
												>
													<!-- Entry cover photo (pannable) -->
													{#if entry.cover_image_url}
														<div class="mb-3 overflow-hidden rounded-lg">
															<PannableCover
																src={storageRefToUrl(entry.cover_image_url)}
																editable={true}
																onFocalChange={async (x, y) => {
																	// Update entry metadata with focal point
																	try {
																		await fluxbase
																			.from('trip_entries')
																			.update({
																				cover_focal_x: x,
																				cover_focal_y: y
																			})
																			.eq('id', entry.id);
																	} catch {
																		// non-critical
																	}
																}}
																class="h-28 w-full"
															/>
														</div>
													{/if}

													<!-- Date badge -->
													<div class="mb-2 flex items-center gap-2">
														<div
															class="bg-primary/10 text-primary flex h-9 w-9 flex-col items-center justify-center rounded-lg text-[10px] leading-tight font-bold uppercase"
														>
															{new Date(entry.entry_date).toLocaleDateString(undefined, {
																month: 'short'
															})}
															<span class="text-sm font-extrabold">
																{new Date(entry.entry_date).getDate()}
															</span>
														</div>
														<span class="text-muted-foreground text-xs">
															{new Date(entry.entry_date).toLocaleDateString(undefined, {
																weekday: 'long',
																year: 'numeric',
																month: 'long',
																day: 'numeric'
															})}
														</span>
														<div class="flex-1"></div>
														<button
															type="button"
															onclick={() => openEditEditor(entry)}
															class="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
														>
															<Pencil class="h-3.5 w-3.5" />
														</button>
														<button
															type="button"
															onclick={() => handleDeleteEntry(entry)}
															class="text-muted-foreground hover:text-destructive rounded p-1 transition-colors"
														>
															<Trash2 class="h-3.5 w-3.5" />
														</button>
													</div>

													{#if entry.title}
														<h3 class="text-foreground mb-1 flex items-center gap-2 font-semibold">
															{entry.title}
															{#if entry.status === 'draft'}
																<span
																	class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600"
																	>DRAFT</span
																>
															{/if}
														</h3>
													{/if}
													{#if mediaForEntry(trip.id, entry.id).length > 0 || entry.body}
														{@const entryMedia = mediaForEntry(trip.id, entry.id)}
														{@const effectiveEntryBlocks = effectiveBlocks(
															{ body: entry.body, blocks: normalizeEntryBlocks(entry.blocks) },
															entryMedia
														)}
														{#if effectiveEntryBlocks.length > 0}
															<div class="mb-3">
																<EntryBlocksView
																	blocks={effectiveEntryBlocks}
																	mediaById={viewMediaMap(entryMedia)}
																/>
															</div>
														{/if}
													{/if}

													<!-- Engagement -->
													<div class="border-border mt-3 flex items-start gap-3 border-t pt-2">
														<EntryLikeButton tripId={trip.id} entryId={entry.id} />
														<div class="flex-1">
															<EntryComments tripId={trip.id} entryId={entry.id} />
														</div>
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}

				<!-- Pagination -->
				{#if totalTripPages > 1}
					<div class="mt-6 flex items-center justify-center gap-4">
						<button
							type="button"
							onclick={() => (currentPage = Math.max(1, currentPage - 1))}
							disabled={currentPage === 1}
							class="border-border text-foreground hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
						>
							← Prev
						</button>
						<span class="text-muted-foreground text-sm">
							Page {currentPage} of {totalTripPages}
						</span>
						<button
							type="button"
							onclick={() => (currentPage = Math.min(totalTripPages, currentPage + 1))}
							disabled={currentPage === totalTripPages}
							class="border-border text-foreground hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
						>
							Next →
						</button>
					</div>
				{/if}

				<!-- Delete confirmations (styled modal, not window.confirm) -->
				<ConfirmationModal
					open={pendingDeleteEntry !== null}
					title={t('travel.confirmDeleteEntry')}
					message={t('trips.deleteConfirmation', {
						title: pendingDeleteEntry?.title || pendingDeleteEntry?.trip_title || ''
					})}
					confirmText={t('common.actions.delete')}
					cancelText={t('common.actions.cancel')}
					variant="danger"
					onConfirm={confirmDeleteEntry}
					onCancel={() => (pendingDeleteEntry = null)}
				/>
				<ConfirmationModal
					open={pendingDeleteTripId !== null}
					title={t('travel.confirmDeleteTrip')}
					message={t('trips.deleteConfirmation', {
						title: trips.find((tr) => tr.id === pendingDeleteTripId)?.title ?? ''
					})}
					confirmText={t('common.actions.delete')}
					cancelText={t('common.actions.cancel')}
					variant="danger"
					onConfirm={confirmDeleteTrip}
					onCancel={() => (pendingDeleteTripId = null)}
				/>

				<!-- Entry editor modal -->
				{#if showEditor}
					<div
						class="bg-background/80 fixed inset-0 z-50 flex items-start justify-center p-4 backdrop-blur-sm sm:items-center"
					>
						<div
							class="border-border bg-card mt-0 w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border p-4 shadow-2xl sm:mt-0 sm:p-6"
							style="max-height: calc(100dvh - 2rem)"
						>
							<div class="flex items-center justify-between">
								<h2 class="text-foreground text-lg font-bold">
									{editingEntry ? 'Edit Entry' : 'New Entry'}
								</h2>
								<button
									type="button"
									onclick={() => (showEditor = false)}
									class="text-muted-foreground hover:text-foreground"
								>
									<X class="h-5 w-5" />
								</button>
							</div>

							<div class="flex flex-col gap-1">
								<span class="text-muted-foreground text-xs font-medium">Date range</span>
								<DateRangePicker
									bind:startDate={editorDate}
									bind:endDate={editorEndDate}
									pickLabel="Pick a date"
								/>
							</div>

							<input
								type="text"
								bind:value={editorTitle}
								placeholder="Entry title (optional)"
								class="border-border focus:ring-primary w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:outline-none"
							/>

							<EntryBlockEditor
								bind:blocks={editorBlocks}
								mediaById={viewMediaMap(editorMedia)}
								coverMediaId={editorCoverId}
								onSetCover={handleEditorSetCover}
								onAddPhotos={handleAddPhotos}
								onDeletePhoto={handleEditorDeletePhoto}
								disabled={isSaving}
							/>

							<div class="flex justify-end gap-2">
								<button
									type="button"
									onclick={() => (showEditor = false)}
									class="border-border text-foreground hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
								>
									Cancel
								</button>
								<button
									type="button"
									onclick={() => saveEntry('draft')}
									disabled={isSaving || !editorDate}
									class="border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
								>
									{#if isSaving}
										<Loader2 class="h-4 w-4 animate-spin" />
									{:else}
										<Save class="h-4 w-4" />
									{/if}
									Save Draft
								</button>
								<button
									type="button"
									onclick={() => saveEntry('published')}
									disabled={isSaving || !editorDate}
									class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
								>
									{#if isSaving}
										<Loader2 class="h-4 w-4 animate-spin" />
										Saving...
									{:else}
										<Save class="h-4 w-4" />
										Publish
									{/if}
								</button>
							</div>
						</div>
					</div>
				{/if}

				<!-- New trip modal -->
				{#if showTripModal}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						role="dialog"
						tabindex="-1"
						class="bg-background/80 fixed inset-0 z-50 flex items-start justify-center p-4 backdrop-blur-sm sm:items-center"
						onkeydown={(e) => e.key === 'Escape' && (showTripModal = false)}
					>
						<div
							class="border-border bg-card mt-0 w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border p-4 shadow-2xl sm:mt-0 sm:p-6"
							style="max-height: calc(100dvh - 2rem)"
						>
							<div class="flex items-center justify-between">
								<h2 class="text-foreground text-lg font-bold">
									{editingTrip ? 'Edit Trip' : 'New Trip'}
								</h2>
								<button
									type="button"
									onclick={() => (showTripModal = false)}
									class="text-muted-foreground hover:text-foreground"
								>
									<X class="h-5 w-5" />
								</button>
							</div>
							<input
								type="text"
								bind:value={tripTitle}
								placeholder="Trip title"
								class="border-border focus:ring-primary w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:outline-none"
							/>
							<div>
								<span class="text-muted-foreground mb-1 block text-xs">Date range</span>
								<DateRangePicker bind:startDate={tripStartDate} bind:endDate={tripEndDate} />
							</div>
							<textarea
								bind:value={tripDescription}
								placeholder="Description (optional)"
								rows="2"
								class="border-border focus:ring-primary w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:outline-none"
							></textarea>

							<!-- Cover image management -->
							<div class="space-y-2">
								<span class="text-muted-foreground text-xs font-medium"
									>{t('travel.coverImage')}</span
								>
								<input
									bind:this={tripImageInput}
									type="file"
									accept="image/*"
									class="hidden"
									onchange={(e) => {
										const f = (e.target as HTMLInputElement).files?.[0];
										if (f) handleTripImageUpload(f);
									}}
								/>
								{#if tripImageUrl}
									<div class="relative h-32 overflow-hidden rounded-lg">
										<img src={tripImageUrl} alt="Cover" class="h-full w-full object-cover" />
										<button
											type="button"
											onclick={() => {
												tripImageUrl = null;
												tripImageAttribution = null;
											}}
											class="bg-destructive absolute top-2 right-2 rounded-full p-1.5 text-white shadow-lg"
											title="Remove image"><X class="h-4 w-4" /></button
										>
									</div>
									{#if tripImageAttribution?.photographer}
										<p class="text-muted-foreground text-[10px]">
											Photo by
											<a
												href={tripImageAttribution.photographer_url}
												target="_blank"
												rel="noopener"
												class="hover:underline">{tripImageAttribution.photographer}</a
											>
											on
											<a
												href={tripImageAttribution.pexels_url}
												target="_blank"
												rel="noopener"
												class="hover:underline">Pexels</a
											>
										</p>
									{/if}
								{:else}
									<div
										class="border-border text-muted-foreground flex h-20 items-center justify-center rounded-lg border border-dashed text-xs"
									>
										No cover image
									</div>
								{/if}
								<div class="flex gap-2">
									<button
										type="button"
										onclick={() => tripImageInput?.click()}
										disabled={isUploadingImage}
										class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
									>
										{#if isUploadingImage}
											<Loader2 class="h-3 w-3 animate-spin" /> Uploading...
										{:else}
											<Upload class="h-3 w-3" /> Upload
										{/if}
									</button>
									<button
										type="button"
										onclick={fetchPexelsImage}
										class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
									>
										<Sparkles class="h-3 w-3" /> Fetch from Pexels
									</button>
								</div>
							</div>

							<!-- Sharing & permissions (edit mode only) -->
							{#if editingTrip}
								<div class="border-border space-y-3 border-t pt-4">
									<span class="text-foreground text-xs font-bold tracking-wide uppercase">
										Sharing & Permissions
									</span>

									<!-- Shared friends -->
									{#if tripFriends.length > 0}
										<div class="space-y-1.5">
											<span class="text-muted-foreground text-[10px]">Friends with access</span>
											{#each tripShares as share (share.id)}
												<div class="bg-muted/50 flex items-center gap-2 rounded-lg p-2">
													{#if share.avatar_url}
														<img
															src={storageRefToUrl(share.avatar_url)}
															alt=""
															class="h-6 w-6 rounded-full object-cover"
														/>
													{:else}
														<div
															class="bg-primary/10 text-primary flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
														>
															{share.username?.[0]?.toUpperCase() ?? '?'}
														</div>
													{/if}
													<span class="text-foreground flex-1 text-xs">@{share.username}</span>
													<button
														type="button"
														onclick={async () => {
															await unshareTrip(editingTrip!.id, share.shared_with_user_id);
															tripShares = tripShares.filter((s) => s.id !== share.id);
														}}
														class="text-muted-foreground hover:text-destructive"
														><X class="h-3 w-3" /></button
													>
												</div>
											{/each}

											<!-- Add friend dropdown -->
											<select
												class="border-border rounded border bg-transparent px-2 py-1 text-xs"
												onchange={async (e) => {
													const userId = (e.target as HTMLSelectElement).value;
													if (!userId || !editingTrip) return;
													await shareTrip(editingTrip.id, userId);
													tripShares = await getTripShares(editingTrip.id);
													(e.target as HTMLSelectElement).value = '';
												}}
											>
												<option value="">+ Add friend...</option>
												{#each tripFriends.filter((f) => !tripShares.some((s) => s.shared_with_user_id === (f.user_id === $userStore?.id ? f.friend_id : f.user_id))) as friend}
													<option
														value={friend.user_id === $userStore?.id
															? friend.friend_id
															: friend.user_id}
													>
														@{friend.username}
													</option>
												{/each}
											</select>
										</div>
									{:else}
										<p class="text-muted-foreground text-[10px]">
											No friends yet. <a href="/dashboard/friends" class="text-primary underline"
												>Add friends</a
											> to share trips.
										</p>
									{/if}

									<!-- Permission pill buttons -->
									<div class="space-y-2">
										<div>
											<span class="text-muted-foreground mb-1 block text-[10px] font-medium"
												>Costs</span
											>
											<div class="flex gap-1.5">
												{#each [['private', '🔒'], ['friends', '👥'], ['public', '🌍']] as [val, icon]}
													<button
														type="button"
														onclick={() => (tripCostsVisible = val as typeof tripCostsVisible)}
														class="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors {tripCostsVisible ===
														val
															? 'border-primary bg-primary/10 text-primary'
															: 'border-border text-muted-foreground hover:text-foreground'}"
													>
														{icon}
														{val}
													</button>
												{/each}
											</div>
										</div>
										<div>
											<span class="text-muted-foreground mb-1 block text-[10px] font-medium"
												>GPS</span
											>
											<div class="flex gap-1.5">
												{#each [['private', '🔒'], ['friends', '👥'], ['public', '🌍']] as [val, icon]}
													<button
														type="button"
														onclick={() => (tripGpsVisible = val as typeof tripGpsVisible)}
														class="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors {tripGpsVisible ===
														val
															? 'border-primary bg-primary/10 text-primary'
															: 'border-border text-muted-foreground hover:text-foreground'}"
													>
														{icon}
														{val}
													</button>
												{/each}
											</div>
										</div>
										<div>
											<span class="text-muted-foreground mb-1 block text-[10px] font-medium"
												>Comments</span
											>
											<div class="flex gap-1.5">
												{#each [['owner', '🔒'], ['friends', '👥'], ['public', '🌍']] as [val, icon]}
													<button
														type="button"
														onclick={() =>
															(tripCommentsAllowed = val as typeof tripCommentsAllowed)}
														class="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors {tripCommentsAllowed ===
														val
															? 'border-primary bg-primary/10 text-primary'
															: 'border-border text-muted-foreground hover:text-foreground'}"
													>
														{icon}
														{val === 'owner' ? 'Owner' : val}
													</button>
												{/each}
											</div>
										</div>
									</div>
								</div>
							{/if}

							<div class="flex justify-end gap-2">
								<button
									type="button"
									onclick={() => (showTripModal = false)}
									class="border-border text-foreground hover:bg-muted rounded-lg border px-4 py-2 text-sm font-medium"
								>
									Cancel
								</button>
								<button
									type="button"
									onclick={saveTrip}
									disabled={isCreatingTrip || !tripTitle || !tripStartDate}
									class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
								>
									{#if isCreatingTrip}
										<Loader2 class="h-4 w-4 animate-spin" />
									{/if}
									{editingTrip ? 'Save' : 'Create'}
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Sticky map sidebar (desktop) -->
			<div class="hidden lg:block">
				<div class="sticky top-20 space-y-4">
					<div class="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
						<div class="border-border flex items-center gap-2 border-b px-4 py-2.5">
							<MapPin class="text-primary h-4 w-4" />
							<span class="text-foreground text-sm font-semibold">
								{#if activeTripId}
									{trips.find((t) => t.id === activeTripId)?.title ?? 'Trip'}
								{:else}
									Overview
								{/if}
							</span>
							{#if highlightPoints.length > 0}
								<span class="text-muted-foreground ml-auto text-xs">
									{highlightPoints.length} pts
								</span>
							{/if}
						</div>
						{#if mapPoints.length > 0 || mapMarkers.length > 0 || activeTripRouteSegments.length > 0}
							{#key activeTripId}
								<TripMap
									points={mapPoints}
									segments={activeTripRouteSegments}
									markers={mapMarkers}
									{highlightPoints}
									class="h-[420px]"
								/>
							{/key}
						{:else if activeTripId && loadingTripGps.has(activeTripId)}
							<div
								class="text-muted-foreground flex h-64 items-center justify-center gap-2 px-6 text-center text-sm"
							>
								<Loader2 class="h-4 w-4 animate-spin" />
								{t('common.status.loading')}
							</div>
						{:else}
							<div
								class="text-muted-foreground flex h-64 items-center justify-center px-6 text-center text-sm"
							>
								No location data yet.
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Trip Generation Modal -->
<TripGenerationModal
	bind:open={showGenerationModal}
	bind:startDate={genStartDate}
	bind:endDate={genEndDate}
	bind:useCustomHomeAddress={genUseCustomHome}
	bind:customHomeAddressInput={genCustomHomeInput}
	bind:customHomeAddressSuggestions={genHomeSuggestions}
	bind:showCustomHomeAddressSuggestions={genShowSuggestions}
	bind:selectedCustomHomeAddressIndex={genSelectedSuggestionIdx}
	bind:customHomeAddressSearchError={genHomeError}
	bind:selectedCustomHomeAddress={genSelectedHome}
	bind:isCustomHomeAddressSearching={genIsSearching}
	bind:clearExistingSuggestions={genClearExisting}
	onGenerate={generateSuggestions}
	onClose={() => (showGenerationModal = false)}
/>
