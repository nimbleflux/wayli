<script lang="ts">
	import { Clock, Download, Upload, MapPin, Route, FileDown, X } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import JobDetailModal from '$lib/components/modals/JobDetailModal.svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { translate } from '$lib/i18n';
	import { getActiveJobsMap, subscribe, removeJobFromStore, type JobStoreJob } from '$lib/stores/job-store';
	import {
		activeUploads,
		subscribe as subscribeUploads,
		type UploadProgress
	} from '$lib/stores/upload-store';

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

	// Upload progress state
	let uploads = $state<UploadProgress[]>([]);

	// Detail modal state
	let showDetailModal = $state(false);
	let selectedJob = $state<JobStoreJob | null>(null);

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

		// Subscribe to upload progress
		const unsubscribeUploads = subscribeUploads((uploadMap) => {
			uploads = Array.from(uploadMap.values());
		});

		return () => {
			unsubscribeJobs();
			unsubscribeUploads();
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

	// Get ETA display - format estimated_seconds_left into human-readable string
	function getETADisplay(job: JobStoreJob): string {
		// Only show for active jobs
		if (job.status !== 'running' && job.status !== 'pending') {
			return '';
		}

		// Show "Queued..." for pending jobs
		if (job.status === 'pending') {
			return t('jobProgress.queued');
		}

		// Format estimated_seconds_left into readable ETA
		const seconds = job.estimated_seconds_left;
		if (!seconds || seconds <= 0) {
			return t('jobProgress.determiningEta');
		}

		if (seconds < 60) {
			return `~${Math.round(seconds)}s remaining`;
		}
		if (seconds < 3600) {
			return `~${Math.ceil(seconds / 60)}m remaining`;
		}
		return `~${Math.ceil(seconds / 3600)}h remaining`;
	}

	// Status color mapping
	const statusColors: Record<string, string> = {
		pending: 'text-yellow-600',
		running: 'text-[rgb(34,51,95)] dark:text-blue-400',
		completed: 'text-green-600',
		failed: 'text-red-600',
		cancelled: 'text-gray-600'
	};

	function getStatusColor(status: string) {
		return statusColors[status] || 'text-gray-600';
	}

	// Cancel job function
	async function handleCancelJob(job: JobStoreJob, event?: MouseEvent) {
		event?.stopPropagation();
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

	// Dismiss a job from the UI
	function dismissJob(jobId: string, event?: MouseEvent) {
		// Stop propagation to prevent opening the detail modal
		event?.stopPropagation();

		// Remove from local state
		activeJobs.delete(jobId);
		activeJobs = new Map(activeJobs);

		// Also clear any pending timers
		if (completedJobTimers.has(jobId)) {
			clearTimeout(completedJobTimers.get(jobId));
			completedJobTimers.delete(jobId);
		}
		if (exportJobTimers.has(jobId)) {
			clearTimeout(exportJobTimers.get(jobId));
			exportJobTimers.delete(jobId);
		}

		// Remove from completed lists
		showCompletedJobs = showCompletedJobs.filter((j) => j.id !== jobId);
		completedExportJobs = completedExportJobs.filter((j) => j.id !== jobId);

		// Remove from global store (for cancelled jobs that persist)
		removeJobFromStore(jobId);
	}

	// Open job detail modal
	function openJobDetail(job: JobStoreJob) {
		selectedJob = job;
		showDetailModal = true;
	}

	// Close job detail modal
	function closeJobDetail() {
		showDetailModal = false;
		selectedJob = null;
	}

	// Download export job result
	async function handleDownloadExport(job: JobStoreJob, event?: MouseEvent) {
		event?.stopPropagation();
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
	// Cancelled jobs stay visible until dismissed by user
	let cancelledJobsList = $derived(
		jobsArray.filter((job) => job.status === 'cancelled')
	);
	// Failed jobs also stay visible until dismissed
	let failedJobsList = $derived(
		jobsArray.filter((job) => job.status === 'failed')
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

{#snippet uploadCard(upload: UploadProgress)}
	<div class="mb-3 flex items-center gap-3">
		<div class="flex-shrink-0">
			<Upload class="h-5 w-5 text-[rgb(34,51,95)] dark:text-blue-400" />
		</div>

		<div class="min-w-0 flex-1">
			<div class="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
				{t('jobProgress.uploading')}: {upload.fileName}
			</div>

			{#if upload.status === 'uploading'}
				<div class="relative mb-1">
					<div class="h-4 w-full rounded-full bg-gray-200 dark:bg-gray-700">
						<div
							class="relative h-4 rounded-full bg-[rgb(34,51,95)] transition-all duration-300 dark:bg-blue-500"
							style="width: {upload.percentage}%"
						>
							{#if upload.percentage > 10}
								<div class="absolute inset-0 flex items-center justify-center">
									<span class="text-xs font-medium text-white drop-shadow-sm">
										{upload.percentage}%
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>
				<div class="text-xs text-gray-500 dark:text-gray-400">
					{(upload.loaded / 1024 / 1024).toFixed(1)} / {(upload.total / 1024 / 1024).toFixed(1)} MB
				</div>
			{:else if upload.status === 'processing'}
				<div class="relative mb-1">
					<div class="h-4 w-full rounded-full bg-gray-200 dark:bg-gray-700">
						<div class="h-4 w-full animate-pulse rounded-full bg-[rgb(34,51,95)] dark:bg-blue-500"></div>
					</div>
				</div>
				<div class="text-xs text-gray-500 dark:text-gray-400">{t('jobProgress.creatingJob')}</div>
			{:else if upload.status === 'completed'}
				<div class="text-xs text-green-600 dark:text-green-400">✅ {t('jobProgress.uploadComplete')}</div>
			{:else if upload.status === 'failed'}
				<div class="text-xs text-red-600 dark:text-red-400">❌ {upload.error || t('jobProgress.uploadFailed')}</div>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet jobCard(job: JobStoreJob, showAction: 'cancel' | 'download' | 'dismiss' | 'none')}
	{@const JobIcon = getJobTypeIcon(job.job_name)}
	{@const statusColor = getStatusColor(job.status)}
	{@const eta = getETADisplay(job)}
	{@const jobTypeName = getJobTypeDisplayName(job.job_name)}

	<!-- Using div with role="button" to avoid nested button a11y issue -->
	<div
		role="button"
		tabindex="0"
		class="mb-3 flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
		onclick={() => openJobDetail(job)}
		onkeydown={(e) => e.key === 'Enter' && openJobDetail(job)}
	>
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
							class="relative h-4 rounded-full bg-[rgb(34,51,95)] transition-all duration-300 dark:bg-blue-500"
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
			{:else if job.status === 'cancelled'}
				<div class="text-xs text-gray-600 dark:text-gray-400">⏹️ Cancelled</div>
			{/if}
		</div>

		{#if showAction === 'cancel'}
			<button
				type="button"
				onclick={(e) => handleCancelJob(job, e)}
				class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-red-500 dark:hover:bg-gray-600 dark:hover:text-red-400"
				title={t('jobProgress.cancelJob')}
				aria-label={t('jobProgress.cancelJob')}
			>
				<X class="h-4 w-4" />
			</button>
		{:else if showAction === 'download'}
			<button
				type="button"
				onclick={(e) => handleDownloadExport(job, e)}
				class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-[rgb(34,51,95)] dark:hover:bg-gray-600 dark:hover:text-gray-300"
				title={t('jobProgress.downloadExport')}
				aria-label={t('jobProgress.downloadExport')}
			>
				<Download class="h-4 w-4" />
			</button>
		{:else if showAction === 'dismiss'}
			<button
				type="button"
				onclick={(e) => dismissJob(job.id, e)}
				class="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
				title={t('jobProgress.dismiss')}
				aria-label={t('jobProgress.dismiss')}
			>
				<X class="h-4 w-4" />
			</button>
		{/if}
	</div>
{/snippet}

{#if uploads.length > 0 || visibleJobs.length > 0 || showCompletedJobs.length > 0 || completedExportJobs.length > 0 || cancelledJobsList.length > 0 || failedJobsList.length > 0}
	<!-- Active uploads (shown first) -->
	{#each uploads as upload (`${upload.id}-${upload.status}-${upload.percentage}`)}
		{@render uploadCard(upload)}
	{/each}

	<!-- Active jobs -->
	{#each visibleJobs as job (`${job.id}-${job.status}-${job.progress_percent}`)}
		{@render jobCard(job, job.status === 'running' || job.status === 'pending' ? 'cancel' : 'none')}
	{/each}

	<!-- Completed jobs (non-export) -->
	{#each showCompletedJobs as job (`${job.id}-${job.status}`)}
		{@render jobCard(job, 'dismiss')}
	{/each}

	<!-- Completed export jobs (with download button) -->
	{#each completedExportJobs as job (`${job.id}-${job.status}`)}
		{@render jobCard(job, 'download')}
	{/each}

	<!-- Cancelled jobs (user must dismiss) -->
	{#each cancelledJobsList as job (`${job.id}-cancelled`)}
		{@render jobCard(job, 'dismiss')}
	{/each}

	<!-- Failed jobs (user must dismiss) -->
	{#each failedJobsList as job (`${job.id}-failed`)}
		{@render jobCard(job, 'dismiss')}
	{/each}
{/if}

<!-- Job Detail Modal -->
<JobDetailModal
	open={showDetailModal}
	job={selectedJob}
	onClose={closeJobDetail}
/>

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
