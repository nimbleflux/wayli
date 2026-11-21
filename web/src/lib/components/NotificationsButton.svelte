<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import {
		Bell,
		Check,
		CheckCheck,
		Clock,
		Download,
		Upload,
		MapPin,
		Route,
		FileDown,
		Trash2,
		X,
		Loader2,
		CircleAlert,
		ScrollText
	} from 'lucide-svelte';

	import { translate } from '$lib/i18n';
	import { fluxbase } from '$lib/fluxbase';
	import { toast } from 'svelte-sonner';

	import {
		getActiveJobsMap,
		subscribe as subscribeJobs,
		type JobStoreJob
	} from '$lib/stores/job-store';
	import { unreadCount, refreshUnread, notifRefresh } from '$lib/stores/notifications';
	import {
		listNotifications,
		markRead,
		markAllRead,
		deleteNotification
	} from '$lib/services/notifications.service';
	import type { AppNotification } from '$lib/types/notification.types';
	import JobDetailModal from '$lib/components/modals/JobDetailModal.svelte';

	let t = $derived($translate);

	// --- Panel open state + click-outside ---
	let open = $state(false);
	let panelEl = $state<HTMLDivElement | null>(null);
	let buttonEl = $state<HTMLButtonElement | null>(null);

	// --- Live job data ---
	// Active = pending/running. Terminal = just-completed/failed/cancelled jobs
	// that are still in the job-store's 60s window — surfaced briefly as rich
	// cards so the user sees the outcome immediately, then they collapse into
	// the "Recent" notification list. `hiddenTerminalIds` locally suppresses a
	// terminal card a few seconds after it appears.
	let activeJobsMap = $state<Map<string, JobStoreJob>>(new Map());
	let hiddenTerminalIds = $state<Set<string>>(new Set());
	let hideTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const TERMINAL_LINGER_MS = 4000;

	const activeJobs = $derived(
		Array.from(activeJobsMap.values())
			.filter((j) => j.status === 'pending' || j.status === 'running')
			.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
	);
	const recentTerminalJobs = $derived(
		Array.from(activeJobsMap.values())
			.filter(
				(j) =>
					(j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') &&
					!hiddenTerminalIds.has(j.id)
			)
			.sort((a, b) => {
				const ta = new Date(a.completed_at || a.updated_at || a.created_at).getTime();
				const tb = new Date(b.completed_at || b.updated_at || b.created_at).getTime();
				return tb - ta;
			})
	);

	// --- Persistent notifications ---
	let notifications = $state<AppNotification[]>([]);
	let loadingNotifs = $state(false);

	// --- Job logs modal (opened inline from a card / notification row) ---
	let logJob = $state<JobStoreJob | null>(null);

	const activeCount = $derived(activeJobs.length + recentTerminalJobs.length);
	const totalBadge = $derived(activeCount + ($unreadCount > 0 ? $unreadCount : 0));

	// Job-type icon config.
	const jobTypeIcon: Record<string, any> = {
		data_import: FileDown,
		data_import_geojson: FileDown,
		data_import_gpx: FileDown,
		data_import_owntracks: FileDown,
		data_export: Upload,
		reverse_geocoding: MapPin,
		reverse_geocoding_missing: MapPin,
		trip_generation: Route,
		trip_detection: Route
	};
	function jobIcon(name: string): any {
		const norm = name.replace(/-/g, '_');
		return jobTypeIcon[norm] ?? Clock;
	}

	function notifIcon(n: AppNotification): any {
		if (n.type === 'job_failed') return CircleAlert;
		if (n.type === 'job_cancelled') return X;
		if (n.type === 'job_completed') {
			// data exports are downloadable
			if (n.link) return Download;
			return Check;
		}
		if (n.type === 'geocode_missing') return MapPin;
		return Bell;
	}

	// Detect mobile for sheet vs. popover rendering.
	let isMobile = $state(false);
	function updateMobile() {
		isMobile = window.matchMedia('(max-width: 767px)').matches;
	}

	let unsubJobs: (() => void) | null = null;
	let unsubNotifs: (() => void) | null = null;
	let destroyed = false;

	onMount(() => {
		updateMobile();
		window.addEventListener('resize', updateMobile);
		activeJobsMap = new Map(getActiveJobsMap());
		unsubJobs = subscribeJobs(() => {
			if (destroyed) return;
			const prev = activeJobsMap;
			activeJobsMap = new Map(getActiveJobsMap());
			scheduleLingerTimers(prev, activeJobsMap);
		});
		unsubNotifs = notifRefresh.subscribe(() => {
			if (destroyed || !open) return;
			loadNotifs();
		});
		document.addEventListener('click', handleDocClick);
	});

	onDestroy(() => {
		if (!browser) return;
		destroyed = true;
		window.removeEventListener('resize', updateMobile);
		unsubJobs?.();
		unsubNotifs?.();
		hideTimers.forEach((timer) => clearTimeout(timer));
		hideTimers.clear();
		document.removeEventListener('click', handleDocClick);
	});

	/**
	 * When a job transitions into a terminal state (completed/failed/cancelled),
	 * start a short timer to collapse its rich card into the "Recent" list. The
	 * card stays visible for TERMINAL_LINGER_MS so the user sees the outcome,
	 * then is locally hidden (the underlying job is removed from the store
	 * ~60s later by the job-store's own cleanup).
	 */
	function scheduleLingerTimers(prev: Map<string, JobStoreJob>, curr: Map<string, JobStoreJob>) {
		for (const [id, job] of curr) {
			const isTerminal =
				job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
			const wasTerminal = (() => {
				const p = prev.get(id);
				return (
					!!p && (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled')
				);
			})();
			if (isTerminal && !wasTerminal && !hideTimers.has(id) && !hiddenTerminalIds.has(id)) {
				hideTimers.set(
					id,
					setTimeout(() => {
						hideTimers.delete(id);
						if (destroyed) return;
						// Reassign the Set (not mutate) so Svelte 5 reactivity fires.
						const next = new Set(hiddenTerminalIds);
						next.add(id);
						hiddenTerminalIds = next;
					}, TERMINAL_LINGER_MS)
				);
			}
		}
	}

	function handleDocClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (panelEl && panelEl.contains(target)) return;
		if (buttonEl && buttonEl.contains(target)) return;
		open = false;
	}

	async function togglePanel() {
		open = !open;
		if (open) await loadNotifs();
	}

	async function loadNotifs() {
		loadingNotifs = true;
		try {
			notifications = await listNotifications(25);
		} finally {
			loadingNotifs = false;
		}
	}

	async function handleMarkRead(n: AppNotification, e?: MouseEvent) {
		e?.stopPropagation();
		if (n.read_at) return;
		await markRead(n.id);
		notifications = notifications.map((x) =>
			x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x
		);
		refreshUnread();
	}

	async function handleMarkAllRead() {
		await markAllRead();
		notifications = notifications.map((x) => ({
			...x,
			read_at: x.read_at ?? new Date().toISOString()
		}));
		refreshUnread();
	}

	async function handleDelete(n: AppNotification, e?: MouseEvent) {
		e?.stopPropagation();
		await deleteNotification(n.id);
		notifications = notifications.filter((x) => x.id !== n.id);
		refreshUnread();
	}

	async function handleCancelJob(job: JobStoreJob, e?: MouseEvent) {
		e?.stopPropagation();
		try {
			await fluxbase.jobs.cancel(job.id);
			toast.success(t('jobProgress.cancelSuccess'));
		} catch {
			toast.error(t('jobProgress.cancelFailed'));
		}
	}

	/** Open the job logs modal inline from a job card. */
	function openJobLogs(job: JobStoreJob, e?: MouseEvent) {
		e?.stopPropagation();
		logJob = job;
	}

	/** Open logs from a persistent notification row. The job may no longer be in
	 * the store, so synthesize a minimal JobStoreJob from the notification's
	 * related_job_id; JobDetailModal fetches logs/history via the SDK. */
	function openNotifLogs(n: AppNotification, e?: MouseEvent) {
		e?.stopPropagation();
		if (!n.related_job_id) return;
		handleMarkRead(n);
		// Derive the terminal status from the notification type so the modal
		// header is accurate (was hardcoded to 'completed').
		const status: JobStoreJob['status'] =
			n.type === 'job_failed' ? 'failed' : n.type === 'job_cancelled' ? 'cancelled' : 'completed';
		logJob = {
			id: n.related_job_id,
			job_name: n.title.replace(/\s+(completed|failed|cancelled)$/i, ''),
			status,
			error: n.type === 'job_failed' ? n.body : undefined,
			completed_at: n.created_at,
			created_at: n.created_at
		} as JobStoreJob;
	}

	async function handleNotifClick(n: AppNotification) {
		await handleMarkRead(n);
		if (n.link) {
			open = false;
			window.location.href = n.link;
		}
	}

	function relTime(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const m = Math.floor(diff / 60000);
		if (m < 1) return t('notifications.justNow');
		if (m < 60) return t('notifications.minutesAgo').replace('{minutes}', String(m));
		const h = Math.floor(m / 60);
		if (h < 24) return t('notifications.hoursAgo').replace('{hours}', String(h));
		const d = Math.floor(h / 24);
		return t('notifications.daysAgo').replace('{days}', String(d));
	}

	function jobProgressPct(job: JobStoreJob): number {
		return typeof job.progress_percent === 'number' ? job.progress_percent : 0;
	}
</script>

<div class="relative">
	<!-- Bell button -->
	<button
		bind:this={buttonEl}
		onclick={togglePanel}
		class="text-muted-foreground hover:text-foreground relative flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md p-1 transition-colors"
		title={t('notifications.title')}
		aria-label={t('notifications.title')}
	>
		<Bell class="h-5 w-5" />
		{#if totalBadge > 0}
			<span
				class="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold"
			>
				{totalBadge > 99 ? '99+' : totalBadge}
			</span>
		{/if}
	</button>
</div>

{#if open}
	<!-- Mobile: bottom sheet backdrop -->
	{#if isMobile}
		<button
			class="fixed inset-0 z-40 bg-black/50 md:hidden"
			aria-label="Close notifications"
			onclick={() => (open = false)}
			transition:fade
		></button>

		<div
			class="bg-card fixed inset-x-0 bottom-0 z-50 max-h-[80vh] rounded-t-2xl border-t shadow-2xl md:hidden"
			transition:fly={{ y: 300, duration: 200 }}
		>
			<div class="bg-muted mx-auto mt-2 h-1.5 w-10 rounded-full"></div>
			<div class="flex items-center justify-between border-b p-4">
				<h2 class="text-foreground text-base font-semibold">{t('notifications.title')}</h2>
				<button
					onclick={() => (open = false)}
					class="text-muted-foreground hover:text-foreground rounded-md p-1"
					aria-label="Close"
				>
					<X class="h-5 w-5" />
				</button>
			</div>
			<div class="max-h-[60vh] overflow-y-auto p-2">
				{@render listContent()}
			</div>
		</div>
	{:else}
		<!-- Desktop: popover fixed to the top-right of the viewport so it can't
		     be clipped by any ancestor (sidebar/header) overflow. -->
		<div
			bind:this={panelEl}
			class="bg-card border-border fixed top-16 right-4 z-50 w-96 origin-top-right rounded-xl border shadow-2xl"
			transition:fly={{ y: -8, duration: 150 }}
		>
			<div class="flex items-center justify-between border-b p-3">
				<h2 class="text-foreground text-sm font-semibold">{t('notifications.title')}</h2>
				{#if $unreadCount > 0}
					<button
						onclick={handleMarkAllRead}
						class="text-primary hover:text-primary/80 flex items-center gap-1 text-xs font-medium"
					>
						<CheckCheck class="h-3.5 w-3.5" />
						{t('notifications.markAllRead')}
					</button>
				{/if}
			</div>
			<div class="max-h-[28rem] overflow-y-auto p-2">
				{@render listContent()}
			</div>
		</div>
	{/if}
{/if}

{#snippet listContent()}
	{#if activeJobs.length > 0 || recentTerminalJobs.length > 0}
		<div class="px-2 pt-2 pb-1">
			<p class="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
				{t('notifications.active')} · {activeJobs.length + recentTerminalJobs.length}
			</p>
		</div>

		{#each activeJobs as job (job.id)}
			{@const JobIcon = jobIcon(job.job_name)}
			<div
				class="hover:bg-muted flex items-start gap-3 rounded-lg p-2"
				role="status"
				aria-live="polite"
			>
				<div class="text-primary mt-0.5">
					<Loader2 class="h-4 w-4 animate-spin" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<p class="text-foreground truncate text-sm font-medium">
							<JobIcon class="text-muted-foreground mr-1 inline h-3.5 w-3.5" />
							{job.job_name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
						</p>
						<div class="flex shrink-0 items-center gap-0.5">
							<button
								onclick={(e) => openJobLogs(job, e)}
								class="text-muted-foreground hover:text-foreground rounded p-1"
								title={t('notifications.viewLogs')}
								aria-label={t('notifications.viewLogs')}
							>
								<ScrollText class="h-3.5 w-3.5" />
							</button>
							{#if job.status === 'running'}
								<button
									onclick={(e) => handleCancelJob(job, e)}
									class="text-muted-foreground hover:text-red-500"
									title={t('jobProgress.cancelJob')}
									aria-label={t('jobProgress.cancelJob')}
								>
									<X class="h-3.5 w-3.5" />
								</button>
							{/if}
						</div>
					</div>
					<div class="bg-muted mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary h-full rounded-full transition-all duration-300"
							style="width: {jobProgressPct(job)}%"
						></div>
					</div>
					<p class="text-muted-foreground mt-1 text-xs">
						{job.status === 'pending'
							? t('jobProgress.statusPending')
							: job.progress_message || t('jobProgress.statusRunning')}
					</p>
				</div>
			</div>
		{/each}

		<!-- Just-finished jobs: shown as rich cards briefly before collapsing
		     into the "Recent" notification list below. -->
		{#each recentTerminalJobs as job (job.id)}
			{@const JobIcon = jobIcon(job.job_name)}
			{@const termIcon =
				job.status === 'completed' ? Check : job.status === 'failed' ? CircleAlert : X}
			{@const termColor =
				job.status === 'completed'
					? 'text-green-500'
					: job.status === 'failed'
						? 'text-red-500'
						: 'text-muted-foreground'}
			<div
				class="hover:bg-muted group flex items-start gap-3 rounded-lg p-2"
				role="status"
				aria-live="polite"
				transition:fade={{ duration: 150 }}
			>
				<div class="mt-0.5 {termColor}">
					<termIcon class="h-4 w-4"></termIcon>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-foreground truncate text-sm font-medium">
						<JobIcon class="text-muted-foreground mr-1 inline h-3.5 w-3.5" />
						{job.job_name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
					</p>
					<p class="text-muted-foreground mt-1 text-xs">
						{job.status === 'completed'
							? t('jobProgress.statusCompleted')
							: job.status === 'failed'
								? t('jobProgress.statusFailed')
								: t('jobProgress.statusCancelled')}
					</p>
				</div>
				<button
					onclick={(e) => openJobLogs(job, e)}
					class="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
					title={t('notifications.viewLogs')}
					aria-label={t('notifications.viewLogs')}
				>
					<ScrollText class="h-3.5 w-3.5" />
				</button>
			</div>
		{/each}
	{/if}

	<div class="px-2 pt-2 pb-1">
		<p class="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
			{t('notifications.recent')}
		</p>
	</div>

	{#if loadingNotifs}
		<div class="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
			<Loader2 class="h-4 w-4 animate-spin" />
			{t('notifications.loading')}
		</div>
	{:else if notifications.length === 0 && activeJobs.length === 0 && recentTerminalJobs.length === 0}
		<div class="text-muted-foreground flex flex-col items-center gap-2 p-8 text-center">
			<Bell class="h-8 w-8 opacity-40" />
			<p class="text-sm">{t('notifications.empty')}</p>
		</div>
	{:else}
		{#each notifications as n (n.id)}
			{@const NIcon = notifIcon(n)}
			<div
				class="hover:bg-muted group flex items-start gap-3 rounded-lg p-2 {!n.read_at
					? 'bg-primary/5'
					: ''}"
				role="button"
				tabindex={0}
				onclick={() => handleNotifClick(n)}
				onkeydown={(e) => e.key === 'Enter' && handleNotifClick(n)}
				animate:flip={{ duration: 150 }}
			>
				<div
					class="mt-0.5 {n.type === 'job_failed'
						? 'text-red-500'
						: n.type === 'job_completed'
							? 'text-green-500'
							: 'text-muted-foreground'}"
				>
					<NIcon class="h-4 w-4" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-foreground text-sm leading-snug font-medium">
						{#if !n.read_at}<span
								class="bg-primary mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
							></span>{/if}
						{n.title}
					</p>
					{#if n.body}
						<p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{n.body}</p>
					{/if}
					<p class="text-muted-foreground mt-1 text-xs">{relTime(n.created_at)}</p>
				</div>
				<div
					class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
				>
					{#if n.related_job_id}
						<button
							onclick={(e) => openNotifLogs(n, e)}
							class="text-muted-foreground hover:text-foreground rounded p-1"
							title={t('notifications.viewLogs')}
							aria-label={t('notifications.viewLogs')}
						>
							<ScrollText class="h-3.5 w-3.5" />
						</button>
					{/if}
					{#if !n.read_at}
						<button
							onclick={(e) => handleMarkRead(n, e)}
							class="text-muted-foreground hover:text-foreground rounded p-1"
							title={t('notifications.markRead')}
							aria-label={t('notifications.markRead')}
						>
							<Check class="h-3.5 w-3.5" />
						</button>
					{/if}
					<button
						onclick={(e) => handleDelete(n, e)}
						class="text-muted-foreground rounded p-1 hover:text-red-500"
						title={t('notifications.delete')}
						aria-label={t('notifications.delete')}
					>
						<Trash2 class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{/each}
	{/if}
{/snippet}

<!-- Job logs modal: opened inline from a job card or notification row. The
     modal teleports to document.body and fetches/streams logs via the SDK. -->
<JobDetailModal open={!!logJob} job={logJob} onClose={() => (logJob = null)} />
