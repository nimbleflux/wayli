import { fluxbase } from '$lib/fluxbase';

export interface ExportOptions {
	format?: string;
	includeLocationData: boolean;
	includeWantToVisit: boolean;
	includeTrips: boolean;
	startDate?: string | null;
	endDate?: string | null;
}

export interface ExportJob {
	id: string;
	user_id: string;
	status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
	format: string;
	include_location_data: boolean;
	include_want_to_visit: boolean;
	include_trips: boolean;
	file_path?: string;
	file_size?: number;
	expires_at: string;
	progress: number;
	result?: Record<string, unknown>;
	error?: string;
	created_at: string;
	updated_at: string;
	started_at?: string;
	completed_at?: string;
}

export class ExportService {
	static async createExportJob(userId: string, options: ExportOptions): Promise<ExportJob> {
		try {
			// Check for existing queued or running export jobs using Jobs API
			const { data: existingJobs, error: existingError } = await fluxbase.jobs.list({
				namespace: 'wayli'
			});

			if (existingError) throw existingError;

			// Filter for data_export jobs that are queued or running
			const activeExports =
				existingJobs?.filter(
					(job) =>
						job.job_name === 'data-export' &&
						(job.status === 'pending' || job.status === 'running')
				) || [];

			if (activeExports.length > 0) {
				throw new Error(
					'You already have an export job in progress. Please wait for it to complete before starting a new one.'
				);
			}

			// Set TTL to 1 week from now
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);

			// Submit the export job using Fluxbase Jobs API
			const { data: job, error: jobError } = await fluxbase.jobs.submit(
				'data-export',
				{
					format: options.format,
					includeLocationData: options.includeLocationData,
					includeWantToVisit: options.includeWantToVisit,
					includeTrips: options.includeTrips,
					startDate: options.startDate,
					endDate: options.endDate,
					expires_at: expiresAt.toISOString()
				},
				{
					namespace: 'wayli',
					priority: 5
				}
			);

			if (jobError || !job) {
				throw jobError || new Error('Failed to create export job');
			}

			// Convert job to ExportJob format for consistency
			return {
				id: job.id,
				user_id: job.created_by,
				status: job.status as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
				format: options.format as string,
				include_location_data: options.includeLocationData,
				include_want_to_visit: options.includeWantToVisit,
				include_trips: options.includeTrips,
				expires_at: expiresAt.toISOString(),
				progress: job.progress_percent || 0,
				result: job.result || undefined,
				error: job.error || undefined,
				created_at: job.created_at || new Date().toISOString(),
				updated_at: job.updated_at || new Date().toISOString(),
				started_at: job.started_at || undefined,
				completed_at: job.completed_at || undefined
			};
		} catch (error) {
			console.error('[ExportService] createExportJob error:', error);
			throw error;
		}
	}

	static async getExportJob(jobId: string, userId: string): Promise<ExportJob | null> {
		try {
			// Use Fluxbase Jobs API to get job
			const { data: job, error } = await fluxbase.jobs.get(jobId);

			if (error) return null;
			if (!job) return null;

			// Verify the job belongs to the user and is an export job
			if (job.created_by !== userId || job.job_name !== 'data-export') {
				return null;
			}

			const payload = (job.payload as Record<string, unknown>) || {};
			function safe<T>(key: string, fallback: T): T {
				return payload && Object.prototype.hasOwnProperty.call(payload, key)
					? (payload[key] as T)
					: fallback;
			}

			return {
				id: job.id,
				user_id: job.created_by,
				status: job.status as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
				format: safe<string>('format', ''),
				include_location_data: safe<boolean>('includeLocationData', false),
				include_want_to_visit: safe<boolean>('includeWantToVisit', false),
				include_trips: safe<boolean>('includeTrips', false),
				file_path: ((job.result as Record<string, unknown>)?.file_path as string) || '',
				file_size: ((job.result as Record<string, unknown>)?.file_size as number) || 0,
				expires_at: safe<string>('expires_at', ''),
				progress: job.progress_percent || 0,
				result: job.result,
				error: job.error,
				created_at: job.created_at,
				updated_at: job.updated_at,
				started_at: job.started_at,
				completed_at: job.completed_at
			};
		} catch (error) {
			console.error('[ExportService] getExportJob error:', error);
			return null;
		}
	}

	static async getUserExportJobs(userId: string): Promise<ExportJob[]> {
		try {
			// Use Fluxbase Jobs API to list jobs
			const { data: jobs, error } = await fluxbase.jobs.list({
				namespace: 'wayli'
			});

			if (error) throw error;
			if (!jobs) return [];

			// Filter for export jobs only
			const exportJobs = jobs.filter((job) => job.job_name === 'data-export');

			// Sort by created_at descending
			exportJobs.sort(
				(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
			);

			return exportJobs.map((job) => {
				const payload = (job.payload as Record<string, unknown>) || {};
				function safe<T>(key: string, fallback: T): T {
					return payload && Object.prototype.hasOwnProperty.call(payload, key)
						? (payload[key] as T)
						: fallback;
				}

				return {
					id: job.id,
					user_id: job.created_by,
					status: job.status as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
					format: safe<string>('format', ''),
					include_location_data: safe<boolean>('includeLocationData', false),
					include_want_to_visit: safe<boolean>('includeWantToVisit', false),
					include_trips: safe<boolean>('includeTrips', false),
					file_path: ((job.result as Record<string, unknown>)?.file_path as string) || '',
					file_size: ((job.result as Record<string, unknown>)?.file_size as number) || 0,
					expires_at: safe<string>('expires_at', ''),
					progress: job.progress_percent || 0,
					result: job.result,
					error: job.error,
					created_at: job.created_at,
					updated_at: job.updated_at,
					started_at: job.started_at,
					completed_at: job.completed_at
				};
			});
		} catch (error) {
			console.error('[ExportService] getUserExportJobs error:', error);
			throw error;
		}
	}

	/**
	 * @deprecated Job progress is now managed automatically by Fluxbase job handlers.
	 * Progress updates are done via Fluxbase.reportProgress() inside the job handler.
	 * This method is kept for backward compatibility but should not be used.
	 */
	static async updateExportJobProgress(
		jobId: string,
		progress: number,
		result?: Record<string, unknown>
	): Promise<void> {
		console.warn(
			'[ExportService] updateExportJobProgress is deprecated. Job progress is managed by Fluxbase.'
		);
		// No-op: Job progress is managed by Fluxbase job handlers
	}

	/**
	 * @deprecated Job completion is now managed automatically by Fluxbase when the job handler returns.
	 * This method is kept for backward compatibility but should not be used.
	 */
	static async completeExportJob(
		jobId: string,
		filePath: string,
		fileSize: number,
		result?: Record<string, unknown>
	): Promise<void> {
		console.warn(
			'[ExportService] completeExportJob is deprecated. Jobs complete automatically when handlers return.'
		);
		// No-op: Job completion is managed by Fluxbase job handlers
	}

	/**
	 * @deprecated Job failure is now managed automatically by Fluxbase when the job handler throws an error.
	 * This method is kept for backward compatibility but should not be used.
	 */
	static async failExportJob(jobId: string, errorMessage: string): Promise<void> {
		console.warn(
			'[ExportService] failExportJob is deprecated. Jobs fail automatically when handlers throw errors.'
		);
		// No-op: Job failure is managed by Fluxbase job handlers
	}

	static async getExportDownloadUrl(jobId: string, userId: string): Promise<string | null> {
		const exportJob = await this.getExportJob(jobId, userId);

		if (!exportJob || exportJob.status !== 'completed') {
			return null;
		}

		// Check for file path in job.result
		const filePath = (exportJob.result as Record<string, unknown>)?.file_path as string;
		if (!filePath) {
			return null;
		}

		// Check if file has expired
		if (new Date(exportJob.expires_at) < new Date()) {
			return null;
		}

		const { data } = await fluxbase.storage
			.from('exports')
			.createSignedUrl(filePath, 3600, { download: true }); // 1 hour expiry

		if (!data?.signedUrl) {
			return null;
		}

		// Replace internal hostname/port with public URL
		const signedUrl = data.signedUrl;
		const publicUrl = process.env.PUBLIC_FLUXBASE_BASE_URL;

		if (!publicUrl) {
			console.warn('⚠️  PUBLIC_FLUXBASE_BASE_URL not set, returning signed URL as-is');
			return signedUrl;
		}

		try {
			const signedUrlObj = new URL(signedUrl);
			const publicUrlObj = new URL(publicUrl);

			// Replace the hostname and port with the public URL's hostname and port
			signedUrlObj.protocol = publicUrlObj.protocol;
			signedUrlObj.hostname = publicUrlObj.hostname;
			signedUrlObj.port = publicUrlObj.port;

			const finalUrl = signedUrlObj.toString();
			console.log(`🔄 Replaced internal URL (${signedUrlObj.host}) with public URL (${publicUrlObj.host})`);
			return finalUrl;
		} catch (error) {
			console.error('❌ Error replacing URL hostname:', error);
			return signedUrl;
		}
	}

	static async cleanupExpiredExports(): Promise<number> {
		const { data, error } = await fluxbase.rpc('cleanup_expired_exports');

		if (error) throw error;
		return data || 0;
	}
}
