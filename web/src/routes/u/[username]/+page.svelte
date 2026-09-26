<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fluxbase } from '$lib/fluxbase';
	import { loadPublicSettings, getSetting } from '$lib/stores/settings.svelte';
	import { userStore } from '$lib/stores/auth';
	import {
		MapPin,
		Calendar,
		Route,
		Globe,
		Compass,
		LogIn,
		BookOpen,
		EyeOff,
		Sun,
		Moon,
		ArrowLeft,
		Activity
	} from 'lucide-svelte';
	import { setTheme, state as appState } from '$lib/stores/app-state.svelte';
	import PannableCover from '$lib/components/PannableCover.svelte';
	import WorldMap from '$lib/components/WorldMap.svelte';
	import { translate } from '$lib/i18n';
	import {
		formatDistance as fmtDistance,
		formatDuration as fmtDuration,
		sportTheme
	} from '$lib/utils/fitness';

	let t = $derived($translate);

	type Profile = {
		id: string;
		username: string;
		first_name?: string | null;
		full_name: string | null;
		avatar_url: string | null;
		cover_photo_url: string | null;
		cover_focal_x?: number;
		cover_focal_y?: number;
	};

	type PublicTrip = {
		id: string;
		title: string;
		description: string | null;
		start_date: string;
		end_date: string;
		image_url: string | null;
		visibility: string;
		metadata: Record<string, any> | null;
		entry_count?: number;
	};

	let profile = $state<Profile | null>(null);
	let trips = $state<PublicTrip[]>([]);
	// Shared fitness activities (movement timeline) — gated server-side by
	// can_see_activity: anon effectively sees only effective 'public' ones.
	let activities = $state<
		Array<{
			id: string;
			title: string | null;
			sport: string | null;
			started_at: string;
			total_distance_m: number | null;
			elapsed_time_s: number | null;
			moving_time_s: number | null;
		}>
	>([]);
	let typeFilter = $state<'all' | 'trips' | 'activities'>('all');
	let isLoading = $state(true);
	let notFound = $state(false);
	let isOwner = $state(false);
	let journalOnly = $state(false);
	let sortBy = $state<'recent' | 'oldest' | 'title' | 'duration' | 'entries'>('recent');
	let sortReverse = $state(false);
	let currentUserId = $state<string | null>(null);

	const username = $derived(page.params.username ?? '');

	const stats = $derived.by(() => {
		const cities = new Set<string>();
		const countries = new Set<string>();
		let totalDistance = 0;
		for (const trip of trips) {
			if (trip.metadata?.visitedCitiesDetailed) {
				for (const c of trip.metadata.visitedCitiesDetailed) {
					if (c.city) cities.add(c.city);
					if (c.countryCode) countries.add(c.countryCode);
				}
			}
			totalDistance += trip.metadata?.distanceTraveled ?? 0;
		}
		return {
			trips: trips.length,
			cities: cities.size,
			countries: countries.size,
			distance: totalDistance,
			tripsWithJournal: trips.filter((t) => (t.entry_count ?? 0) > 0).length
		};
	});

	// World map: visited countries. The owner gets the full dwell-based set
	// (visited-countries RPC over all their tracker data); visitors keep the
	// trip-metadata derivation so only countries from trips they can see show —
	// the RPC would leak presence from private trips.
	let trackedCountries = $state<string[] | null>(null); // null = not loaded / not owner

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

	/** Owner-only: load the cached dwell-based country set. Silent on failure. */
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
			// fallback stays active
		}
	}

	// Merged movement timeline: trips + shared fitness activities, newest
	// first, with All / Trips / Activities type filters. Sort keys apply to
	// both kinds (activities sort by title / moving time / date; entries
	// counts as 0).
	type TimelineItem =
		| { kind: 'trip'; id: string; ts: number; title: string; trip: PublicTrip }
		| {
				kind: 'activity';
				id: string;
				ts: number;
				title: string;
				activity: (typeof activities)[number];
		  };

	const timeline = $derived.by(() => {
		const items: TimelineItem[] = [];
		if (typeFilter !== 'activities') {
			for (const trip of journalOnly ? trips.filter((t) => (t.entry_count ?? 0) > 0) : trips) {
				items.push({
					kind: 'trip',
					id: trip.id,
					ts: new Date(trip.start_date).getTime(),
					title: trip.title || '',
					trip
				});
			}
		}
		if (typeFilter !== 'trips') {
			for (const activity of activities) {
				items.push({
					kind: 'activity',
					id: activity.id,
					ts: new Date(activity.started_at).getTime(),
					title: activity.title || '',
					activity
				});
			}
		}
		switch (sortBy) {
			case 'title':
				items.sort((a, b) => a.title.localeCompare(b.title));
				break;
			case 'duration':
				items.sort((a, b) => {
					const da =
						a.kind === 'trip'
							? new Date(a.trip.end_date).getTime() - new Date(a.trip.start_date).getTime()
							: (a.activity.moving_time_s ?? a.activity.elapsed_time_s ?? 0) * 1000;
					const db =
						b.kind === 'trip'
							? new Date(b.trip.end_date).getTime() - new Date(b.trip.start_date).getTime()
							: (b.activity.moving_time_s ?? b.activity.elapsed_time_s ?? 0) * 1000;
					return db - da;
				});
				break;
			case 'entries':
				items.sort((a, b) => {
					const ea = a.kind === 'trip' ? (a.trip.entry_count ?? 0) : 0;
					const eb = b.kind === 'trip' ? (b.trip.entry_count ?? 0) : 0;
					return eb - ea;
				});
				break;
			default:
				items.sort((a, b) => b.ts - a.ts);
		}
		if (sortReverse) items.reverse();
		return items;
	});

	onMount(async () => {
		try {
			const { data: session } = await fluxbase.auth.getSession();
			currentUserId = session?.session?.user?.id ?? null;
		} catch {
			currentUserId = null;
		}

		// Read the auth-required gate from the central settings store (one bulk
		// fetch in the root layout, no per-key 404). `public_trips_require_auth`
		// is marked is_public, so anonymous visitors now honor the admin's setting
		// — previously this read silently failed for anon (settings needed auth)
		// and defaulted to "open", bypassing the gate for the exact audience it
		// was meant to restrict. Fall back to a direct read if the store isn't
		// populated yet, then default to open if still unset.
		await loadPublicSettings();
		const setting = getSetting<unknown>('wayli.public_trips_require_auth', null);
		const requireAuth =
			setting === true ||
			setting === 'true' ||
			(typeof setting === 'object' &&
				setting &&
				((setting as any).value === true || (setting as any).value === 'true'));
		if (requireAuth && !currentUserId) {
			if (!currentUserId) {
				goto(`/auth/signin?redirectTo=/u/${username}`);
				return;
			}
		}

		try {
			const { data: profileData } = await fluxbase
				.from('public_profiles')
				.select('*')
				.eq('username', username)
				.single();

			if (!profileData) {
				notFound = true;
				return;
			}
			profile = profileData as unknown as Profile;
			isOwner = currentUserId === profile.id;

			// Owner: upgrade the map to the full dwell-based country set. Visitors
			// keep the metadata derivation (no presence leak from private trips).
			if (isOwner) void loadTrackedCountries();

			let tripQuery = fluxbase
				.from('trips')
				.select('id, title, description, start_date, end_date, image_url, visibility, metadata')
				.eq('user_id', profile.id)
				.in('status', ['active', 'planned', 'completed'])
				.order('start_date', { ascending: false });

			if (!isOwner && !currentUserId) {
				// Anonymous viewer: only public trips
				tripQuery = tripQuery.eq('visibility', 'public');
			}
			// Logged-in non-owner: no filter — RLS returns public + shared trips

			const { data: tripData } = await tripQuery;
			trips = (tripData as unknown as PublicTrip[]) ?? [];

			// Shared fitness activities for the movement timeline. RLS on the
			// public view decides what this viewer may see (anon: only
			// effectively-public ones).
			try {
				const { data: activityData } = await fluxbase
					.from('public_fitness_activities')
					.select('id, title, sport, started_at, total_distance_m, elapsed_time_s, moving_time_s')
					.eq('user_id', profile.id)
					.order('started_at', { ascending: false })
					.limit(100);
				activities = (activityData as any[]) ?? [];
			} catch {
				// Activities are additive — ignore load errors.
			}

			// Fetch journal entry counts per trip. Use trip_entries directly
			// instead of the public_trip_entries view, which can error on
			// certain Fluxbase API queries due to auth.uid() in the view.
			if (trips.length > 0) {
				try {
					const { data: entryCounts, error: entryErr } = await fluxbase
						.from('trip_entries')
						.select('trip_id')
						.eq('status', 'published')
						.in(
							'trip_id',
							trips.map((t) => t.id)
						);
					if (entryErr) throw entryErr;
					if (entryCounts) {
						const counts = new Map<string, number>();
						for (const e of entryCounts as any[]) {
							counts.set(e.trip_id, (counts.get(e.trip_id) ?? 0) + 1);
						}
						trips = trips.map((t) => ({ ...t, entry_count: counts.get(t.id) ?? 0 }));
					}
				} catch {
					// non-critical
				}
			}
		} catch {
			notFound = true;
		} finally {
			isLoading = false;
		}
	});

	function formatDistance(meters: number): string {
		if (!meters || meters < 1) return '0 km';
		if (meters < 1000) return `${Math.round(meters)} m`;
		const km = meters / 1000;
		if (km < 100) return `${km.toFixed(0)} km`;
		if (km < 10000) return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
		return `${(km / 1000).toFixed(0)}k km`;
	}

	async function saveCoverFocal(x: number, y: number) {
		if (!isOwner || !profile) return;
		profile.cover_focal_x = x;
		profile.cover_focal_y = y;
		try {
			await fluxbase
				.from('user_profiles')
				.update({ cover_focal_x: x, cover_focal_y: y })
				.eq('id', profile.id);
		} catch {
			// non-critical
		}
	}
</script>

<svelte:head>
	<title>{profile ? `${profile.full_name || '@' + profile.username} · Wayli` : 'Wayli'}</title>
</svelte:head>

{#if isLoading}
	<div class="flex min-h-[60vh] items-center justify-center">
		<div class="border-primary h-10 w-10 animate-spin rounded-full border-2"></div>
	</div>
{:else if notFound}
	<div class="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4">
		<Compass class="text-muted-foreground h-12 w-12 opacity-40" />
		<p class="text-muted-foreground text-lg">{t('profile.travelerNotFound')}</p>
		<a href="/" class="text-primary inline-flex items-center gap-1 text-sm hover:underline">
			<ArrowLeft class="h-3.5 w-3.5" />
			{t('profile.home')}
		</a>
	</div>
{:else if profile}
	<!-- Floating top bar — matches landing/stories/travelers pill -->
	<div
		class="bg-background/80 border-border fixed top-4 right-4 z-50 flex items-center gap-2 rounded-full border px-2 py-1 shadow-sm backdrop-blur-md"
	>
		<a
			href="/"
			class="text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
		>
			<ArrowLeft class="h-4 w-4" />
			{t('profile.home')}
		</a>
		<div class="flex gap-1">
			<button
				type="button"
				onclick={() => setTheme('light')}
				class="cursor-pointer rounded-lg p-2 transition-colors {appState.theme === 'light'
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground hover:bg-muted'}"
			>
				<Sun class="h-4 w-4" />
			</button>
			<button
				type="button"
				onclick={() => setTheme('dark')}
				class="cursor-pointer rounded-lg p-2 transition-colors {appState.theme === 'dark'
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground hover:bg-muted'}"
			>
				<Moon class="h-4 w-4" />
			</button>
		</div>
		{#if isOwner}
			<a
				href="/dashboard/travel"
				class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
			>
				<BookOpen class="h-4 w-4" />
				{t('common.navigation.dashboard')}
			</a>
		{:else if currentUserId}
			<a
				href="/dashboard/travel"
				class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
			>
				<BookOpen class="h-4 w-4" />
				{t('profile.myTravel')}
			</a>
		{:else}
			<a
				href="/auth/signin"
				class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
			>
				<LogIn class="h-4 w-4" />
				{t('auth.signIn')}
			</a>
		{/if}
	</div>

	<!-- Full-bleed hero -->
	<div class="relative h-[420px] w-full overflow-hidden">
		{#if profile.cover_photo_url}
			<PannableCover
				src={storageRefToUrl(profile.cover_photo_url)}
				focalX={profile.cover_focal_x ?? 0.5}
				focalY={profile.cover_focal_y ?? 0.5}
				editable={isOwner}
				onFocalChange={saveCoverFocal}
				class="h-full w-full"
			/>
		{:else}
			<div class="h-full w-full bg-gradient-to-br from-slate-800 via-slate-700 to-slate-500"></div>
		{/if}
		<!-- Gradient overlays for text legibility -->
		<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/30"></div>

		<!-- Hero content -->
		<div class="inset-bottom-0 absolute bottom-0 mx-auto max-w-6xl px-6 pb-8">
			<div class="flex items-end gap-5">
				<!-- Avatar -->
				{#if profile.avatar_url}
					<img
						src={storageRefToUrl(profile.avatar_url)}
						alt={profile.full_name || profile.username}
						class="h-28 w-28 rounded-3xl border-2 border-white/20 object-cover shadow-2xl"
					/>
				{:else}
					<div
						class="flex h-28 w-28 items-center justify-center rounded-3xl border-2 border-white/20 bg-white/10 text-4xl font-bold text-white shadow-2xl backdrop-blur-sm"
					>
						{(profile.full_name || profile.username)[0]?.toUpperCase()}
					</div>
				{/if}
				<!-- Name + handle -->
				<div class="pb-2">
					<h1 class="text-3xl font-bold tracking-tight text-white drop-shadow-lg sm:text-4xl">
						{profile.first_name || profile.full_name || `@${profile.username}`}
					</h1>
					<p class="flex items-center gap-1.5 text-base text-white/70">
						<Globe class="h-4 w-4" />
						@{profile.username}
					</p>
				</div>
			</div>
			<!-- Stats pills -->
			{#if stats.trips > 0}
				<div class="mt-5 flex flex-wrap gap-3">
					<div
						class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur-md"
					>
						<Route class="h-4 w-4 text-white/60" />
						<span class="font-bold text-white">{stats.trips}</span>
						<span class="text-white/60"
							>{stats.trips === 1 ? t('common.trip') : t('common.trips')}</span
						>
					</div>
					<div
						class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur-md"
					>
						<Globe class="h-4 w-4 text-white/60" />
						<span class="font-bold text-white">{stats.countries}</span>
						<span class="text-white/60"
							>{stats.countries === 1 ? t('common.country') : t('common.countries')}</span
						>
					</div>
					<div
						class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur-md"
					>
						<MapPin class="h-4 w-4 text-white/60" />
						<span class="font-bold text-white">{stats.cities}</span>
						<span class="text-white/60"
							>{stats.cities === 1 ? t('common.city') : t('common.cities')}</span
						>
					</div>
					<div
						class="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur-md"
					>
						<Route class="h-4 w-4 text-white/60" />
						<span class="font-bold text-white">{formatDistance(stats.distance)}</span>
						<span class="text-white/60">{t('profile.traveled')}</span>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- World map -->
	{#if visitedCountries.length > 0}
		<div class="mx-auto max-w-6xl px-4 pt-8">
			<div class="bg-card border-border rounded-2xl border p-4">
				<div class="mb-3 flex items-center justify-between">
					<h3 class="text-foreground text-sm font-bold tracking-wide uppercase">Where I've Been</h3>
					<span class="text-muted-foreground text-xs">
						{visitedCountries.length}
						{visitedCountries.length === 1 ? 'country' : 'countries'}
					</span>
				</div>
				<WorldMap {visitedCountries} class="h-56" />
			</div>
		</div>
	{/if}

	<!-- Trip cards -->
	<div class="mx-auto max-w-6xl px-4 py-10">
		{#if timeline.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<Route class="text-muted-foreground mb-4 h-12 w-12 opacity-30" />
				<p class="text-muted-foreground text-lg">{t('profile.noTrips')}</p>
			</div>
		{:else}
			<!-- Sort + filter buttons -->
			<div class="mb-6 flex flex-wrap items-center gap-2">
				{#if activities.length > 0}
					<div
						class="bg-muted mr-1 inline-flex rounded-full p-0.5"
						role="group"
						aria-label="Timeline type"
					>
						{#each [['all', `${trips.length + activities.length}`], ['trips', `${trips.length}`], ['activities', `${activities.length}`]] as [value, count] (value)}
							<button
								type="button"
								onclick={() => (typeFilter = value as typeof typeFilter)}
								class="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors {typeFilter ===
								value
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								aria-pressed={typeFilter === value}
							>
								{value === 'all'
									? `All (${count})`
									: value === 'trips'
										? `Trips (${count})`
										: `Activities (${count})`}
							</button>
						{/each}
					</div>
				{/if}
				{#each [['recent', 'Recent'], ['duration', 'Longest'], ['entries', 'Most entries'], ['title', 'A–Z']] as [value, label] (value)}
					<button
						type="button"
						onclick={() => {
							if (sortBy === value && !sortReverse) {
								sortReverse = true;
							} else if (sortBy === value && sortReverse) {
								sortBy = 'recent';
								sortReverse = false;
							} else {
								sortBy = value as typeof sortBy;
								sortReverse = false;
							}
						}}
						class="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {sortBy ===
						value
							? 'border-primary bg-primary/10 text-primary'
							: 'border-border text-muted-foreground hover:text-foreground'}"
					>
						{label}
						{#if sortBy === value}
							<span class="text-[10px] opacity-60">{sortReverse ? '↓' : '↑'}</span>
						{/if}
					</button>
				{/each}
				{#if trips.length > 0}
					{@const journalFilterDisabled = stats.tripsWithJournal === 0 && !journalOnly}
					<div class="bg-border mx-1 h-4 w-px"></div>
					<button
						type="button"
						onclick={() => (journalOnly = !journalOnly)}
						disabled={journalFilterDisabled}
						aria-pressed={journalOnly}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {journalOnly
							? 'border-primary bg-primary/10 text-primary'
							: journalFilterDisabled
								? 'border-border text-muted-foreground/50'
								: 'border-border text-muted-foreground hover:text-foreground'}"
					>
						<BookOpen class="h-3.5 w-3.5" />
						{journalOnly ? 'All trips' : `Trips with journal (${stats.tripsWithJournal})`}
					</button>
				{/if}
			</div>
			<div
				class="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4"
				style="grid-auto-flow: dense; grid-auto-rows: 120px;"
			>
				{#each timeline as item, i (item.kind + ':' + item.id)}
					{#if item.kind === 'trip'}
						{@const trip = item.trip}
						{@const hasJournal = (trip.entry_count ?? 0) > 0}
						{@const tripDays = Math.max(
							1,
							Math.ceil(
								(new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86400000
							)
						)}
						{@const isLarge = hasJournal || tripDays >= 7}
						<a
							href="/u/{username}/trips/{trip.id}"
							class="group animate-fade-in-up relative overflow-hidden rounded-xl shadow-md transition-all duration-500 hover:shadow-xl {isLarge
								? 'col-span-2 row-span-2'
								: ''}"
							style="animation-delay: {i * 40}ms"
						>
							<!-- Background image -->
							{#if trip.image_url}
								<img
									src={storageRefToUrl(trip.image_url)}
									alt={trip.title}
									class="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
									loading="lazy"
								/>
							{:else}
								<div class="absolute inset-0 bg-gradient-to-br from-slate-600 to-slate-800"></div>
							{/if}
							<!-- Gradient overlay -->
							<div
								class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent transition-opacity duration-500 group-hover:from-black/90"
							></div>

							<!-- Top date badge -->
							<div class="absolute top-3 left-3 flex gap-2">
								<div
									class="rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white backdrop-blur-md"
								>
									{new Date(trip.start_date).toLocaleDateString(undefined, {
										month: 'short',
										day: 'numeric',
										year: 'numeric'
									})}
								</div>
								{#if isOwner && trip.visibility !== 'public'}
									<div
										class="flex items-center justify-center rounded-full bg-amber-500/80 p-1.5 text-white backdrop-blur-md"
										title={trip.visibility}
									>
										<EyeOff class="h-3 w-3" />
									</div>
								{/if}
								{#if (trip.entry_count ?? 0) > 0}
									<div
										class="flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md"
									>
										<BookOpen class="h-3 w-3" />
										{trip.entry_count}
									</div>
								{/if}
							</div>

							<!-- Bottom content -->
							<div class="absolute right-0 bottom-0 left-0 p-3 sm:p-4">
								<h3
									class="text-sm font-bold tracking-tight text-white drop-shadow-md sm:text-base {hasJournal
										? ''
										: 'truncate'}"
								>
									{trip.title}
								</h3>
								{#if hasJournal}
									<div class="mt-0.5 flex items-center gap-2 text-xs text-white/50">
										{new Date(trip.start_date).toLocaleDateString(undefined, {
											month: 'short',
											day: 'numeric'
										})}
										– {new Date(trip.end_date).toLocaleDateString(undefined, {
											month: 'short',
											day: 'numeric',
											year: 'numeric'
										})}
									</div>
									{#if (trip.entry_count ?? 0) > 0}
										<div class="mt-1 flex items-center gap-1 text-[10px] text-white/40">
											<BookOpen class="h-3 w-3" />
											{trip.entry_count} entries
										</div>
									{/if}
								{/if}
								{#if trip.metadata?.primaryCity && hasJournal}
									<div class="mt-1 flex items-center gap-1 text-[10px] text-white/40">
										<MapPin class="h-3 w-3" />
										{trip.metadata.primaryCity}
									</div>
								{/if}
								{#if trip.metadata?.image_attribution?.photographer}
									<p class="mt-0.5 text-[9px] text-white/25">
										{t('common.photoCredit', {
											photographer: trip.metadata.image_attribution.photographer
										})}
									</p>
								{/if}
							</div>
						</a>
					{:else}
						{@const sport = sportTheme(item.activity.sport)}
						<a
							href="/u/{username}/fitness/{item.activity.id}"
							class="group animate-fade-in-up relative col-span-1 row-span-1 overflow-hidden rounded-xl shadow-md transition-all duration-500 hover:shadow-xl"
							style="animation-delay: {i *
								40}ms; background: linear-gradient(135deg, {sport.stroke}dd, {sport.stroke}88);"
						>
							<!-- Top date badge -->
							<div class="absolute top-3 left-3">
								<div
									class="rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white backdrop-blur-md"
								>
									{new Date(item.activity.started_at).toLocaleDateString(undefined, {
										month: 'short',
										day: 'numeric',
										year: 'numeric'
									})}
								</div>
							</div>

							<!-- Bottom content -->
							<div class="absolute right-0 bottom-0 left-0 p-3 sm:p-4">
								<div class="flex items-center gap-1.5">
									<Activity class="h-3.5 w-3.5 text-white/70" />
									<h3 class="truncate text-sm font-bold tracking-tight text-white drop-shadow-md">
										{item.activity.title ?? t(sport.labelKey)}
									</h3>
								</div>
								<div class="mt-0.5 flex items-baseline gap-2 text-xs text-white/75 tabular-nums">
									<span class="font-semibold">{fmtDistance(item.activity.total_distance_m)}</span>
									<span
										>{fmtDuration(
											item.activity.moving_time_s ?? item.activity.elapsed_time_s
										)}</span
									>
								</div>
							</div>
						</a>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
{/if}
