import { fluxbase } from '../../worker/fluxbase';

import { JobQueueService } from '../../worker/job-queue.service.worker';

export interface ExportOptions {
	format: 'GeoJSON' | 'GPX' | 'OwnTracks';
	includeLocationData: boolean;
	includeWantToVisit: boolean;
	includeTrips: boolean;
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
	private static fluxbase = fluxbase;

	static async createExportJob(userId: string, options: ExportOptions): Promise<ExportJob> {
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
			format: options.format,
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

		// Convert job to ExportJob format
		type JobRecord = {
			id: string;
			created_by: string;
			status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
			data: Record<string, unknown>;
			progress: number;
			result?: Record<string, unknown>;
			error?: string;
			created_at: string;
			updated_at: string;
			started_at?: string;
			completed_at?: string;
		};
		const jobRecord = job as JobRecord;
		const options = jobRecord.data as Record<string, unknown>;
		return {
			id: jobRecord.id,
			user_id: jobRecord.created_by,
			status: jobRecord.status,
			format: options.format as string,
			include_location_data: options.includeLocationData as boolean,
			include_want_to_visit: options.includeWantToVisit as boolean,
			include_trips: options.includeTrips as boolean,
			file_path:
				(options.file_path as string) ||
				((jobRecord.result as Record<string, unknown>)?.file_path as string) ||
				undefined,
			file_size:
				(options.file_size as number) ||
				((jobRecord.result as Record<string, unknown>)?.file_size as number) ||
				undefined,
			expires_at: options.expires_at as string,
			progress: jobRecord.progress,
			result: jobRecord.result,
			error: jobRecord.error,
			created_at: jobRecord.created_at,
			updated_at: jobRecord.updated_at,
			started_at: jobRecord.started_at,
			completed_at: jobRecord.completed_at
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

		// Convert jobs to ExportJob format
		type JobRecord = {
			id: string;
			created_by: string;
			status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
			data: Record<string, unknown>;
			progress: number;
			result?: Record<string, unknown>;
			error?: string;
			created_at: string;
			updated_at: string;
			started_at?: string;
			completed_at?: string;
		};
		return jobs.map((job) => {
			const jobRecord = job as JobRecord;
			const options = jobRecord.data as Record<string, unknown>;
			return {
				id: jobRecord.id,
				user_id: jobRecord.created_by,
				status: jobRecord.status,
				format: options.format as string,
				include_location_data: options.includeLocationData as boolean,
				include_want_to_visit: options.includeWantToVisit as boolean,
				include_trips: options.includeTrips as boolean,
				file_path:
					(options.file_path as string) ||
					((jobRecord.result as Record<string, unknown>)?.file_path as string) ||
					undefined,
				file_size:
					(options.file_size as number) ||
					((jobRecord.result as Record<string, unknown>)?.file_size as number) ||
					undefined,
				expires_at: options.expires_at as string,
				progress: jobRecord.progress,
				result: jobRecord.result,
				error: jobRecord.error,
				created_at: jobRecord.created_at,
				updated_at: jobRecord.updated_at,
				started_at: jobRecord.started_at,
				completed_at: jobRecord.completed_at
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

	static async cleanupExpiredExports(): Promise<number> {
		const { data, error } = await this.fluxbase.rpc('cleanup_expired_exports');

		if (error) {
			console.error('Error cleaning up expired exports:', error);
			return 0;
		}

		return data || 0;
	}
}
