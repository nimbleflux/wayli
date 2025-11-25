<script lang="ts">
	import { Download, Check } from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { sessionStore } from '$lib/stores/auth';
	import { exportJobs as exportJobsStore, type JobStoreJob } from '$lib/stores/job-store';

	// Use the reactive translation function
	let t = $derived($translate);

	// No props needed - component listens directly to job store

	interface ExportJob {
		id: string;
		status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
		type: string;
		progress: number;
		data?: {
			format: string;
			includeLocationData: boolean;
			includeWantToVisit: boolean;
			includeTrips: boolean;
			dateRange?: string;
			startDate?: string;
			endDate?: string;
		};
		result?: {
			file_path?: string;
			file_size?: number;
			downloadUrl?: string;
			eta?: string; // Added for ETA
		};
		error?: string;
		created_at: string;
		updated_at: string;
		started_at?: string;
		completed_at?: string;
	}

	let exportJobs = $state<ExportJob[]>([]);
	let filteredExportJobs = $state<ExportJob[]>([]);
	let loading = $state(true);
	let unsubscribe: (() => void) | null = null;

	// Track jobs by ID to ensure uniqueness
	let jobsById = $state<Map<string, ExportJob>>(new Map());

	onMount(async () => {
		// Small delay to ensure session is available
		setTimeout(async () => {
			await loadExportJobs();
			// Always start Realtime monitoring to get real-time updates for all export jobs
			startRealtimeMonitoring();
		}, 100);
	});

	// Component automatically refreshes via Realtime updates - no reload flag needed

	onDestroy(() => {
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
	});

	function updateJobById(job: ExportJob) {
		const existing = jobsById.get(job.id);
		if (existing) {
			// Merge with existing job, preferring the one with download info
			const hasDownload = (j: ExportJob) => j.result?.file_path || j.result?.downloadUrl;
			if (hasDownload(job) && !hasDownload(existing)) {
				jobsById.set(job.id, { ...existing, ...job });
			} else if (!hasDownload(job) && hasDownload(existing)) {
				// Keep existing if it has download info
			} else {
				// Otherwise, prefer the most recently updated
				const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
				const newTime = new Date(job.updated_at || job.created_at).getTime();
				if (newTime > existingTime) {
					jobsById.set(job.id, { ...existing, ...job });
				}
			}
		} else {
			jobsById.set(job.id, job);
		}
		console.log(`🔄 Updated job ${job.id}:`, $state.snapshot({
			status: job.status,
			hasDownload: !!(job.result?.file_path || job.result?.downloadUrl)
		}));
	}

	function updateExportJobs(newJobs: ExportJob[]) {
		// Safety check: only process export jobs
		const exportOnlyJobs = newJobs.filter((job) => job.type === 'data_export');
		if (exportOnlyJobs.length !== newJobs.length) {
			console.log(
				'🔒 Filtered out non-export jobs:',
				newJobs.length - exportOnlyJobs.length,
				'jobs filtered'
			);
		}

		// Update each job by ID
		exportOnlyJobs.forEach(updateJobById);

		// Convert map back to array
		exportJobs = Array.from(jobsById.values());

		// Update filtered jobs
		updateFilteredJobs();
	}

	function updateFilteredJobs() {
		const now = new Date();

		// Filter jobs: only show completed jobs with download links, or non-completed jobs
		filteredExportJobs = exportJobs
			.filter((job) => {
				const created = new Date(job.created_at);
				const isRecent = now.getTime() - created.getTime() <= 7 * 24 * 60 * 60 * 1000;

				if (job.status === 'completed') {
					// Only show completed jobs if they have a download available
					const hasDownload = job.result && (job.result.file_path || job.result.downloadUrl);
					return isRecent && hasDownload;
				}

				// Show running/queued/failed/cancelled jobs
				return isRecent;
			})
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	function convertJobStoreJobToExportJob(job: JobStoreJob): ExportJob {
		return {
			id: job.id,
			status: job.status as ExportJob['status'],
			type: job.job_name,
			progress: job.progress_percent || 0,
			error: job.error || undefined,
			result: job.result as ExportJob['result'],
			created_at: job.created_at,
			updated_at: job.updated_at || job.created_at,
			data: job.payload as ExportJob['data'],
			started_at: job.started_at,
			completed_at: job.completed_at
		};
	}

	function startRealtimeMonitoring() {
		// Subscribe to pre-filtered export jobs derived store
		// No manual filtering needed - the store handles it
		unsubscribe = exportJobsStore.subscribe((jobs) => {
			const exportJobUpdates = jobs.map((job) => convertJobStoreJobToExportJob(job));
			if (exportJobUpdates.length > 0) {
				updateExportJobs(exportJobUpdates);
			}
		});
	}

	async function loadExportJobs() {
		try {
			const session = $sessionStore;
			if (!session) {
				console.warn('No session available for loading export jobs');
				return;
			}

			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.getExportJobs()) as ExportJob[] | null;

			// The service adapter returns the data directly, not wrapped in a success object
			if (Array.isArray(result)) {
				updateExportJobs(result);
			} else {
				console.error('Failed to load export jobs: Invalid response format', result);
			}
		} catch (error) {
			console.error('Error loading export jobs:', error);
		} finally {
			loading = false;
		}
	}

	// Expose the function for external use
	export { loadExportJobs };

	function getJobETA() {
		// Hide ETA for export jobs
		return null;
	}

	async function downloadExport(jobId: string) {
		try {
			console.log('🚀 Starting download for export job:', jobId);

			const session = $sessionStore;
			if (!session) {
				console.error('❌ No session available for download');
				toast.error('No session available');
				return;
			}
			console.log('🔑 Session available, user ID:', session.user.id);

			console.log('📡 Calling service adapter for download URL...');
			const serviceAdapter = new ServiceAdapter({ session });
			const result = (await serviceAdapter.getExportDownloadUrl(jobId)) as {
				downloadUrl: string;
			} | null;
			console.log('📥 Service adapter response:', result);
			console.log('📥 Response type:', typeof result);
			console.log('📥 Response keys:', result ? Object.keys(result) : 'null/undefined');

			// The service adapter returns the data directly, not wrapped in a success object
			if (result && result.downloadUrl) {
				console.log('✅ Download URL received:', result.downloadUrl);
				console.log('🌐 Opening download URL in new tab...');
				window.open(result.downloadUrl, '_blank');
			} else {
				console.error('❌ Download URL not available in response:', result);
				console.error('❌ Expected downloadUrl property but got:', result?.downloadUrl);
				toast.error('Download URL not available');
			}
		} catch (error) {
			console.error('❌ Error downloading export:', error);
			console.error('❌ Error type:', typeof error);
			console.error('❌ Error message:', error instanceof Error ? error.message : String(error));
			console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
			toast.error('Failed to download export');
		}
	}

	// Export a refresh function for parent
	export function refreshExportJobs() {
		return loadExportJobs();
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('exportJobs.title')}</h3>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-8">
			<div class="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600"></div>
		</div>
	{:else if filteredExportJobs.length === 0}
		<div class="py-8 text-center text-gray-500 dark:text-gray-400">
			<p>{t('exportJobs.noJobsFound')}</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each filteredExportJobs as job (job.id)}
				<div
					class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="mb-3 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<!-- Status icon -->
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20"
							>
								<Check class="h-4 w-4 text-green-600 dark:text-green-400" />
							</div>

							<!-- Job info -->
							<div class="flex-1">
								<h4 class="font-medium text-gray-900 dark:text-gray-100">
									{t('exportJobs.created')}: {new Date(job.created_at).toLocaleString()}
								</h4>
								<div class="text-xs text-gray-500 dark:text-gray-400">
									{t('exportJobs.dateRange')}: {job.data?.startDate && job.data?.endDate
										? `${new Date(job.data.startDate).toISOString().split('T')[0]} ${t('exportJobs.to')} ${new Date(job.data.endDate).toISOString().split('T')[0]}`
										: t('exportJobs.allData')}
								</div>
								{#if job.status === 'completed'}
									<div class="text-xs text-gray-500 dark:text-gray-400">
										{#if new Date(new Date(job.created_at).getTime() + 7 * 24 * 60 * 60 * 1000) > new Date()}
											{t('exportJobs.linkValidUntil')}: {new Date(
												new Date(job.created_at).getTime() + 7 * 24 * 60 * 60 * 1000
											).toLocaleString()}
										{:else}
											{t('exportJobs.linkExpired')}
										{/if}
									</div>
								{/if}
								{#if job.status === 'running' && getJobETA()}
									<div class="text-xs text-gray-500 dark:text-gray-400">ETA: {getJobETA()}</div>
								{/if}
							</div>
						</div>

						<!-- Download button -->
						{#if job.status === 'completed' && new Date(new Date(job.created_at).getTime() + 7 * 24 * 60 * 60 * 1000) > new Date()}
							<button
								onclick={() => downloadExport(job.id)}
								class="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
							>
								<Download class="h-4 w-4" />
								{t('exportJobs.download')}
							</button>
						{/if}
					</div>

					<!-- Progress bar for running jobs -->
					{#if job.status === 'running' || job.status === 'queued'}
						<div class="mb-3">
							<div class="mb-1 flex justify-between text-sm text-gray-600 dark:text-gray-400">
								<span>{t('exportJobs.progress')}</span>
								<span>{job.progress}%</span>
							</div>
							<div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
								<div
									class="h-2 rounded-full bg-blue-600 transition-all duration-300"
									style="width: {job.progress}%"
								></div>
							</div>
						</div>
					{/if}

					<!-- Export options -->
					{#if job.data}
						<div class="mb-3">
							<div class="flex flex-wrap gap-2">
								{#if job.data.includeLocationData}
									<span
										class="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200"
									>
										{t('exportJobs.locationData')}
									</span>
								{/if}
								{#if job.data.includeWantToVisit}
									<span
										class="inline-flex items-center rounded-full bg-purple-100 px-2 py-1 text-xs text-purple-800 dark:bg-purple-900 dark:text-purple-200"
									>
										{t('exportJobs.wantToVisit')}
									</span>
								{/if}
								{#if job.data.includeTrips}
									<span
										class="inline-flex items-center rounded-full bg-orange-100 px-2 py-1 text-xs text-orange-800 dark:bg-orange-900 dark:text-orange-200"
									>
										{t('exportJobs.trips')}
									</span>
								{/if}
								{#if job.data.format}
									<span
										class="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200"
									>
										{job.data.format === 'GeoJSON' ? job.data.format : 'JSON'}
									</span>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Error message -->
					{#if job.error}
						<div
							class="mb-3 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
						>
							<p class="text-sm text-red-700 dark:text-red-300">{job.error}</p>
						</div>
					{/if}

					<!-- Result info -->
					{#if job.result && job.status === 'completed'}
						<div class="mb-3 text-sm text-gray-600 dark:text-gray-400">
							{#if job.result.file_size}
								<span class="mr-4"
									>{t('exportJobs.size')}: {job.result.file_size
										? `${(job.result.file_size / 1024 / 1024).toFixed(2)} MB`
										: t('exportJobs.unknown')}</span
								>
							{/if}
							{#if job.completed_at}
								<span
									>{t('exportJobs.completed')}: {new Date(job.completed_at).toLocaleString()}</span
								>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
