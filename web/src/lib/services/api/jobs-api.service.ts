// src/lib/services/api/jobs-api.service.ts
// Jobs API service layer - extracts business logic from API routes

import { errorHandler, ErrorCode } from '../error-handler.service';
import { JobQueueService } from '../../../worker/job-queue.service.server';

import type { Job, JobType } from '$lib/types/job-queue.types';
import type { CreateJobRequest, JobQuery } from '$lib/utils/api/schemas';
import type { FluxbaseClient } from '@fluxbase/sdk';

export interface JobsApiServiceConfig {
	fluxbase: FluxbaseClient;
}

export interface GetJobsResult {
	jobs: Job[];
	total: number;
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		hasNext: boolean;
		hasPrev: boolean;
	};
}

export interface CreateJobResult {
	job: Job;
	message: string;
}

export class JobsApiService {
	private fluxbase: FluxbaseClient;

	constructor(config: JobsApiServiceConfig) {
		this.fluxbase = config.fluxbase;
	}

	/**
	 * Get jobs for a user with pagination and filtering
	 */
	async getJobs(userId: string, query: JobQuery, isAdmin: boolean = false): Promise<GetJobsResult> {
		try {
			const { page, limit, status, type, search } = query;
			const effectiveUserId = isAdmin ? undefined : userId;

			// Map status from schema to JobStatus type
			const jobStatus = status === 'processing' ? 'running' : status;

			// Get jobs with pagination
			const { jobs, total } = await JobQueueService.getJobs(
				jobStatus,
				effectiveUserId,
				page,
				limit
			);

			// Apply additional filtering if needed
			let filteredJobs = jobs;
			if (type) {
				filteredJobs = jobs.filter((job) => job.type === type);
			}

			if (search) {
				const searchLower = search.toLowerCase();
				filteredJobs = jobs.filter(
					(job) =>
						job.type.toLowerCase().includes(searchLower) ||
						job.status.toLowerCase().includes(searchLower) ||
						JSON.stringify(job.data).toLowerCase().includes(searchLower)
				);
			}

			const totalPages = Math.ceil(total / limit);
			const hasNext = page < totalPages;
			const hasPrev = page > 1;

			return {
				jobs: filteredJobs,
				total: filteredJobs.length,
				pagination: {
					page,
					limit,
					total,
					totalPages,
					hasNext,
					hasPrev
				}
			};
		} catch (error) {
			throw errorHandler.createError(ErrorCode.DATABASE_ERROR, 'Failed to fetch jobs', 500, error, {
				userId,
				query
			});
		}
	}

	/**
	 * Map job type from schema to JobType
	 */
	private mapJobType(type: string): JobType {
		// Map schema job types to internal JobType enum
		const typeMap: Record<string, JobType> = {
			trip_generation: 'trip_generation',
			data_export: 'data_export',
			data_import: 'data_import',
			geocoding: 'geocoding',
			image_generation: 'image_generation',
			poi_detection: 'poi_detection',
			trip_detection: 'trip_detection'
		};

		const mappedType = typeMap[type];
		if (!mappedType) {
			throw errorHandler.createError(ErrorCode.VALIDATION_ERROR, `Invalid job type: ${type}`, 400, {
				type
			});
		}

		return mappedType;
	}

	/**
	 * Create a new job for a user
	 */
	async createJob(userId: string, request: CreateJobRequest): Promise<CreateJobResult> {
		try {
			const { type, data, priority } = request;

			// Map job type from schema to JobType
			const jobType = this.mapJobType(type);

			// Check for active jobs of the same type
			const activeJob = await this.checkForActiveJob(userId, jobType);
			if (activeJob) {
				throw errorHandler.createError(
					ErrorCode.JOB_ALREADY_RUNNING,
					`A ${type} job is already ${activeJob.status}. Please wait for it to complete.`,
					409,
					{ activeJob }
				);
			}

			// Create the job
			const job = await JobQueueService.createJob(jobType, data, priority, userId);

			return {
				job,
				message: `Job created successfully with ID: ${job.id}`
			};
		} catch (error) {
			if (error instanceof Error && error.message.includes('JOB_ALREADY_RUNNING')) {
				throw error;
			}

			throw errorHandler.createError(
				ErrorCode.JOB_PROCESSING_ERROR,
				'Failed to create job',
				500,
				error,
				{ userId, request }
			);
		}
	}

	/**
	 * Get a specific job by ID
	 */
	async getJobById(jobId: string, userId: string, isAdmin: boolean = false): Promise<Job> {
		try {
			const { data: job, error } = await this.fluxbase
				.from('jobs')
				.select('*')
				.eq('id', jobId)
				.single();

			if (error) {
				if (error.code === 'PGRST116') {
					throw errorHandler.createError(ErrorCode.JOB_NOT_FOUND, 'Job not found', 404, { jobId });
				}
				throw error;
			}

			// Check permissions
			if (!isAdmin && job.created_by !== userId) {
				throw errorHandler.createError(
					ErrorCode.INSUFFICIENT_PERMISSIONS,
					'You do not have permission to access this job',
					403,
					{ jobId, userId }
				);
			}

			return job;
		} catch (error) {
			if (error instanceof Error && error.message.includes('JOB_NOT_FOUND')) {
				throw error;
			}

			throw errorHandler.createError(ErrorCode.DATABASE_ERROR, 'Failed to fetch job', 500, error, {
				jobId,
				userId
			});
		}
	}

	/**
	 * Cancel a job
	 */
	async cancelJob(jobId: string, userId: string, isAdmin: boolean = false): Promise<void> {
		try {
			// First get the job to check permissions
			const job = await this.getJobById(jobId, userId, isAdmin);

			// Check if job can be cancelled
			if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
				throw errorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					`Cannot cancel job in ${job.status} status`,
					400,
					{ jobId, status: job.status }
				);
			}

			// Cancel the job via Edge Function
			const { error } = await this.fluxbase.functions.invoke(`jobs/${jobId}`, {
				method: 'DELETE'
			});

			if (error) {
				throw error;
			}

			// Also update locally for immediate UI feedback
			const { error: updateError } = await this.fluxbase
				.from('jobs')
				.update({
					status: 'cancelled',
					updated_at: new Date().toISOString()
				})
				.eq('id', jobId);

			if (updateError) {
				console.warn('⚠️ Failed to update job status locally:', updateError);
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('VALIDATION_ERROR')) {
				throw error;
			}

			throw errorHandler.createError(
				ErrorCode.JOB_PROCESSING_ERROR,
				'Failed to cancel job',
				500,
				error,
				{
					jobId,
					userId
				}
			);
		}
	}

	/**
	 * Get job statistics for a user
	 */
	async getJobStats(userId: string, isAdmin: boolean = false): Promise<Record<string, number>> {
		try {
			const effectiveUserId = isAdmin ? undefined : userId;

			// Get all jobs for the user
			const { jobs } = await JobQueueService.getJobs(undefined, effectiveUserId, 1, 1000);

			// Calculate statistics
			const stats = {
				total: jobs.length,
				queued: jobs.filter((job: Job) => job.status === 'queued').length,
				running: jobs.filter((job: Job) => job.status === 'running').length,
				completed: jobs.filter((job: Job) => job.status === 'completed').length,
				failed: jobs.filter((job: Job) => job.status === 'failed').length,
				cancelled: jobs.filter((job: Job) => job.status === 'cancelled').length
			};

			return stats;
		} catch (error) {
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to fetch job statistics',
				500,
				error,
				{ userId }
			);
		}
	}

	/**
	 * Check if user has an active job of the specified type
	 */
	private async checkForActiveJob(userId: string, type: JobType): Promise<Job | null> {
		try {
			const { data: jobs, error } = await this.fluxbase
				.from('jobs')
				.select('*')
				.eq('type', type)
				.in('status', ['queued', 'running'])
				.eq('created_by', userId)
				.order('created_at', { ascending: false })
				.limit(1);

			if (error) {
				throw error;
			}

			return jobs?.[0] || null;
		} catch (error) {
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to check for active jobs',
				500,
				error,
				{ userId, type }
			);
		}
	}

	/**
	 * Validate job creation request
	 */
	validateCreateJobRequest(request: CreateJobRequest): void {
		const { type, data } = request;

		if (!type) {
			throw errorHandler.createError(
				ErrorCode.MISSING_REQUIRED_FIELD,
				'Job type is required',
				400,
				{
					field: 'type'
				}
			);
		}

		if (!data || typeof data !== 'object') {
			throw errorHandler.createError(
				ErrorCode.MISSING_REQUIRED_FIELD,
				'Job data is required and must be an object',
				400,
				{ field: 'data' }
			);
		}

		// Validate job data based on type
		switch (type) {
			case 'trip_generation':
				if (!data.startDate && !data.endDate) {
					throw errorHandler.createError(
						ErrorCode.VALIDATION_ERROR,
						'Trip generation requires either startDate or endDate',
						400,
						{ type, data }
					);
				}
				break;

			case 'data_export':
				if (!data.format) {
					throw errorHandler.createError(
						ErrorCode.VALIDATION_ERROR,
						'Data export requires format specification',
						400,
						{ type, data }
					);
				}
				break;

			default:
				// Other job types don't have specific requirements
				break;
		}
	}
}

// Export singleton instance
export const jobsApiService = new JobsApiService({
	fluxbase: {} as FluxbaseClient // Will be injected by API handlers
});
