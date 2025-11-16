import { createWorkerClient } from '../../worker/client';

import { JobQueueService } from '../../worker/job-queue.service.server';

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
	private static fluxbase = createWorkerClient();

	static async createExportJob(userId: string, options: ExportOptions): Promise<ExportJob> {
		// Check for existing queued or running export job
		const { data: existingJobs, error: existingError } = await this.fluxbase
			.from('jobs')
			.select('id, status')
			.eq('created_by', userId)
			.eq('type', 'data_export')
			.in('status', ['queued', 'running']);
		if (existingError) throw existingError;
		if (existingJobs && existingJobs.length > 0) {
			throw new Error(
				'You already have an export job in progress. Please wait for it to complete before starting a new one.'
			);
		}

		// Set TTL to 1 week from now
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + 7);

		// Create a background job to process the export
		const job = await JobQueueService.createJob(
			'data_export',
			{
				userId,
				options,
				expires_at: expiresAt.toISOString()
			},
			'normal',
			userId
		);

		// Convert job to ExportJob format for consistency
		return {
			id: job.id,
			user_id: job.created_by,
			status: job.status,
			format: options.format as string,
			include_location_data: options.includeLocationData,
			include_want_to_visit: options.includeWantToVisit,
			include_trips: options.includeTrips,
			expires_at: expiresAt.toISOString(),
			progress: job.progress,
			result: job.result,
			error: job.error,
			created_at: job.created_at,
			updated_at: job.updated_at,
			started_at: job.started_at,
			completed_at: job.completed_at
		};
	}

	static async getExportJob(jobId: string, userId: string): Promise<ExportJob | null> {
		const { data: job, error } = await this.fluxbase
			.from('jobs')
			.select('*')
			.eq('id', jobId)
			.eq('created_by', userId)
			.eq('type', 'data_export')
			.single();

		if (error) {
			if (error.code === 'PGRST116') return null; // No rows returned
			throw error;
		}

		if (!job) return null;

		const options = ((job.data as Record<string, unknown>)?.options ||
			(job.data as Record<string, unknown>)) as Record<string, unknown>;
		function safe<T>(key: string, fallback: T): T {
			return options && Object.prototype.hasOwnProperty.call(options, key)
				? (options[key] as T)
				: fallback;
		}
		return {
			id: job.id,
			user_id: job.created_by,
			status: job.status,
			format: safe<string>('format', ''),
			include_location_data: safe<boolean>('includeLocationData', false),
			include_want_to_visit: safe<boolean>('includeWantToVisit', false),
			include_trips: safe<boolean>('includeTrips', false),
			file_path:
				safe<string>('file_path', '') ||
				((job.result as Record<string, unknown>)?.file_path as string) ||
				'',
			file_size:
				safe<number>('file_size', 0) ||
				((job.result as Record<string, unknown>)?.file_size as number) ||
				0,
			expires_at: safe<string>('expires_at', ''),
			progress: job.progress,
			result: job.result,
			error: job.error,
			created_at: job.created_at,
			updated_at: job.updated_at,
			started_at: job.started_at,
			completed_at: job.completed_at
		};
	}

	static async getUserExportJobs(userId: string): Promise<ExportJob[]> {
		const { data: jobs, error } = await this.fluxbase
			.from('jobs')
			.select('*')
			.eq('created_by', userId)
			.eq('type', 'data_export')
			.order('created_at', { ascending: false });

		if (error) throw error;

		if (!jobs) return [];

		return jobs.map((job: any) => {
			const options = ((job.data as Record<string, unknown>)?.options ||
				(job.data as Record<string, unknown>)) as Record<string, unknown>;
			function safe<T>(key: string, fallback: T): T {
				return options && Object.prototype.hasOwnProperty.call(options, key)
					? (options[key] as T)
					: fallback;
			}
			return {
				id: job.id,
				user_id: job.created_by,
				status: job.status,
				format: safe<string>('format', ''),
				include_location_data: safe<boolean>('includeLocationData', false),
				include_want_to_visit: safe<boolean>('includeWantToVisit', false),
				include_trips: safe<boolean>('includeTrips', false),
				file_path:
					safe<string>('file_path', '') ||
					((job.result as Record<string, unknown>)?.file_path as string) ||
					'',
				file_size:
					safe<number>('file_size', 0) ||
					((job.result as Record<string, unknown>)?.file_size as number) ||
					0,
				expires_at: safe<string>('expires_at', ''),
				progress: job.progress,
				result: job.result,
				error: job.error,
				created_at: job.created_at,
				updated_at: job.updated_at,
				started_at: job.started_at,
				completed_at: job.completed_at
			};
		});
	}

	static async updateExportJobProgress(
		jobId: string,
		progress: number,
		result?: Record<string, unknown>
	): Promise<void> {
		// Use JobQueueService to update job progress
		await JobQueueService.updateJobProgress(jobId, progress, result);
	}

	static async completeExportJob(
		jobId: string,
		filePath: string,
		fileSize: number,
		result?: Record<string, unknown>
	): Promise<void> {
		// Update the job data with file information
		const updatedResult = {
			...result,
			file_path: filePath,
			file_size: fileSize
		};

		// Complete the job using JobQueueService
		await JobQueueService.completeJob(jobId, updatedResult);
	}

	static async failExportJob(jobId: string, error: string): Promise<void> {
		// Use JobQueueService to fail the job
		await JobQueueService.failJob(jobId, error);
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

		const { data } = await this.fluxbase.storage
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
		const { data, error } = await this.fluxbase.rpc('cleanup_expired_exports');

		if (error) throw error;
		return data || 0;
	}
}
