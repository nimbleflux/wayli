<script lang="ts">
	import { Clock, Download, Upload, MapPin, Route, FileDown, X } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { fluxbase } from '$lib/fluxbase';
	import { translate } from '$lib/i18n';
	import { getActiveJobsMap, subscribe, type JobStoreJob } from '$lib/stores/job-store';

	// Use the reactive translation function
	let t = $derived($translate);

	// State
	let activeJobs = $state<Map<string, JobStoreJob>>(new Map());
	let visibleJobs = $state<JobStoreJob[]>([]);
	let showCompletedJobs = $state<JobStoreJob[]>([]);
	let completedJobTimers = $state(new Map<string, NodeJS.Timeout>());
	let showCancelConfirm = $state(false);
	let jobToCancel = $state<JobStoreJob | null>(null);
	let completedExportJobs = $state<JobStoreJob[]>([]);
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

	// Combined job type configuration
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

	// Get ETA display
	function getETADisplay(job: JobStoreJob): string {
		// Only show for active jobs
		if (job.status !== 'running' && job.status !== 'pending') {
			return '';
		}

		// Show "Queued..." for pending jobs
		if (job.status === 'pending') {
			return t('jobProgress.queued');
		}

		// Use Fluxbase's progress_message directly - it handles ETA formatting
		return job.progress_message || '';
	}

	// Status color mapping
	const statusColors: Record<string, string> = {
		pending: 'text-yellow-600',
		running: 'text-blue-600',
		completed: 'text-green-600',
		failed: 'text-red-600',
		cancelled: 'text-gray-600'
	};

	function getStatusColor(status: string) {
		return statusColors[status] || 'text-gray-600';
	}

	// Cancel job function
	async function handleCancelJob(job: JobStoreJob) {
		jobToCancel = job;
		showCancelConfirm = true;
	}

	// Confirm cancel job
	async function confirmCancelJob() {
		if (!jobToCancel) return;

		try {
			const { data } = await fluxbase.auth.getSession();
			if (!data?.session) {
				toast.error(t('jobProgress.notAuthenticated'));
				return;
			}

			// Use Fluxbase Jobs API to cancel the job
			const { error } = await fluxbase.jobs.cancel(jobToCancel.id);

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
	async function handleDownloadExport(job: JobStoreJob) {
		try {
			const { data: sessionData } = await fluxbase.auth.getSession();
			if (!sessionData?.session) {
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
		jobsArray.filter((job) => job.status === 'pending' || job.status === 'running')
	);
	let recentlyCompletedJobs = $derived(
		jobsArray.filter(
			(job) => job.status === 'completed' && job.updated_at && Date.now() - new Date(job.updated_at).getTime() < 5000
		)
	);
	let recentlyCompletedExportJobs = $derived(
		jobsArray.filter(
			(job) =>
				job.job_name === 'data-export' &&
				job.status === 'completed' &&
				job.updated_at &&
				Date.now() - new Date(job.updated_at).getTime() < 60000
		)
	);

	// Helper to manage job timers
	function manageJobTimers(
		recentJobs: JobStoreJob[],
		currentList: JobStoreJob[],
		timerMap: Map<string, NodeJS.Timeout>,
		delay: number,
		updateList: (jobs: JobStoreJob[]) => void
	) {
		// Add new jobs and set timers
		recentJobs.forEach((job) => {
			if (!currentList.find((j) => j.id === job.id)) {
				updateList([...currentList, job]);
				const timer = setTimeout(() => {
					updateList(currentList.filter((j) => j.id !== job.id));
					timerMap.delete(job.id);
				}, delay);
				timerMap.set(job.id, timer);
			}
		});

		// Clean up stale timers
		timerMap.forEach((timer, jobId) => {
			if (!recentJobs.find((job) => job.id === jobId)) {
				clearTimeout(timer);
				timerMap.delete(jobId);
			}
		});
	}

	// Watch for changes and update state
	$effect(() => {
		visibleJobs = activeJobsList;

		// Handle non-export completed jobs (5 second display)
		const nonExportCompleted = recentlyCompletedJobs.filter((job) => job.job_name !== 'data-export');
		manageJobTimers(
			nonExportCompleted,
			showCompletedJobs,
			completedJobTimers,
			5000,
			(jobs) => (showCompletedJobs = jobs)
		);

		// Handle export completed jobs (60 second display)
		manageJobTimers(
			recentlyCompletedExportJobs,
			completedExportJobs,
			exportJobTimers,
			60000,
			(jobs) => (completedExportJobs = jobs)
		);
	});
</script>

{#snippet jobCard(job: JobStoreJob, showAction: 'cancel' | 'download' | 'none')}
	{@const JobIcon = getJobTypeIcon(job.job_name)}
	{@const statusColor = getStatusColor(job.status)}
	{@const eta = getETADisplay(job)}
	{@const jobTypeName = getJobTypeDisplayName(job.job_name)}

	<div class="mb-3 flex items-center gap-3">
		<div class="flex-shrink-0">
			<JobIcon class="h-5 w-5 {statusColor}" />
		</div>

		<div class="min-w-0 flex-1">
			<div class="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
				{jobTypeName}
			</div>

			{#if job.status === 'running' || job.status === 'pending'}
				<div class="relative mb-1">
					<div class="h-4 w-full rounded-full bg-gray-200 dark:bg-gray-700">
						<div
							class="relative h-4 rounded-full bg-blue-600 transition-all duration-300"
							style="width: {job.progress_percent || 0}%"
						>
							{#if (job.progress_percent || 0) > 10}
								<div class="absolute inset-0 flex items-center justify-center">
									<span class="text-xs font-medium text-white drop-shadow-sm">
										{job.progress_percent || 0}%
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>
				{#if eta}
					<div class="text-xs text-gray-500 dark:text-gray-400">{eta}</div>
				{/if}
			{:else if job.status === 'completed'}
				<div class="text-xs text-green-600 dark:text-green-400">
					✅ Complete{showAction === 'download' ? ' - Ready to download' : ''}
				</div>
			{:else if job.status === 'failed'}
				<div class="text-xs text-red-600 dark:text-red-400">❌ Failed</div>
			{/if}
		</div>

		{#if showAction === 'cancel'}
			<button
				onclick={() => handleCancelJob(job)}
				class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
				title={t('jobProgress.cancelJob')}
				aria-label={t('jobProgress.cancelJob')}
			>
				<X class="h-4 w-4" />
			</button>
		{:else if showAction === 'download'}
			<button
				onclick={() => handleDownloadExport(job)}
				class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-700 dark:hover:text-blue-400"
				title={t('jobProgress.downloadExport')}
				aria-label={t('jobProgress.downloadExport')}
			>
				<Download class="h-4 w-4" />
			</button>
		{/if}
	</div>
{/snippet}

{#if visibleJobs.length > 0 || showCompletedJobs.length > 0 || completedExportJobs.length > 0}
	{#each visibleJobs as job (`${job.id}-${job.status}-${job.progress_percent}`)}
		{@render jobCard(job, job.status === 'running' || job.status === 'pending' ? 'cancel' : 'none')}
	{/each}

	{#each showCompletedJobs as job (`${job.id}-${job.status}`)}
		{@render jobCard(job, 'none')}
	{/each}

	{#each completedExportJobs as job (`${job.id}-${job.status}`)}
		{@render jobCard(job, 'download')}
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
						jobToCancel.job_name
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
