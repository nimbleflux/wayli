<script lang="ts">
	import {
		ArrowLeft,
		ChevronLeft,
		ChevronRight,
		Clock,
		Flag,
		Globe,
		Link2,
		Loader2,
		Lock,
		MapPin,
		Pencil,
		Route,
		Trash2,
		Users
	} from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';
	import { watchMapTheme, createBasemapLayer } from '$lib/utils/map-theme';
	import FitnessChart from '$lib/components/fitness/FitnessChart.svelte';
	import {
		currentUsername,
		fitnessSharing,
		loadFitnessSharing,
		setActivityVisibility,
		type FitnessAudience
	} from '$lib/stores/fitness-sharing.svelte';
	import {
		cumulativeDistances,
		elevationGain,
		formatDistance,
		formatDuration,
		formatSpeed,
		movingAverage,
		formatSubSport,
		sportTheme,
		type FitnessActivity
	} from '$lib/utils/fitness';

	let t = $derived($translate);
	let id = $derived(page.params.id);

	let activity = $state<FitnessActivity | null>(null);
	let prevActivity = $state<FitnessActivity | null>(null);
	let nextActivity = $state<FitnessActivity | null>(null);
	let loading = $state(true);
	let notFound = $state(false);

	// ── Editing (title / comment) ──
	let editing = $state(false);
	let savingEdits = $state(false);
	let titleInput = $state('');
	let descriptionInput = $state('');

	// ── Deletion ──
	let confirmingDelete = $state(false);
	let deleting = $state(false);

	// ── Sharing ──
	let username = $state<string | null>(null);

	const CYCLE: (FitnessAudience | null)[] = [null, 'private', 'friends', 'public'];

	function effectiveVisibility(): FitnessAudience {
		return activity?.visibility ?? fitnessSharing().default;
	}

	function visibilityLabel(): string {
		const override = activity?.visibility ?? null;
		if (override === null) {
			return `${t('fitness.sharing.default')} (${t('fitness.sharing.' + fitnessSharing().default)})`;
		}
		return t('fitness.sharing.' + override);
	}

	async function cycleVisibility() {
		if (!activity) return;
		const next = CYCLE[(CYCLE.indexOf(activity.visibility ?? null) + 1) % CYCLE.length];
		const previous = activity.visibility ?? null;
		activity.visibility = next;
		try {
			await setActivityVisibility(activity.id, next);
			toast.success(t('fitness.sharing.overrideChanged'));
		} catch (err) {
			activity.visibility = previous;
			toast.error(err instanceof Error ? err.message : t('fitness.sharing.updateFailed'));
		}
	}

	async function copyShareLink() {
		if (!activity || !username) return;
		const url = `${window.location.origin}/u/${username}/fitness/${activity.id}`;
		try {
			await navigator.clipboard.writeText(url);
			toast.success(
				effectiveVisibility() === 'private'
					? t('fitness.sharing.linkCopiedPrivate')
					: t('fitness.sharing.linkCopied')
			);
		} catch {
			toast.error(t('fitness.sharing.copyFailed'));
		}
	}

	interface TrackPoint {
		t: number;
		lat: number;
		lon: number;
		altitude: number | null;
		/** tracker_data.speed is km/h, derived by DB trigger from consecutive-point geometry */
		speed: number | null;
		/** Geometry-derived speeds are jittery; charts and map colours use this ~30 s average */
		speedSmooth: number | null;
		/** Cumulative distance in meters (device-reported, geometry fallback) */
		dist: number;
		/** Device-reported cumulative distance, before the geometry fallback */
		fitDist: number | null;
		hr: number | null;
		power: number | null;
		cadence: number | null;
	}
	let track = $state<TrackPoint[]>([]);
	let elevation = $state<number | null>(null);

	// Chart x axis: elapsed time or distance covered
	let xMode = $state<'time' | 'distance'>('time');

	// ── Map ──
	let mapContainer = $state<HTMLDivElement | null>(null);
	let L: typeof import('leaflet');
	let map: import('leaflet').Map | null = null;
	let polylineLayers: import('leaflet').Polyline[] = [];
	let pinLayers: import('leaflet').Marker[] = [];
	let scrubMarker: import('leaflet').CircleMarker | null = null;
	let cleanupThemeWatcher: (() => void) | null = null;

	const theme = $derived(sportTheme(activity?.sport));

	function xOf(p: TrackPoint): number {
		return xMode === 'distance' ? p.dist : p.t;
	}

	// Chart series built from the track; x follows the selected axis mode
	let hrPowerSeries = $derived([
		{
			label: 'bpm',
			color: '#ef4444',
			area: true,
			points: track.filter((p) => p.hr != null).map((p) => ({ x: xOf(p), v: p.hr as number }))
		},
		{
			label: 'W',
			color: '#3b82f6',
			points: track.filter((p) => p.power != null).map((p) => ({ x: xOf(p), v: p.power as number }))
		}
	]);
	let speedCadenceSeries = $derived([
		{
			label: 'km/h',
			color: theme.stroke,
			area: true,
			points: track
				.filter((p) => p.speedSmooth != null)
				.map((p) => ({ x: xOf(p), v: Math.round((p.speedSmooth as number) * 10) / 10 }))
		},
		{
			label: 'rpm',
			color: '#a855f7',
			points: track
				.filter((p) => p.cadence != null && p.cadence > 0)
				.map((p) => ({ x: xOf(p), v: p.cadence as number }))
		}
	]);

	$effect(() => {
		if (activity && track.length > 0) {
			elevation = elevationGain(track.map((p) => p.altitude));
		}
	});

	async function loadActivity(activityId: string) {
		loading = true;
		notFound = false;
		activity = null;
		prevActivity = null;
		nextActivity = null;
		track = [];
		void loadFitnessSharing();

		try {
			const { data, error } = await fluxbase
				.from<Record<string, any>>('fitness_activities')
				.select('*')
				.eq('id', activityId)
				.maybeSingle();
			if (error || !data) {
				notFound = true;
				return;
			}
			activity = data as unknown as FitnessActivity;

			// Username for share links (once)
			if (!username) {
				username = await currentUsername();
			}

			// Neighbour sessions for prev/next navigation
			const [prevRes, nextRes] = await Promise.all([
				fluxbase
					.from<Record<string, any>>('fitness_activities')
					.select('id, started_at, sport')
					.lt('started_at', activity.started_at)
					.order('started_at', { ascending: false })
					.range(0, 0)
					.maybeSingle(),
				fluxbase
					.from<Record<string, any>>('fitness_activities')
					.select('id, started_at, sport')
					.gt('started_at', activity.started_at)
					.order('started_at', { ascending: true })
					.range(0, 0)
					.maybeSingle()
			]);
			prevActivity = (prevRes.data as any) ?? null;
			nextActivity = (nextRes.data as any) ?? null;

			await loadTrack(activity);
		} finally {
			loading = false;
		}
	}

	/**
	 * Load the GPS track (tracker_data) and per-point metrics
	 * (fitness_records), merged on recorded_at.
	 */
	async function loadTrack(activity: FitnessActivity) {
		const from = activity.started_at;
		const to =
			activity.ended_at ?? new Date(new Date(from).getTime() + 24 * 3600 * 1000).toISOString();

		// tracker_data range query, paginated
		const points = new Map<
			string,
			{ lat: number; lon: number; altitude: number | null; speed: number | null }
		>();
		let offset = 0;
		while (true) {
			const { data, error } = await fluxbase
				.from<Record<string, any>>('tracker_data')
				.select('recorded_at, location, altitude, speed')
				.gte('recorded_at', from)
				.lte('recorded_at', to)
				.order('recorded_at', { ascending: true })
				.range(offset, offset + 999);
			if (error) {
				console.error('Failed to load track points:', error);
				break;
			}
			const batch = (data as any[]) ?? [];
			for (const row of batch) {
				const loc = row.location?.coordinates;
				if (!loc) continue;
				points.set(row.recorded_at, {
					lon: parseFloat(loc[0]),
					lat: parseFloat(loc[1]),
					altitude: row.altitude != null ? parseFloat(row.altitude) : null,
					speed: row.speed != null ? parseFloat(row.speed) : null
				});
			}
			if (batch.length < 1000) break;
			offset += 1000;
		}

		// Metrics join on recorded_at (equality — same source timestamps)
		const metrics = new Map<
			string,
			{
				hr: number | null;
				power: number | null;
				cadence: number | null;
				dist: number | null;
			}
		>();
		let mOffset = 0;
		while (true) {
			const { data, error } = await fluxbase
				.from<Record<string, any>>('fitness_records')
				.select('recorded_at, heart_rate, power, cadence, cumulative_distance_m')
				.eq('activity_id', activity.id)
				.order('recorded_at', { ascending: true })
				.range(mOffset, mOffset + 999);
			if (error) break;
			const batch = (data as any[]) ?? [];
			for (const row of batch) {
				metrics.set(row.recorded_at, {
					hr: row.heart_rate,
					power: row.power,
					cadence: row.cadence,
					dist: row.cumulative_distance_m != null ? parseFloat(row.cumulative_distance_m) : null
				});
			}
			if (batch.length < 1000) break;
			mOffset += 1000;
		}

		const merged: TrackPoint[] = [];
		for (const [recordedAt, p] of points) {
			const m = metrics.get(recordedAt);
			merged.push({
				t: new Date(recordedAt).getTime(),
				lat: p.lat,
				lon: p.lon,
				altitude: p.altitude,
				speed: p.speed,
				speedSmooth: null,
				dist: m?.dist ?? 0,
				fitDist: m?.dist ?? null,
				hr: m?.hr ?? null,
				power: m?.power ?? null,
				cadence: m?.cadence ?? null
			});
		}
		merged.sort((a, b) => a.t - b.t);

		// Downsample for rendering if enormous (keep the tail intact)
		const stride = Math.max(1, Math.ceil(merged.length / 6000));
		const sampled = stride > 1 ? merged.filter((_, i) => i % stride === 0) : merged;

		// ~30 s centered average (window scales with the sampling stride)
		const smoothed = movingAverage(
			sampled.map((p) => p.speed),
			Math.max(3, Math.round(15 / stride))
		);
		for (let i = 0; i < sampled.length; i++) {
			sampled[i].speedSmooth = smoothed[i];
		}

		// Cumulative distance: prefer the device-reported values, fall back to
		// geometry-derived for points (or files) without them.
		const geoDistances = cumulativeDistances(sampled);
		let lastFit: number | null = null;
		for (let i = 0; i < sampled.length; i++) {
			if (sampled[i].fitDist != null) lastFit = sampled[i].fitDist;
			sampled[i].dist = lastFit ?? geoDistances[i];
		}

		track = sampled;
	}

	// ── Title / comment editing ──
	function startEditing() {
		if (!activity) return;
		titleInput = activity.title ?? '';
		descriptionInput = activity.description ?? '';
		confirmingDelete = false;
		editing = true;
	}

	async function saveEdits() {
		if (!activity || savingEdits) return;
		savingEdits = true;
		try {
			const title = titleInput.trim() || null;
			const description = descriptionInput.trim() || null;
			const { error } = await fluxbase
				.from<Record<string, any>>('fitness_activities')
				.update({ title, description })
				.eq('id', activity.id);
			if (error) throw new Error(error.message);
			activity = { ...activity, title, description };
			editing = false;
			toast.success(t('fitness.edit.saved'));
		} catch (error) {
			console.error('Failed to save activity:', error);
			toast.error(t('fitness.edit.saveFailed'));
		} finally {
			savingEdits = false;
		}
	}

	async function deleteActivity() {
		if (!activity || deleting) return;
		deleting = true;
		try {
			const { error } = await fluxbase
				.from<Record<string, any>>('fitness_activities')
				.delete()
				.eq('id', activity.id);
			if (error) throw new Error(error.message);
			toast.success(t('fitness.edit.deleted'));
			goto('/dashboard/fitness');
		} catch (error) {
			console.error('Failed to delete activity:', error);
			toast.error(t('fitness.edit.deleteFailed'));
			deleting = false;
		}
	}

	// ── Map rendering ──
	async function renderMap() {
		if (track.length === 0) return;
		if (!L) L = await import('leaflet');

		// The map card may have just entered the DOM (loading → content
		// swap); wait a frame so bind:this has fired and the container is
		// measured before Leaflet initializes.
		if (!mapContainer) {
			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
			if (!mapContainer) return;
		}

		if (map) {
			drawTrack();
			return;
		}

		// Leaflet needs an initial view — a map without one stays unloaded and
		// renders a single tile; fitBounds below moves to the actual track.
		map = L.map(mapContainer, {
			zoomControl: true,
			center: [track[0].lat, track[0].lon],
			zoom: 12
		});
		cleanupThemeWatcher = watchMapTheme(map, createBasemapLayer);
		drawTrack();

		// If the container was still settling when Leaflet measured it, its
		// cached size (and therefore fitBounds' zoom) is wrong. Recompute the
		// size and re-fit the track bounds once layout has settled.
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

	function speedColor(kmh: number | null): string {
		if (kmh == null) return theme.stroke;
		// 0 → deep, fast → hot (green→yellow→red ramp)
		const max = 45;
		const frac = Math.min(kmh / max, 1);
		const hue = 140 - frac * 140;
		return `hsl(${hue}, 70%, 45%)`;
	}

	function drawTrack() {
		if (!map || !L) return;
		for (const layer of polylineLayers) map.removeLayer(layer);
		polylineLayers = [];
		for (const pin of pinLayers) map.removeLayer(pin);
		pinLayers = [];
		if (scrubMarker) {
			map.removeLayer(scrubMarker);
			scrubMarker = null;
		}
		if (track.length < 2) {
			if (track.length === 1) map.setView([track[0].lat, track[0].lon], 14);
			return;
		}

		// Speed-coloured segments
		for (let i = 1; i < track.length; i++) {
			const a = track[i - 1];
			const b = track[i];
			const line = L.polyline(
				[
					[a.lat, a.lon],
					[b.lat, b.lon]
				],
				{
					color: speedColor(b.speedSmooth),
					weight: 4,
					opacity: 0.9,
					lineCap: 'round'
				}
			).addTo(map);
			polylineLayers.push(line);
		}

		// Start / finish pins
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

		const bounds = L.latLngBounds(track.map((p) => [p.lat, p.lon] as [number, number]));
		map.fitBounds(bounds, { padding: [30, 30] });
	}

	/** Resolve a scrubbed chart x value (time or distance) to the map marker. */
	function handleScrub(x: number | null) {
		if (!map || !L) return;
		if (x == null || track.length === 0) {
			scrubMarker?.remove();
			scrubMarker = null;
			return;
		}
		let best = track[0];
		let bestDelta = Infinity;
		for (const p of track) {
			const delta = Math.abs(xOf(p) - x);
			if (delta < bestDelta) {
				bestDelta = delta;
				best = p;
			}
		}
		if (!scrubMarker) {
			scrubMarker = L.circleMarker([best.lat, best.lon], {
				radius: 7,
				color: '#ffffff',
				weight: 3,
				fillColor: '#1f2937',
				fillOpacity: 1
			}).addTo(map);
		} else {
			scrubMarker.setLatLng([best.lat, best.lon]);
		}
	}

	// Load + redraw on id change
	$effect(() => {
		const activityId = id;
		if (activityId) {
			void loadActivity(activityId).then(() => renderMap());
		}
	});

	// Keyboard navigation between sessions
	$effect(() => {
		const handler = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLElement &&
				['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
			)
				return;
			if (e.key === 'ArrowLeft' && prevActivity)
				window.location.href = `/dashboard/fitness/${prevActivity.id}`;
			if (e.key === 'ArrowRight' && nextActivity)
				window.location.href = `/dashboard/fitness/${nextActivity.id}`;
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	});

	onDestroy(() => {
		cleanupThemeWatcher?.();
		map?.remove();
		map = null;
	});

	function statCard(
		label: string,
		value: string,
		sub?: string
	): { label: string; value: string; sub?: string } {
		return { label, value, sub };
	}

	let stats = $derived.by(() => {
		if (!activity) return [];
		const cards = [
			statCard(t('fitness.stats.distance'), formatDistance(activity.total_distance_m)),
			statCard(
				t('fitness.stats.movingTime'),
				formatDuration(activity.moving_time_s ?? activity.elapsed_time_s)
			)
		];
		const avgSpeed =
			activity.total_distance_m && activity.moving_time_s
				? activity.total_distance_m / activity.moving_time_s
				: null;
		if (avgSpeed != null) {
			cards.push(statCard(t('fitness.stats.avgSpeed'), `${formatSpeed(avgSpeed)} km/h`));
		}
		if (elevation != null && elevation > 0) {
			cards.push(statCard(t('fitness.stats.elevation'), `${elevation} m`));
		}
		if (activity.avg_heartrate != null) {
			cards.push(
				statCard(
					t('fitness.stats.avgHr'),
					`${activity.avg_heartrate}`,
					activity.max_heartrate != null ? `max ${activity.max_heartrate} bpm` : undefined
				)
			);
		}
		if (activity.avg_power != null) {
			cards.push(
				statCard(
					t('fitness.stats.avgPower'),
					`${activity.avg_power} W`,
					activity.max_power != null ? `max ${activity.max_power} W` : undefined
				)
			);
		}
		if (activity.avg_cadence != null) {
			cards.push(statCard(t('fitness.stats.avgCadence'), `${activity.avg_cadence} rpm`));
		}
		if (activity.calories != null) {
			cards.push(statCard(t('fitness.stats.calories'), `${activity.calories} kcal`));
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
	<title
		>{activity
			? `${activity.title ?? t(theme.labelKey)} · ${formatHeaderDate(activity.started_at)}`
			: t('fitness.title')} · Wayli</title
	>
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</svelte:head>

<div>
	<!-- Back + prev/next -->
	<div class="mb-4 flex items-center justify-between gap-2">
		<a
			href="/dashboard/fitness"
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
		>
			<ArrowLeft class="h-4 w-4" />
			{t('fitness.backToList')}
		</a>
		<div class="flex items-center gap-1">
			<a
				href={prevActivity ? `/dashboard/fitness/${prevActivity.id}` : undefined}
				class="border-border hover:bg-muted flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium {prevActivity
					? ''
					: 'pointer-events-none opacity-40'}"
				aria-label={t('fitness.previous')}
				title={t('fitness.previous')}
			>
				<ChevronLeft class="h-4 w-4" />
			</a>
			<a
				href={nextActivity ? `/dashboard/fitness/${nextActivity.id}` : undefined}
				class="border-border hover:bg-muted flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium {nextActivity
					? ''
					: 'pointer-events-none opacity-40'}"
				aria-label={t('fitness.next')}
				title={t('fitness.next')}
			>
				<ChevronRight class="h-4 w-4" />
			</a>
		</div>
	</div>

	{#if loading}
		<div class="bg-card border-border flex items-center justify-center rounded-xl border p-24">
			<div class="flex items-center gap-3">
				<Loader2 class="text-muted-foreground h-5 w-5 animate-spin" />
				<span class="text-muted-foreground">{t('fitness.loading')}</span>
			</div>
		</div>
	{:else if notFound || !activity}
		<div class="bg-card border-border rounded-xl border p-16 text-center">
			<MapPin class="text-muted-foreground mx-auto mb-3 h-8 w-8" />
			<p class="text-foreground font-medium">{t('fitness.notFound')}</p>
			<a href="/dashboard/fitness" class="text-primary mt-3 inline-block text-sm font-medium">
				{t('fitness.backToList')}
			</a>
		</div>
	{:else}
		<!-- Hero -->
		<div class="relative mb-6 overflow-hidden rounded-2xl">
			<div class="absolute inset-0 bg-gradient-to-r {theme.gradient}"></div>
			<div
				class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.25),transparent_55%)]"
			></div>
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
				<div class="flex items-center gap-6">
					<div class="hidden items-baseline gap-6 sm:flex">
						<div>
							<p class="text-3xl font-bold tabular-nums">
								{formatDistance(activity.total_distance_m)}
							</p>
						</div>
						<div>
							<p class="text-3xl font-bold tabular-nums">
								{formatDuration(activity.moving_time_s ?? activity.elapsed_time_s)}
							</p>
						</div>
					</div>
					{#if !editing}
						<div class="flex shrink-0 items-center gap-2">
							<button
								type="button"
								class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-white/25"
								onclick={copyShareLink}
								aria-label="Copy share link"
								title="Copy share link"
							>
								<Link2 class="h-4 w-4" />
							</button>
							<button
								type="button"
								class="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/25"
								onclick={cycleVisibility}
								aria-label={`Sharing: ${visibilityLabel()} — click to change`}
								title={`Sharing: ${visibilityLabel()} — click to change`}
							>
								{#if activity.visibility === null}
									<Clock class="h-4 w-4" />
								{:else if effectiveVisibility() === 'private'}
									<Lock class="h-4 w-4" />
								{:else if effectiveVisibility() === 'friends'}
									<Users class="h-4 w-4" />
								{:else}
									<Globe class="h-4 w-4" />
								{/if}
								{visibilityLabel()}
							</button>
							<button
								type="button"
								class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-white/25"
								onclick={startEditing}
								aria-label={t('fitness.edit.rename')}
								title={t('fitness.edit.rename')}
							>
								<Pencil class="h-4 w-4" />
							</button>
							{#if confirmingDelete}
								<div class="flex flex-col items-end gap-1.5">
									<div class="flex items-center gap-2">
										<button
											type="button"
											class="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={deleteActivity}
											disabled={deleting}
										>
											{#if deleting}
												<Loader2 class="h-4 w-4 animate-spin" />
											{:else}
												<Trash2 class="h-4 w-4" />
											{/if}
											{t('common.actions.delete')}
										</button>
										<button
											type="button"
											class="flex h-9 cursor-pointer items-center rounded-lg bg-white/15 px-3 text-sm font-medium text-white transition-colors hover:bg-white/25"
											onclick={() => (confirmingDelete = false)}
											disabled={deleting}
										>
											{t('common.actions.cancel')}
										</button>
									</div>
									<p class="max-w-xs text-right text-xs text-white/75">
										{t('fitness.edit.deleteHint')}
									</p>
								</div>
							{:else}
								<button
									type="button"
									class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-red-600"
									onclick={() => (confirmingDelete = true)}
									aria-label={t('fitness.edit.delete')}
									title={t('fitness.edit.delete')}
								>
									<Trash2 class="h-4 w-4" />
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Edit form (title / comment) -->
		{#if editing}
			<div class="bg-card border-border mb-6 rounded-xl border p-5">
				<label class="mb-1.5 block text-sm font-medium" for="fitness-title">
					{t('fitness.edit.titleLabel')}
				</label>
				<input
					id="fitness-title"
					type="text"
					bind:value={titleInput}
					placeholder={t('fitness.edit.titlePlaceholder')}
					maxlength="120"
					class="border-border bg-background text-foreground placeholder:text-muted-foreground mb-4 w-full rounded-lg border px-3 py-2 text-sm"
				/>
				<label class="mb-1.5 block text-sm font-medium" for="fitness-description">
					{t('fitness.edit.commentLabel')}
				</label>
				<textarea
					id="fitness-description"
					bind:value={descriptionInput}
					placeholder={t('fitness.edit.commentPlaceholder')}
					rows="3"
					maxlength="2000"
					class="border-border bg-background text-foreground placeholder:text-muted-foreground w-full resize-y rounded-lg border px-3 py-2 text-sm"
				></textarea>
				<div class="mt-4 flex justify-end gap-2">
					<button
						type="button"
						class="border-border hover:bg-muted cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium"
						onclick={() => (editing = false)}
						disabled={savingEdits}
					>
						{t('common.actions.cancel')}
					</button>
					<button
						type="button"
						class="bg-primary hover:bg-primary/90 inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
						onclick={saveEdits}
						disabled={savingEdits}
					>
						{#if savingEdits}
							<Loader2 class="h-4 w-4 animate-spin" />
						{/if}
						{t('common.actions.save')}
					</button>
				</div>
			</div>
		{/if}

		<!-- Stats grid -->
		<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each stats as stat (stat.label)}
				<div class="bg-card border-border rounded-xl border p-4">
					<p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
						{stat.label}
					</p>
					<p class="text-foreground mt-1 text-xl font-bold tabular-nums">{stat.value}</p>
					{#if stat.sub}
						<p class="text-muted-foreground mt-0.5 text-xs tabular-nums">{stat.sub}</p>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Map -->
		{#if track.length > 0}
			<div class="bg-card border-border mb-6 overflow-hidden rounded-xl border">
				<div class="border-border border-b px-4 py-2.5 text-sm font-medium">
					{#if activity.manufacturer}
						<span class="text-muted-foreground float-right text-xs font-normal">
							{t('fitness.stats.device')}: {activity.manufacturer}{activity.product
								? ` ${activity.product}`
								: ''}
						</span>
					{/if}
				</div>
				<div bind:this={mapContainer} class="h-[380px] w-full"></div>
			</div>

			<!-- Charts -->
			{#if hrPowerSeries[0].points.length > 0 || hrPowerSeries[1].points.length > 0 || speedCadenceSeries[0].points.length > 0 || speedCadenceSeries[1].points.length > 0}
				<div class="mb-3 flex items-center justify-end">
					<div class="bg-muted inline-flex rounded-lg p-0.5" role="group" aria-label="X axis">
						<button
							type="button"
							class="cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors {xMode ===
							'time'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
							onclick={() => (xMode = 'time')}
							aria-pressed={xMode === 'time'}
						>
							<Clock class="mr-1 inline h-3.5 w-3.5" />
							{t('fitness.chart.time')}
						</button>
						<button
							type="button"
							class="cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors {xMode ===
							'distance'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
							onclick={() => (xMode = 'distance')}
							aria-pressed={xMode === 'distance'}
						>
							<Route class="mr-1 inline h-3.5 w-3.5" />
							{t('fitness.chart.distance')}
						</button>
					</div>
				</div>
			{/if}
			<div class="grid gap-6 lg:grid-cols-2">
				{#if hrPowerSeries[0].points.length > 0 || hrPowerSeries[1].points.length > 0}
					<div class="bg-card border-border rounded-xl border p-4">
						<div class="mb-2 flex items-center justify-between">
							<h3 class="text-foreground text-sm font-semibold">
								{t('fitness.chart.heartRate')} · {t('fitness.chart.power')}
							</h3>
						</div>
						<FitnessChart series={hrPowerSeries} xAxis={xMode} onscrub={handleScrub} />
						<div class="text-muted-foreground/70 mt-1 text-center text-[11px]">
							{t('fitness.chart.hint')}
						</div>
					</div>
				{/if}
				{#if speedCadenceSeries[0].points.length > 0 || speedCadenceSeries[1].points.length > 0}
					<div class="bg-card border-border rounded-xl border p-4">
						<div class="mb-2 flex items-center justify-between">
							<h3 class="text-foreground text-sm font-semibold">
								{t('fitness.chart.speed')} · {t('fitness.chart.cadence')}
							</h3>
						</div>
						<FitnessChart series={speedCadenceSeries} xAxis={xMode} onscrub={handleScrub} />
						<div class="text-muted-foreground/70 mt-1 text-center text-[11px]">
							{t('fitness.chart.hint')}
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="bg-card border-border rounded-xl border p-12 text-center">
				<Flag class="text-muted-foreground mx-auto mb-2 h-6 w-6" />
				<p class="text-muted-foreground text-sm">{t('fitness.notFound')}</p>
			</div>
		{/if}

		<!-- Source -->
		{#if activity.source_file}
			<p class="text-muted-foreground/60 mt-6 text-xs">
				{t('fitness.stats.source')}: {activity.source_file}
			</p>
		{/if}
	{/if}
</div>
