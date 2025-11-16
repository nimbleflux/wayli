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

	static getFluxbaseUrl(): string {
		return (this.fluxbase as any).fluxbaseUrl || 'unknown';
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
		// console.log(`🔍 Worker ${workerId} attempting to get next job...`);

		// Use a transaction-like approach to ensure atomic job claiming
		const { data: job, error } = await this.fluxbase
			.from('jobs')
			.select('*')
			.in('status', ['queued'])
			.order('created_at', { ascending: true })
			.limit(1)
			.single();

		if (error) {
			if (error.code === 'PGRST116') {
				// console.log(`⏳ Worker ${workerId} found no queued jobs (PGRST116: no rows returned)`);
				return null;
			}
			// console.error(`❌ Worker ${workerId} error querying for jobs:`, error);
			throw error;
		}

		if (!job) {
			// console.log(`⏳ Worker ${workerId} found no queued jobs`);
			return null;
		}

		console.log(`📋 Worker ${workerId} found job ${job.id} (${job.type}), attempting to claim...`);

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

		console.log(`🔧 Worker ${workerId} job claim update:`, {
			updatedJob: updatedJob ? 'success' : 'null',
			updateError: updateError ? updateError.code : 'none',
			count,
			workerId,
			jobId: job.id
		});

		if (updateError) {
			if (updateError.code === 'PGRST116') {
				console.log(`⚠️ Worker ${workerId} job was already claimed by another worker (PGRST116)`);
				return null;
			}
			console.error(`❌ Worker ${workerId} error claiming job:`, updateError);
			throw updateError;
		}

		if (!updatedJob) {
			// Job was claimed by another worker during update (expected in multi-worker setup)
			console.log(
				`⚠️ Worker ${workerId} job ${job.id} was claimed by another worker during update`
			);
			return null;
		}

		console.log(`✅ Worker ${workerId} successfully claimed job ${job.id} (${job.type})`);
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

		console.log(
			`📊 Updating job ${jobId} progress to ${progress}%`,
			result ? `with result: ${JSON.stringify(result)}` : ''
		);

		const { error, data } = await this.fluxbase
			.from('jobs')
			.update(update)
			.eq('id', jobId)
			.select();

		if (error) {
			console.error(`❌ Error updating job progress:`, error);
			throw error;
		}
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
		// Debug: Log which Fluxbase client we're using
		console.log(
			'🔍 JobQueueService.getJobStats() using Fluxbase client with URL:',
			(this.fluxbase as any).fluxbaseUrl || 'unknown'
		);

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

		data?.forEach((job) => {
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

	static async requeueJobForRetry(jobId: string, reason: string): Promise<void> {
		console.log(`🔄 Requeueing job ${jobId} for retry. Reason: ${reason}`);

		const { data: job, error: fetchError } = await this.fluxbase
			.from('jobs')
			.select('retry_count')
			.eq('id', jobId)
			.single();

		if (fetchError) throw fetchError;

		const currentRetries = job?.retry_count || 0;
		const maxRetries = this.config.retryAttempts;

		if (currentRetries < maxRetries) {
			// Re-queue the job for retry
			const { error: retryError } = await this.fluxbase
				.from('jobs')
				.update({
					status: 'queued',
					retry_count: currentRetries + 1,
					last_error: reason,
					updated_at: new Date().toISOString(),
					worker_id: null,
					started_at: null
					// Note: Keep progress and result to allow resumption if needed
				})
				.eq('id', jobId);

			if (retryError) throw retryError;
			console.log(
				`✅ Job ${jobId} requeued for retry (attempt ${currentRetries + 1}/${maxRetries})`
			);
		} else {
			// Exceeded max retries, mark as failed
			const { error: failError } = await this.fluxbase
				.from('jobs')
				.update({
					status: 'failed',
					error: `${reason} (exceeded max retries: ${maxRetries})`,
					updated_at: new Date().toISOString()
				})
				.eq('id', jobId);

			if (failError) throw failError;
			console.log(`❌ Job ${jobId} failed after exceeding max retries (${maxRetries})`);
		}
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
			await this.requeueJobForRetry(job.id, 'Job was stuck (worker offline or timed out)');
		}
	}
}
