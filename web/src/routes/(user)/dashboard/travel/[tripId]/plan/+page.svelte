<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { fluxbase } from '$lib/fluxbase';
	import {
		getPlanItems,
		createPlanItem,
		updatePlanItem,
		deletePlanItem,
		getCollaborators,
		addCollaborator,
		removeCollaborator,
		type PlanItem,
		type Collaborator
	} from '$lib/services/trip-plan.service';
	import {
		ChevronRight,
		Plus,
		Trash2,
		Clock,
		Calendar,
		X,
		Check,
		Loader2,
		Eye,
		UserPlus,
		Users,
		MapPin,
		Search,
		Star,
		ExternalLink,
		Pencil
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import TripMap from '$lib/components/TripMap.svelte';
	import PlaceAutocomplete from '$lib/components/PlaceAutocomplete.svelte';
	import { fetchLinkPreview, type LinkPreview } from '$lib/services/link-preview.service';
	import { translate } from '$lib/i18n';
	import { PLAN_CATEGORY_COLORS } from '$lib/utils/colors';
	import { aiDrawer, type PlanSuggestion } from '$lib/stores/ai-drawer';

	let t = $derived($translate);

	type Trip = {
		id: string;
		title: string;
		start_date: string;
		end_date: string;
		description: string | null;
		image_url: string | null;
		metadata: Record<string, any> | null;
		budget_total: number | null;
		budget_currency: string | null;
		plan_visible_to: 'private' | 'friends' | 'public';
	};

	const tripId = $derived(page.params.tripId ?? '');
	let trip = $state<Trip | null>(null);
	let items = $state<PlanItem[]>([]);
	let collaborators = $state<Collaborator[]>([]);
	let isLoading = $state(true);
	let selectedDay = $state<number | null>(null);
	// Tapped day in the cost-per-day chart (mobile-friendly alternative to the
	// hover tooltip, which is invisible on touch devices).
	let selectedCostDay = $state<number | null>(null);
	let showCollaboratorModal = $state(false);
	let collaboratorUsername = $state('');
	let isAddingCollaborator = $state(false);
	let linkPreviews = $state<Map<string, LinkPreview | null>>(new Map());
	let loadingPreview = $state<string | null>(null);
	let previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let homeCity = $state<string | null>(null);

	async function handleBookingUrlChange(item: any) {
		const url = item.booking_url?.trim();
		if (!url || !url.startsWith('http')) {
			linkPreviews.delete(url);
			linkPreviews = new Map(linkPreviews);
			return;
		}

		// Debounce
		const existing = previewTimers.get(url);
		if (existing) clearTimeout(existing);

		previewTimers.set(
			url,
			setTimeout(async () => {
				loadingPreview = url;
				try {
					const preview = await fetchLinkPreview(url);
					linkPreviews.set(url, preview);
					linkPreviews = new Map(linkPreviews);

					// Auto-fill title if empty
					if (preview?.title && !item.title) {
						item.title = preview.title;
						await saveItem(item);
					}

					// Store metadata
					if (preview) {
						const meta = item.metadata ?? {};
						meta.linkPreview = preview;
						item.metadata = meta;
						await fluxbase.from('trip_plan_items').update({ metadata: meta }).eq('id', item.id);
					}
				} finally {
					loadingPreview = null;
				}
			}, 500)
		);
	}

	// Map: show planned stops for the selected day as markers + connecting route
	const dayMapPoints = $derived(
		(selectedDay ? items.filter((i) => i.day_number === selectedDay && i.location) : []).map(
			(i) => ({ lat: i.location!.lat, lng: i.location!.lng })
		)
	);

	// Overview map: ALL planned stops across all days, ordered by day then time
	const allMapPoints = $derived(
		items
			.filter((i) => i.location)
			.sort(
				(a, b) =>
					a.day_number - b.day_number || (a.start_time ?? '').localeCompare(b.start_time ?? '')
			)
			.map((i) => ({ lat: i.location!.lat, lng: i.location!.lng }))
	);

	// New item form
	let newItemTitle = $state('');
	let newItemUrl = $state('');
	let newItemPreview = $state<LinkPreview | null>(null);
	let isFetchingPreview = $state(false);
	let newItemType = $state('activity');
	let newItemTime = $state('');
	let newItemCost = $state('');
	let newItemCurrency = $state('EUR');
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let isSearching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedCoords = $state<{ lat: number; lng: number } | null>(null);
	let selectedAddress = $state<string | null>(null);

	// Plan item types — icons + labels stay here; colors from shared PLAN_CATEGORY_COLORS.
	const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
		sightseeing: { icon: '📷', color: PLAN_CATEGORY_COLORS.sightseeing, label: 'Sightseeing' },
		food: { icon: '🍴', color: PLAN_CATEGORY_COLORS.food, label: 'Food' },
		activity: { icon: '🎯', color: PLAN_CATEGORY_COLORS.activity, label: 'Activity' },
		transport: { icon: '🚇', color: PLAN_CATEGORY_COLORS.transport, label: 'Transport' },
		accommodation: { icon: '🏨', color: PLAN_CATEGORY_COLORS.accommodation, label: 'Stay' },
		rest: { icon: '☕', color: PLAN_CATEGORY_COLORS.rest, label: 'Rest' },
		shopping: { icon: '🛍️', color: PLAN_CATEGORY_COLORS.shopping, label: 'Shopping' }
	};

	const numDays = $derived(
		trip
			? Math.max(
					1,
					Math.ceil(
						(new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86400000
					) + 1
				)
			: 1
	);

	const days = $derived(
		Array.from({ length: numDays }, (_, i) => ({
			number: i + 1,
			date: trip ? new Date(new Date(trip.start_date).getTime() + i * 86400000) : null,
			items: items.filter((item) => item.day_number === i + 1)
		}))
	);

	const budgetByCurrency = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const item of items) {
			if (item.cost_estimate) {
				const cur = item.currency || 'EUR';
				totals.set(cur, (totals.get(cur) ?? 0) + item.cost_estimate);
			}
		}
		return [...totals.entries()].map(([currency, total]) => ({ currency, total }));
	});

	const budgetByCategory = $derived.by(() => {
		const totals = new Map<string, { total: number; count: number }>();
		for (const item of items) {
			if (item.cost_estimate) {
				const cat = item.type || 'activity';
				const existing = totals.get(cat) ?? { total: 0, count: 0 };
				totals.set(cat, { total: existing.total + item.cost_estimate, count: existing.count + 1 });
			}
		}
		return [...totals.entries()]
			.map(([category, data]) => ({ category, ...data }))
			.sort((a, b) => b.total - a.total);
	});

	const budgetTotal = $derived(budgetByCurrency.reduce((s, e) => s + e.total, 0));

	const dailyCosts = $derived(
		days.map((d) => ({
			day: d.number,
			cost: d.items.reduce((s: number, i: PlanItem) => s + (i.cost_estimate ?? 0), 0),
			currency: d.items[0]?.currency ?? 'EUR'
		}))
	);

	const maxDailyCost = $derived(Math.max(1, ...dailyCosts.map((d) => d.cost)));

	// Per-day category breakdown for stacked bars
	const dailyCategoryBreakdown = $derived(
		days.map((d) => {
			const byCat = new Map<string, number>();
			for (const item of d.items) {
				if (item.cost_estimate) {
					const cat = item.type || 'activity';
					byCat.set(cat, (byCat.get(cat) ?? 0) + item.cost_estimate);
				}
			}
			return {
				day: d.number,
				total: d.items.reduce((s: number, i: PlanItem) => s + (i.cost_estimate ?? 0), 0),
				currency: d.items[0]?.currency ?? 'EUR',
				categories: budgetByCategory
					.map((c) => ({ category: c.category, amount: byCat.get(c.category) ?? 0 }))
					.filter((c) => c.amount > 0)
			};
		})
	);

	// Donut chart segments
	const donutSegments = $derived.by(() => {
		if (budgetByCategory.length === 0) return [];
		const total = budgetByCategory.reduce((s, c) => s + c.total, 0);
		let offset = 0;
		const radius = 42;
		const circumference = 2 * Math.PI * radius;
		return budgetByCategory.map((cat) => {
			const fraction = cat.total / total;
			const length = fraction * circumference;
			const seg = {
				...cat,
				fraction,
				dashArray: `${length} ${circumference - length}`,
				dashOffset: -offset * circumference,
				percent: Math.round(fraction * 100)
			};
			offset += fraction;
			return seg;
		});
	});

	onMount(async () => {
		try {
			const { data: tripData } = await fluxbase.from('trips').select('*').eq('id', tripId).single();
			trip = tripData as unknown as Trip;

			// Fetch user's home city in parallel for AI context (departure cutoff detection)
			const { data: profile } = await fluxbase
				.from('user_profiles')
				.select('home_address')
				.maybeSingle();
			const homeAddr = (profile as any)?.home_address;
			if (typeof homeAddr === 'string' && homeAddr.trim()) {
				homeCity = homeAddr.trim();
			} else if (homeAddr && typeof homeAddr === 'object') {
				homeCity = (homeAddr as any).city ?? (homeAddr as any).locality ?? null;
			}

			if (trip) {
				const [planItems, collabs] = await Promise.all([
					getPlanItems(tripId),
					getCollaborators(tripId)
				]);
				items = planItems;
				collaborators = collabs;
			}
		} catch (err) {
			console.error('Failed to load trip plan:', err);
		} finally {
			isLoading = false;
		}
	});

	// ponytail: register a page-context effect + accept-suggestion handler with
	// the global AI drawer. Runs whenever trip/items change. Drawer arriving on
	// this route is in 'plan' mode; leaving the page clears back to 'default'
	// via the onDestroy cleanup below.
	$effect(() => {
		if (!trip) return;
		aiDrawer.setContext({
			page: 'plan',
			trip_id: tripId,
			trip_title: trip.title,
			trip_dates: { start: trip.start_date, end: trip.end_date },
			num_days: numDays,
			primary_city: trip.metadata?.primaryCity ?? null,
			home_city: homeCity,
			current_plan_items: items
		});
	});

	const handleAcceptSuggestion = async (item: PlanSuggestion) => {
		if (!trip) return;
		const userId = await getCurrentUserId();
		const action = item.action ?? 'create';

		// === DELETE ===
		if (action === 'delete' && item.item_id) {
			const existing = items.find((i) => i.id === item.item_id);
			if (!existing) {
				toast.error(t('plan.itemNotFound'));
				return;
			}
			await deletePlanItem(item.item_id);
			items = items.filter((i) => i.id !== item.item_id);
			toast.success(t('plan.itemDeleted', { title: existing.title }));
			return;
		}

		// === UPDATE ===
		if (action === 'update' && item.item_id) {
			const existing = items.find((i) => i.id === item.item_id);
			if (!existing) {
				toast.error(t('plan.itemNotFound'));
				return;
			}
			const changes = item.changes ?? {};
			const updated: PlanItem = {
				...existing,
				title: changes.title ?? existing.title,
				type: changes.type ?? existing.type,
				start_time: changes.time !== undefined ? changes.time : existing.start_time,
				end_time: changes.end_time !== undefined ? changes.end_time : existing.end_time,
				cost_estimate: changes.cost !== undefined ? changes.cost : existing.cost_estimate,
				currency: changes.currency ?? existing.currency,
				address: changes.address !== undefined ? changes.address : existing.address,
				metadata:
					changes.end_address !== undefined
						? { ...(existing.metadata ?? {}), end_address: changes.end_address }
						: existing.metadata
			};
			await updatePlanItem(existing.id, {
				title: updated.title,
				type: updated.type,
				start_time: updated.start_time,
				end_time: updated.end_time,
				cost_estimate: updated.cost_estimate,
				currency: updated.currency,
				address: updated.address,
				location: updated.location,
				metadata: updated.metadata
			});
			items = items.map((i) => (i.id === existing.id ? updated : i));
			toast.success(t('plan.itemUpdated', { title: updated.title }));
			return;
		}

		// === CREATE === (existing path)
		// If we received an address but no coordinates, background-geocode via Pelias
		// so the new item shows on the map. Best-effort: if it fails, the item still
		// saves without a location; user can fix via the autocomplete on the edit panel.
		let locationLat: number | null = null;
		let locationLng: number | null = null;
		const addressForGeocode = item.address ?? item.end_address ?? null;
		if (addressForGeocode) {
			try {
				const { getPeliasEndpoint } = await import('$lib/services/external/pelias.service');
				const endpoint = await getPeliasEndpoint();
				const res = await fetch(
					`${endpoint}/v1/search?text=${encodeURIComponent(addressForGeocode)}&size=1`,
					{ headers: { Accept: 'application/json' } }
				);
				const data = await res.json();
				const feat = data.features?.[0];
				if (feat?.geometry?.coordinates) {
					[locationLng, locationLat] = feat.geometry.coordinates;
				}
			} catch (err) {
				console.warn('Background geocode failed for suggestion:', err);
			}
		}

		const metadata =
			item.type === 'transport' && item.end_address ? { end_address: item.end_address } : null;

		const created = await createPlanItem({
			trip_id: tripId,
			user_id: userId!,
			day_number: item.day,
			sort_order: items.filter((i) => i.day_number === item.day).length,
			title: item.title,
			description: null,
			type: item.type || 'activity',
			start_time: item.time || null,
			end_time: item.end_time ?? null,
			location:
				locationLat != null && locationLng != null ? { lat: locationLat, lng: locationLng } : null,
			address: item.address ?? null,
			cost_estimate: item.cost ?? null,
			currency: item.currency || trip.budget_currency || 'EUR',
			booking_url: null,
			booking_status: 'not_booked',
			want_to_visit_id: null,
			notes: null,
			metadata,
			created_by: userId
		});
		items = [...items, created];
		toast.success('Added "' + item.title + '" to Day ' + item.day);
	};

	onMount(() => {
		aiDrawer.setAcceptSuggestionHandler(handleAcceptSuggestion);
		return () => {
			// Reset to default mode + clear handler when leaving the plan page
			aiDrawer.setAcceptSuggestionHandler(null);
			aiDrawer.setContext({ page: 'default' });
		};
	});

	async function getCurrentUserId(): Promise<string | null> {
		const { data } = await fluxbase.auth.getUser();
		return data?.user?.id ?? null;
	}

	function formatDateShort(d: Date): string {
		return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
	}

	function formatTime(time: string | null): string {
		if (!time) return '';
		return time.slice(0, 5);
	}

	function dayCost(dayItems: PlanItem[]): number {
		return dayItems.reduce((sum, i) => sum + (i.cost_estimate ?? 0), 0);
	}

	// ── Day selection ──
	function openDay(dayNumber: number) {
		selectedDay = dayNumber;
		resetNewItemForm();
	}

	function resetNewItemForm() {
		newItemTitle = '';
		newItemUrl = '';
		newItemPreview = null;
		newItemType = 'activity';
		newItemTime = '';
		newItemCost = '';
		newItemCurrency = trip?.budget_currency || 'EUR';
		searchQuery = '';
		searchResults = [];
		selectedCoords = null;
		selectedAddress = null;
	}

	// ── Smart search (URL or Pelias) ──
	let searchInProgress = false;
	async function handleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		if (!searchQuery.trim()) {
			searchResults = [];
			newItemPreview = null;
			return;
		}

		if (searchInProgress) return;

		// URL detected → fetch link preview immediately
		if (searchQuery.trim().startsWith('http')) {
			searchResults = [];
			newItemPreview = null;
			searchInProgress = true;
			isFetchingPreview = true;
			try {
				const preview = await fetchLinkPreview(searchQuery.trim());
				newItemPreview = preview;
				if (preview?.title && !newItemTitle.trim()) {
					newItemTitle = preview.title;
				}
				newItemUrl = searchQuery.trim();
			} catch {
				newItemPreview = null;
			} finally {
				isFetchingPreview = false;
				searchInProgress = false;
			}
			return;
		}

		// Regular Pelias place search
		newItemPreview = null;
		newItemUrl = '';
		if (searchQuery.length < 3) {
			searchResults = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			isSearching = true;
			try {
				const { getPeliasEndpoint } = await import('$lib/services/external/pelias.service');
				const endpoint = await getPeliasEndpoint();
				const res = await fetch(
					`${endpoint}/v1/autocomplete?text=${encodeURIComponent(searchQuery)}&size=5`,
					{ headers: { Accept: 'application/json' } }
				);
				const data = await res.json();
				searchResults = data.features ?? [];
			} catch {
				searchResults = [];
			} finally {
				isSearching = false;
			}
		}, 300);
	}

	function selectSearchResult(feature: any) {
		const [lng, lat] = feature.geometry.coordinates;
		newItemTitle = feature.properties.label || feature.properties.name || t('common.unnamed');
		searchQuery = newItemTitle;
		searchResults = [];
		selectedCoords = { lat, lng };
		selectedAddress = feature.properties.label ?? null;
	}

	// ── Item management ──
	async function addItem(dayNumber: number) {
		const title = newItemTitle.trim() || t('plan.newItem');
		const userId = await getCurrentUserId();

		// Auto-select first search result if user hasn't clicked one
		if (!selectedCoords && searchResults.length > 0) {
			const feature = searchResults[0];
			if (feature?.geometry?.coordinates) {
				selectedCoords = {
					lat: feature.geometry.coordinates[1],
					lng: feature.geometry.coordinates[0]
				};
				selectedAddress = feature.properties?.label ?? null;
			}
		}

		// Fetch link preview if URL was provided
		let itemMetadata = null;
		let bookingUrl = null;
		if (newItemUrl.trim() && newItemUrl.trim().startsWith('http')) {
			bookingUrl = newItemUrl.trim();
			try {
				const preview = await fetchLinkPreview(bookingUrl);
				if (preview) {
					itemMetadata = { linkPreview: preview };
					if (!newItemTitle.trim() && preview.title) {
						// Don't override — title was already set
					}
				}
			} catch {
				// non-critical
			}
		}

		const newItem = await createPlanItem({
			trip_id: tripId,
			user_id: userId!,
			day_number: dayNumber,
			sort_order: items.filter((i) => i.day_number === dayNumber).length,
			title,
			description: null,
			type: newItemType,
			start_time: newItemTime || null,
			end_time: null,
			location: selectedCoords,
			address: selectedAddress,
			cost_estimate: newItemCost ? parseFloat(newItemCost) : null,
			currency: newItemCurrency,
			booking_url: bookingUrl,
			booking_status: 'not_booked',
			want_to_visit_id: null,
			notes: null,
			created_by: userId
		});

		// Save metadata if we fetched it
		if (itemMetadata) {
			try {
				await fluxbase
					.from('trip_plan_items')
					.update({ metadata: itemMetadata })
					.eq('id', newItem.id);
				newItem.metadata = itemMetadata;
			} catch {
				// non-critical
			}
		}

		items = [...items, newItem];
		resetNewItemForm();
		toast.success(t('plan.addedToDay', { day: dayNumber }));
	}

	async function saveItem(item: PlanItem) {
		try {
			await updatePlanItem(item.id, {
				title: item.title,
				description: item.description,
				type: item.type,
				start_time: item.start_time,
				end_time: item.end_time,
				address: item.address,
				cost_estimate: item.cost_estimate,
				currency: item.currency,
				booking_url: item.booking_url,
				booking_status: item.booking_status,
				notes: item.notes,
				metadata: item.metadata ?? null
			});
		} catch (err) {
			console.error('Save failed:', err);
			toast.error(t('plan.saveFailed'));
		}
	}

	async function removeItem(id: string) {
		try {
			await deletePlanItem(id);
			items = items.filter((i) => i.id !== id);
		} catch (err) {
			console.error('Delete failed:', err);
		}
	}

	async function toggleBooking(item: PlanItem) {
		item.booking_status = item.booking_status === 'booked' ? 'not_booked' : 'booked';
		await saveItem(item);
	}

	async function moveItem(item: PlanItem, toDay: number) {
		item.day_number = toDay;
		try {
			await updatePlanItem(item.id, { day_number: toDay });
			items = [...items];
		} catch (err) {
			console.error('Move failed:', err);
		}
	}

	// ── Drag and drop ──
	let draggedItem = $state<PlanItem | null>(null);

	// HTML5 drag-and-drop doesn't fire on touch devices, so we offer a
	// tap-to-move alternative there: tap an item to pick it up, then tap a
	// day card to drop it. `movingItem` holds the picked-up item.
	let movingItem = $state<PlanItem | null>(null);
	const isTouchDevice =
		typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

	function onDragStart(e: DragEvent, item: PlanItem) {
		draggedItem = item;
		e.dataTransfer?.setData('text/plain', item.id);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function onDrop(e: DragEvent, dayNumber: number) {
		e.preventDefault();
		if (draggedItem && draggedItem.day_number !== dayNumber) {
			moveItem(draggedItem, dayNumber);
		}
		draggedItem = null;
	}

	// Tap-to-move handlers (touch devices only).
	function beginMoveItem(item: PlanItem) {
		movingItem = movingItem?.id === item.id ? null : item;
	}

	function moveToDay(dayNumber: number) {
		if (movingItem && movingItem.day_number !== dayNumber) {
			moveItem(movingItem, dayNumber);
		}
		movingItem = null;
	}

	function cancelMove() {
		movingItem = null;
	}

	// ── Collaborators ──
	async function handleAddCollaborator() {
		if (!collaboratorUsername.trim()) return;
		isAddingCollaborator = true;
		try {
			const collab = await addCollaborator(tripId, collaboratorUsername.trim());
			if (collab) {
				collaborators = [...collaborators, collab];
				toast.success(t('plan.collaboratorAdded', { username: collaboratorUsername }));
				collaboratorUsername = '';
			} else {
				toast.error(t('plan.userNotFound'));
			}
		} catch {
			toast.error(t('plan.addCollaboratorFailed'));
		} finally {
			isAddingCollaborator = false;
		}
	}

	async function handleRemoveCollaborator(id: string) {
		await removeCollaborator(id);
		collaborators = collaborators.filter((c) => c.id !== id);
	}

	async function setPlanVisibility(next: 'private' | 'friends' | 'public') {
		if (!trip || trip.plan_visible_to === next) return;
		const prev = trip.plan_visible_to;
		trip.plan_visible_to = next;
		try {
			await fluxbase.from('trips').update({ plan_visible_to: next }).eq('id', tripId);
			toast.success(
				next === 'public'
					? t('plan.planPublic')
					: next === 'friends'
						? t('plan.planFriends')
						: t('plan.planPrivate')
			);
		} catch {
			trip.plan_visible_to = prev;
			toast.error(t('plan.updateFailed'));
		}
	}
</script>

<svelte:head>
	<title>{trip ? `${trip.title} · Plan · Wayli` : 'Trip Plan · Wayli'}</title>
</svelte:head>

{#if isLoading}
	<div class="flex min-h-[60vh] items-center justify-center">
		<Loader2 class="text-muted-foreground h-8 w-8 animate-spin" />
	</div>
{:else if trip}
	<!-- Header -->
	<div class="mb-6 space-y-4">
		<!-- Breadcrumb -->
		<nav class="text-muted-foreground mb-4 flex items-center gap-1 text-sm" aria-label="Breadcrumb">
			<a href="/dashboard/travel" class="hover:text-foreground">{t('common.navigation.travel')}</a>
			<ChevronRight class="h-3.5 w-3.5 opacity-50" />
			<a href="/dashboard/travel?trip={tripId}" class="text-primary hover:underline">{trip.title}</a
			>
			<ChevronRight class="h-3.5 w-3.5 opacity-50" />
			<span class="text-foreground font-medium">{t('travel.plan')}</span>
		</nav>

		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-foreground text-2xl font-bold">{trip.title}</h1>
					<a
						href="/dashboard/travel?trip={tripId}&edit=1"
						class="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
						title={t('travel.editTrip')}
					>
						<Pencil class="h-3.5 w-3.5" />
						{t('common.actions.edit')}
					</a>
				</div>
				<p class="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
					<Calendar class="h-4 w-4" />
					{new Date(trip.start_date).toLocaleDateString(undefined, {
						month: 'long',
						day: 'numeric'
					})}
					– {new Date(trip.end_date).toLocaleDateString(undefined, {
						month: 'long',
						day: 'numeric',
						year: 'numeric'
					})}
					· {numDays}
					{numDays === 1 ? t('common.day') : t('common.days')}
				</p>
			</div>

			<!-- Collaborators -->
			<div class="flex items-center gap-2">
				{#each collaborators as collab (collab.id)}
					<div class="flex items-center gap-1.5" title={`@${collab.username}`}>
						{#if collab.avatar_url}
							<img
								src={storageRefToUrl(collab.avatar_url)}
								alt={collab.username}
								class="border-border h-8 w-8 rounded-full border-2 object-cover"
							/>
						{:else}
							<div
								class="border-border bg-muted flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold"
							>
								{collab.username?.[0]?.toUpperCase() ?? '?'}
							</div>
						{/if}
						<button
							type="button"
							onclick={() => handleRemoveCollaborator(collab.id)}
							class="text-muted-foreground hover:text-destructive"><X class="h-3 w-3" /></button
						>
					</div>
				{/each}
				<button
					type="button"
					onclick={() => (showCollaboratorModal = true)}
					class="border-border text-muted-foreground hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-full border"
					title={t('plan.inviteCollaborator')}
				>
					<UserPlus class="h-4 w-4" />
				</button>
				<div class="flex items-center gap-1" title={t('plan.planVisibilityTitle')}>
					{#each [['private', '🔒'], ['friends', '👥'], ['public', '🌍']] as [val, icon]}
						<button
							type="button"
							onclick={() => setPlanVisibility(val as 'private' | 'friends' | 'public')}
							class="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors {trip.plan_visible_to ===
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
		</div>
	</div>

	<!-- Budget panel -->
	{#if budgetByCurrency.length > 0}
		<div class="bg-card border-border mb-4 rounded-2xl border p-4">
			<div class="grid gap-4 sm:grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_auto]">
				<!-- Donut chart + total -->
				<div class="flex items-center gap-3">
					<svg width="100" height="100" viewBox="0 0 100 100" class="flex-shrink-0">
						{#if donutSegments.length > 0}
							{#each donutSegments as seg (seg.category)}
								<circle
									cx="50"
									cy="50"
									r="42"
									fill="none"
									stroke={TYPE_CONFIG[seg.category]?.color ?? '#6b7280'}
									stroke-width="10"
									stroke-dasharray={seg.dashArray}
									stroke-dashoffset={seg.dashOffset}
									transform="rotate(-90 50 50)"
								/>
							{/each}
						{:else}
							<circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" stroke-width="10" />
						{/if}
						<text
							x="50"
							y="48"
							text-anchor="middle"
							class="text-foreground fill-current"
							font-size="14"
							font-weight="bold">{budgetByCurrency[0]?.currency ?? ''}</text
						>
						<text
							x="50"
							y="62"
							text-anchor="middle"
							class="text-muted-foreground fill-current"
							font-size="11">{budgetByCurrency[0]?.total.toFixed(0) ?? '0'}</text
						>
					</svg>
				</div>

				<!-- Category legend with bars -->
				<div class="space-y-1.5">
					<div class="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
						{t('plan.byCategory')}
					</div>
					{#each budgetByCategory as cat (cat.category)}
						{@const maxCat = Math.max(...budgetByCategory.map((c) => c.total))}
						<div class="flex items-center gap-2 text-xs">
							<span class="w-4 shrink-0 text-center">{TYPE_CONFIG[cat.category]?.icon ?? '📌'}</span
							>
							<span class="text-muted-foreground w-16 shrink-0 truncate sm:w-20">
								{t('plan.type.' + cat.category)}
							</span>
							<div class="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
								<div
									class="h-full rounded-full"
									style="width: {(cat.total / maxCat) * 100}%; background: {TYPE_CONFIG[
										cat.category
									]?.color ?? '#6b7280'}"
								></div>
							</div>
							<span class="text-muted-foreground w-10 shrink-0 text-right font-mono sm:w-12">
								{cat.total.toFixed(0)}
							</span>
						</div>
					{/each}
				</div>

				<!-- Daily cost bars (stacked by category) -->
				{#if dailyCosts.some((d) => d.cost > 0)}
					<div class="border-border md:border-l md:pl-4">
						<div class="text-muted-foreground mb-2 text-[10px] font-medium uppercase">
							{t('plan.costPerDay', { currency: dailyCosts[0]?.currency ?? 'EUR' })}
						</div>
						<div class="flex gap-1.5">
							<!-- Y-axis -->
							<div class="flex flex-col justify-between text-right" style="height: 96px;">
								<span class="text-muted-foreground text-[10px]">{maxDailyCost.toFixed(0)}</span>
								<span class="text-muted-foreground text-[10px]"
									>{(maxDailyCost / 2).toFixed(0)}</span
								>
								<span class="text-muted-foreground text-[10px]">0</span>
							</div>
							<!-- Bars -->
							<div class="relative flex-1">
								<!-- Grid lines -->
								<div class="absolute inset-0 flex flex-col justify-between">
									<div class="border-border border-t"></div>
									<div class="border-border border-t"></div>
									<div class="border-border border-t"></div>
								</div>
								<div class="relative flex items-end gap-1" style="height: 96px;">
									{#each dailyCategoryBreakdown as d (d.day)}
										<button
											type="button"
											class="group relative flex h-full min-w-[18px] flex-1 cursor-pointer flex-col justify-end rounded-t-sm focus:outline-none {selectedCostDay ===
											d.day
												? 'ring-primary ring-2 ring-offset-1'
												: ''}"
											aria-label="{t('plan.dayLabel', { day: d.day })}: {d.total.toFixed(
												0
											)} {d.currency}"
											onclick={() => (selectedCostDay = selectedCostDay === d.day ? null : d.day)}
										>
											<!-- Stacked segments -->
											{#each d.categories as cat (cat.category)}
												<div
													class="w-full transition-all"
													style="height: {(cat.amount / maxDailyCost) *
														96}px; background: {TYPE_CONFIG[cat.category]?.color ?? '#6b7280'}"
												></div>
											{/each}
											<!-- Empty bar for zero-cost days -->
											{#if d.total === 0}
												<div class="w-full" style="height: 2px; background: #e5e7eb"></div>
											{/if}
											<!-- Tooltip on hover (desktop pointer devices) -->
											{#if d.total > 0}
												<div
													class="bg-card border-border pointer-events-none absolute -top-2 left-1/2 z-20 hidden -translate-x-1/2 -translate-y-full rounded-lg border p-3 text-xs whitespace-nowrap shadow-xl group-hover:block"
												>
													<div class="text-foreground font-bold">
														{t('plan.dayCost', {
															day: d.day,
															cost: `${d.total.toFixed(0)} ${d.currency}`
														})}
													</div>
													{#each d.categories as cat (cat.category)}
														<div class="text-muted-foreground flex items-center gap-1.5">
															<span>{TYPE_CONFIG[cat.category]?.icon}</span>
															{t('plan.type.' + cat.category)}: {cat.amount.toFixed(0)}
														</div>
													{/each}
												</div>
											{/if}
										</button>
									{/each}
								</div>
								<!-- Day numbers -->
								<div class="mt-1 flex gap-1">
									{#each dailyCategoryBreakdown as d (d.day)}
										<div
											class="text-muted-foreground flex-1 text-center text-[10px] {selectedCostDay ===
											d.day
												? 'text-foreground font-bold'
												: ''}"
										>
											{d.day}
										</div>
									{/each}
								</div>
								<!-- Tap-to-show breakdown (mobile-friendly) -->
								{#if selectedCostDay !== null}
									{@const picked = dailyCategoryBreakdown.find((d) => d.day === selectedCostDay)}
									{#if picked}
										<div class="bg-muted/50 mt-2 rounded-lg p-2.5 text-xs sm:hidden">
											<div class="text-foreground mb-1 font-bold">
												{t('plan.dayCost', {
													day: picked.day,
													cost: `${picked.total.toFixed(0)} ${picked.currency}`
												})}
											</div>
											{#each picked.categories as cat (cat.category)}
												<div class="text-muted-foreground flex items-center gap-1.5">
													<span>{TYPE_CONFIG[cat.category]?.icon}</span>
													{t('plan.type.' + cat.category)}: {cat.amount.toFixed(0)}
												</div>
											{/each}
										</div>
									{/if}
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Calendar + day detail (full width) -->
	<div>
		{#if selectedDay === null}
			<!-- Calendar overview -->
			{#if movingItem}
				<div
					class="bg-primary/10 text-primary mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium"
				>
					<span>
						Moving: <strong>{movingItem.title}</strong> — tap a day to move it
					</span>
					<button
						type="button"
						onclick={cancelMove}
						class="hover:bg-primary/20 rounded px-2 py-1 font-medium underline"
					>
						{t('common.actions.cancel')}
					</button>
				</div>
			{/if}
			<div
				class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7"
			>
				{#each days as day (day.number)}
					<div
						role="button"
						tabindex="0"
						onclick={() => {
							if (movingItem) {
								moveToDay(day.number);
							} else {
								openDay(day.number);
							}
						}}
						onkeydown={(e) => e.key === 'Enter' && openDay(day.number)}
						ondragover={onDragOver}
						ondrop={(e) => onDrop(e, day.number)}
						class="bg-card border-border flex min-h-44 cursor-pointer flex-col rounded-xl border p-3 transition-all hover:-translate-y-0.5 hover:shadow-md {day
							.items.length > 0
							? 'border-primary/30'
							: ''} {movingItem ? 'border-primary ring-primary/40 ring-2' : ''}"
					>
						<!-- Header -->
						<div class="mb-2 flex items-center justify-between">
							<div>
								<div class="text-foreground text-sm font-bold">
									{t('plan.dayLabel', { day: day.number })}
								</div>
								{#if day.date}
									<div class="text-muted-foreground text-[10px]">{formatDateShort(day.date)}</div>
								{/if}
							</div>
							{#if day.items.length > 0}
								<span
									class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-bold"
								>
									{day.items.length}
								</span>
							{/if}
						</div>
						<!-- Items (flex-1 fills space) -->
						<div class="flex-1 space-y-1">
							{#each day.items.slice(0, 4) as item (item.id)}
								<div
									class="truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white transition-shadow {movingItem?.id ===
									item.id
										? 'ring-2 ring-white'
										: ''} {isTouchDevice
										? 'cursor-pointer'
										: 'cursor-grab hover:shadow-md active:cursor-grabbing'}"
									draggable={isTouchDevice ? 'false' : 'true'}
									role="button"
									tabindex="0"
									aria-label="Plan item: {item.title}. {isTouchDevice
										? 'Tap to select, then tap a day to move.'
										: 'Drag to move between days.'}"
									ondragstart={(e) => {
										e.stopPropagation();
										onDragStart(e, item);
									}}
									onclick={(e) => {
										e.stopPropagation();
										if (isTouchDevice) {
											beginMoveItem(item);
										}
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' && isTouchDevice) {
											e.stopPropagation();
											beginMoveItem(item);
										}
									}}
									style="background: {TYPE_CONFIG[item.type]?.color ?? '#6b7280'}"
									title={item.title}
								>
									{TYPE_CONFIG[item.type]?.icon}
									{#if item.start_time}{formatTime(item.start_time)}
									{/if}
									{item.title}
								</div>
							{/each}
							{#if day.items.length > 4}
								<div class="text-muted-foreground text-[10px]">
									{t('plan.moreCount', { count: day.items.length - 4 })}
								</div>
							{/if}
						</div>
						<!-- Cost at bottom-right -->
						{#if dayCost(day.items) > 0}
							<div class="text-muted-foreground mt-1 text-right text-[10px] font-medium">
								{day.items[0]?.currency ?? ''}
								{dayCost(day.items).toFixed(0)}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Overview map: entire route across all days -->
			<div class="border-border bg-card mt-4 overflow-hidden rounded-xl border">
				<div class="border-border flex items-center gap-2 border-b px-4 py-2">
					<MapPin class="text-primary h-4 w-4" />
					<span class="text-foreground text-sm font-semibold">{t('plan.entireRoute')}</span>
					{#if allMapPoints.length > 0}
						<span class="text-muted-foreground ml-auto text-xs"
							>{t('plan.stopsAcrossDays', { stops: allMapPoints.length, days: numDays })}</span
						>
					{:else}
						<span class="text-muted-foreground ml-auto text-xs">{t('plan.addLocationsHint')}</span>
					{/if}
				</div>
				{#if allMapPoints.length > 0}
					<TripMap points={allMapPoints} class="h-64" />
				{:else}
					<div class="text-muted-foreground flex h-40 items-center justify-center text-sm">
						{t('plan.searchPlacesHint')}
					</div>
				{/if}
			</div>
		{:else}
			<!-- Day detail view -->
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<button
						type="button"
						onclick={() => (selectedDay = null)}
						class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
					>
						{t('plan.backToCalendar')}
					</button>
					<h2 class="text-foreground text-lg font-bold">
						{t('plan.dayLabel', { day: selectedDay })}
						{#if days[selectedDay - 1]?.date}
							<span class="text-muted-foreground text-sm font-normal">
								· {days[selectedDay - 1].date!.toLocaleDateString(undefined, {
									weekday: 'long',
									month: 'short',
									day: 'numeric'
								})}
							</span>
						{/if}
					</h2>
				</div>

				<!-- Add item form -->
				<div class="bg-card border-border rounded-xl border p-4">
					<div class="mb-3 flex items-center gap-2">
						<Plus class="text-primary h-4 w-4" />
						<span class="text-foreground text-sm font-medium">{t('plan.addStop')}</span>
					</div>
					<!-- Smart search (URL or place) -->
					<div class="relative mb-3">
						<Search class="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
						<input
							type="text"
							bind:value={searchQuery}
							oninput={handleSearch}
							onpaste={(e) => {
								// Let input update, then search — oninput will also fire
								// but handleSearch has a guard to prevent double execution
							}}
							placeholder="Search for a place or paste a booking URL..."
							class="border-border focus:ring-primary w-full rounded-lg border bg-transparent py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
						/>
						{#if isSearching || isFetchingPreview}
							<Loader2
								class="text-muted-foreground absolute top-2.5 right-3 h-4 w-4 animate-spin"
							/>
						{/if}
					</div>

					<!-- Pelias search results -->
					{#if searchResults.length > 0}
						<div class="bg-muted/50 mb-3 max-h-40 overflow-y-auto rounded-lg">
							{#each searchResults as result (result.properties?.gid ?? result.properties?.id)}
								<button
									type="button"
									onclick={() => selectSearchResult(result)}
									class="hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
								>
									<MapPin class="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
									<span class="truncate">{result.properties?.label ?? t('common.unknown')}</span>
								</button>
							{/each}
						</div>
					{/if}

					<!-- Link preview result -->
					{#if newItemPreview}
						<div class="bg-muted/50 mb-3 rounded-lg p-3">
							<div class="flex items-center gap-3">
								{#if newItemPreview.image}
									<img
										src={newItemPreview.image}
										alt=""
										class="h-12 w-12 flex-shrink-0 rounded-lg object-cover"
										loading="lazy"
									/>
								{:else}
									<div
										class="bg-primary/10 text-primary flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
									>
										{new URL(newItemPreview.url).hostname
											.replace('www.', '')
											.slice(0, 2)
											.toUpperCase()}
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="text-foreground truncate text-sm font-medium">
										{newItemPreview.title ||
											newItemPreview.site_name ||
											new URL(newItemPreview.url).hostname.replace('www.', '')}
									</div>
									{#if newItemPreview.description}
										<div class="text-muted-foreground truncate text-xs">
											{newItemPreview.description}
										</div>
									{/if}
									{#if newItemPreview.rating}
										<div class="flex items-center gap-0.5 text-xs text-amber-500">
											<Star class="h-3 w-3 fill-current" />
											{newItemPreview.rating}
										</div>
									{/if}
								</div>
								<button
									type="button"
									onclick={() => {
										newItemPreview = null;
										newItemUrl = '';
										searchQuery = '';
									}}
									class="text-muted-foreground hover:text-destructive"><X class="h-4 w-4" /></button
								>
							</div>
						</div>
					{/if}

					<div class="flex flex-wrap gap-2">
						<input
							type="text"
							bind:value={newItemTitle}
							placeholder={t('plan.titlePlaceholder')}
							class="border-border focus:ring-primary flex-1 rounded-lg border bg-transparent px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
						/>
						<select
							bind:value={newItemType}
							class="border-border rounded-lg border bg-transparent px-2 py-1.5 text-sm"
						>
							{#each Object.entries(TYPE_CONFIG) as [key, cfg] (key)}
								<option value={key}>{cfg.icon} {t('plan.type.' + key)}</option>
							{/each}
						</select>
						<input
							type="time"
							bind:value={newItemTime}
							class="border-border rounded-lg border bg-transparent px-2 py-1.5 text-sm"
						/>
						<input
							type="number"
							bind:value={newItemCost}
							placeholder={t('plan.costPlaceholder')}
							step="0.01"
							class="border-border w-20 rounded-lg border bg-transparent px-2 py-1.5 text-sm"
						/>
						<input
							type="text"
							bind:value={newItemCurrency}
							maxlength="3"
							class="border-border w-14 rounded-lg border bg-transparent px-2 py-1.5 text-sm"
						/>
						<button
							type="button"
							onclick={() => addItem(selectedDay!)}
							class="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-1.5 text-sm font-medium"
						>
							{t('plan.add')}
						</button>
					</div>
				</div>

				<!-- Items for selected day -->
				<div class="space-y-2">
					{#each days[selectedDay - 1]?.items ?? [] as item (item.id)}
						<div
							class="bg-card border-border group rounded-xl border p-3"
							draggable="true"
							role="button"
							tabindex="0"
							aria-label="Plan item: {item.title}. Drag to move to another day."
							ondragstart={(e) => onDragStart(e, item)}
						>
							<div class="flex items-start gap-3">
								<span class="text-lg">{TYPE_CONFIG[item.type]?.icon ?? '📌'}</span>
								<div class="min-w-0 flex-1">
									<input
										type="text"
										bind:value={item.title}
										onchange={() => saveItem(item)}
										class="text-foreground w-full bg-transparent text-sm font-medium focus:outline-none"
									/>
									<div
										class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs"
									>
										{#if item.start_time}
											<span class="flex items-center gap-1">
												<Clock class="h-3 w-3" />{formatTime(item.start_time)}{#if item.end_time}
													– {formatTime(item.end_time)}{/if}
											</span>
										{/if}
										{#if item.type === 'transport' && item.metadata?.end_address}
											<span class="flex items-center gap-1 truncate">
												<MapPin class="h-3 w-3" />{item.address || '?'} → {item.metadata
													.end_address}
											</span>
										{:else if item.address}
											<span class="flex items-center gap-1 truncate">
												<MapPin class="h-3 w-3" />{item.address}
											</span>
										{/if}
										{#if item.cost_estimate}
											<span class="font-medium"
												>{item.currency} {item.cost_estimate.toFixed(2)}</span
											>
										{/if}
									</div>
									<!-- Quick actions -->
									<div class="mt-2 flex items-center gap-2">
										{#if item.booking_url}
											<button
												type="button"
												onclick={() => toggleBooking(item)}
												class="text-xs {item.booking_status === 'booked'
													? 'text-green-600'
													: 'text-muted-foreground'}"
											>
												{#if item.booking_status === 'booked'}
													<Check class="inline h-3 w-3" /> {t('plan.booked')}
												{:else}
													<div
														class="inline-block h-3 w-3 rounded-full border border-current"
													></div>
													{t('plan.pending')}
												{/if}
											</button>
										{/if}
										<select
											bind:value={item.type}
											onchange={() => saveItem(item)}
											class="border-border rounded border bg-transparent px-1 py-0.5 text-[10px]"
										>
											{#each Object.entries(TYPE_CONFIG) as [key, cfg] (key)}
												<option value={key}>{t('plan.type.' + key)}</option>
											{/each}
										</select>
										<!-- Move to day -->
										<select
											value={item.day_number}
											onchange={(e) =>
												moveItem(item, parseInt((e.target as HTMLSelectElement).value))}
											class="border-border rounded border bg-transparent px-1 py-0.5 text-[10px]"
										>
											{#each Array.from({ length: numDays }, (_, i) => i + 1) as d (d)}
												<option value={d}>{t('plan.dayLabel', { day: d })}</option>
											{/each}
										</select>
									</div>

									<!-- Expandable edit panel -->
									<details class="mt-2">
										<summary
											class="text-muted-foreground hover:text-foreground cursor-pointer text-[10px]"
										>
											{t('plan.editDetails')}
										</summary>
										<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
											<label class="flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]">{t('plan.startTime')}</span>
												<input
													type="time"
													bind:value={item.start_time}
													onchange={() => saveItem(item)}
													class="border-border min-h-[40px] rounded border bg-transparent px-2 py-1.5 text-xs"
												/>
											</label>
											<label class="flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]">{t('plan.endTime')}</span>
												<input
													type="time"
													bind:value={item.end_time}
													onchange={() => saveItem(item)}
													class="border-border min-h-[40px] rounded border bg-transparent px-2 py-1.5 text-xs"
												/>
											</label>
											<label class="flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]">{t('plan.cost')}</span>
												<input
													type="number"
													bind:value={item.cost_estimate}
													onchange={() => saveItem(item)}
													step="0.01"
													placeholder="0.00"
													class="border-border min-h-[40px] rounded border bg-transparent px-2 py-1.5 text-xs"
												/>
											</label>
											<label class="flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]">{t('plan.currency')}</span>
												<input
													type="text"
													bind:value={item.currency}
													onchange={() => saveItem(item)}
													maxlength="3"
													class="border-border min-h-[40px] rounded border bg-transparent px-2 py-1.5 text-xs"
												/>
											</label>
											<label class="flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]">{t('plan.bookingUrl')}</span
												>
												<input
													type="url"
													bind:value={item.booking_url}
													oninput={() => handleBookingUrlChange(item)}
													onchange={() => saveItem(item)}
													placeholder="https://..."
													class="border-border min-h-[40px] rounded border bg-transparent px-2 py-1.5 text-xs"
												/>
												{#if item.booking_url && loadingPreview === item.booking_url}
													<div
														class="text-muted-foreground flex items-center gap-1 py-1 text-[10px]"
													>
														<Loader2 class="h-3 w-3 animate-spin" /> Loading preview...
													</div>
												{:else if item.booking_url && linkPreviews.get(item.booking_url)}
													{@const pv = linkPreviews.get(item.booking_url)!}
													<a
														href={item.booking_url}
														target="_blank"
														rel="noopener"
														class="bg-muted/50 hover:bg-muted mt-1 flex items-center gap-2 rounded-lg p-2 transition-colors"
													>
														{#if pv.image}
															<img
																src={pv.image}
																alt=""
																class="h-10 w-10 flex-shrink-0 rounded object-cover"
																loading="lazy"
															/>
														{/if}
														<div class="min-w-0 flex-1">
															<div class="text-foreground truncate text-[10px] font-medium">
																{pv.title || pv.site_name || 'Link'}
															</div>
															{#if pv.description}
																<div class="text-muted-foreground truncate text-[9px]">
																	{pv.description}
																</div>
															{/if}
															{#if pv.rating}
																<div class="flex items-center gap-0.5 text-[9px] text-amber-500">
																	<Star class="h-2.5 w-2.5 fill-current" />
																	{pv.rating}
																</div>
															{/if}
														</div>
														<ExternalLink class="text-muted-foreground h-3 w-3 flex-shrink-0" />
													</a>
												{/if}
											</label>
											<label class="col-span-2 flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]"
													>{item.type === 'transport'
														? t('plan.fromAddress')
														: t('plan.address')}</span
												>
												<PlaceAutocomplete
													bind:value={item.address}
													onSelect={({ lat, lng }) => {
														item.location = { lat, lng };
														saveItem(item);
													}}
													onInput={() => {
														// Clear stale location if user edits the address text
														if (item.location) item.location = null;
													}}
												/>
											</label>
											{#if item.type === 'transport'}
												<label class="col-span-2 flex flex-col gap-0.5">
													<span class="text-muted-foreground text-[10px]"
														>{t('plan.toAddress')}</span
													>
													<PlaceAutocomplete
														value={item.metadata?.end_address ?? ''}
														onSelect={({ label }) => {
															item.metadata = {
																...(item.metadata ?? {}),
																end_address: label
															};
															saveItem(item);
														}}
													/>
												</label>
											{/if}
											<label class="col-span-2 flex flex-col gap-0.5">
												<span class="text-muted-foreground text-[10px]">{t('plan.notes')}</span>
												<textarea
													bind:value={item.notes}
													onchange={() => saveItem(item)}
													rows="2"
													class="border-border rounded border bg-transparent px-2 py-1 text-xs"
												></textarea>
											</label>
										</div>
									</details>
								</div>
								<button
									type="button"
									onclick={() => removeItem(item.id)}
									class="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					{/each}
				</div>

				<!-- Day map: planned stops connected by route -->
				{#if dayMapPoints.length > 1}
					<div class="border-border bg-card overflow-hidden rounded-xl border">
						<div class="border-border flex items-center gap-2 border-b px-4 py-2">
							<MapPin class="text-primary h-4 w-4" />
							<span class="text-foreground text-sm font-semibold"
								>{t('plan.routeForDay', { day: selectedDay })}</span
							>
							<span class="text-muted-foreground ml-auto text-xs"
								>{t('plan.stops', { count: dayMapPoints.length })}</span
							>
						</div>
						<TripMap points={dayMapPoints} class="h-64" />
					</div>
				{:else if dayMapPoints.length === 1}
					<div class="border-border bg-card overflow-hidden rounded-xl border">
						<div class="border-border flex items-center gap-2 border-b px-4 py-2">
							<MapPin class="text-primary h-4 w-4" />
							<span class="text-foreground text-sm font-semibold">{t('plan.stopLocation')}</span>
						</div>
						<TripMap points={dayMapPoints} class="h-48" />
					</div>
				{/if}
			</div>
		{/if}
	</div>
	<!-- The global floating AI button (in dashboard layout) opens the drawer in plan mode
	     via the $effect that sets page context on this route. -->
	{#if showCollaboratorModal}
		<div
			class="bg-background/80 fixed inset-0 z-[1000] flex items-center justify-center p-4 backdrop-blur-sm"
		>
			<div class="border-border bg-card w-full max-w-sm rounded-2xl border p-6 shadow-2xl">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-foreground flex items-center gap-2 text-lg font-bold">
						<Users class="h-5 w-5" />
						{t('plan.inviteCollaborator')}
					</h2>
					<button
						type="button"
						onclick={() => (showCollaboratorModal = false)}
						class="text-muted-foreground hover:text-foreground"
					>
						<X class="h-5 w-5" />
					</button>
				</div>
				<input
					type="text"
					bind:value={collaboratorUsername}
					placeholder="@username"
					onkeydown={(e) => e.key === 'Enter' && handleAddCollaborator()}
					class="border-border focus:ring-primary mb-4 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:outline-none"
				/>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={() => (showCollaboratorModal = false)}
						class="border-border text-foreground hover:bg-muted rounded-lg border px-4 py-2 text-sm"
						>{t('common.actions.cancel')}</button
					>
					<button
						type="button"
						onclick={handleAddCollaborator}
						disabled={isAddingCollaborator}
						class="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
					>
						{#if isAddingCollaborator}<Loader2 class="h-4 w-4 animate-spin" />{:else}{t(
								'plan.invite'
							)}{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
{:else}
	<div class="flex min-h-[60vh] flex-col items-center justify-center gap-3">
		<p class="text-muted-foreground text-lg">{t('plan.tripNotFound')}</p>
		<a href="/dashboard/travel" class="text-primary text-sm hover:underline"
			>{t('common.navigation.travel')}</a
		>
	</div>
{/if}
