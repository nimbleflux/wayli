/**
 * Jobs management adapter.
 * Handles background job operations including creation, monitoring, and cancellation.
 * @module adapters/jobs-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * Progress information for a background job.
 */
export interface JobProgress {
	/** Unique job identifier */
	id: string;
	/** Current job status (pending, running, completed, failed, cancelled) */
	status: string;
	/** Progress percentage (0-100) */
	progress: number;
	/** Human-readable progress message */
	progress_message?: string;
	/** Job result data (when completed) */
	result?: unknown;
	/** Error message (when failed) */
	error?: string;
	/** ISO timestamp when job was created */
	created_at: string;
	/** ISO timestamp of last update */
	updated_at?: string;
	/** ISO timestamp when job completed */
	completed_at?: string;
}

/**
 * Adapter for managing background jobs.
 * Supports data import, export, geocoding, and other async operations.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const jobsAdapter = new JobsAdapter({ session });
 *
 * // Create and monitor an import job
 * const { jobId } = await jobsAdapter.createImportJob(file, 'gpx', session);
 * const progress = await jobsAdapter.getJobProgress(jobId);
 * ```
 */
export class JobsAdapter extends BaseAdapter {
	/**
	 * Creates a new JobsAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Retrieves a list of jobs with optional filtering and pagination.
	 *
	 * @param options - Query options
	 * @param options.limit - Maximum jobs to return (default: 50)
	 * @param options.offset - Jobs to skip for pagination (default: 0)
	 * @param options.type - Filter by job type (e.g., 'data_import', 'data-export')
	 * @returns Promise resolving to array of job objects
	 * @throws Error if query fails
	 *
	 * @example
	 * ```typescript
	 * const importJobs = await jobsAdapter.getJobs({ type: 'data_import', limit: 10 });
	 * ```
	 */
	async getJobs(options?: { limit?: number; offset?: number; type?: string }) {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const { data: jobs, error } = await fluxbase.jobs.list({
				namespace: 'wayli',
				limit: options?.limit || 50,
				offset: options?.offset || 0
			});

			if (error) {
				console.error('[JobsAdapter] getJobs failed:', error);
				throw new Error(error.message || 'Failed to fetch jobs');
			}

			let filteredJobs: Array<{ job_name?: string }> = Array.isArray(jobs)
				? jobs
				: ((jobs as { jobs?: Array<{ job_name?: string }> })?.jobs ?? []);

			if (options?.type) {
				filteredJobs = filteredJobs.filter((job) => job.job_name === options.type);
			}

			return filteredJobs;
		} catch (error) {
			console.error('[JobsAdapter] getJobs error:', error);
			throw error;
		}
	}

	/**
	 * Creates a new background job.
	 *
	 * @param job - Job configuration
	 * @param job.type - Required job type identifier
	 * @param job.data - Optional job payload data
	 * @param job.priority - Optional priority (1-10, default: 5)
	 * @returns Promise resolving to the created job
	 * @throws Error if job type is missing or creation fails
	 *
	 * @example
	 * ```typescript
	 * const job = await jobsAdapter.createJob({
	 *   type: 'reverse_geocoding',
	 *   data: { batch_size: 100 },
	 *   priority: 7
	 * });
	 * ```
	 */
	async createJob(job: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			if (!job.type) {
				throw new Error('Job type is required');
			}

			const { data: newJob, error } = await fluxbase.jobs.submit(
				job.type as string,
				job.data || {},
				{
					namespace: 'wayli',
					priority: (job.priority as number) || 5
				}
			);

			if (error) {
				console.error('[JobsAdapter] createJob failed:', error);
				throw new Error(error.message || 'Failed to create job');
			}

			return newJob;
		} catch (error) {
			console.error('[JobsAdapter] createJob error:', error);
			throw error;
		}
	}

	/**
	 * Retrieves the current progress of a job.
	 *
	 * @param jobId - The job ID to query
	 * @returns Promise resolving to job progress information
	 * @throws Error if job is not found
	 *
	 * @example
	 * ```typescript
	 * const progress = await jobsAdapter.getJobProgress('job-uuid');
	 * console.log(`${progress.progress}% - ${progress.progress_message}`);
	 * ```
	 */
	async getJobProgress(jobId: string): Promise<JobProgress> {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const { data: job, error } = await fluxbase.jobs.get(jobId);

			if (error) {
				console.error('[JobsAdapter] getJobProgress failed:', error);
				throw new Error('Job not found');
			}

			if (!job) {
				throw new Error('Job not found');
			}

			return {
				id: job.id,
				status: job.status,
				progress: job.progress_percent || 0,
				progress_message: job.progress_message,
				result: job.result,
				error: job.error,
				created_at: job.created_at,
				updated_at: job.updated_at,
				completed_at: job.completed_at
			};
		} catch (error) {
			console.error('[JobsAdapter] getJobProgress error:', error);
			throw error;
		}
	}

	/**
	 * Cancels a running or pending job.
	 * Automatically triggers a reverse geocoding job when cancelling data imports.
	 *
	 * @param jobId - The job ID to cancel
	 * @returns Promise resolving to success message
	 * @throws Error if job is not found or cannot be cancelled
	 *
	 * @example
	 * ```typescript
	 * await jobsAdapter.cancelJob('job-uuid');
	 * console.log('Job cancelled');
	 * ```
	 */
	async cancelJob(jobId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const { data: job, error: fetchError } = await fluxbase.jobs.get(jobId);

			if (fetchError || !job) {
				throw new Error('Job not found');
			}

			const { error: cancelError } = await fluxbase.jobs.cancel(jobId);

			if (cancelError) {
				console.error('[JobsAdapter] cancelJob failed:', cancelError);
				throw new Error(cancelError.message || 'Failed to cancel job');
			}

			// Auto-create reverse geocoding job when import is cancelled
			if (job.job_name === 'data_import') {
				try {
					await this.createJob({
						type: 'reverse_geocoding',
						data: {
							auto_created: true,
							triggered_by: 'import_cancellation',
							original_job_id: jobId
						}
					});
				} catch {
					console.warn('[JobsAdapter] Failed to auto-create reverse geocoding job');
				}
			}

			return { message: 'Job cancelled successfully', jobId };
		} catch (error) {
			console.error('[JobsAdapter] cancelJob error:', error);
			throw error;
		}
	}

	/**
	 * Gets a Server-Sent Events stream for real-time job updates.
	 *
	 * @returns Promise resolving to SSE stream data
	 * @throws Error if stream cannot be established
	 */
	async getJobStream() {
		const { fluxbase } = await import('$lib/fluxbase');
		const { data, error } = await fluxbase.functions.invoke('jobs-stream', {
			method: 'GET'
		});

		if (error) {
			throw new Error(error.message || 'Failed to get job stream');
		}

		return data;
	}

	/**
	 * Retrieves all data export jobs across all statuses.
	 * Fetches completed, running, pending, and failed export jobs.
	 *
	 * @param options - Pagination options
	 * @param options.limit - Maximum completed jobs to fetch (default: 50)
	 * @returns Promise resolving to sorted array of export jobs
	 * @throws Error if query fails
	 *
	 * @example
	 * ```typescript
	 * const exportJobs = await jobsAdapter.getExportJobs({ limit: 20 });
	 * const completed = exportJobs.filter(j => j.status === 'completed');
	 * ```
	 */
	async getExportJobs(options?: { limit?: number; offset?: number }) {
		const { fluxbase } = await import('$lib/fluxbase');

		try {
			const [completedResult, runningResult, pendingResult, failedResult] = await Promise.all([
				fluxbase.jobs.list({
					namespace: 'wayli',
					status: 'completed',
					limit: options?.limit || 50,
					includeResult: true
				}),
				fluxbase.jobs.list({ namespace: 'wayli', status: 'running', limit: 20 }),
				fluxbase.jobs.list({ namespace: 'wayli', status: 'pending', limit: 20 }),
				fluxbase.jobs.list({ namespace: 'wayli', status: 'failed', limit: 20 })
			]);

			const toArray = (
				data: unknown
			): Array<{ job_name: string; created_at: string; id: string }> => {
				if (!data) return [];
				if (Array.isArray(data)) return data;
				if (
					typeof data === 'object' &&
					data !== null &&
					'jobs' in data &&
					Array.isArray((data as { jobs: unknown[] }).jobs)
				) {
					return (data as { jobs: Array<{ job_name: string; created_at: string; id: string }> })
						.jobs;
				}
				return [];
			};

			const completedJobs = toArray(completedResult.data);
			const runningJobs = toArray(runningResult.data);
			const pendingJobs = toArray(pendingResult.data);
			const failedJobs = toArray(failedResult.data);

			const allJobs = [...completedJobs, ...runningJobs, ...pendingJobs, ...failedJobs].filter(
				(job) => job.job_name === 'data-export'
			);

			allJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

			return allJobs;
		} catch (error) {
			console.error('[JobsAdapter] getExportJobs error:', error);
			throw error;
		}
	}

	/**
	 * Creates a data export job with the specified options.
	 *
	 * @param exportData - Export configuration
	 * @param exportData.format - Export format (json, csv, gpx)
	 * @param exportData.include_trips - Include trip data
	 * @param exportData.include_tracker_data - Include raw tracker data
	 * @returns Promise resolving to the created job
	 *
	 * @example
	 * ```typescript
	 * const job = await jobsAdapter.createExportJob({
	 *   format: 'json',
	 *   include_trips: true,
	 *   include_tracker_data: false
	 * });
	 * ```
	 */
	async createExportJob(exportData: Record<string, unknown>) {
		return this.createJob({
			type: 'data-export',
			data: exportData
		});
	}

	/**
	 * Gets the download URL for a completed export job.
	 * Verifies job ownership and completion before returning URL.
	 *
	 * @param jobId - The export job ID
	 * @returns Promise resolving to object with downloadUrl
	 * @throws Error if job not found, not owned by user, or not ready
	 *
	 * @example
	 * ```typescript
	 * const { downloadUrl } = await jobsAdapter.getExportDownloadUrl('job-uuid');
	 * window.open(downloadUrl, '_blank');
	 * ```
	 */
	async getExportDownloadUrl(jobId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: job, error: jobError } = await fluxbase.jobs.get(jobId);

		if (jobError || !job) {
			console.error('[JobsAdapter] getExportDownloadUrl - job not found:', jobError);
			throw new Error('Export job not found');
		}

		if (job.created_by !== userData.user.id) {
			throw new Error('Export job not found');
		}

		if (job.job_name !== 'data-export') {
			throw new Error('Not an export job');
		}

		let result = job.result as { file_path?: string; result?: { file_path?: string } } | string | null;

		if (typeof result === 'string') {
			try {
				result = JSON.parse(result);
			} catch {
				result = null;
			}
		}

		const parsedResult = result as { file_path?: string; result?: { file_path?: string } } | null;
		const filePath = parsedResult?.file_path || parsedResult?.result?.file_path;

		if (job.status !== 'completed' || !filePath) {
			throw new Error('Export file not ready');
		}

		const { data: urlData } = fluxbase.storage.from('temp-files').getPublicUrl(filePath);

		return { downloadUrl: urlData.publicUrl };
	}

	/**
	 * Creates a data import job by uploading a file and triggering processing.
	 * Supports GPX, JSON, CSV, and KML formats.
	 *
	 * @param file - The file to import
	 * @param format - File format (gpx, json, csv, kml)
	 * @param session - User session for file path generation
	 * @param _onUploadProgress - Optional progress callback (currently unused)
	 * @returns Promise resolving to object with jobId
	 * @throws Error if upload or job creation fails
	 *
	 * @example
	 * ```typescript
	 * const fileInput = document.querySelector('input[type="file"]');
	 * const file = fileInput.files[0];
	 * const { jobId } = await jobsAdapter.createImportJob(file, 'gpx', session);
	 * ```
	 */
	async createImportJob(
		file: File,
		format: string,
		session: { user?: { id: string } } | null,
		_onUploadProgress?: (progress: number) => void
	): Promise<{ jobId: string }> {
		try {
			const fileSizeMB = file.size / (1024 * 1024);
			console.log(`[JobsAdapter] Uploading file: ${fileSizeMB.toFixed(2)}MB`);

			const timestamp = Date.now();
			const fileName = `${session?.user?.id}/${timestamp}-${file.name}`;

			const { fluxbase } = await import('$lib/fluxbase');

			const arrayBuffer = await file.arrayBuffer();
			const fileBlob = new Blob([arrayBuffer], { type: file.type });

			const { error: uploadError } = await fluxbase.storage.from('temp-files').upload(fileName, fileBlob, {
				contentType: file.type,
				upsert: false,
				metadata: {
					mimetype: file.type,
					size: file.size.toString()
				}
			});

			if (uploadError) {
				console.error('[JobsAdapter] File upload failed:', uploadError);
				const message =
					typeof uploadError === 'object' && uploadError && 'message' in uploadError
						? (uploadError as { message: string }).message
						: String(uploadError);
				throw new Error(`File upload failed: ${message}`);
			}

			const response = await fluxbase.functions.invoke('import', {
				body: {
					storage_path: fileName,
					file_name: file.name,
					file_size: file.size,
					format: format
				}
			});

			if (response.error) {
				throw new Error(`Import job creation failed: ${response.error.message}`);
			}

			const result = response.data as {
				success: boolean;
				data: { success: boolean; data: { jobId: string }; message: string };
				message: string;
			};

			if (!result.success) {
				throw new Error(`Import job creation failed: ${result.message || 'Unknown error'}`);
			}

			const jobData = result.data;
			if (!jobData.success || !jobData.data?.jobId) {
				throw new Error(`Import job creation failed: Invalid response structure`);
			}

			return { jobId: jobData.data.jobId };
		} catch (error) {
			console.error('[JobsAdapter] Error in createImportJob:', error);
			throw error;
		}
	}

	/**
	 * Gets all active data import jobs.
	 * Convenience method that filters jobs by 'data_import' type.
	 *
	 * @returns Promise resolving to array of import jobs
	 *
	 * @example
	 * ```typescript
	 * const importJobs = await jobsAdapter.getImportProgress();
	 * const running = importJobs.filter(j => j.status === 'running');
	 * ```
	 */
	async getImportProgress() {
		return this.getJobs({ type: 'data_import' });
	}
}
