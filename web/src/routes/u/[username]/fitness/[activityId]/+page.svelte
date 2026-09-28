<script lang="ts">
	import { ArrowLeft, Activity, Flag, MapPin } from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';
	import { getSetting, loadPublicSettings } from '$lib/stores/settings.svelte';
	import { watchMapTheme, createBasemapLayer } from '$lib/utils/map-theme';
	import FitnessChart from '$lib/components/fitness/FitnessChart.svelte';
	import {
		formatDistance,
		formatDuration,
		formatSpeed,
		movingAverage,
		formatSubSport,
		sportTheme
	} from '$lib/utils/fitness';

	let t = $derived($translate);
	let username = $derived(page.params.username);
	let activityId = $derived(page.params.activityId);

	interface PublicActivity {
		id: string;
		user_id: string;
		title: string | null;
		description: string | null;
		sport: string | null;
		sub_sport: string | null;
		started_at: string;
		ended_at: string | null;
		total_distance_m: number | null;
		elapsed_time_s: number | null;
		moving_time_s: number | null;
		calories: number | null;
		effective_visibility: 'private' | 'friends' | 'public';
	}

	interface TrackPoint {
		t: number;
		lat: number;
		lon: number;
		speed: number | null;
		speedSmooth: number | null;
	}

	let profile = $state<{
		id: string;
		username: string;
		full_name: string | null;
		avatar_url: string | null;
	} | null>(null);
	let activity = $state<PublicActivity | null>(null);
	let track = $state<TrackPoint[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let currentUserId = $state<string | null>(null);

	// ── Map ──
	let mapContainer = $state<HTMLDivElement | null>(null);
	let L: typeof import('leaflet');
	let map: import('leaflet').Map | null = null;
	let polylineLayers: import('leaflet').Polyline[] = [];
	let pinLayers: import('leaflet').Marker[] = [];
	let cleanupThemeWatcher: (() => void) | null = null;

	const theme = $derived(sportTheme(activity?.sport));

	function speedColor(kmh: number | null): string {
		if (kmh == null) return theme.stroke;
		const frac = Math.min(kmh / 45, 1);
		const hue = 140 - frac * 140;
		return `hsl(${hue}, 70%, 45%)`;
	}

	async function loadPage() {
		loading = true;
		notFound = false;
		activity = null;
		profile = null;
		track = [];

		// Same anonymous gate as public trip pages.
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
					goto(`/auth/signin?redirectTo=/u/${username}/fitness/${activityId}`);
					return;
				}
			} catch {
				goto(`/auth/signin?redirectTo=/u/${username}/fitness/${activityId}`);
				return;
			}
		}
		try {
			const { data: session } = await fluxbase.auth.getSession();
			currentUserId = session?.session?.user?.id ?? null;
		} catch {
			currentUserId = null;
		}

		try {
			// The public view is gated by can_see_activity() — if a row comes
			// back, this viewer (anon, friend, or the world) may see it.
			const { data: profileData } = await fluxbase
				.from('public_profiles')
				.select('id, username, full_name, avatar_url')
				.eq('username', username)
				.maybeSingle();
			const owner = (profileData ?? null) as {
				id: string;
				username: string;
				full_name: string | null;
				avatar_url: string | null;
			} | null;
			if (!owner) {
				notFound = true;
				return;
			}
			profile = owner;

			const { data: activityData } = await fluxbase
				.from('public_fitness_activities')
				.select('*')
				.eq('id', activityId)
				.eq('user_id', owner.id)
				.maybeSingle();
			if (!activityData) {
				notFound = true;
				return;
			}
			activity = activityData as unknown as PublicActivity;

			await loadTrack();
		} finally {
			loading = false;
		}
	}

	/**
	 * Privacy-clipped track via the get-public-activity-track RPC (drops points
	 * within the owner's privacy zones). The owner views their full data in the
	 * dashboard analyzer instead, so no owner-specific path is needed here.
	 */
	async function loadTrack() {
		if (!activity) return;
		try {
			const { data: rpcData, error } = await (fluxbase.rpc as any).invoke(
				'get-public-activity-track',
				{ activity_uuid: activity.id },
				{ namespace: 'wayli' }
			);
			let rows: any[] = [];
			const raw = rpcData as any;
			if (Array.isArray(raw)) rows = raw;
			else if (raw?.result)
				rows = typeof raw.result === 'string' ? JSON.parse(raw.result) : raw.result;
			else if (Array.isArray(raw?.data)) rows = raw.data;
			else if (raw?.data?.result)
				rows = typeof raw.data.result === 'string' ? JSON.parse(raw.data.result) : raw.data.result;
			if (error || rows.length === 0) return;

			const parsed = rows
				.filter((p) => p.lat != null && p.lng != null)
				.map((p) => ({
					t: p.recorded_at ? new Date(p.recorded_at).getTime() : 0,
					lat: p.lat as number,
					lon: p.lng as number,
					speed: p.speed != null ? Number(p.speed) : null,
					speedSmooth: null as number | null
				}))
				.filter((p) => p.t > 0)
				.toSorted((a, b) => a.t - b.t);

			// Downsample for rendering (keep the tail intact).
			const stride = Math.max(1, Math.ceil(parsed.length / 6000));
			const sampled = stride > 1 ? parsed.filter((_, i) => i % stride === 0) : parsed;

			const smoothed = movingAverage(
				sampled.map((p) => p.speed),
				Math.max(3, Math.round(15 / stride))
			);
			sampled.forEach((p, i) => (p.speedSmooth = smoothed[i]));
			track = sampled;
		} catch {
			// Track unavailable — summary still shows.
		}
	}

	// ── Map rendering (speed-colored segments, web dashboard parity) ──
	async function renderMap() {
		if (track.length === 0) return;
		if (!L) L = await import('leaflet');

		if (!mapContainer) {
			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
			if (!mapContainer) return;
		}

		if (map) {
			drawTrack();
			return;
		}

		map = L.map(mapContainer, {
			zoomControl: true,
			center: [track[0].lat, track[0].lon],
			zoom: 12
		});
		cleanupThemeWatcher = watchMapTheme(map, createBasemapLayer);
		drawTrack();

		setTimeout(() => {
			if (!map) return;
			map.invalidateSize();
			if (track.length > 1) {
				map.fitBounds(L.latLngBounds(track.map((p) => [p.lat, p.lon] as [number, number])), {
					padding: [30, 30]
				});
			}
		}, 250);
	}

	function drawTrack() {
		if (!map || !L) return;
		for (const layer of polylineLayers) map.removeLayer(layer);
		polylineLayers = [];
		for (const pin of pinLayers) map.removeLayer(pin);
		pinLayers = [];
		if (track.length < 2) return;

		for (let i = 1; i < track.length; i++) {
			const a = track[i - 1];
			const b = track[i];
			polylineLayers.push(
				L.polyline(
					[
						[a.lat, a.lon],
						[b.lat, b.lon]
					],
					{ color: speedColor(b.speedSmooth), weight: 4, opacity: 0.9, lineCap: 'round' }
				).addTo(map)
			);
		}

		const first = track[0];
		const last = track[track.length - 1];
		const pinIcon = (label: string) =>
			L.divIcon({
				className: '',
				html: `<div style="transform: translate(-50%, -50%); background: #fff; border: 2px solid #1f2937; border-radius: 9999px; padding: 1px 7px; font: 600 11px/1.4 ui-sans-serif, system-ui; color: #1f2937; box-shadow: 0 1px 3px rgba(0,0,0,.35);">${label}</div>`,
				iconSize: [0, 0]
			});
		pinLayers.push(
			L.marker([first.lat, first.lon], { icon: pinIcon(t('fitness.start')) }).addTo(map)
		);
		pinLayers.push(
			L.marker([last.lat, last.lon], { icon: pinIcon(t('fitness.finish')) }).addTo(map)
		);

		map.fitBounds(L.latLngBounds(track.map((p) => [p.lat, p.lon] as [number, number])), {
			padding: [30, 30]
		});
	}

	$effect(() => {
		if (activity && track.length > 0) {
			void renderMap();
		}
	});

	$effect(() => {
		const id = activityId;
		if (id) void loadPage();
	});

	onDestroy(() => {
		cleanupThemeWatcher?.();
		map?.remove();
		map = null;
	});

	let speedSeries = $derived([
		{
			label: 'km/h',
			color: theme.stroke,
			area: true,
			points: track
				.filter((p) => p.speedSmooth != null)
				.map((p) => ({ x: p.t, v: Math.round((p.speedSmooth as number) * 10) / 10 }))
		}
	]);

	let stats = $derived.by(() => {
		if (!activity) return [];
		const cards = [
			{ label: t('fitness.stats.distance'), value: formatDistance(activity.total_distance_m) },
			{
				label: t('fitness.stats.movingTime'),
				value: formatDuration(activity.moving_time_s ?? activity.elapsed_time_s)
			}
		];
		if (activity.total_distance_m && activity.moving_time_s) {
			cards.push({
				label: t('fitness.stats.avgSpeed'),
				value: `${formatSpeed(activity.total_distance_m / activity.moving_time_s)} km/h`
			});
		}
		if (activity.calories != null) {
			cards.push({ label: t('fitness.stats.calories'), value: `${activity.calories} kcal` });
		}
		return cards;
	});

	function formatHeaderDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}

	function formatHeaderTime(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>
		{activity
			? `${activity.title ?? t(theme.labelKey)} · ${formatHeaderDate(activity.started_at)}`
			: t('fitness.title')} · Wayli
	</title>
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</svelte:head>

<div>
	<!-- Back to the public profile -->
	<div class="mb-4 flex items-center justify-between gap-2">
		<a
			href="/u/{username}"
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
		>
			<ArrowLeft class="h-4 w-4" />
			{profile?.full_name || username}
		</a>
		{#if activity && currentUserId === activity.user_id}
			<a
				href="/dashboard/fitness/{activity.id}"
				class="border-border hover:bg-muted flex h-8 items-center rounded-lg border px-3 text-xs font-medium"
			>
				{t('common.actions.edit')}
			</a>
		{/if}
	</div>

	{#if loading}
		<div class="bg-card border-border flex items-center justify-center rounded-xl border p-24">
			<Activity class="text-muted-foreground h-5 w-5 animate-pulse" />
		</div>
	{:else if notFound || !activity}
		<div class="bg-card border-border rounded-xl border p-16 text-center">
			<MapPin class="text-muted-foreground mx-auto mb-3 h-8 w-8" />
			<p class="text-foreground font-medium">{t('fitness.notFound')}</p>
			<a href="/u/{username}" class="text-primary mt-3 inline-block text-sm font-medium">
				{username}
			</a>
		</div>
	{:else}
		<!-- Hero -->
		<div class="relative mb-6 overflow-hidden rounded-2xl">
			<div class="absolute inset-0 bg-gradient-to-r {theme.gradient}"></div>
			<div class="relative flex flex-wrap items-end justify-between gap-4 p-6 text-white sm:p-8">
				<div class="min-w-0 flex-1">
					<p class="mb-1 text-sm font-medium tracking-wider text-white/75 uppercase">
						{t(theme.labelKey)}{activity.sub_sport
							? ` · ${formatSubSport(activity.sub_sport, t)}`
							: ''}
					</p>
					<h1 class="text-2xl font-bold sm:text-3xl">
						{activity.title ?? formatHeaderDate(activity.started_at)}
					</h1>
					<p class="mt-1 text-white/80">
						{formatHeaderDate(activity.started_at)} · {formatHeaderTime(activity.started_at)} –
						{activity.ended_at ? formatHeaderTime(activity.ended_at) : ''}
					</p>
					{#if activity.description}
						<p class="mt-3 max-w-2xl text-sm text-white/90">{activity.description}</p>
					{/if}
				</div>
				<div class="hidden items-baseline gap-6 sm:flex">
					<p class="text-3xl font-bold tabular-nums">
						{formatDistance(activity.total_distance_m)}
					</p>
					<p class="text-3xl font-bold tabular-nums">
						{formatDuration(activity.moving_time_s ?? activity.elapsed_time_s)}
					</p>
				</div>
			</div>
		</div>

		<!-- Stats grid -->
		<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each stats as stat (stat.label)}
				<div class="bg-card border-border rounded-xl border p-4">
					<p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
						{stat.label}
					</p>
					<p class="text-foreground mt-1 text-xl font-bold tabular-nums">{stat.value}</p>
				</div>
			{/each}
		</div>

		<!-- Map + speed chart -->
		{#if track.length > 0}
			<div class="bg-card border-border mb-6 overflow-hidden rounded-xl border">
				<div bind:this={mapContainer} class="h-[380px] w-full"></div>
			</div>
			{#if speedSeries[0].points.length > 0}
				<div class="bg-card border-border rounded-xl border p-4">
					<h3 class="text-foreground mb-2 text-sm font-semibold">
						{t('fitness.chart.speed')}
					</h3>
					<FitnessChart series={speedSeries} xAxis="time" />
					<p class="text-muted-foreground/70 mt-1 text-center text-[11px]">
						{t('fitness.sharing.privacyRadiusHint')}
					</p>
				</div>
			{/if}
		{:else}
			<div class="bg-card border-border rounded-xl border p-12 text-center">
				<Flag class="text-muted-foreground mx-auto mb-2 h-6 w-6" />
				<p class="text-muted-foreground text-sm">{t('fitness.notFound')}</p>
			</div>
		{/if}
	{/if}
</div>
