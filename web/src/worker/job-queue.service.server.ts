import { getWorkerConfig } from '../shared/config/node-environment';
import { fluxbase } from './fluxbase';

import type { Job, JobType, JobStatus, JobPriority, JobConfig } from '../lib/types/job-queue.types';

export class JobQueueService {
	private static config: JobConfig = getWorkerConfig();
	private static fluxbase = fluxbase;

	static setConfig(newConfig: Partial<JobConfig>): void {
		this.config = { ...this.config, ...newConfig };
	}

	static getConfig(): JobConfig {
		return { ...this.config };
	}

	static async createJob(
		type: JobType,
		data: Record<string, unknown>,
		priority: JobPriority = 'normal',
		userId: string
	): Promise<Job> {
		const { data: job, error } = await this.fluxbase
			.from('jobs')
			.insert({
				type,
				status: 'queued',
				priority,
				data,
				progress: 0,
				created_by: userId
			})
			.select()
			.single();

		if (error) throw error;

		console.log(`📝 New job created: ${job.id} (${type}) with priority ${priority}`);
		return job;
	}

	static async getNextJob(workerId: string): Promise<Job | null> {
		// Use a transaction-like approach to ensure atomic job claiming
		const { data: job, error } = await this.fluxbase
			.from('jobs')
			.select('*')
			.in('status', ['queued'])
			.order('created_at', { ascending: true })
			.limit(1)
			.single();
		if (error && error.code !== 'PGRST116') throw error;
		if (!job) return null;

		// Claim the job atomically - only update if it's still queued
		const {
			data: updatedJob,
			error: updateError,
			count
		} = await this.fluxbase
			.from('jobs')
			.update({
				status: 'running',
				worker_id: workerId,
				started_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.eq('id', job.id)
			.eq('status', 'queued')
			.select('*')
			.single();

		console.log('Job claim update:', { updatedJob, updateError, count, workerId, jobId: job.id });

		if (updateError) {
			if (updateError.code === 'PGRST116') {
				console.log(updateError.details);
				return null;
			}
			throw updateError;
		}

		if (!updatedJob) {
			// Job was claimed by another worker during update (expected in multi-worker setup)
			console.log(
				'Job was claimed by another worker during update (expected in multi-worker setup)'
			);
			return null;
		}

		// Worker successfully claimed job (info-level, omitted for less verbosity)
		return updatedJob;
	}

	static async updateJobProgress(
		jobId: string,
		progress: number,
		result?: Record<string, unknown>
	): Promise<void> {
		const update: Record<string, unknown> = {
			progress,
			updated_at: new Date().toISOString()
		};
		if (result) update.result = result;

		const { error } = await this.fluxbase.from('jobs').eq('id', jobId).update(update);

		if (error) throw error;
	}

	static async completeJob(jobId: string, result?: Record<string, unknown>): Promise<void> {
		const { error } = await this.fluxbase
			.from('jobs')
			.update({
				status: 'completed',
				progress: 100,
				result,
				completed_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.eq('id', jobId);

		if (error) throw error;
	}

	static async failJob(jobId: string, error: string): Promise<void> {
		// Mark job as failed immediately without retrying
		const { error: updateError } = await this.fluxbase
			.from('jobs')
			.update({
				status: 'failed',
				error: error,
				updated_at: new Date().toISOString()
			})
			.eq('id', jobId);

		if (updateError) throw updateError;
	}

	static async cancelJob(jobId: string): Promise<void> {
		const { error } = await this.fluxbase
			.from('jobs')
			.update({
				status: 'cancelled',
				updated_at: new Date().toISOString()
			})
			.eq('id', jobId);

		if (error) throw error;
	}

	static async getJobStatus(jobId: string): Promise<string | null> {
		const { data: job, error } = await this.fluxbase
			.from('jobs')
			.select('status')
			.eq('id', jobId)
			.single();

		if (error) {
			console.error('Error getting job status:', error);
			return null;
		}

		return job?.status || null;
	}

	static async getJobs(
		status?: JobStatus,
		userId?: string,
		page: number = 1,
		limit: number = 20
	): Promise<{ jobs: Job[]; total: number }> {
		let query = this.fluxbase.from('jobs').select('*', { count: 'exact' });

		if (status) query = query.eq('status', status);
		if (userId) query = query.eq('created_by', userId);

		const {
			data: jobs,
			error,
			count
		} = await query
			.order('created_at', { ascending: false })
			.range((page - 1) * limit, page * limit - 1);

		if (error) throw error;

		return { jobs: jobs || [], total: count || 0 };
	}

	static async getJobStats(): Promise<{
		total: number;
		queued: number;
		running: number;
		completed: number;
		failed: number;
		cancelled: number;
	}> {
		const { data, error } = await this.fluxbase.from('jobs').select('status');

		if (error) throw error;

		const stats = {
			total: 0,
			queued: 0,
			running: 0,
			completed: 0,
			failed: 0,
			cancelled: 0
		};

		data?.forEach((job: { status: string }) => {
			stats.total++;
			switch (job.status) {
				case 'queued':
					stats.queued++;
					break;
				case 'running':
					stats.running++;
					break;
				case 'completed':
					stats.completed++;
					break;
				case 'failed':
					stats.failed++;
					break;
				case 'cancelled':
					stats.cancelled++;
					break;
			}
		});

		return stats;
	}

	static async cleanupStaleJobs(): Promise<void> {
		const timeoutThreshold = new Date(Date.now() - this.config.jobTimeout);
		// Find all running jobs that have not been updated for longer than jobTimeout
		const { data: staleJobs, error: fetchError } = await this.fluxbase
			.from('jobs')
			.select('*')
			.eq('status', 'running')
			.lt('updated_at', timeoutThreshold.toISOString());
		if (fetchError) throw fetchError;
		if (!staleJobs || staleJobs.length === 0) return;

		for (const job of staleJobs) {
			const currentRetries = job.retry_count || 0;
			const maxRetries = this.config.jobTimeout;
			if (currentRetries < maxRetries) {
				// Re-queue the job
				const { error: retryError } = await this.fluxbase
					.from('jobs')
					.update({
						status: 'queued',
						retry_count: currentRetries + 1,
						last_error: 'Job was stuck (worker offline or timed out)',
						updated_at: new Date().toISOString(),
						worker_id: null,
						started_at: null,
						progress: 0
					})
					.eq('id', job.id);
				if (retryError) throw retryError;
			} else {
				// Mark as failed
				const { error: failError } = await this.fluxbase
					.from('jobs')
					.update({
						status: 'failed',
						error: 'Job timed out and exceeded max retries',
						updated_at: new Date().toISOString()
					})
					.eq('id', job.id);
				if (failError) throw failError;
			}
		}
	}
}
