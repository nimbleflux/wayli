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

		// Refresh the materialized view using the RPC (requires service_role)
		// Use (rpc as any).invoke for Fluxbase RPC endpoint calling
		const { error: refreshError } = await (fluxbaseService.rpc as any).invoke('refresh-place-visits', {}, {
			namespace: 'wayli'
		});

		if (refreshError) {
			console.error('Failed to refresh place_visits:', refreshError);
			return {
				success: false,
				error: `Failed to refresh place_visits: ${refreshError.message}`
			};
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
