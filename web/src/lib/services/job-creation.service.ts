/**
 * Job Creation Service
 *
 * Provides a convenient API for creating and managing Fluxbase Jobs
 */

import { fluxbase } from '$lib/fluxbase';

type JobType =
	| 'data_import'
	| 'data_export'
	| 'trip_generation'
	| 'trip_detection'
	| 'reverse_geocoding_missing'
	| 'distance_calculation';

type JobPriority = number; // 1-10, where 10 is highest priority

interface CreateJobOptions {
	type: JobType;
	data: Record<string, unknown>;
	priority?: JobPriority;
}

interface JobResult {
	id: string;
	type: JobType;
	status: string;
	created_at: string;
}

class JobCreationService {
	/**
	 * Create a new job using Fluxbase Jobs API
	 */
	async createJob(options: CreateJobOptions): Promise<JobResult> {
		const { data, error } = await fluxbase.jobs.submit(
			options.type,
			options.data,
			{
				namespace: 'wayli',
				priority: options.priority || 5 // Default to medium priority
			}
		);

		if (error) {
			throw new Error(`Failed to create job: ${error.message}`);
		}

		return {
			id: data.job_id,
			type: options.type,
			status: data.status || 'queued',
			created_at: data.created_at || new Date().toISOString()
		};
	}

	/**
	 * Cancel a running job
	 */
	async cancelJob(jobId: string): Promise<void> {
		const { error } = await fluxbase.jobs.cancel(jobId);

		if (error) {
			throw new Error(`Failed to cancel job: ${error.message}`);
		}
	}
}

export const jobCreationService = new JobCreationService();
