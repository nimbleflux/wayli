<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fluxbase } from '$lib/fluxbase';
	import { loadPublicSettings, getSetting } from '$lib/stores/settings.svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { effectiveBlocks, normalizeEntryBlocks } from '$lib/utils/entry-blocks';
	import EntryBlocksView from '$lib/components/EntryBlocksView.svelte';
	import TripMap from '$lib/components/TripMap.svelte';
	import EntryComments from '$lib/components/EntryComments.svelte';
	import EntryLikeButton from '$lib/components/EntryLikeButton.svelte';
	import { fetchTrackPoints } from '$lib/services/gps.service';
	import { fromStoredSegments } from '$lib/services/trip-route/trip-route-geometry';
	import { PLAN_CATEGORY_COLORS } from '$lib/utils/colors';
	import {
		ArrowLeft,
		Calendar,
		Route,
		MapPin,
		Globe,
		Compass,
		LogIn,
		BookOpen,
		ChevronLeft,
		ChevronRight,
		X
	} from 'lucide-svelte';
	import { translate } from '$lib/i18n';

	let t = $derived($translate);

	const TYPE_ICONS: Record<string, string> = {
		sightseeing: '📷',
		food: '🍴',
		activity: '🎯',
		transport: '🚇',
		accommodation: '🏨',
		rest: '☕',
		shopping: '🛍️'
	};
	// Plan item colors (shared palette from $lib/utils/colors.ts)
	const TYPE_COLORS = PLAN_CATEGORY_COLORS;

	type Trip = {
		id: string;
		user_id: string;
		title: string;
		description: string | null;
		start_date: string;
		end_date: string;
		image_url: string | null;
		metadata: Record<string, any> | null;
		visibility: string;
		plan_visible_to?: 'private' | 'friends' | 'public' | null;
	};

	type Entry = {
		id: string;
		title: string;
		body: string;
		blocks?: unknown;
		entry_date: string;
		end_date?: string | null;
	};

	type Media = {
		id: string;
		storage_path: string;
		thumbnail_path: string | null;
		caption: string;
		entry_id: string | null;
	};

	let trip = $state<Trip | null>(null);
	let entries = $state<Entry[]>([]);
	let media = $state<Media[]>([]);
	let planItems = $state<any[]>([]);

	const planTotalCost = $derived(
		planItems.reduce((s: number, i: any) => s + (i.cost_estimate ?? 0), 0)
	);
	const planCurrency = $derived(planItems[0]?.currency ?? 'EUR');
	const planBudgetByCat = $derived(
		planItems.reduce((acc: Record<string, number>, item: any) => {
			const cat = item.type || 'activity';
			acc[cat] = (acc[cat] ?? 0) + (item.cost_estimate ?? 0);
			return acc;
		}, {})
	);
	const planByDay = $derived(
		planItems.reduce((acc: Record<number, any[]>, item: any) => {
			const d = item.day_number ?? 1;
			if (!acc[d]) acc[d] = [];
			acc[d].push(item);
			return acc;
		}, {})
	);
	let allGpsPoints = $state<Array<{ lat: number; lng: number; date: string }>>([]);
	let cityMarkers = $state<Array<{ lat: number; lng: number; label: string }>>([]);
	let isLoading = $state(true);
	let notFound = $state(false);
	let lightbox = $state<Media | null>(null);
	let activeEntryId = $state<string | null>(null);
	let scrollProgress = $state(0);
	let currentUserId = $state<string | null>(null);

	const username = $derived(page.params.username ?? '');
	const tripId = $derived(page.params.tripId ?? '');

	const mapPoints = $derived(allGpsPoints.map((p) => ({ lat: p.lat, lng: p.lng })));

	// Valhalla-snapped route (trips.metadata.routeShape) — shown whenever the
	// trip has one; falls back to the raw GPS points otherwise. The shape was
	// generated server-side for owners who opted into the beta, and is already
	// privacy-clipped (home + trip exclusion zones) before storage.
	const routeSegments = $derived.by(() => {
		const stored = trip?.metadata?.routeShape?.segments;
		if (!Array.isArray(stored) || stored.length === 0) return [];
		return fromStoredSegments(stored);
	});

	const highlightPoints = $derived.by(() => {
		if (!activeEntryId) return [];
		const entry = entries.find((e) => e.id === activeEntryId);
		if (!entry) return [];
		const startDay = (entry.entry_date || '').slice(0, 10);
		const endDay = (entry.end_date || entry.entry_date || '').slice(0, 10);
		return allGpsPoints
			.filter((p) => p.date >= startDay && p.date <= endDay)
			.map((p) => ({ lat: p.lat, lng: p.lng }));
	});

	let entryElements = $state<Map<string, HTMLElement>>(new Map());
	let observer: IntersectionObserver | null = null;

	function setupScrollObserver() {
		if (observer) observer.disconnect();
		observer = new IntersectionObserver(
			(els) => {
				for (const e of els) {
					if (e.isIntersecting) {
						const id = (e.target as HTMLElement).dataset.entryId;
						if (id) activeEntryId = id;
					}
				}
			},
			{ rootMargin: '-30% 0px -50% 0px', threshold: 0 }
		);
		// Query DOM directly instead of relying on entryElements map
		document.querySelectorAll('[data-entry-id]').forEach((el) => observer?.observe(el));
	}

	function onScroll() {
		const max = document.body.scrollHeight - window.innerHeight;
		scrollProgress = max > 0 ? (window.scrollY / max) * 100 : 0;
	}

	const allLightboxMedia = $derived(media);
	function navigateLightbox(direction: number) {
		if (!lightbox || allLightboxMedia.length === 0) return;
		const idx = allLightboxMedia.findIndex((m) => m.id === lightbox!.id);
		if (idx === -1) return;
		const next = (idx + direction + allLightboxMedia.length) % allLightboxMedia.length;
		lightbox = allLightboxMedia[next];
	}

	let touchStartX = 0;
	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
	}
	function handleTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		if (Math.abs(dx) > 50) navigateLightbox(dx > 0 ? -1 : 1);
	}

	onMount(async () => {
		window.addEventListener('scroll', onScroll, { passive: true });

		// Read the auth-required gate from the central settings store (one bulk
		// fetch, no per-key 404). `public_trips_require_auth` is is_public, so
		// anonymous visitors now honor the admin's setting — previously this read
		// silently failed for anon and defaulted to "open", bypassing the gate.
		await loadPublicSettings();
		const setting = getSetting<unknown>('wayli.public_trips_require_auth', null);
		const requireAuth =
			setting === true ||
			setting === 'true' ||
			(typeof setting === 'object' &&
				setting &&
				((setting as any).value === true || (setting as any).value === 'true'));
		if (requireAuth) {
			try {
				const { data: session } = await fluxbase.auth.getSession();
				if (!session?.session?.user) {
					goto(`/auth/signin?redirectTo=/u/${username}/trips/${tripId}`);
					return;
				}
			} catch {
				goto(`/auth/signin?redirectTo=/u/${username}/trips/${tripId}`);
				return;
			}
		}

		// Get current user ID (if logged in)
		try {
			const { data: session } = await fluxbase.auth.getSession();
			currentUserId = session?.session?.user?.id ?? null;
		} catch {
			currentUserId = null;
		}

		try {
			const { data: tripData } = await fluxbase.from('trips').select('*').eq('id', tripId).single();
			if (!tripData) {
				notFound = true;
				return;
			}
			trip = tripData as unknown as Trip;

			// RLS handles authorization — if the query returned a trip, the user
			// is allowed to see it (owner, public, or shared via trip_shares).
			// No client-side visibility check needed.

			// Owner sees all entries (including drafts); non-owners see published only.
			// Use base trip_entries table for all viewers — RLS on trip_entries now
			// honors trip_shares (migration 073), so share recipients can see entries
			// from private/shared trips. The public_trip_entries view still hard-filters
			// visibility='public' and would miss shared-but-private trips.
			const isOwnerViewer = (trip as any).user_id === currentUserId;
			const entryQuery = fluxbase
				.from('trip_entries')
				.select('id, title, body, blocks, entry_date, end_date')
				.eq('trip_id', tripId)
				.order('entry_date', { ascending: true });
			if (!isOwnerViewer) {
				entryQuery.eq('status', 'published');
			}
			const { data: entryData } = await entryQuery;
			entries = (entryData as unknown as Entry[]) ?? [];

			const mediaTable = isOwnerViewer ? 'trip_media' : 'public_trip_media';
			const { data: mediaData } = await fluxbase
				.from(mediaTable)
				.select('id, storage_path, thumbnail_path, caption, entry_id')
				.eq('trip_id', tripId)
				.order('sort_order', { ascending: true });
			media = (mediaData as unknown as Media[]) ?? [];

			// Hide imported entries that are truly empty — no title, no body,
			// and no linked media. They otherwise render as blank cards
			// (typically Polarsteps steps with no name/description/photos).
			const entryIdsWithMedia = new Set(media.map((m) => m.entry_id).filter(Boolean));
			entries = entries.filter(
				(e) => !((e.title ?? '') === '' && (e.body ?? '') === '' && !entryIdsWithMedia.has(e.id))
			);

			// Load plan items if shared with viewer (RLS enforces actual visibility)
			if (trip?.plan_visible_to && trip.plan_visible_to !== 'private') {
				const { data: planData } = await fluxbase
					.from('trip_plan_items')
					.select('title, type, start_time, cost_estimate, currency, day_number')
					.eq('trip_id', tripId)
					.order('day_number', { ascending: true })
					.order('sort_order', { ascending: true });
				planItems = (planData as any[]) ?? [];
			}

			try {
				// Load the GPS track for the trip.
				//
				// OWNER path: query tracker_data directly via fetchTrackPoints.
				// The owner's session grants RLS access, and — importantly —
				// get_public_trip_track() is SECURITY DEFINER, so its internal
				// can_see_gps()/auth.uid() check resolves the function owner
				// rather than the caller, making the owner's own private trips
				// invisible through the RPC (commit 473caa3b). The direct query
				// avoids that.
				//
				// NON-OWNER path: fall back to the get-public-trip-track RPC
				// (gated by can_see_gps: public trip / share / friend).
				if (trip?.user_id && trip.start_date) {
					if (isOwnerViewer) {
						allGpsPoints = await fetchTrackPoints(
							trip.user_id,
							trip.start_date,
							trip.end_date || trip.start_date
						);
					} else {
						const { data: rpcData, error: trackErr } = await (fluxbase.rpc as any).invoke(
							'get-public-trip-track',
							{ trip_uuid: tripId },
							{ namespace: 'wayli' }
						);
						// rpc.invoke result shape varies; unwrap robustly.
						let rows: any[] = [];
						const raw = rpcData as any;
						if (Array.isArray(raw)) rows = raw;
						else if (raw?.result)
							rows = typeof raw.result === 'string' ? JSON.parse(raw.result) : raw.result;
						else if (Array.isArray(raw?.data)) rows = raw.data;
						else if (raw?.data?.result)
							rows =
								typeof raw.data.result === 'string' ? JSON.parse(raw.data.result) : raw.data.result;

						if (!trackErr && rows.length > 0) {
							allGpsPoints = rows
								.filter((p) => p.lat != null && p.lng != null)
								.map((p) => {
									const dt = p.recorded_at ? new Date(p.recorded_at) : null;
									return {
										lat: p.lat,
										lng: p.lng,
										// Local date (not UTC) so it lines up with entry_date.
										date: dt ? dt.toLocaleDateString('en-CA') : ''
									};
								});
						}
					}
				}
			} catch {
				// GPS track not available
			}

			if (trip?.metadata?.visitedCitiesDetailed) {
				cityMarkers = trip.metadata.visitedCitiesDetailed
					.filter((c: any) => c.lat && c.lng)
					.map((c: any) => ({ lat: c.lat, lng: c.lng, label: c.city || 'Unknown' }));
			}

			if (entries.length > 0) activeEntryId = entries[0].id;

			// Deep-link: if the URL has ?entry=<id>, scroll to + activate that
			// specific entry (e.g. arriving from the feed "Read more").
			const entryParam = page.url.searchParams.get('entry');
			if (entryParam) {
				const found = entries.find((e) => e.id === entryParam);
				if (found) {
					activeEntryId = found.id;
					setTimeout(() => {
						document
							.querySelector(`[data-entry-id="${entryParam}"]`)
							?.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}, 200);
				}
			}

			setTimeout(() => setupScrollObserver(), 100);
		} catch {
			notFound = true;
		} finally {
			isLoading = false;
		}
	});

	function formatDateRange(start: string, end: string): string {
		const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
		return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(end).toLocaleDateString(undefined, opts)}`;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (!lightbox) return;
		if (e.key === 'Escape') lightbox = null;
		else if (e.key === 'ArrowLeft') navigateLightbox(-1);
		else if (e.key === 'ArrowRight') navigateLightbox(1);
	}}
/>

<svelte:head>
	<title>{trip ? `${trip.title} · Wayli` : 'Wayli'}</title>
</svelte:head>

{#if isLoading}
	<div class="bg-background flex min-h-screen items-center justify-center">
		<div class="border-primary h-10 w-10 animate-spin rounded-full border-2"></div>
	</div>
{:else if notFound || !trip}
	<div class="bg-background flex min-h-screen flex-col items-center justify-center gap-3 p-4">
		<Compass class="text-muted-foreground h-12 w-12 opacity-40" />
		<p class="text-muted-foreground text-lg">{t('publicTrip.tripNotFound')}</p>
		<a href="/u/{username}" class="text-primary text-sm hover:underline"
			>{t('publicTrip.backToProfile')}</a
		>
	</div>
{:else}
	<!-- Reading progress bar -->
	<div class="fixed top-0 left-0 z-[60] h-1 w-full bg-transparent">
		<div
			class="bg-primary h-full transition-all duration-150 ease-out"
			style="width: {scrollProgress}%"
		></div>
	</div>

	<!-- Floating buttons -->
	<div class="fixed top-4 right-4 z-50 flex items-center gap-2">
		{#if currentUserId}
			<a
				href="/dashboard/feed"
				class="bg-background/80 text-foreground ring-border inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105"
			>
				<ArrowLeft class="h-3.5 w-3.5" />
				Explore
			</a>
		{/if}
		{#if currentUserId}
			<a
				href="/dashboard/travel"
				class="bg-background/80 text-foreground ring-border inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105"
			>
				<BookOpen class="h-4 w-4" />
				{t('publicTrip.myTravel')}
			</a>
		{:else}
			<a
				href="/auth/signin"
				class="bg-background/80 text-foreground ring-border inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105"
			>
				<LogIn class="h-4 w-4" />
				{t('auth.signIn')}
			</a>
		{/if}
	</div>

	<!-- Full-bleed trip hero -->
	<div class="relative h-[340px] w-full overflow-hidden sm:h-[420px]">
		{#if trip.image_url}
			<img
				src={storageRefToUrl(trip.image_url)}
				alt={trip.title}
				class="h-full w-full object-cover"
				style="object-position: {(trip.metadata?.image_focal_x ?? 0.5) * 100}% {(trip.metadata
					?.image_focal_y ?? 0.5) * 100}%"
			/>
		{:else}
			<div class="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900"></div>
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/20"></div>

		<!-- Back link -->
		<a
			href="/u/{username}"
			class="absolute top-5 left-5 inline-flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-all hover:scale-105 hover:bg-black/50"
		>
			<ArrowLeft class="h-4 w-4" />
			@{username}
		</a>

		<!-- Title + meta at bottom -->
		<div class="absolute right-0 bottom-0 left-0 p-6 sm:p-10">
			<div class="mx-auto max-w-7xl">
				<h1 class="mb-3 text-3xl font-bold tracking-tight text-white drop-shadow-xl sm:text-5xl">
					{trip.title}
				</h1>
				{#if trip.description}
					<p class="mb-4 max-w-2xl text-base text-white/60">{trip.description}</p>
				{/if}
				<div class="flex flex-wrap items-center gap-4 text-sm text-white/50">
					<span class="flex items-center gap-1.5">
						<Calendar class="h-4 w-4" />
						{formatDateRange(trip.start_date, trip.end_date)}
					</span>
					{#if trip.metadata?.primaryCity}
						<span class="flex items-center gap-1.5">
							<MapPin class="h-4 w-4" />
							{trip.metadata.primaryCity}
						</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Content -->
	<div class="mx-auto max-w-7xl px-4 py-8">
		<div class="grid gap-8 lg:grid-cols-[1fr_400px]">
			<!-- Journal feed -->
			<div class="space-y-8">
				{#if entries.length > 0}
					{#each entries as entry, i (entry.id)}
						<div
							data-entry-id={entry.id}
							onclick={() => (activeEntryId = entry.id)}
							onkeydown={(e) => e.key === 'Enter' && (activeEntryId = entry.id)}
							role="button"
							tabindex="0"
							class="animate-fade-in-up bg-card border-border cursor-pointer scroll-mt-4 rounded-3xl border p-6 transition-all duration-300 {activeEntryId ===
							entry.id
								? 'ring-primary/30 shadow-lg ring-2'
								: 'shadow-sm hover:shadow-md'}"
							style="animation-delay: {i * 100}ms"
						>
							<!-- Date badge -->
							<div class="mb-4 flex items-center gap-3">
								<div
									class="bg-primary/10 text-primary flex h-12 w-12 flex-col items-center justify-center rounded-2xl"
								>
									<span class="text-[10px] leading-none font-bold uppercase">
										{new Date(entry.entry_date).toLocaleDateString(undefined, { month: 'short' })}
									</span>
									<span class="text-lg leading-tight font-extrabold">
										{new Date(entry.entry_date).getDate()}
									</span>
								</div>
								<div>
									<div class="text-muted-foreground text-xs font-medium">
										{new Date(entry.entry_date).toLocaleDateString(undefined, {
											weekday: 'long',
											year: 'numeric',
											month: 'long',
											day: 'numeric'
										})}
									</div>
									{#if entry.end_date && entry.end_date !== entry.entry_date}
										<div class="text-muted-foreground/60 text-xs">
											{t('publicTrip.until', {
												date: new Date(entry.end_date).toLocaleDateString(undefined, {
													month: 'short',
													day: 'numeric'
												})
											})}
										</div>
									{/if}
								</div>
							</div>

							{#if entry.title}
								<h3 class="text-foreground mb-3 text-2xl font-bold tracking-tight">
									{entry.title}
								</h3>
							{/if}
							{#if entry.body || media.some((m) => m.entry_id === entry.id)}
								{@const entryMedia = media.filter((m) => m.entry_id === entry.id)}
								{@const entryBlockList = effectiveBlocks(
									{ body: entry.body, blocks: normalizeEntryBlocks(entry.blocks) },
									entryMedia
								)}
								{#if entryBlockList.length > 0}
									<EntryBlocksView
										blocks={entryBlockList}
										mediaById={new Map(
											entryMedia.map((m) => [
												m.id,
												{
													url: storageRefToUrl(m.thumbnail_path ?? m.storage_path),
													fullUrl: storageRefToUrl(m.storage_path),
													caption: m.caption
												}
											])
										)}
									/>
								{/if}
							{/if}

							<!-- Engagement -->
							<div class="border-border mt-5 flex items-start gap-3 border-t pt-4">
								<EntryLikeButton {tripId} entryId={entry.id} />
								<div class="flex-1">
									<EntryComments {tripId} entryId={entry.id} />
								</div>
							</div>

							<!-- Pexels attribution -->
							{#if trip.metadata?.image_attribution?.photographer}
								<p class="absolute right-4 bottom-3 z-10 text-[10px] text-white/40">
									{t('common.photoBy')}
									<a
										href={trip.metadata.image_attribution.photographer_url}
										target="_blank"
										rel="noopener"
										class="hover:text-white/60 hover:underline"
										>{trip.metadata.image_attribution.photographer}</a
									>
									{t('common.on')}
									<a
										href={trip.metadata.image_attribution.pexels_url}
										target="_blank"
										rel="noopener"
										class="hover:text-white/60 hover:underline">Pexels</a
									>
								</p>
							{/if}
						</div>
					{/each}
				{:else}
					<div class="flex flex-col items-center justify-center py-20 text-center">
						<MapPin class="text-muted-foreground mb-4 h-12 w-12 opacity-30" />
						<p class="text-muted-foreground text-lg">{t('publicTrip.noEntries')}</p>
					</div>
				{/if}
			</div>

			<!-- Public plan items + budget -->
			{#if planItems.length > 0}
				<div class="bg-card border-border mt-8 rounded-2xl border p-6">
					<h2 class="text-foreground mb-4 text-lg font-bold">{t('publicTrip.tripPlanCosts')}</h2>

					<!-- Budget summary -->
					{#if planTotalCost > 0}
						<div class="mb-4 flex items-center gap-2">
							<span class="text-muted-foreground text-sm">{t('common.total')}</span>
							<span class="text-foreground text-xl font-bold"
								>{planCurrency} {planTotalCost.toFixed(0)}</span
							>
						</div>
						<div class="mb-4 flex flex-wrap gap-3">
							{#each Object.entries(planBudgetByCat).sort(([, a], [, b]) => b - a) as [cat, amount]}
								<div class="flex items-center gap-1.5 text-xs">
									<span
										class="h-2 w-2 rounded-full"
										style="background: {TYPE_COLORS[cat] ?? '#6b7280'}"
									></span>
									<span class="text-muted-foreground">{cat}</span>
									<span class="text-foreground font-medium">{amount.toFixed(0)}</span>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Plan items by day -->
					<div class="space-y-3">
						{#each Object.entries(planByDay).sort(([a], [b]) => Number(a) - Number(b)) as [day, dayItems]}
							<div>
								<div class="text-muted-foreground mb-1 text-xs font-medium uppercase">
									{t('plan.dayLabel', { day })}
								</div>
								<div class="flex flex-wrap gap-2">
									{#each dayItems as item}
										<span
											class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium"
											style="background: {TYPE_COLORS[item.type] ??
												'#6b7280'}20; color: {TYPE_COLORS[item.type] ?? '#6b7280'}"
										>
											{TYPE_ICONS[item.type] ?? '📌'}
											{item.title}
											{#if item.cost_estimate}
												<span class="opacity-70"
													>· {item.currency} {item.cost_estimate.toFixed(0)}</span
												>
											{/if}
										</span>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Sticky map sidebar (only when there are entries — the no-entries
			     case shows the route as main content below instead) -->
			<div class="hidden {entries.length > 0 ? 'lg:block' : ''}">
				<div class="sticky top-6 space-y-4">
					<div class="border-border overflow-hidden rounded-3xl border shadow-xl">
						<div class="border-border bg-card flex items-center gap-2 border-b px-4 py-3">
							<MapPin class="text-primary h-4 w-4" />
							<span class="text-foreground text-sm font-semibold">
								{#if activeEntryId}
									{entries.find((e) => e.id === activeEntryId)?.entry_date
										? new Date(
												entries.find((e) => e.id === activeEntryId)!.entry_date
											).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
										: t('publicTrip.route')}
								{:else}
									{t('publicTrip.route')}
								{/if}
							</span>
							{#if highlightPoints.length > 0}
								<span class="text-muted-foreground ml-auto text-xs">
									{t('publicTrip.points', { count: highlightPoints.length })}
								</span>
							{/if}
						</div>
						{#if mapPoints.length > 0 || cityMarkers.length > 0 || routeSegments.length > 0}
							<TripMap
								points={mapPoints}
								segments={routeSegments}
								markers={cityMarkers}
								{highlightPoints}
								class="h-[420px]"
							/>
						{:else}
							<div
								class="text-muted-foreground flex h-64 items-center justify-center px-6 text-center text-sm"
							>
								{t('publicTrip.noGpsData')}
							</div>
						{/if}
					</div>

					<!-- Entry navigation dots -->
					{#if entries.length > 1}
						<div class="border-border bg-card rounded-2xl border p-4 shadow-sm">
							<div class="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
								{t('publicTrip.entries')}
							</div>
							<div class="flex flex-wrap gap-2">
								{#each entries as entry, i (entry.id)}
									<button
										type="button"
										onclick={() => {
											activeEntryId = entry.id;
											document
												.querySelector(`[data-entry-id="${entry.id}"]`)
												?.scrollIntoView({ behavior: 'smooth', block: 'start' });
										}}
										class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 {activeEntryId ===
										entry.id
											? 'bg-primary text-primary-foreground scale-110 shadow-md'
											: 'bg-muted text-muted-foreground hover:bg-muted/70 hover:scale-105'}"
									>
										{i + 1}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Route map: on mobile it supplements the sticky sidebar map; when the trip
     has no journal entries the route is the page's content, so it shows at
     full size on every screen size. -->
{#if !isLoading && !notFound && trip && (allGpsPoints.length > 0 || cityMarkers.length > 0 || routeSegments.length > 0)}
	<div class="mx-auto mt-4 max-w-7xl px-4 {entries.length === 0 ? '' : 'lg:hidden'}">
		<div class="border-border bg-card overflow-hidden rounded-3xl border p-3 shadow-sm">
			<div class="text-foreground mb-2 flex items-center gap-2 text-sm font-semibold">
				<MapPin class="text-primary h-4 w-4" />
				{#if activeEntryId}
					{t('plan.dayLabel', { day: entries.findIndex((e) => e.id === activeEntryId) + 1 })}
				{:else}
					{t('publicTrip.route')}
				{/if}
			</div>
			<TripMap
				points={mapPoints}
				segments={routeSegments}
				markers={cityMarkers}
				{highlightPoints}
				class={entries.length === 0 ? 'h-[420px]' : 'h-56'}
			/>
		</div>
	</div>
{/if}

<!-- Lightbox with navigation -->
{#if lightbox}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/90 pt-8"
		onclick={() => (lightbox = null)}
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
		role="presentation"
	>
		<button
			type="button"
			class="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
			aria-label="Close"><X class="h-6 w-6" /></button
		>
		{#if media.length > 1}
			<button
				type="button"
				class="absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					navigateLightbox(-1);
				}}
				aria-label="Previous photo"><ChevronLeft class="h-6 w-6" /></button
			>
			<button
				type="button"
				class="absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					navigateLightbox(1);
				}}
				aria-label="Next photo"><ChevronRight class="h-6 w-6" /></button
			>
		{/if}
		<img
			src={storageRefToUrl(lightbox.storage_path)}
			alt={lightbox.caption || 'Photo'}
			class="animate-scale-in max-h-[92vh] max-w-full rounded-lg object-contain"
			role="presentation"
		/>
	</div>
{/if}
