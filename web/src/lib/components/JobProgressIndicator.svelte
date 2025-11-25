<script lang="ts">
	import { Clock, Download, Upload, MapPin, Route, FileDown, X } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { fluxbase } from '$lib/fluxbase';
	import { translate } from '$lib/i18n';
	import { getActiveJobsMap, subscribe } from '$lib/stores/job-store';

	import type { JobUpdate } from '$lib/services/job-realtime.service';

	// Use the reactive translation function
	let t = $derived($translate);

	// State
	let activeJobs = $state<Map<string, JobUpdate>>(new Map());
	let visibleJobs = $state<JobUpdate[]>([]);
	let showCompletedJobs = $state<JobUpdate[]>([]);
	let completedJobTimers = $state(new Map<string, NodeJS.Timeout>());
	let showCancelConfirm = $state(false);
	let jobToCancel = $state<JobUpdate | null>(null);
	let completedExportJobs = $state<JobUpdate[]>([]);
	let exportJobTimers = $state(new Map<string, NodeJS.Timeout>());

	// Subscribe to store changes
	onMount(() => {
		// Initial load from store
		activeJobs = new Map(getActiveJobsMap());

		// No need to fetch jobs - rely on realtime updates from JobTracker
		const unsubscribeJobs = subscribe(() => {
			const newJobs = getActiveJobsMap();
			// Create a new Map to trigger reactivity
			activeJobs = new Map(newJobs);
		});

		return () => {
			unsubscribeJobs();
			// Clear all timers
			completedJobTimers.forEach((timer) => clearTimeout(timer));
			completedJobTimers.clear();
			exportJobTimers.forEach((timer) => clearTimeout(timer));
			exportJobTimers.clear();
		};
	});

	// Get job type icon
	function getJobTypeIcon(type: string) {
		switch (type) {
			case 'data_import':
				return FileDown;
			case 'data_export':
				return Upload;
			case 'reverse_geocoding':
			case 'reverse_geocoding_missing':
				return MapPin;
			case 'trip_generation':
				return Route;
			default:
				return Clock;
		}
	}

	// Get job type display name
	function getJobTypeDisplayName(type: string) {
		switch (type) {
			case 'data_import':
				return t('jobProgress.import');
			case 'data_export':
				return t('jobProgress.export');
			case 'reverse_geocoding':
			case 'reverse_geocoding_missing':
				return t('jobProgress.geocoding');
			case 'trip_generation':
				return t('jobProgress.tripGeneration');
			default:
				return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
		}
	}

	// Get ETA display
	function getETADisplay(job: JobUpdate): string {
		// Helper to format seconds as h m s consistently
		function formatSeconds(seconds: number): string {
			if (!seconds || seconds <= 0) return '';
			const s = Math.floor(seconds % 60);
			const m = Math.floor((seconds / 60) % 60);
			const h = Math.floor(seconds / 3600);
			if (h > 0) return `${h}h ${m}m ${s}s`;
			if (m > 0) return `${m}m ${s}s`;
			return `${s}s`;
		}

		// Hide ETA for export jobs
		if (job.type === 'data_export') {
			return '';
		}

		if (job.status !== 'running' && job.status !== 'queued') {
			return '';
		}

		// Show "Queued..." for queued jobs
		if (job.status === 'queued') {
			return t('jobProgress.queued');
		}

		// Server always provides ETA
		const serverETA = job.result?.estimatedTimeRemaining ?? job.result?.eta;

		// Handle numeric values
		if (typeof serverETA === 'number') {
			return formatSeconds(serverETA);
		}
		// Handle string numeric values (e.g., "50")
		if (typeof serverETA === 'string' && /^(\d+)$/.test(serverETA)) {
			return formatSeconds(parseInt(serverETA, 10));
		}
		// Handle "50s" format from import workers (only simple seconds, not compound formats like "5m 30s")
		if (typeof serverETA === 'string' && /^\d+s$/.test(serverETA)) {
			const seconds = parseInt(serverETA.slice(0, -1), 10);
			if (!isNaN(seconds)) {
				return formatSeconds(seconds);
			}
		}
		// Return as-is if it's already a formatted string (e.g., "5m 30s", "1h 15m 30s")
		// Translate "Calculating..." to support i18n
		if (typeof serverETA === 'string') {
			return serverETA === 'Calculating...' ? t('jobProgress.calculating') : serverETA;
		}
		// Fallback for undefined/null
		return '';
	}

	// Get status color
	function getStatusColor(status: string) {
		switch (status) {
			case 'queued':
				return 'text-yellow-600';
			case 'running':
				return 'text-blue-600';
			case 'completed':
				return 'text-green-600';
			case 'failed':
				return 'text-red-600';
			default:
				return 'text-gray-600';
		}
	}

	// Cancel job function
	async function handleCancelJob(job: JobUpdate) {
		jobToCancel = job;
		showCancelConfirm = true;
	}

	// Confirm cancel job
	async function confirmCancelJob() {
		if (!jobToCancel) return;

		try {
			const {
				data: { session }
			} = await fluxbase.auth.getSession();
			if (!session) {
				toast.error(t('jobProgress.notAuthenticated'));
				return;
			}

			// Call the cancel job Edge Function
			const { error } = await fluxbase.functions.invoke(`jobs/${jobToCancel.id}`, {
				method: 'DELETE'
			});

			if (error) {
				throw new Error(error.message || 'Failed to cancel job');
			}

			toast.success(t('jobProgress.jobCancelledSuccessfully'));
		} catch (error) {
			console.error('❌ Error cancelling job:', error);
			toast.error(t('jobProgress.failedToCancelJob'));
		} finally {
			showCancelConfirm = false;
			jobToCancel = null;
		}
	}

	// Cancel the confirmation
	function cancelConfirmation() {
		showCancelConfirm = false;
		jobToCancel = null;
	}

	// Download export job result
	async function handleDownloadExport(job: JobUpdate) {
		try {
			const {
				data: { session }
			} = await fluxbase.auth.getSession();
			if (!session) {
				toast.error(t('jobProgress.notAuthenticated'));
				return;
			}

			// Get download URL from Edge Function
			const { data, error } = await fluxbase.functions.invoke(`export-download/${job.id}`);

			if (error) {
				throw new Error(error.message || 'Failed to get download URL');
			}

			if (data?.downloadUrl) {
				// Create a temporary link and click it
				const link = document.createElement('a');
				link.href = data.downloadUrl;
				link.download = data.fileName || `export-${job.id}.zip`;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);

				toast.success(t('jobProgress.downloadStarted'));

				// Remove the job from the completed export jobs list
				completedExportJobs = completedExportJobs.filter((j) => j.id !== job.id);
				if (exportJobTimers.has(job.id)) {
					clearTimeout(exportJobTimers.get(job.id));
					exportJobTimers.delete(job.id);
				}
			} else {
				throw new Error('No download URL available');
			}
		} catch (error) {
			console.error('❌ Error downloading export:', error);
			toast.error(t('jobProgress.failedToDownloadExport'));
		}
	}

	// Optimized job filtering with derived reactive variables
	let jobsArray = $derived(Array.from(activeJobs.values()));
	let activeJobsList = $derived(
		jobsArray.filter((job) => job.status === 'queued' || job.status === 'running')
	);
	let recentlyCompletedJobs = $derived(
		jobsArray.filter(
			(job) => job.status === 'completed' && Date.now() - new Date(job.updated_at).getTime() < 5000
		)
	);
	let recentlyCompletedExportJobs = $derived(
		jobsArray.filter(
			(job) =>
				job.type === 'data_export' &&
				job.status === 'completed' &&
				Date.now() - new Date(job.updated_at).getTime() < 60000
		)
	);

	// Watch for changes and update state
	$effect(() => {
		// Update visible jobs
		visibleJobs = activeJobsList;

		// Handle recently completed jobs (excluding export jobs which have their own section)
		const nonExportCompletedJobs = recentlyCompletedJobs.filter(
			(job) => job.type !== 'data_export'
		);
		nonExportCompletedJobs.forEach((job) => {
			if (!showCompletedJobs.find((j) => j.id === job.id)) {
				showCompletedJobs = [...showCompletedJobs, job];

				// Set timer to remove this completed job after 5 seconds
				const timer = setTimeout(() => {
					showCompletedJobs = showCompletedJobs.filter((j) => j.id !== job.id);
					completedJobTimers.delete(job.id);
				}, 5000);

				completedJobTimers.set(job.id, timer);
			}
		});

		// Handle completed export jobs
		recentlyCompletedExportJobs.forEach((job) => {
			if (!completedExportJobs.find((j) => j.id === job.id)) {
				completedExportJobs = [...completedExportJobs, job];

				// Set timer to remove this completed export job after 1 minute
				const timer = setTimeout(() => {
					completedExportJobs = completedExportJobs.filter((j) => j.id !== job.id);
					exportJobTimers.delete(job.id);
				}, 60000);

				exportJobTimers.set(job.id, timer);
			}
		});

		// Clean up timers for jobs that are no longer in recently completed
		completedJobTimers.forEach((timer, jobId) => {
			if (!nonExportCompletedJobs.find((job) => job.id === jobId)) {
				clearTimeout(timer);
				completedJobTimers.delete(jobId);
			}
		});

		// Clean up timers for export jobs that are no longer in recently completed
		exportJobTimers.forEach((timer, jobId) => {
			if (!recentlyCompletedExportJobs.find((job) => job.id === jobId)) {
				clearTimeout(timer);
				exportJobTimers.delete(jobId);
			}
		});
	});
</script>

{#if visibleJobs.length > 0 || showCompletedJobs.length > 0 || completedExportJobs.length > 0}
	<!-- Active Jobs -->
	{#each visibleJobs as job (`${job.id}-${job.status}-${job.progress}`)}
		{@const JobIcon = getJobTypeIcon(job.type)}
		{@const statusColor = getStatusColor(job.status)}
		{@const eta = getETADisplay(job)}
		{@const jobTypeName = getJobTypeDisplayName(job.type)}

		<div class="mb-3 flex items-center gap-3">
			<!-- Job Icon -->
			<div class="flex-shrink-0">
				<JobIcon class="h-5 w-5 {statusColor}" />
			</div>

			<!-- Progress and ETA -->
			<div class="min-w-0 flex-1">
				<!-- Job Type Label -->
				<div class="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
					{jobTypeName}
				</div>

				{#if job.status === 'running' || job.status === 'queued'}
					<!-- Progress Bar with percentage inside -->
					<div class="relative mb-1">
						<div class="h-4 w-full rounded-full bg-gray-200 dark:bg-gray-700">
							<div
								class="relative h-4 rounded-full bg-blue-600 transition-all duration-300"
								style="width: {job.progress}%"
							>
								<!-- Percentage text inside progress bar -->
								{#if job.progress > 10}
									<div class="absolute inset-0 flex items-center justify-center">
										<span class="text-xs font-medium text-white drop-shadow-sm">
											{job.progress}%
										</span>
									</div>
								{/if}
							</div>
						</div>
					</div>
					<!-- ETA -->
					{#if eta}
						<div class="text-xs text-gray-500 dark:text-gray-400">
							{eta}
						</div>
					{/if}
				{:else if job.status === 'completed'}
					<div class="text-xs text-green-600 dark:text-green-400">✅ Complete</div>
				{:else if job.status === 'failed'}
					<div class="text-xs text-red-600 dark:text-red-400">❌ Failed</div>
				{/if}
			</div>

			<!-- Cancel Button (only for running/queued jobs) -->
			{#if job.status === 'running' || job.status === 'queued'}
				<button
					onclick={() => handleCancelJob(job)}
					class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
					title={t('jobProgress.cancelJob')}
					aria-label={t('jobProgress.cancelJob')}
				>
					<X class="h-4 w-4" />
				</button>
			{/if}
		</div>
	{/each}

	<!-- Recently Completed Jobs -->
	{#each showCompletedJobs as job (`${job.id}-${job.status}`)}
		{@const JobIcon = getJobTypeIcon(job.type)}
		{@const statusColor = getStatusColor(job.status)}
		{@const jobTypeName = getJobTypeDisplayName(job.type)}

		<div class="mb-3 flex items-center gap-3">
			<!-- Job Icon -->
			<div class="flex-shrink-0">
				<JobIcon class="h-5 w-5 {statusColor}" />
			</div>

			<!-- Progress and ETA -->
			<div class="min-w-0 flex-1">
				<!-- Job Type Label -->
				<div class="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
					{jobTypeName}
				</div>

				<div class="text-xs text-green-600 dark:text-green-400">✅ Complete</div>
			</div>
		</div>
	{/each}

	<!-- Completed Export Jobs -->
	{#each completedExportJobs as job (`${job.id}-${job.status}`)}
		{@const JobIcon = getJobTypeIcon(job.type)}
		{@const statusColor = getStatusColor(job.status)}
		{@const jobTypeName = getJobTypeDisplayName(job.type)}

		<div class="mb-3 flex items-center gap-3">
			<!-- Job Icon -->
			<div class="flex-shrink-0">
				<JobIcon class="h-5 w-5 {statusColor}" />
			</div>

			<!-- Progress and Download -->
			<div class="min-w-0 flex-1">
				<!-- Job Type Label -->
				<div class="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
					{jobTypeName}
				</div>

				<div class="text-xs text-green-600 dark:text-green-400">
					✅ Complete - Ready to download
				</div>
			</div>

			<!-- Download Button -->
			<button
				onclick={() => handleDownloadExport(job)}
				class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-700 dark:hover:text-blue-400"
				title={t('jobProgress.downloadExport')}
				aria-label={t('jobProgress.downloadExport')}
			>
				<Download class="h-4 w-4" />
			</button>
		</div>
	{/each}
{/if}

<!-- Cancel Confirmation Modal -->
{#if showCancelConfirm && jobToCancel}
	<div
		class="cancel-job-modal fixed inset-0 z-[99999999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
		style="position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 99999999 !important; pointer-events: auto !important;"
	>
		<div
			class="cancel-job-modal-content relative mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
			style="position: relative !important; z-index: 100000000 !important; pointer-events: auto !important;"
		>
			<div class="mb-4">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Cancel Job</h3>
				<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
					Are you sure you want to cancel the {getJobTypeDisplayName(
						jobToCancel.type
					).toLowerCase()} job? This action cannot be undone.
				</p>
			</div>
			<div class="flex justify-end gap-3">
				<button
					onclick={cancelConfirmation}
					class="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
				>
					Keep Running
				</button>
				<button
					onclick={confirmCancelJob}
					class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
				>
					Cancel Job
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Ensure modal is always on top of everything, including Leaflet maps */
	.cancel-job-modal {
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

	.cancel-job-modal-content {
		z-index: 100000000 !important;
		position: relative !important;
		pointer-events: auto !important;
	}
</style>
