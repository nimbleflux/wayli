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
		status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
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
			// Always merge, preserving important fields from both
			// Prefer result/data from whichever has it (existing or new)
			const mergedJob: ExportJob = {
				...existing,
				...job,
				// Preserve result - use new if it has file_path, otherwise keep existing
				result: getFilePath(job.result) ? job.result : (existing.result ?? job.result),
				// Preserve data/payload
				data: job.data ?? existing.data,
				// Use the higher progress value
				progress: Math.max(job.progress || 0, existing.progress || 0)
			};
			console.log(`🔄 Job ${job.id}: merged (new status=${job.status}, existing status=${existing.status})`);
			jobsById.set(job.id, mergedJob);
		} else {
			console.log(`🔄 Job ${job.id}: new job added`);
			jobsById.set(job.id, job);
		}

		const finalJob = jobsById.get(job.id)!;
		console.log(`🔄 Job ${job.id} final state:`, $state.snapshot({
			status: finalJob.status,
			hasDownload: !!getFilePath(finalJob.result),
			filePath: getFilePath(finalJob.result),
			resultKeys: finalJob.result ? Object.keys(finalJob.result as object) : null
		}));
	}

	function updateExportJobs(newJobs: ExportJob[]) {
		console.log('📥 updateExportJobs called with', newJobs.length, 'jobs');

		// Update each job by ID (jobs are already filtered by getExportJobs)
		newJobs.forEach(updateJobById);

		// Convert map back to array
		exportJobs = Array.from(jobsById.values());

		// Update filtered jobs
		updateFilteredJobs();
	}

	// Parse result if it's a JSON string (API returns stringified JSON for result/progress fields)
	function parseResultIfString(result: any): Record<string, any> | undefined {
		if (!result) return undefined;
		if (typeof result === 'string') {
			try {
				return JSON.parse(result);
			} catch {
				return undefined;
			}
		}
		return result;
	}

	function getFilePath(result: ExportJob['result']): string | undefined {
		if (!result) return undefined;
		// Parse if it's a JSON string
		const r = parseResultIfString(result) as Record<string, any>;
		if (!r) return undefined;
		// Handle various result structures:
		// 1. file_path at top level: { file_path: "..." }
		// 2. Nested in result: { result: { file_path: "..." } }
		// 3. downloadUrl at top level
		if (r.file_path && typeof r.file_path === 'string') return r.file_path;
		if (r.result?.file_path && typeof r.result.file_path === 'string') return r.result.file_path;
		if (r.downloadUrl && typeof r.downloadUrl === 'string') return r.downloadUrl;
		return undefined;
	}

	function updateFilteredJobs() {
		const now = new Date();
		const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

		// Filter jobs: show completed jobs with download links (within 7 days), or active/recent failed jobs
		filteredExportJobs = exportJobs
			.filter((job) => {
				const created = new Date(job.created_at);
				const isRecent = created.getTime() > sevenDaysAgo;

				if (job.status === 'completed') {
					// Show completed jobs that have a download and are within 7 days (download expires)
					const filePath = getFilePath(job.result);
					const hasDownload = !!filePath;
					const hasValidLink = isRecent && hasDownload;
					console.log(`📋 Job ${job.id}: completed=${job.status === 'completed'}, hasDownload=${hasDownload}, filePath=${filePath}, isRecent=${isRecent}, showing=${hasValidLink}, result=`, job.result);
					return hasValidLink;
				}

				// Show running/queued jobs regardless of age
				if (job.status === 'running' || job.status === 'queued' || job.status === 'pending') {
					return true;
				}

				// Show failed/cancelled jobs only if recent
				return isRecent;
			})
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

		console.log(`📋 Filtered export jobs: ${filteredExportJobs.length} of ${exportJobs.length}`);
	}

	// Helper to extract progress percent from job data
	// Handles: progress_percent (SDK format), progress.percent (JSONB object), progress as JSON string
	function extractProgressPercent(job: any): number {
		if (typeof job.progress_percent === 'number') return job.progress_percent;
		if (job.progress) {
			if (typeof job.progress === 'number') return job.progress;
			if (typeof job.progress === 'object' && typeof job.progress.percent === 'number') {
				return job.progress.percent;
			}
			if (typeof job.progress === 'string') {
				try {
					const parsed = JSON.parse(job.progress);
					if (typeof parsed.percent === 'number') return parsed.percent;
				} catch {
					// Ignore parse errors
				}
			}
		}
		return 0;
	}

	function convertJobStoreJobToExportJob(job: JobStoreJob): ExportJob {
		// Parse result if it's a JSON string, then normalize
		let normalizedResult = parseResultIfString(job.result) as ExportJob['result'];
		// Handle old format with nested result
		if (normalizedResult && (normalizedResult as any).result?.file_path && !normalizedResult.file_path) {
			normalizedResult = {
				...(normalizedResult as any).result,
				...normalizedResult
			} as ExportJob['result'];
			if (normalizedResult) delete (normalizedResult as any).result;
		}

		return {
			id: job.id,
			status: job.status as ExportJob['status'],
			type: job.job_name,
			progress: extractProgressPercent(job),
			error: job.error || undefined,
			result: normalizedResult,
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
			const result = await serviceAdapter.getExportJobs();

			// The service adapter returns jobs in API format (job_name, progress_percent, etc.)
			// Convert to ExportJob format (type, progress, etc.)
			if (Array.isArray(result)) {
				console.log('📋 Raw API jobs:', result.map((j: any) => ({
					id: j.id,
					status: j.status,
					hasResult: !!j.result,
					resultType: j.result ? typeof j.result : 'undefined',
					resultKeys: j.result && typeof j.result === 'object' ? Object.keys(j.result) : null,
					file_path: j.result?.file_path
				})));
				const convertedJobs = result.map((job: any) => {
					// Parse result if it's a JSON string (API returns stringified JSON)
					let normalizedResult = parseResultIfString(job.result);
					// Also handle old format with nested result
					if (normalizedResult?.result?.file_path && !normalizedResult.file_path) {
						normalizedResult = {
							...normalizedResult.result,
							...normalizedResult
						};
						delete normalizedResult.result;
					}

					return {
						id: job.id,
						status: job.status,
						type: job.job_name, // API returns job_name, we use type
						progress: extractProgressPercent(job),
						data: job.payload,
						result: normalizedResult,
						error: job.error || undefined,
						created_at: job.created_at,
						updated_at: job.updated_at || job.created_at,
						started_at: job.started_at,
						completed_at: job.completed_at
					};
				}) as ExportJob[];
				console.log('📋 Loaded export jobs:', convertedJobs.length, convertedJobs);
				updateExportJobs(convertedJobs);
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
			<div class="h-6 w-6 animate-spin rounded-full border-b-2 border-[rgb(34,51,95)]"></div>
		</div>
	{:else if filteredExportJobs.length === 0}
		<div class="py-8 text-center text-gray-500 dark:text-gray-400">
			<p>{t('exportJobs.noJobsFound')}</p>
			<!-- Debug: Show raw exportJobs count -->
			<p class="mt-2 text-xs">Debug: {exportJobs.length} total jobs loaded, {filteredExportJobs.length} filtered</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each filteredExportJobs as job (job.id)}
				<div
					class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
				>
					<!-- Debug info -->
					<details class="mb-2 text-xs text-gray-400">
						<summary class="cursor-pointer">Debug: status={job.status}, hasData={!!job.data}, hasResult={!!job.result}</summary>
						<pre class="mt-1 overflow-auto rounded bg-gray-100 p-2 text-[10px] dark:bg-gray-900">{JSON.stringify({ status: job.status, data: job.data, result: job.result, type: job.type }, null, 2)}</pre>
					</details>

					<div class="mb-3 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<!-- Status icon -->
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full {job.status === 'completed' ? 'bg-green-100 dark:bg-green-900/20' : job.status === 'failed' ? 'bg-red-100 dark:bg-red-900/20' : 'bg-[rgb(34,51,95)]/10 dark:bg-[rgb(34,51,95)]/20'}"
							>
								<Check class="h-4 w-4 {job.status === 'completed' ? 'text-green-600 dark:text-green-400' : job.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-[rgb(34,51,95)] dark:text-gray-300'}" />
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

						<!-- Download button - always show for completed jobs within 7 days -->
						{#if job.status === 'completed' && new Date(new Date(job.created_at).getTime() + 7 * 24 * 60 * 60 * 1000) > new Date()}
							<button
								onclick={() => downloadExport(job.id)}
								class="inline-flex items-center gap-2 rounded-md bg-[rgb(34,51,95)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(34,51,95)]/90"
							>
								<Download class="h-4 w-4" />
								{t('exportJobs.download')}
							</button>
						{/if}
					</div>

					<!-- Progress bar for running jobs -->
					{#if job.status === 'running' || job.status === 'queued' || job.status === 'pending'}
						<div class="mb-3">
							<div class="mb-1 flex justify-between text-sm text-gray-600 dark:text-gray-400">
								<span>{t('exportJobs.progress')}</span>
								<span>{job.progress}%</span>
							</div>
							<div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
								<div
									class="h-2 rounded-full bg-[rgb(34,51,95)] transition-all duration-300"
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
										class="inline-flex items-center rounded-full bg-[rgb(34,51,95)]/10 px-2 py-1 text-xs text-[rgb(34,51,95)] dark:bg-[rgb(34,51,95)]/20 dark:text-gray-300"
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
