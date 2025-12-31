<script lang="ts">
	import {
		Clock,
		Download,
		Upload,
		MapPin,
		Route,
		FileDown,
		X,
		ChevronDown,
		StopCircle
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';

	import { fluxbase } from '$lib/fluxbase';
	import { translate } from '$lib/i18n';
	import {
		subscribe as subscribeToJobs,
		getActiveJobsMap,
		type JobStoreJob
	} from '$lib/stores/job-store';

	// Props using Svelte 5 runes
	interface Props {
		open?: boolean;
		job?: JobStoreJob | null;
		onClose?: () => void;
	}

	let { open = false, job = null, onClose }: Props = $props();

	// Live job data from store (stays in sync with realtime updates)
	let liveJob = $state<JobStoreJob | null>(null);

	// Teleport action - moves element to document.body
	function teleport(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		};
	}

	// Subscribe to job store for live updates
	onMount(() => {
		// Subscribe to job store updates
		const unsubscribe = subscribeToJobs(() => {
			if (job?.id) {
				const jobs = getActiveJobsMap();
				liveJob = jobs.get(job.id) || null;
			}
		});

		return () => {
			unsubscribe();
		};
	});

	// Update liveJob when job prop changes
	$effect(() => {
		if (job?.id) {
			const jobs = getActiveJobsMap();
			liveJob = jobs.get(job.id) || job;
		} else {
			liveJob = null;
		}
	});

	// Use liveJob for display, falling back to prop
	let displayJob = $derived(liveJob || job);

	// Use the reactive translation function
	let t = $derived($translate);

	// Log level types
	type LogLevel = 'debug' | 'info' | 'warn' | 'error';

	interface ExecutionLog {
		id: number;
		job_id: string;
		line_number: number;
		level: LogLevel;
		message: string;
		created_at: string;
	}

	// Log level priority for filtering
	const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
		debug: 0,
		info: 1,
		warn: 2,
		error: 3
	};

	// State
	let logs = $state<ExecutionLog[]>([]);
	let selectedLevel = $state<LogLevel>('info');
	let logsChannel: { unsubscribe: () => void } | null = null;
	let logsContainer = $state<HTMLElement | null>(null);
	let userHasScrolled = $state(false);
	let isLoadingLogs = $state(false);
	let showLevelDropdown = $state(false);
	let lastLineNumber = $state(0);

	// Filtered logs based on selected level
	let filteredLogs = $derived(
		logs.filter((log) => LOG_LEVEL_PRIORITY[log.level] >= LOG_LEVEL_PRIORITY[selectedLevel])
	);

	// Grouped logs interface - combines consecutive identical messages
	interface GroupedLog extends ExecutionLog {
		count: number;
	}

	// Group consecutive logs with identical level and message
	let groupedLogs = $derived.by(() => {
		const result: GroupedLog[] = [];
		for (const log of filteredLogs) {
			const last = result[result.length - 1];
			if (last && last.level === log.level && last.message === log.message) {
				// Increment count for consecutive duplicate
				last.count++;
			} else {
				// New unique log entry
				result.push({ ...log, count: 1 });
			}
		}
		return result;
	});

	// Job type configuration
	const jobTypeConfig: Record<string, { icon: any; displayKey: string }> = {
		data_import: { icon: FileDown, displayKey: 'jobProgress.import' },
		data_import_geojson: { icon: FileDown, displayKey: 'jobProgress.import' },
		data_import_gpx: { icon: FileDown, displayKey: 'jobProgress.import' },
		data_import_owntracks: { icon: FileDown, displayKey: 'jobProgress.import' },
		data_export: { icon: Upload, displayKey: 'jobProgress.export' },
		reverse_geocoding: { icon: MapPin, displayKey: 'jobProgress.geocoding' },
		reverse_geocoding_missing: { icon: MapPin, displayKey: 'jobProgress.geocoding' },
		trip_generation: { icon: Route, displayKey: 'jobProgress.tripGeneration' },
		trip_detection: { icon: Route, displayKey: 'jobProgress.tripGeneration' }
	};

	function getJobTypeIcon(jobName: string) {
		const normalized = jobName.replace(/-/g, '_');
		return jobTypeConfig[normalized]?.icon || Clock;
	}

	function getJobTypeDisplayName(jobName: string) {
		const normalized = jobName.replace(/-/g, '_');
		const config = jobTypeConfig[normalized];
		return config
			? t(config.displayKey)
			: jobName.charAt(0).toUpperCase() + jobName.slice(1).replace(/[_-]/g, ' ');
	}

	// Status color and label mapping
	const statusConfig: Record<string, { color: string; bgColor: string; labelKey: string }> = {
		pending: {
			color: 'text-yellow-600',
			bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
			labelKey: 'jobProgress.statusPending'
		},
		running: {
			color: 'text-primary dark:text-primary-dark',
			bgColor: 'bg-primary/10 dark:bg-primary-dark/20',
			labelKey: 'jobProgress.statusRunning'
		},
		completed: {
			color: 'text-green-600',
			bgColor: 'bg-green-100 dark:bg-green-900/30',
			labelKey: 'jobProgress.statusCompleted'
		},
		failed: {
			color: 'text-red-600',
			bgColor: 'bg-red-100 dark:bg-red-900/30',
			labelKey: 'jobProgress.statusFailed'
		},
		cancelled: {
			color: 'text-gray-600',
			bgColor: 'bg-gray-100 dark:bg-gray-900/30',
			labelKey: 'jobProgress.statusCancelled'
		}
	};

	// Get translated status label
	function getStatusLabel(status: string): string {
		const config = statusConfig[status];
		return config ? t(config.labelKey) : status;
	}

	// Log level colors
	const logLevelColors: Record<LogLevel, string> = {
		debug: 'text-gray-500',
		info: 'text-primary dark:text-primary-dark',
		warn: 'text-yellow-600',
		error: 'text-red-600'
	};

	// Format ETA
	function formatEta(seconds: number | undefined): string {
		if (!seconds || seconds <= 0) return '';
		if (seconds < 60) return t('jobProgress.secondsRemaining', { seconds: Math.round(seconds) });
		if (seconds < 3600)
			return t('jobProgress.minutesRemaining', { minutes: Math.ceil(seconds / 60) });
		return t('jobProgress.hoursRemaining', { hours: Math.ceil(seconds / 3600) });
	}

	// Fetch existing logs (backfill) using the Fluxbase SDK
	async function fetchExistingLogs(jobId: string) {
		console.log('[JobDetailModal] Fetching existing logs for job:', jobId);
		isLoadingLogs = true;
		try {
			const { data, error } = await fluxbase.jobs.getLogs(jobId);

			if (error) {
				console.warn('[JobDetailModal] Could not fetch existing logs:', error);
				return;
			}

			const entries = (data || []) as ExecutionLog[];
			console.log('[JobDetailModal] Fetched logs count:', entries.length);

			// Merge backfill logs with any realtime logs that arrived during fetch
			// Use line_number for deduplication
			const existingLineNumbers = new Set(logs.map((l) => l.line_number));
			const newLogs = entries.filter((e) => !existingLineNumbers.has(e.line_number));
			logs = [...newLogs, ...logs].sort((a, b) => a.line_number - b.line_number);

			// Update lastLineNumber to the highest we've seen
			lastLineNumber = Math.max(...(logs.map((l) => l.line_number) ?? []), lastLineNumber);
			console.log('[JobDetailModal] Last line number after backfill:', lastLineNumber);
		} catch (err) {
			console.error('[JobDetailModal] Exception fetching logs:', err);
		} finally {
			isLoadingLogs = false;
		}
	}

	// Subscribe to realtime log updates
	function subscribeToLogs(jobId: string) {
		logsChannel = fluxbase.realtime
			.executionLogs(jobId, 'job')
			.onLog((log) => {
				// Deduplicate by line number (in case of overlap with backfill)
				if (log.line_number > lastLineNumber) {
					const newLog: ExecutionLog = {
						id: Date.now() + Math.random(), // Generate unique id for realtime logs
						job_id: jobId,
						line_number: log.line_number,
						level: log.level as LogLevel,
						message: log.message,
						created_at: new Date().toISOString()
					};
					logs = [...logs, newLog].sort((a, b) => a.line_number - b.line_number);
					lastLineNumber = log.line_number;
				}
			})
			.subscribe((status, err) => {
				if (status === 'SUBSCRIBED') {
					console.log('[JobDetailModal] Connected to job logs');
				} else if (err) {
					console.error('[JobDetailModal] Log subscription error:', err);
				}
			});
	}

	// Handle scroll to detect if user has scrolled up
	function handleScroll() {
		if (!logsContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = logsContainer;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
		userHasScrolled = !isAtBottom;
	}

	// Auto-scroll to bottom when new logs arrive
	$effect(() => {
		if (filteredLogs.length > 0 && !userHasScrolled && logsContainer) {
			// Use requestAnimationFrame to ensure DOM is updated
			requestAnimationFrame(() => {
				if (logsContainer) {
					logsContainer.scrollTop = logsContainer.scrollHeight;
				}
			});
		}
	});

	// Track which job we're currently subscribed to (not reactive to avoid loops)
	let subscribedJobId: string | null = null;

	// Use onMount for cleanup on destroy
	onMount(() => {
		return () => {
			// Cleanup on component destroy
			if (logsChannel) {
				logsChannel.unsubscribe();
				logsChannel = null;
			}
		};
	});

	// Setup and cleanup when modal opens/closes or job changes
	$effect(() => {
		const shouldSubscribe = open && job;
		const jobId = job?.id ?? null;

		// Only act if subscription state needs to change
		if (shouldSubscribe && jobId && jobId !== subscribedJobId) {
			// Cleanup previous subscription if any
			if (logsChannel) {
				logsChannel.unsubscribe();
				logsChannel = null;
				logs = [];
			}
			// Subscribe to new job
			subscribedJobId = jobId;
			lastLineNumber = 0;
			// First subscribe to realtime updates, then fetch existing logs
			// This ensures we don't miss any logs that arrive during the fetch
			subscribeToLogs(jobId);
			// Fetch existing logs (backfill) - must run after subscription is set up
			fetchExistingLogs(jobId);
		} else if (!shouldSubscribe && subscribedJobId) {
			// Modal closed or job cleared - cleanup
			if (logsChannel) {
				logsChannel.unsubscribe();
				logsChannel = null;
			}
			logs = [];
			userHasScrolled = false;
			subscribedJobId = null;
			lastLineNumber = 0;
		}
	});

	// Handle escape key
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			handleClose();
		}
	}

	// Cancel job state
	let isCancelling = $state(false);

	// Cancel job function
	async function handleCancelJob() {
		if (!displayJob || isCancelling) return;

		isCancelling = true;
		try {
			const { error } = await fluxbase.jobs.cancel(displayJob.id);
			if (error) {
				toast.error(t('jobProgress.cancelFailed'));
				console.error('[JobDetailModal] Cancel failed:', error);
			} else {
				toast.success(t('jobProgress.cancelSuccess'));
			}
		} catch (err) {
			toast.error(t('jobProgress.cancelFailed'));
			console.error('[JobDetailModal] Cancel exception:', err);
		} finally {
			isCancelling = false;
		}
	}

	function handleClose() {
		// Cleanup is handled by the effect when open changes to false
		onClose?.();
	}

	function handleBackdropClick() {
		handleClose();
	}

	function selectLevel(level: LogLevel) {
		selectedLevel = level;
		showLevelDropdown = false;
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.level-dropdown')) {
			showLevelDropdown = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

{#if open && displayJob}
	{@const JobIcon = getJobTypeIcon(displayJob.job_name)}
	{@const status = statusConfig[displayJob.status] || statusConfig.pending}
	{@const eta = formatEta(displayJob.estimated_seconds_left)}

	<div
		use:teleport
		class="job-detail-modal fixed inset-0 z-[99999999] flex items-start justify-center bg-black/40 p-4 pt-16 backdrop-blur-sm"
		style="position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 99999999 !important; pointer-events: auto !important;"
		role="dialog"
		aria-modal="true"
		aria-labelledby="job-detail-title"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && handleClose()}
		tabindex="0"
	>
		<div
			class="job-detail-modal-content relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
			style="position: relative !important; z-index: 100000000 !important; pointer-events: auto !important;"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700"
			>
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg {status.bgColor}">
						<JobIcon class="h-5 w-5 {status.color}" />
					</div>
					<div>
						<h2
							id="job-detail-title"
							class="text-lg font-semibold text-gray-900 dark:text-gray-100"
						>
							{getJobTypeDisplayName(displayJob.job_name)}
						</h2>
						<span
							class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {status.bgColor} {status.color}"
						>
							{getStatusLabel(displayJob.status)}
						</span>
					</div>
				</div>
				<button
					type="button"
					class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					onclick={handleClose}
					aria-label="Close modal"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Status Section -->
			<div class="border-b border-gray-200 p-6 dark:border-gray-700">
				{#if displayJob.status === 'running' || displayJob.status === 'pending'}
					<div class="mb-3">
						<div class="mb-1 flex items-center justify-between text-sm">
							<span class="text-gray-600 dark:text-gray-400">Progress</span>
							<span class="font-medium text-gray-900 dark:text-gray-100"
								>{displayJob.progress_percent || 0}%</span
							>
						</div>
						<div class="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
							<div
								class="bg-primary dark:bg-primary-dark h-3 rounded-full transition-all duration-300"
								style="width: {displayJob.progress_percent || 0}%"
							></div>
						</div>
					</div>
					{#if eta}
						<p class="text-sm text-gray-600 dark:text-gray-400">{eta}</p>
					{:else}
						<p class="text-sm text-gray-500 dark:text-gray-400">Determining ETA...</p>
					{/if}
					{#if displayJob.progress_message}
						<p class="mt-1 text-sm text-gray-500 dark:text-gray-500">
							{displayJob.progress_message}
						</p>
					{/if}
					<!-- Cancel Button -->
					<button
						type="button"
						onclick={handleCancelJob}
						disabled={isCancelling}
						class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/20"
					>
						<StopCircle class="h-4 w-4" />
						{isCancelling ? t('jobProgress.cancelling') : t('jobProgress.cancelJob')}
					</button>
				{:else if displayJob.status === 'completed'}
					<p class="text-sm text-green-600 dark:text-green-400">Job completed successfully.</p>
				{:else if displayJob.status === 'failed'}
					<p class="text-sm text-red-600 dark:text-red-400">
						{displayJob.error || 'Job failed. Check logs for details.'}
					</p>
				{:else if displayJob.status === 'cancelled'}
					<p class="text-sm text-gray-600 dark:text-gray-400">Job was cancelled.</p>
				{/if}
			</div>

			<!-- Logs Section -->
			<div class="p-6">
				<div class="mb-3 flex items-center justify-between">
					<h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">Execution Logs</h3>

					<!-- Log Level Selector -->
					<div class="level-dropdown relative">
						<button
							type="button"
							class="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
							onclick={() => (showLevelDropdown = !showLevelDropdown)}
						>
							<span class="capitalize">{selectedLevel}</span>
							<ChevronDown class="h-4 w-4" />
						</button>

						{#if showLevelDropdown}
							<div
								class="absolute right-0 z-10 mt-1 w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
							>
								{#each ['debug', 'info', 'warn', 'error'] as const as level}
									<button
										type="button"
										class="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 {selectedLevel ===
										level
											? 'bg-gray-100 dark:bg-gray-700'
											: ''}"
										onclick={() => selectLevel(level)}
									>
										<span class="capitalize {logLevelColors[level]}">{level}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Logs Container -->
				<div
					bind:this={logsContainer}
					onscroll={handleScroll}
					class="overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-950"
					style="height: 256px; min-height: 256px; max-height: 256px;"
				>
					{#if isLoadingLogs}
						<div class="flex h-full items-center justify-center text-gray-500">Loading logs...</div>
					{:else if groupedLogs.length === 0}
						<div class="flex h-full items-center justify-center text-gray-500">
							No logs available
						</div>
					{:else}
						{#each groupedLogs as log (log.id)}
							<div class="mb-1 flex gap-2">
								<span class="flex-shrink-0 uppercase {logLevelColors[log.level]}"
									>[{log.level}]</span
								>
								{#if log.count > 1}
									<span
										class="flex-shrink-0 rounded bg-gray-200 px-1.5 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
										>x{log.count}</span
									>
								{/if}
								<span class="text-gray-700 dark:text-gray-300">{log.message}</span>
							</div>
						{/each}
					{/if}
				</div>

				{#if userHasScrolled && filteredLogs.length > 0}
					<button
						type="button"
						class="bg-primary hover:bg-primary/90 dark:bg-primary-dark mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-white dark:hover:bg-blue-600"
						onclick={() => {
							userHasScrolled = false;
							if (logsContainer) {
								logsContainer.scrollTop = logsContainer.scrollHeight;
							}
						}}
					>
						Scroll to bottom
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Ensure modal is always on top of everything, including Leaflet maps and sidebars */
	:global(.job-detail-modal) {
		z-index: 99999999 !important;
		position: fixed !important;
		top: 0 !important;
		left: 0 !important;
		right: 0 !important;
		bottom: 0 !important;
		width: 100vw !important;
		height: 100vh !important;
		pointer-events: auto !important;
	}

	:global(.job-detail-modal-content) {
		z-index: 100000000 !important;
		position: relative !important;
		pointer-events: auto !important;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
	}
</style>
