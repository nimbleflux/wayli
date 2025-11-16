// This file is for server-side worker logic only. Do not import SvelteKit or Vite modules here.
// The Fluxbase client is provided by JobQueueService, which uses the worker-only client.
//
// Workers use Fluxbase Realtime to receive instant notifications when new jobs are queued.
// This eliminates the need for polling and provides sub-second job pickup latency.
// Race conditions are prevented by atomic job claiming via database UPDATE...WHERE operations.

import { randomUUID } from 'crypto';

import { getWorkerFluxbaseConfig } from '../../shared/config/worker-environment';

import { JobProcessorService } from '../job-processor.service';
import { JobQueueService } from '../job-queue.service.worker';
import { WorkerRealtimeService } from './job-realtime.service';

import type { Job } from '../../lib/types/job-queue.types';
import type { JobNotification } from './job-realtime.service';

export class JobWorker {
	private workerId: string;
	private isRunning: boolean = false;
	private isShuttingDown: boolean = false;
	private shutdownGracePeriod: number = 30000; // 30 seconds default
	private forceShutdownTimeout?: NodeJS.Timeout;
	private currentJob: Job | null = null;
	private cancellationCheckInterval?: NodeJS.Timeout;
	private cancellationCheckIntervalMs: number = 10000; // 10 seconds default
	private jobCancelled: boolean = false;
	private lastHeartbeat: string = new Date().toISOString();
	private totalJobsProcessed: number = 0;
	private activeJobs: Set<string> = new Set();
	private abortController?: AbortController;
	private realtimeService: WorkerRealtimeService | null = null;

	constructor(workerId?: string) {
		this.workerId = workerId || randomUUID();
	}

	async start(): Promise<void> {
		if (this.isRunning) return;

		console.log(`🚀 Starting worker ${this.workerId}...`);

		try {
			// Check environment variables with timeout
			await Promise.race([
				this.checkEnvironmentVariables(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Environment check timeout')), 10000)
				)
			]);

			this.isRunning = true;
			await this.registerWorker();

			console.log(`✅ Worker ${this.workerId} started successfully`);

			// Initialize Realtime service for instant job notifications
			this.realtimeService = new WorkerRealtimeService({
				workerId: this.workerId,
				onConnected: () => {
					console.log(`🔗 Worker ${this.workerId} Realtime connected`);
				},
				onDisconnected: () => {
					console.log(`🔌 Worker ${this.workerId} Realtime disconnected`);
				},
				onError: (error) => {
					console.error(`❌ Worker ${this.workerId} Realtime error:`, error);
				},
				onJobAvailable: (job: JobNotification) => {
					// When notified of a new job, try to claim it
					this.handleJobNotification(job);
				}
			});

			// Connect to Realtime
			await this.realtimeService.connect();

			// Start cancellation checking for running jobs
			this.cancellationCheckInterval = setInterval(async () => {
				if (this.isRunning && this.currentJob) {
					await this.checkJobCancellation();
				}
			}, this.cancellationCheckIntervalMs);

			// Do an initial check for any existing queued jobs
			// This handles jobs that were queued before the worker started
			await this.tryClaimJob();
		} catch (error) {
			console.error(`❌ Failed to start worker ${this.workerId}:`, error);
			throw error;
		}
	}

	private async checkEnvironmentVariables(): Promise<void> {
		console.log('🔍 Checking worker environment variables...');

		try {
			const config = getWorkerFluxbaseConfig();

			// Enhanced debugging for Kubernetes troubleshooting
			console.log('🔧 Worker environment check:');
			console.log('  - FLUXBASE_BASE_URL:', config.url ? 'SET' : 'NOT SET');
			console.log('  - FLUXBASE_SERVICE_ROLE_KEY:', config.serviceRoleKey ? 'SET' : 'NOT SET');
			console.log('  - FLUXBASE_ANON_KEY:', (config as any).anonKey ? 'SET' : 'NOT SET');

			// Check if we're in a container environment
			console.log(
				'  - Container environment:',
				process.env.KUBERNETES_SERVICE_HOST ? 'Kubernetes' : 'Local'
			);
			console.log('  - Node environment:', process.env.NODE_ENV || 'undefined');
			console.log('  - Working directory:', process.cwd());

			if (!config.url) {
				console.error('❌ FLUXBASE_BASE_URL is not set! Worker cannot connect to Fluxbase.');
			}

			if (!config.serviceRoleKey) {
				console.error('❌ FLUXBASE_SERVICE_ROLE_KEY is not set! Worker cannot access jobs table.');
			}

			if (!config.url || !config.serviceRoleKey) {
				console.error(
					'🚨 Worker will not be able to retrieve jobs due to missing environment variables!'
				);
				console.error(
					'   Please set FLUXBASE_BASE_URL and FLUXBASE_SERVICE_ROLE_KEY before running workers.'
				);
				console.error('🚨 Missing required environment variables - exiting with code 1');
				console.error(
					'   This indicates a critical configuration failure that prevents the worker from starting.'
				);
				console.error('   Please check your environment variable configuration.');
				throw new Error(
					'Missing required environment variables: FLUXBASE_BASE_URL and/or FLUXBASE_SERVICE_ROLE_KEY'
				);
			}

			// Test the connection by trying to get job stats with timeout
			try {
				console.log('🔍 Testing Fluxbase connection...');
				// Get the actual URL from the Fluxbase client being used
				const actualUrl = JobQueueService.getFluxbaseUrl();
				console.log('  - Target URL:', actualUrl);
				console.log('  - Service role key length:', config.serviceRoleKey.length);

				const stats = await Promise.race([
					JobQueueService.getJobStats(),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error('Fluxbase connection timeout')), 10000)
					)
				]);
				console.log('✅ Fluxbase connection successful! Job stats:', stats);
			} catch (error) {
				console.error('❌ Failed to connect to Fluxbase:', error);

				// Enhanced error analysis
				if (error instanceof Error) {
					console.error('❌ Error type:', error.constructor.name);
					console.error('❌ Error message:', error.message);

					// Check for specific error types
					if (error.message.includes('fetch failed')) {
						console.error(
							'❌ Network error detected - check pod network policies and firewall rules'
						);
					} else if (error.message.includes('timeout')) {
						console.error('❌ Connection timeout - check if Fluxbase is reachable from the pod');
					} else if (error.message.includes('unauthorized')) {
						console.error('❌ Authentication error - check service role key permissions');
					}
				}

				// Throw error to cause worker to exit with code 1
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error('🚨 Worker cannot connect to Fluxbase - exiting with code 1');
				console.error(
					'   This indicates a critical connection failure that prevents the worker from functioning.'
				);
				console.error('   Please check your Fluxbase configuration and network connectivity.');
				throw new Error(`Worker cannot connect to Fluxbase: ${errorMessage}`);
			}
		} catch (error) {
			console.error('❌ Failed to load worker environment configuration:', error);
			console.error('   This could be due to missing or invalid environment variables.');

			// Re-throw the error to cause worker to exit with code 1
			throw error;
		}
	}

	async stop(graceful: boolean = true): Promise<void> {
		console.log(
			`🛑 Worker ${this.workerId} initiating ${graceful ? 'graceful' : 'forced'} shutdown...`
		);

		this.isShuttingDown = true;
		this.isRunning = false;

		// Disconnect Realtime service
		if (this.realtimeService) {
			await this.realtimeService.disconnect();
			this.realtimeService = null;
		}

		// Stop cancellation checking
		if (this.cancellationCheckInterval) {
			clearInterval(this.cancellationCheckInterval);
			this.cancellationCheckInterval = undefined;
		}

		// Handle current job based on shutdown mode
		if (this.currentJob) {
			if (graceful) {
				console.log(
					`⏳ Worker ${this.workerId} waiting for current job ${this.currentJob.id} to complete (grace period: ${this.shutdownGracePeriod}ms)...`
				);

				// Mark job as aborting
				await JobQueueService.updateJobProgress(this.currentJob.id, this.currentJob.progress || 0, {
					message: 'Worker shutting down, attempting graceful job completion...',
					aborting: true
				});

				// Signal abort to job processor
				if (this.abortController) {
					this.abortController.abort();
				}

				// Set a timeout for forced shutdown
				const shutdownPromise = new Promise<void>((resolve) => {
					this.forceShutdownTimeout = setTimeout(() => {
						console.log(`⏰ Worker ${this.workerId} grace period expired, forcing shutdown...`);
						resolve();
					}, this.shutdownGracePeriod);
				});

				// Wait for either job completion or timeout
				await Promise.race([shutdownPromise, this.waitForJobCompletion()]);

				// Clear timeout if job completed early
				if (this.forceShutdownTimeout) {
					clearTimeout(this.forceShutdownTimeout);
					this.forceShutdownTimeout = undefined;
				}

				// If job is still running after grace period, requeue it
				if (this.currentJob) {
					console.log(
						`🔄 Worker ${this.workerId} requeueing job ${this.currentJob.id} for retry...`
					);
					await JobQueueService.requeueJobForRetry(
						this.currentJob.id,
						'Worker shutdown during job execution'
					);
					this.currentJob = null;
				}
			} else {
				// Forced shutdown: fail the job immediately
				console.log(
					`❌ Worker ${this.workerId} forcing shutdown, failing current job ${this.currentJob.id}...`
				);
				await JobQueueService.failJob(this.currentJob.id, 'Worker stopped (forced shutdown)');
				this.currentJob = null;
			}
		} else {
			console.log(`✅ Worker ${this.workerId} has no active job, shutting down immediately`);
		}

		await this.unregisterWorker();
		console.log(`🛑 Worker ${this.workerId} stopped successfully`);
	}

	private async waitForJobCompletion(): Promise<void> {
		// Poll until current job is cleared (indicates completion)
		while (this.currentJob) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	private async checkJobCancellation(): Promise<void> {
		if (!this.currentJob) return;

		try {
			// Check if the current job has been cancelled
			const jobStatus = await JobQueueService.getJobStatus(this.currentJob.id);

			if (jobStatus === 'cancelled') {
				console.log(
					`🛑 Worker ${this.workerId} detected job ${this.currentJob.id} was cancelled, stopping processing`
				);
				this.jobCancelled = true;
				// The job processor will handle the cancellation when it next calls checkJobCancellation
				// We just need to mark that the job was cancelled
			}
		} catch (error) {
			console.error(`❌ Worker ${this.workerId} error in cancellation check:`, error);
		}
	}

	private async registerWorker(): Promise<void> {
		// Register worker in the database (if you have a workers table)
		// This could be used for monitoring and management
		console.log(`📝 Worker ${this.workerId} registered`);
	}

	/**
	 * Handle job notification from Realtime
	 * This is called when a new job becomes available
	 */
	private async handleJobNotification(_job: JobNotification): Promise<void> {
		// Don't process if shutting down or already busy
		if (this.isShuttingDown || this.currentJob) {
			return;
		}

		// Try to claim a job
		await this.tryClaimJob();
	}

	/**
	 * Try to claim and process the next available job
	 * This uses atomic database operations to prevent race conditions
	 */
	private async tryClaimJob(): Promise<void> {
		try {
			// Don't claim jobs if shutting down
			if (this.isShuttingDown) {
				return;
			}

			// Update heartbeat
			this.lastHeartbeat = new Date().toISOString();

			// If we're already processing a job, don't get another one
			if (this.currentJob) {
				return;
			}

			// Try to atomically claim the next job
			// getNextJob() handles the race condition - only one worker will succeed
			const job = await JobQueueService.getNextJob(this.workerId);
			if (!job) {
				// No job available or another worker claimed it
				return;
			}

			this.currentJob = job;
			this.jobCancelled = false;
			console.log(`📋 Worker ${this.workerId} claimed job ${job.id} (${job.type})`);

			// Create new abort controller for this job
			this.abortController = new AbortController();

			// Process the job
			await this.processJob(job);
		} catch (error: unknown) {
			console.error(`❌ Worker ${this.workerId} error claiming job:`, error);

			if (this.currentJob) {
				await this.failJob(this.currentJob.id, (error as Error)?.message || 'Unknown error');
				this.currentJob = null;
			}
		}
	}

	private async processJob(job: Job): Promise<void> {
		try {
			// Track active job
			this.activeJobs.add(job.id);

			// Pass abort signal to job processor
			await JobProcessorService.processJob(job, this.abortController?.signal);

			// Check if job was cancelled during processing
			if (this.jobCancelled) {
				console.log(`🛑 Worker ${this.workerId} job ${job.id} was cancelled during processing`);
				return;
			}

			// Check if job was aborted due to shutdown
			if (this.isShuttingDown && this.currentJob) {
				console.log(`🛑 Worker ${this.workerId} job ${job.id} aborted due to shutdown`);
				// Job will be requeued by stop() method
				return;
			}

			// The job processor should handle its own completion
			// Only set processed: true for jobs that don't handle their own completion
			// For export jobs, the ExportService.completeExportJob handles completion
			if (job.type !== 'data_export') {
				await this.completeJob(job.id, { processed: true });
			}
		} catch (error: unknown) {
			console.error(`❌ Worker ${this.workerId} error processing job ${job.id}:`, error);

			// Check if the error is due to cancellation
			if (error instanceof Error && error.message === 'Job was cancelled') {
				console.log(`🛑 Worker ${this.workerId} job ${job.id} was cancelled`);
				return;
			}

			// Check if the error is due to abort
			if (error instanceof Error && error.name === 'AbortError') {
				console.log(`🛑 Worker ${this.workerId} job ${job.id} was aborted`);
				// Job will be requeued by stop() method if during shutdown
				return;
			}

			const errorMessage = (error as Error)?.message || 'Unknown error';
			await this.failJob(job.id, errorMessage);
		} finally {
			// Remove from active jobs and increment counter
			if (this.currentJob) {
				this.activeJobs.delete(this.currentJob.id);
				this.totalJobsProcessed++;
			}
			this.currentJob = null;
			this.jobCancelled = false;
			this.abortController = undefined;

			// After finishing a job, check if there are more jobs waiting
			// This handles the case where jobs were queued while we were busy
			if (!this.isShuttingDown) {
				setImmediate(() => this.tryClaimJob());
			}
		}
	}

	private async completeJob(jobId: string, result?: Record<string, unknown>): Promise<void> {
		try {
			await JobQueueService.completeJob(jobId, result);
			console.log(`✅ Worker ${this.workerId} completed job ${jobId}`);
		} catch (error: unknown) {
			console.error(`❌ Worker ${this.workerId} error completing job:`, error);
			throw error;
		}
	}

	private async failJob(jobId: string, error: string): Promise<void> {
		try {
			await JobQueueService.failJob(jobId, error);
			console.log(`❌ Worker ${this.workerId} failed job ${jobId}: ${error}`);
		} catch (failError: unknown) {
			console.error(`❌ Worker ${this.workerId} error failing job:`, failError);
		}
	}

	private async unregisterWorker(): Promise<void> {
		// Unregister worker in the database (if you have a workers table)
		// This could be used for monitoring and management
		console.log(`🗑️ Worker ${this.workerId} unregistered`);
	}

	/**
	 * Check worker health and Fluxbase connectivity
	 */
	async checkHealth(): Promise<{ healthy: boolean; details: Record<string, any> }> {
		const health = {
			workerId: this.workerId,
			timestamp: new Date().toISOString(),
			healthy: true,
			details: {
				fluxbase: { connected: false, error: null as string | null },
				jobQueue: { connected: false, error: null as string | null },
				lastHeartbeat: this.lastHeartbeat,
				activeJobs: this.activeJobs.size,
				totalJobsProcessed: this.totalJobsProcessed
			}
		};

		try {
			// Test Fluxbase connection through JobQueueService
			await JobQueueService.getJobStats();
			health.details.fluxbase.connected = true;
		} catch (error) {
			health.details.fluxbase.error = error instanceof Error ? error.message : 'Unknown error';
			health.healthy = false;
		}

		try {
			// Test job queue connection
			await JobQueueService.getNextJob(this.workerId);
			// If we can get a job (even if it's null), the connection is working
			health.details.jobQueue.connected = true;
		} catch (error) {
			health.details.jobQueue.error = error instanceof Error ? error.message : 'Unknown error';
			health.healthy = false;
		}

		return health;
	}

	/**
	 * Update the worker's last heartbeat timestamp
	 */
	updateLastHeartbeat(): void {
		this.lastHeartbeat = new Date().toISOString();
	}

	/**
	 * Increment the total jobs processed count
	 */
	incrementTotalJobsProcessed(): void {
		this.totalJobsProcessed++;
	}

	/**
	 * Get the current active jobs count
	 */
	getActiveJobsCount(): number {
		return this.activeJobs.size;
	}
}
