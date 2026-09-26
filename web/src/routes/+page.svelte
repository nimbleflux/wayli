<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import {
		Sun,
		Moon,
		User,
		Users,
		BookOpen,
		Globe,
		Calendar,
		Shield,
		Server,
		Route,
		Sparkles,
		ImagePlus
	} from 'lucide-svelte';
	import LanguageSelector from '$lib/components/ui/language-selector/index.svelte';
	import { translate, messages } from '$lib/i18n';
	import { setTheme, initializeTheme } from '$lib/stores/app-state.svelte';
	import { loadPublicSettings, getSetting, allSettings } from '$lib/stores/settings.svelte';
	import { userStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';
	import { getTripsService } from '$lib/services/service-layer-adapter';
	import { loadTravelers } from '$lib/services/community.service';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	let t = $derived($translate);
	let currentTheme = $state<'light' | 'dark'>('light');
	let latestEntries = $state<
		Array<{
			id: string;
			trip_id: string;
			title: string;
			body: string;
			entry_date: string;
			trip_title?: string;
			trip_image_url?: string | null;
			username?: string;
		}>
	>([]);
	let travelers = $state<
		Array<{
			id: string;
			username: string;
			full_name: string | null;
			avatar_url: string | null;
			trip_count: number;
		}>
	>([]);
	let pageMode = $state<'loading' | 'signin' | 'community'>('loading');
	let isLoggedIn = $state(false);
	// Display name fetched from user_profiles (the source of truth for full_name).
	// The raw SDK User on userStore has no name field, so we fetch it on mount.
	let profileFullName = $state<string | null>(null);
	// Username fetched alongside full_name — shown in the account pill as @username.
	let profileUsername = $state<string | null>(null);
	// The signed-in user's own trips — shown when there are no public stories yet
	// so the landing page is still useful to a logged-in visitor.
	let myTrips = $state<
		Array<{
			id: string;
			title: string;
			image_url: string | null;
			start_date: string;
			status: string;
			visibility: string;
		}>
	>([]);

	// Render signed-in state from the reactive userStore (kept in sync by the
	// SessionManager in the root layout), not the one-shot isLoggedIn flag —
	// the latter can go stale if the session is validated/cleared after mount.
	// The display name falls back through the fetched profile name, signup
	// metadata, and email so the button always shows something meaningful.
	let displayName = $derived(
		profileFullName ||
			($userStore?.full_name as string | undefined) ||
			(($userStore?.metadata as Record<string, unknown> | null)?.full_name as string) ||
			(($userStore?.metadata as Record<string, unknown> | null)?.first_name as string) ||
			$userStore?.email ||
			''
	);

	onMount(() => {
		initializeTheme();
		if (browser) {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
			currentTheme =
				savedTheme ??
				(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		}

		(async () => {
			// Restore session first — capture the result for all subsequent logic.
			// The landing page is a public route; the SDK might not have initialized
			// the auth listener yet, so we must call getSession() explicitly.
			let sessionUserId: string | null = null;
			try {
				const { data: sessionData } = await fluxbase.auth.getSession();
				// SDK returns { data: { session: { user } } } — the user is nested
				// under `session`, not top-level. Every other call site reads
				// session.session.user.id; the old `sessionData.user.id` was always
				// undefined, which meant sessionUserId was always null and the data-
				// loading block below never ran (the "no trips on landing" bug).
				sessionUserId = (sessionData as any)?.session?.user?.id ?? null;
			} catch {}
			isLoggedIn = !!sessionUserId;

			// Read landing settings from the central settings store (populated by a
			// single bulk fetch in the root layout). The batch endpoint unwraps the
			// stored `{value: x}` so we read the raw value. These keys are marked
			// is_public on write, so this works for anonymous visitors too — fixing
			// the previous behavior where anon never saw the redirect/gating.
			await loadPublicSettings();
			const redirectRaw = getSetting<unknown>('wayli.landing_redirect_username', null);
			const redirectUser =
				typeof redirectRaw === 'string' && redirectRaw.trim()
					? redirectRaw.trim()
					: (() => {
							// Tolerate the wrapped shape too (older writes / single-key reads).
							const v = (redirectRaw as any)?.value ?? (redirectRaw as any)?.data?.value;
							return v && typeof v === 'string' ? v.trim() : null;
						})();
			const communityRaw = getSetting<unknown>('wayli.community_enabled', null);
			const communityDisabled =
				communityRaw === false ||
				communityRaw === 'false' ||
				(typeof communityRaw === 'object' &&
					communityRaw &&
					((communityRaw as any).value === false || (communityRaw as any).value === 'false'));

			if (communityDisabled) {
				if (redirectUser) {
					await goto(`/u/${redirectUser}`, { replaceState: true });
					return;
				}
				pageMode = 'signin';
				return;
			}

			pageMode = 'community';
			// Only fetch community content when authenticated. The /api/v1/tables/*
			// data routes are auth-required, so an anonymous query 401s (the SDK's
			// .from('trips') resolves to GET /api/v1/tables/trips). Skip it for anon
			// visitors instead of firing a wasted request; they see the empty state.
			if (sessionUserId) {
				// Fetch the signed-in user's display name from user_profiles (the
				// raw SDK User has no name field). Mirrors AppNav.svelte.
				try {
					const { data: profile } = await fluxbase
						.from('user_profiles')
						.select('full_name, username')
						.eq('id', sessionUserId)
						.maybeSingle();
					if ((profile as any)?.full_name) {
						profileFullName = (profile as any).full_name;
					}
					if ((profile as any)?.username) {
						profileUsername = (profile as any).username;
					}
				} catch {}

				await loadCommunityContent(sessionUserId, profileUsername);

				// Always show the signed-in user's own trips alongside the public
				// stories — the user should be able to see their own (private)
				// stories regardless of whether public stories exist.
				await loadMyTrips(sessionUserId);
			}
		})();
	});

	// Load community content for an authenticated visitor. The /api/v1/tables/*
	// data routes are auth-required, so this is only called when signed in — an
	// anonymous visitor would get a 401 on every query. (Anonymous community
	// browsing is gated at the call site; see onMount.)
	async function loadCommunityContent(userId: string, ownUsername?: string | null) {
		// Build "Latest stories" from BOTH the community feed (public/shared
		// trips + their published entries) AND the signed-in user's OWN
		// published entries. The own-entries query is decoupled from the
		// community trips query so the user always sees their own stories here
		// even if the community query errors or returns nothing — previously a
		// silent early-return hid the user's own entries entirely.
		try {
			// Community trips: RLS returns public + owned + shared. Surface the
			// error (don't destructure it away) so a failure is diagnosable.
			const { data: tripsData, error: tripsError } = await fluxbase
				.from('trips')
				.select('id, title, image_url, user_id, metadata')
				.in('status', ['active', 'completed', 'planned'])
				.order('start_date', { ascending: false })
				.limit(10);
			if (tripsError) {
				console.warn('[landing] community trips query error:', tripsError);
			}
			const tripsList = (tripsData as any[]) ?? [];

			// Always also fetch the signed-in user's own trips so their entries
			// are included even when the community query returned nothing.
			let ownTrips: any[] = [];
			if (userId) {
				try {
					const { data: ownData } = await fluxbase
						.from('trips')
						.select('id, title, image_url, user_id, metadata')
						.eq('user_id', userId)
						.in('status', ['active', 'completed', 'planned'])
						.order('start_date', { ascending: false })
						.limit(10);
					ownTrips = (ownData as any[]) ?? [];
				} catch (err) {
					console.warn('[landing] own-trips query failed:', err);
				}
			}
			// Merge + de-dup trips by id (own trips may already be in tripsList).
			const tripMap = new Map<string, any>();
			for (const tr of [...tripsList, ...ownTrips]) tripMap.set(tr.id, tr);
			const allTripIds = [...tripMap.keys()];
			if (allTripIds.length === 0) return;

			const [entriesResult, profilesResult, mediaResult] = await Promise.all([
				fluxbase
					.from('trip_entries')
					.select('id, trip_id, title, body, entry_date, cover_media_id, status')
					.in('trip_id', allTripIds)
					.order('entry_date', { ascending: false })
					.limit(12),
				fluxbase
					.from('public_profiles')
					.select('id, username')
					.in('id', [...new Set(allTripIds.map((id) => tripMap.get(id)!.user_id))]),
				fluxbase
					.from('trip_media')
					.select('id, entry_id, storage_path, thumbnail_path')
					.in('trip_id', allTripIds)
			]);

			if (entriesResult.error) {
				console.warn('[landing] trip_entries query error:', entriesResult.error);
			}
			// Published entries are visible to everyone; the owner additionally
			// sees their own drafts, but we only surface published here so the
			// public feed stays consistent. Own published entries are included
			// via the ownTrips merge above.
			const entriesList = ((entriesResult.data as any[]) ?? []).filter(
				(e) => e.status === 'published'
			);
			const profileMap = new Map<string, string>();
			for (const p of (profilesResult.data as any[]) ?? []) profileMap.set(p.id, p.username);
			// Seed the caller's own username so their own entries show a handle,
			// even if they're not yet in public_profiles (e.g. username set after
			// the entries were created, or the view hasn't propagated).
			if (ownUsername && userId) profileMap.set(userId, ownUsername);
			const mediaMap = new Map<string, string>();
			// First media row per entry — used as the per-story image when no
			// explicit cover is set, instead of falling back to the trip hero.
			const entryFirstMedia = new Map<string, string>();
			for (const m of (mediaResult.data as any[]) ?? []) {
				mediaMap.set(m.id, m.thumbnail_path ?? m.storage_path);
				if (m.entry_id && !entryFirstMedia.has(m.entry_id)) {
					entryFirstMedia.set(m.entry_id, m.thumbnail_path ?? m.storage_path);
				}
			}

			// De-dup entries by id, cap at 6 for the grid.
			const seenEntry = new Set<string>();
			latestEntries = entriesList
				.filter((e) => {
					if (seenEntry.has(e.id)) return false;
					seenEntry.add(e.id);
					return true;
				})
				.slice(0, 6)
				.map((e) => {
					const trip = tripMap.get(e.trip_id);
					const entryCover = e.cover_media_id ? mediaMap.get(e.cover_media_id) : null;
					return {
						...e,
						trip_title: trip?.title,
						trip_image_url: entryCover ?? entryFirstMedia.get(e.id) ?? trip?.image_url,
						username: trip ? profileMap.get(trip.user_id) : undefined
					};
				});

			// Travelers directory — use the shared community service so the
			// discoverability filter (is-discoverable-to RPC with correct
			// namespace) is consistent with the /travelers page.
			travelers = await loadTravelers(userId, 12);
		} catch (err) {
			console.error('Failed to load community content:', err);
		}
	}

	// Load the signed-in user's own trips (RLS-scoped to owner). Shown so the
	// landing page is always useful to a logged-in user — their own (private)
	// stories appear here regardless of whether public stories exist.
	async function loadMyTrips(userId: string) {
		let rows: any[] = [];
		try {
			const { data, error } = await fluxbase
				.from('trips')
				.select('id, title, image_url, start_date, status, visibility')
				.eq('user_id', userId)
				.in('status', ['active', 'completed', 'planned'])
				.order('start_date', { ascending: false })
				.limit(6);
			if (error) {
				console.warn('[landing] myTrips query returned an error:', error);
			}
			rows = (data as any[]) ?? [];
		} catch (err) {
			// Surface the failure clearly so we can diagnose why logged-in users
			// sometimes see "No public stories yet" despite having trips.
			console.warn('[landing] myTrips raw query failed:', err);
		}

		// Fallback: the Travel page loads trips successfully via TripsService;
		// if the raw query came back empty/errored, retry through the same path
		// to isolate whether the issue is the query or RLS.
		if (rows.length === 0) {
			try {
				const tripsService = await getTripsService();
				const all = (await tripsService.getTrips(userId)) ?? [];
				rows = all
					.filter((tp: any) => ['active', 'completed', 'planned'].includes(tp.status))
					.slice(0, 6)
					.map((tp: any) => ({
						id: tp.id,
						title: tp.title,
						image_url: tp.image_url,
						start_date: tp.start_date,
						status: tp.status,
						visibility: tp.visibility
					}));
			} catch (err) {
				console.warn('[landing] myTrips TripsService fallback failed:', err);
			}
		}
		myTrips = rows;
	}

	function handleThemeChange(theme: 'light' | 'dark') {
		setTheme(theme);
		currentTheme = theme;
	}
</script>

<svelte:head>
	<title>Wayli · Travel Stories</title>
</svelte:head>

{#if pageMode === 'loading'}
	<div class="bg-background flex min-h-screen items-center justify-center">
		<div class="border-primary h-10 w-10 animate-spin rounded-full border-2"></div>
	</div>
{:else if pageMode === 'signin'}
	<div class="bg-background relative flex min-h-screen flex-col items-center justify-center p-4">
		<div class="mb-8 rounded-3xl bg-white/75 p-10 shadow-xl">
			<img src="/logo.svg" alt="Wayli" class="h-56 w-auto" />
		</div>
		<div class="w-full max-w-sm space-y-4 text-center">
			<p class="text-muted-foreground text-sm">{t('landing.selfHostedTagline')}</p>
			{#if $userStore}
				{#if displayName}
					<p class="text-foreground text-sm font-medium">{displayName}</p>
				{/if}
				<a
					href="/dashboard/location-data"
					class="bg-primary hover:bg-primary/90 text-primary-foreground mt-4 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium transition-colors"
				>
					<BookOpen class="h-4 w-4" />
					{t('common.navigation.dashboard')}
				</a>
			{:else}
				<a
					href="/auth/signin"
					class="bg-primary hover:bg-primary/90 text-primary-foreground mt-4 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium transition-colors"
				>
					<User class="h-4 w-4" />
					{t('auth.signIn')}
				</a>
			{/if}
		</div>
		<div
			class="bg-background/80 border-border fixed top-4 right-4 z-40 flex items-center gap-2 rounded-full border px-2 py-1 shadow-sm backdrop-blur-md"
		>
			<button
				onclick={() => handleThemeChange('light')}
				class="cursor-pointer rounded-lg p-2 transition-colors {currentTheme === 'light'
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground'}"
			>
				<Sun class="h-4 w-4" />
			</button>
			<button
				onclick={() => handleThemeChange('dark')}
				class="cursor-pointer rounded-lg p-2 transition-colors {currentTheme === 'dark'
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground'}"
			>
				<Moon class="h-4 w-4" />
			</button>
			<LanguageSelector variant="minimal" size="sm" showLabel={false} position="bottom-right" />
		</div>
	</div>
{:else if pageMode === 'community'}
	<div class="bg-background min-h-screen">
		<!-- Top bar -->
		<div
			class="bg-background/80 border-border fixed top-4 right-4 z-40 flex items-center gap-3 rounded-full border px-2 py-1 shadow-sm backdrop-blur-md"
		>
			<LanguageSelector variant="minimal" size="sm" showLabel={false} position="bottom-right" />
			<div class="flex gap-2">
				<button
					onclick={() => handleThemeChange('light')}
					class="cursor-pointer rounded-lg p-2 transition-colors {currentTheme === 'light'
						? 'bg-primary/10 text-primary'
						: 'text-muted-foreground hover:bg-muted'}"
				>
					<Sun class="h-4 w-4" />
				</button>
				<button
					onclick={() => handleThemeChange('dark')}
					class="cursor-pointer rounded-lg p-2 transition-colors {currentTheme === 'dark'
						? 'bg-primary/10 text-primary'
						: 'text-muted-foreground hover:bg-muted'}"
				>
					<Moon class="h-4 w-4" />
				</button>
			</div>
			{#if $userStore}
				<a
					href="/dashboard/account-settings"
					title={profileUsername
						? `@${profileUsername}`
						: displayName || t('common.navigation.accountSettings')}
					class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex max-w-[10rem] items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
				>
					<User class="h-4 w-4 shrink-0" />
					<span class="truncate"
						>{profileUsername
							? `@${profileUsername}`
							: displayName || t('common.navigation.dashboard')}</span
					>
				</a>
			{:else}
				<a
					href="/auth/signin"
					class="text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
				>
					<User class="h-4 w-4" />
					{t('auth.signIn')}
				</a>
			{/if}
		</div>

		<!-- Hero — full-bleed gradient echoing the /u/{user} profile header -->
		<div class="relative h-[440px] w-full overflow-hidden sm:h-[480px]">
			<!-- Rich backdrop: layered gradients (light + dark) -->
			<div
				class="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-500 dark:from-slate-900 dark:via-slate-800 dark:to-slate-600"
			></div>
			<!-- Soft brand-color glow -->
			<div
				class="bg-primary/20 absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full blur-3xl"
			></div>
			<!-- Bottom-up scrim so the headline/footer read clearly -->
			<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/30"></div>

			<div
				class="relative mx-auto flex h-full max-w-6xl flex-col items-center justify-center px-4 text-center"
			>
				<div
					class="mb-6 inline-flex rounded-3xl bg-white/80 p-6 shadow-2xl ring-1 ring-white/20 backdrop-blur-md"
				>
					<img src="/logo.svg" alt="Wayli" class="h-20 w-auto drop-shadow-2xl" />
				</div>
				<h1
					class="max-w-3xl text-4xl font-extrabold tracking-tight text-white drop-shadow-lg sm:text-5xl"
				>
					{t('landing.heroHeadline')}
				</h1>
				<p class="mt-4 max-w-2xl text-base text-white/80 sm:text-lg">
					{t('landing.heroSubtext')}
				</p>

				<!-- CTAs as frosted-glass pills -->
				<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
					<!-- Always-visible discover buttons → dedicated browse pages -->
					<a
						href="/stories"
						class="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition-all hover:scale-105 hover:bg-white/25"
					>
						<BookOpen class="h-4 w-4" />
						{t('community.exploreStories')}
					</a>
					{#if travelers.length > 1}
						<a
							href="/travelers"
							class="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition-all hover:scale-105 hover:bg-white/25"
						>
							<Users class="h-4 w-4" />
							{t('community.browseTravelers')}
						</a>
					{/if}
					<!-- Primary contextual action -->
					{#if $userStore}
						<a
							href="/dashboard/location-data"
							class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors"
						>
							<BookOpen class="h-4 w-4" />
							{t('landing.goToDashboard')}
						</a>
					{:else}
						<a
							href="/auth/signin"
							class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors"
						>
							<User class="h-4 w-4" />
							{t('auth.signIn')}
						</a>
					{/if}
				</div>

				<!-- Feature trio -->
				<div
					class="mt-10 hidden flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/70 sm:flex"
				>
					<span class="inline-flex items-center gap-2">
						<Shield class="h-4 w-4 text-white/50" />
						{t('landing.privacyFirst')}
					</span>
					<span class="inline-flex items-center gap-2">
						<Server class="h-4 w-4 text-white/50" />
						{t('landing.selfHosted')}
					</span>
					<span class="inline-flex items-center gap-2">
						<Route class="h-4 w-4 text-white/50" />
						{t('landing.autoTrips')}
					</span>
				</div>
			</div>
		</div>

		<!-- Content -->
		<div id="stories" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-6">
			<!-- Latest Stories -->
			{#if latestEntries.length > 0}
				<div class="mb-16">
					<div class="mb-6 flex items-center gap-2">
						<BookOpen class="text-primary h-5 w-5" />
						<h2 class="text-foreground text-sm font-bold tracking-wide uppercase">
							{t('community.latestStories')}
						</h2>
					</div>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each latestEntries as entry (entry.id)}
							<a
								href={entry.username ? `/u/${entry.username}/trips/${entry.trip_id}` : '#'}
								class="group bg-card border-border overflow-hidden rounded-2xl border transition-all hover:shadow-xl"
							>
								{#if entry.trip_image_url}
									<div class="h-32 overflow-hidden">
										<img
											src={storageRefToUrl(entry.trip_image_url)}
											alt={entry.trip_title || ''}
											class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
											loading="lazy"
										/>
									</div>
								{/if}
								<div class="p-4">
									<div class="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
										<Calendar class="h-3 w-3" />
										{new Date(entry.entry_date).toLocaleDateString(undefined, {
											month: 'long',
											day: 'numeric',
											year: 'numeric'
										})}
									</div>
									<h3 class="text-foreground mb-1 font-bold">
										{entry.title || entry.trip_title || 'Untitled'}
									</h3>
									{#if entry.body}
										<p class="text-muted-foreground line-clamp-3 text-sm">
											{entry.body
												.replace(/[#*`>\-]/g, '')
												.trim()
												.slice(0, 150)}
										</p>
									{/if}
									{#if entry.username}
										<div class="text-muted-foreground/70 mt-2 text-xs">
											{t('community.by')} @{entry.username}
										</div>
									{/if}
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Travelers Directory -->
			{#if travelers.length > 0}
				<div id="travelers" class="mb-16 scroll-mt-20">
					<div class="mb-6 flex items-center gap-2">
						<Globe class="text-primary h-5 w-5" />
						<h2 class="text-foreground text-sm font-bold tracking-wide uppercase">
							{t('community.travelers')}
						</h2>
					</div>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each travelers as traveler (traveler.id)}
							<a
								href="/u/{traveler.username}"
								class="bg-card border-border flex items-center gap-3 rounded-2xl border p-4 transition-all hover:shadow-lg"
							>
								{#if traveler.avatar_url}
									<img
										src={storageRefToUrl(traveler.avatar_url)}
										alt=""
										class="h-12 w-12 rounded-full object-cover"
									/>
								{:else}
									<div
										class="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold"
									>
										{traveler.username[0]?.toUpperCase()}
									</div>
								{/if}
								<div>
									<p class="text-foreground font-medium">@{traveler.username}</p>
									<p class="text-muted-foreground text-xs">
										{traveler.trip_count}
										{traveler.trip_count === 1 ? t('common.trip') : t('common.trips')}
									</p>
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Your trips (shown to signed-in users alongside public stories) -->
			{#if $userStore && myTrips.length > 0}
				<div class="mb-16">
					<div class="mb-6 flex items-center gap-2">
						<Route class="text-primary h-5 w-5" />
						<h2 class="text-foreground text-sm font-bold tracking-wide uppercase">
							{t('community.yourTrips')}
						</h2>
					</div>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each myTrips as trip (trip.id)}
							<a
								href={profileUsername
									? `/u/${profileUsername}/trips/${trip.id}`
									: '/dashboard/travel'}
								class="group bg-card border-border overflow-hidden rounded-2xl border transition-all hover:shadow-xl"
							>
								{#if trip.image_url}
									<div class="h-32 overflow-hidden">
										<img
											src={storageRefToUrl(trip.image_url)}
											alt={trip.title}
											class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
											loading="lazy"
										/>
									</div>
								{/if}
								<div class="p-4">
									<div class="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
										<Calendar class="h-3 w-3" />
										{new Date(trip.start_date).toLocaleDateString(undefined, {
											month: 'long',
											day: 'numeric',
											year: 'numeric'
										})}
									</div>
									<h3 class="text-foreground mb-1 font-bold">{trip.title || 'Untitled'}</h3>
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Empty state: placeholder preview (when there's truly nothing to show) -->
			{#if latestEntries.length === 0 && travelers.length === 0 && myTrips.length === 0}
				<div class="mb-16">
					<div class="mb-6 flex items-center gap-2">
						<Sparkles class="text-primary h-5 w-5" />
						<h2 class="text-foreground text-sm font-bold tracking-wide uppercase">
							{t('community.latestStories')}
						</h2>
					</div>
					<p class="text-muted-foreground mb-6 text-sm">
						{$userStore ? t('community.emptyHintOwn') : t('community.emptyHintAnon')}
					</p>
					<!-- Dashed placeholder cards previewing the layout -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each { length: 3 } as _}
							<div class="border-border bg-card/50 flex flex-col rounded-2xl border border-dashed">
								<div class="text-muted-foreground/30 flex h-32 items-center justify-center">
									<ImagePlus class="h-8 w-8" />
								</div>
								<div class="p-4">
									<div class="bg-muted mb-3 h-3 w-1/3 rounded"></div>
									<div class="bg-muted mb-2 h-4 w-2/3 rounded"></div>
									<div class="bg-muted h-3 w-full rounded"></div>
								</div>
							</div>
						{/each}
					</div>
					<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
						{#if $userStore}
							<a
								href="/dashboard/travel"
								class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors"
							>
								<BookOpen class="h-4 w-4" />
								{t('community.publishFirstTrip')}
							</a>
						{:else}
							<a
								href="/auth/signin"
								class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors"
							>
								<User class="h-4 w-4" />
								{t('community.signInToShare')}
							</a>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
