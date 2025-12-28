/**
 * Refresh place_visits materialized view and chain to embedding sync
 *
 * Refreshes the place_visits materialized view and then chains to
 * sync-poi-embeddings to update POI embeddings with the refreshed data.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type { FluxbaseClient, JobUtils } from './types';

// Safe wrapper for reportProgress
function safeReportProgress(job: JobUtils, percent: number, message: string): void {
	if (typeof (job as any)?.reportProgress === 'function') {
		try {
			job.reportProgress(percent, message);
		} catch (e) {
			console.log(`[Progress ${percent}%] ${message}`);
		}
	} else {
		console.log(`[Progress ${percent}%] ${message}`);
	}
}

/**
 * Wait for an async RPC execution to complete by polling its status.
 */
async function waitForRpcCompletion(
	fluxbase: FluxbaseClient,
	executionId: string,
	job: JobUtils,
	maxWaitMs: number = 600000, // 10 minutes max for materialized view refresh
	pollIntervalMs: number = 5000 // Poll every 5 seconds
): Promise<boolean> {
	const startTime = Date.now();
	console.log(`⏳ Waiting for RPC execution ${executionId} to complete...`);

	while (Date.now() - startTime < maxWaitMs) {
		try {
			const { data: status } = await (fluxbase.rpc as any).getStatus(executionId);
			console.log(`📊 RPC status for ${executionId}:`, JSON.stringify(status));

			if (status?.status === 'completed' || status?.status === 'success') {
				console.log(`✅ RPC execution ${executionId} completed successfully`);
				return true;
			}

			if (status?.status === 'failed' || status?.status === 'error') {
				console.error(`❌ RPC execution ${executionId} failed: ${status?.error_message || status?.error || status?.message || 'unknown error'}`);
				return false;
			}

			// Still running, update progress
			const elapsed = Math.round((Date.now() - startTime) / 1000);
			safeReportProgress(job, 10 + Math.min(35, elapsed), `Refreshing place_visits... (${elapsed}s)`);
		} catch (err) {
			console.warn(`⚠️ Error checking RPC status:`, err);
		}

		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	console.warn(`⚠️ RPC execution ${executionId} timed out after ${maxWaitMs / 1000}s`);
	return false;
}

export async function handler(
	_req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
		};
	}

	try {
		safeReportProgress(job, 10, 'Refreshing place_visits materialized view...');

		// Refresh the materialized view using the RPC
		// Use user-scoped client to pass the admin role context
		// Run async to avoid request timeout on large datasets
		const { data: rpcResult, error: refreshError } = await (fluxbase.rpc as any).invoke('refresh-place-visits', {}, {
			namespace: 'wayli',
			async: true
		});

		if (refreshError) {
			console.error('Failed to refresh place_visits:', refreshError);
			return {
				success: false,
				error: `Failed to refresh place_visits: ${refreshError.message}`
			};
		}

		console.log(`✅ Place visits refresh RPC triggered: ${rpcResult || 'started'}`);

		// Wait for async RPC to complete
		const executionId = (rpcResult as any)?.execution_id || rpcResult;
		if (executionId) {
			const success = await waitForRpcCompletion(fluxbase, executionId, job);
			if (!success) {
				return {
					success: false,
					error: 'Place visits refresh timed out or failed'
				};
			}
		}

		console.log('✅ Place visits materialized view refreshed');
		safeReportProgress(job, 50, 'Place visits refreshed. Queueing POI embeddings sync...');

		// Chain to sync-poi-embeddings job
		console.log('🔗 Queueing sync-poi-embeddings job...');
		try {
			const onBehalfOf = context.user
				? {
						user_id: context.user.id,
						user_email: context.user.email,
						user_role: context.user.role
					}
				: undefined;

			const { data: embedJob, error: embedError } = await fluxbaseService.jobs.submit(
				'sync-poi-embeddings',
				{},
				{
					namespace: 'wayli',
					priority: 5,
					onBehalfOf
				}
			);

			if (embedError) {
				console.warn(`⚠️ Failed to queue sync-poi-embeddings job: ${embedError.message}`);
			} else {
				console.log(`✅ sync-poi-embeddings job queued: ${(embedJob as any)?.job_id || 'unknown'}`);
			}
		} catch (embedQueueError) {
			console.warn(`⚠️ Error queueing sync-poi-embeddings job:`, embedQueueError);
		}

		safeReportProgress(job, 100, 'Place visits refreshed and POI embeddings sync queued');

		return {
			success: true,
			result: {
				message: 'Place visits refreshed and POI embeddings sync queued'
			}
		};
	} catch (error: unknown) {
		console.error('❌ Error in refresh-place-visits job:', error);
		throw error;
	}
}
