<script lang="ts">
	import {
		Loader2,
		Activity,
		ChevronRight,
		Dumbbell,
		Globe,
		Lock,
		Share2,
		UploadCloud,
		Users
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';
	import {
		currentUsername,
		fitnessSharing,
		loadFitnessSharing,
		setActivityVisibility,
		type FitnessAudience
	} from '$lib/stores/fitness-sharing.svelte';
	import {
		formatDistance,
		formatDuration,
		groupByMonth,
		sportTheme,
		type FitnessActivity
	} from '$lib/utils/fitness';

	let t = $derived($translate);

	let activities = $state<FitnessActivity[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let username = $state<string | null>(null);

	const groups = $derived(groupByMonth(activities));

	const PAGE_SIZE = 200;

	/** True when the last fetch returned a full page — there may be more. */
	let canLoadMore = $state(false);
	let loadingMore = $state(false);

	async function loadActivitiesPage(offset: number): Promise<FitnessActivity[]> {
		const res = await fluxbase
			.from<Record<string, any>>('fitness_activities')
			.select('*')
			.order('started_at', { ascending: false })
			.range(offset, offset + PAGE_SIZE - 1);
		if (res.error) throw new Error(res.error.message || 'Failed to load activities');
		return (res.data ?? []) as unknown as FitnessActivity[];
	}

	async function loadMore() {
		if (loadingMore || !canLoadMore) return;
		loadingMore = true;
		try {
			const page = await loadActivitiesPage(activities.length);
			// A full page suggests more exist; a short page is the tail.
			canLoadMore = page.length === PAGE_SIZE;
			activities = [...activities, ...page];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load activities';
		} finally {
			loadingMore = false;
		}
	}

	onMount(async () => {
		void loadFitnessSharing();
		try {
			const [page, name] = await Promise.all([loadActivitiesPage(0), currentUsername()]);
			activities = page;
			canLoadMore = page.length === PAGE_SIZE;
			username = name;
		} catch (err) {
			console.error('Failed to load fitness activities:', err);
			loadError = err instanceof Error ? err.message : 'Failed to load activities';
		} finally {
			loading = false;
		}
	});

	// ---- Sharing ----
	// Cycle Default → Private → Friends → Public; Default clears the override
	// so the activity follows the global fitness_sharing.default preference.
	const CYCLE: (FitnessAudience | null)[] = [null, 'private', 'friends', 'public'];

	function effectiveVisibility(activity: FitnessActivity): FitnessAudience {
		return activity.visibility ?? fitnessSharing().default;
	}

	async function cycleVisibility(e: MouseEvent, activity: FitnessActivity) {
		e.preventDefault();
		e.stopPropagation();
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

	function visibilityLabel(v: FitnessAudience | null): string {
		if (v === null)
			return `${t('fitness.sharing.default')} (${t('fitness.sharing.' + fitnessSharing().default)})`;
		return t('fitness.sharing.' + v);
	}

	async function copyShareLink(e: MouseEvent, activity: FitnessActivity) {
		e.preventDefault();
		e.stopPropagation();
		if (!username) return;
		const url = `${window.location.origin}/u/${username}/fitness/${activity.id}`;
		try {
			await navigator.clipboard.writeText(url);
			toast.success(
				effectiveVisibility(activity) === 'private'
					? t('fitness.sharing.linkCopiedPrivate')
					: t('fitness.sharing.linkCopied')
			);
		} catch {
			toast.error(t('fitness.sharing.copyFailed'));
		}
	}

	function formatStart(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>{t('fitness.title')} · Wayli</title>
</svelte:head>

<div>
	<!-- Header -->
	<div class="mb-8 flex items-center gap-3">
		<div
			class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-fuchsia-500/20"
		>
			<Activity class="h-6 w-6 text-white" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<h1 class="text-foreground text-xl font-bold">{t('fitness.title')}</h1>
				<span
					class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-900/40 dark:text-amber-300"
				>
					{t('fitness.betaBadge')}
				</span>
			</div>
			<p class="text-muted-foreground text-sm">{t('fitness.subtitle')}</p>
		</div>
	</div>

	{#if loading}
		<!-- Loading skeleton -->
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each Array(3) as _}
				<div class="bg-card border-border animate-pulse rounded-xl border p-5">
					<div class="bg-muted mb-4 h-3 w-24 rounded-full"></div>
					<div class="bg-muted mb-2 h-8 w-32 rounded-lg"></div>
					<div class="bg-muted h-3 w-40 rounded-full"></div>
				</div>
			{/each}
		</div>
	{:else if loadError}
		<!-- Error state -->
		<div class="border-border rounded-xl border bg-red-50 p-8 text-center dark:bg-red-950/30">
			<p class="font-medium text-red-700 dark:text-red-300">{loadError}</p>
			<p class="text-muted-foreground mt-1 text-sm">
				{t('fitness.emptyHint')}
			</p>
		</div>
	{:else if activities.length === 0}
		<!-- Empty state -->
		<div
			class="bg-card border-border flex flex-col items-center rounded-xl border p-14 text-center"
		>
			<div class="bg-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
				<UploadCloud class="text-muted-foreground h-7 w-7" />
			</div>
			<h2 class="text-foreground text-lg font-semibold">{t('fitness.emptyTitle')}</h2>
			<p class="text-muted-foreground mt-1 max-w-md text-sm">{t('fitness.emptyHint')}</p>
			<a
				href="/dashboard/import-export"
				class="bg-primary hover:bg-primary/90 mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
			>
				<UploadCloud class="h-4 w-4" />
				{t('importExport.importData')}
			</a>
		</div>
	{:else}
		{#each groups as group (group.label)}
			<section class="mb-8">
				<h2 class="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
					{group.label}
				</h2>
				<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{#each group.activities as activity (activity.id)}
						{@const theme = sportTheme(activity.sport)}
						<a
							href="/dashboard/fitness/{activity.id}"
							class="bg-card border-border group hover:border-primary/40 relative overflow-hidden rounded-xl border transition-all hover:shadow-lg"
						>
							<!-- Sport gradient accent -->
							<div class="h-1.5 w-full bg-gradient-to-r {theme.gradient}"></div>
							<div class="p-5">
								<div class="mb-3 flex items-center justify-between">
									<div class="flex min-w-0 items-center gap-2">
										<span
											class="{theme.text} flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br {theme.gradient} bg-clip-text"
										>
											<Dumbbell class="h-4 w-4 text-white" />
										</span>
										<div>
											<p class="text-foreground text-sm font-semibold">
												{activity.title ?? t(theme.labelKey)}
											</p>
											<p class="text-muted-foreground text-xs">
												{activity.title ? `${t(theme.labelKey)} · ` : ''}{formatStart(
													activity.started_at
												)} · {formatTime(activity.started_at)}
											</p>
										</div>
									</div>
									<div class="flex shrink-0 items-center gap-1">
										<button
											type="button"
											class="text-muted-foreground hover:bg-muted flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium"
											onclick={(e) => copyShareLink(e, activity)}
											aria-label="Copy share link"
											title="Copy share link"
										>
											<Share2 class="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											class="hover:bg-muted flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium {effectiveVisibility(
												activity
											) === 'public'
												? 'text-emerald-600 dark:text-emerald-300'
												: effectiveVisibility(activity) === 'friends'
													? 'text-sky-600 dark:text-sky-300'
													: 'text-muted-foreground'}"
											onclick={(e) => cycleVisibility(e, activity)}
											aria-label={`Sharing: ${visibilityLabel(activity.visibility ?? null)} — click to change`}
											title={`Sharing: ${visibilityLabel(activity.visibility ?? null)} — click to change`}
										>
											{#if activity.visibility === null}
												<Activity class="h-3.5 w-3.5" />
											{:else if effectiveVisibility(activity) === 'private'}
												<Lock class="h-3.5 w-3.5" />
											{:else if effectiveVisibility(activity) === 'friends'}
												<Users class="h-3.5 w-3.5" />
											{:else}
												<Globe class="h-3.5 w-3.5" />
											{/if}
											<span>{visibilityLabel(activity.visibility ?? null)}</span>
										</button>
										<ChevronRight
											class="text-muted-foreground group-hover:text-primary h-5 w-5 transition-colors"
										/>
									</div>
								</div>

								<div class="mb-3 flex items-baseline gap-3">
									<span class="text-foreground text-2xl font-bold tabular-nums">
										{formatDistance(activity.total_distance_m)}
									</span>
									<span class="text-muted-foreground text-sm tabular-nums">
										{formatDuration(activity.moving_time_s ?? activity.elapsed_time_s)}
									</span>
								</div>

								<div
									class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums"
								>
									{#if activity.avg_heartrate != null}
										<span
											>❤️ {activity.avg_heartrate}<span class="opacity-60"
												>/{activity.max_heartrate ?? '—'}</span
											> bpm</span
										>
									{/if}
									{#if activity.avg_power != null}
										<span
											>⚡ {activity.avg_power}<span class="opacity-60"
												>/{activity.max_power ?? '—'}</span
											> W</span
										>
									{/if}
									{#if activity.calories != null}
										<span>🔥 {activity.calories} kcal</span>
									{/if}
								</div>

								{#if activity.manufacturer}
									<p class="text-muted-foreground/70 mt-3 text-[11px] tracking-wide uppercase">
										{activity.manufacturer}{activity.product ? ` · ${activity.product}` : ''}
									</p>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/each}

		{#if canLoadMore}
			<div class="mt-4 flex justify-center">
				<button
					type="button"
					class="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					onclick={loadMore}
					disabled={loadingMore}
				>
					{#if loadingMore}
						<Loader2 class="h-4 w-4 animate-spin" />
					{/if}
					Load more activities
				</button>
			</div>
		{/if}
	{/if}
</div>
