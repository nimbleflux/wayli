/**
 * Scheduled place visit detection for all users
 *
 * Runs daily at 03:00 UTC to detect place visits incrementally for all users.
 * Each user's data is processed from their respective watermark timestamp.
 *
 * @fluxbase:require-role admin
 * @fluxbase:timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 3 * * *
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
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	try {
		safeReportProgress(job, 5, 'Starting incremental place visit detection for all users...');

		// Invoke global incremental detection (no user_id = process all users)
		const { data, error } = await (fluxbaseService.rpc as any).invoke(
			'detect-place-visits-incremental',
			{ user_id: null },
			{ namespace: 'wayli' }
		);

		if (error) {
			console.error('❌ Failed to detect place visits:', error);
			return {
				success: false,
				error: `Failed to detect place visits: ${error.message}`
			};
		}

		const result = data?.[0] || data || {};
		const insertedCount = result.inserted_count || 0;
		const usersProcessed = result.users_processed || 0;
		const deletedCount = result.deleted_count || 0;

		safeReportProgress(
			job,
			100,
			`Completed: ${insertedCount} visits detected for ${usersProcessed} users (${deletedCount} old visits updated)`
		);

		console.log(
			`✅ Scheduled place visit detection complete: ${insertedCount} visits for ${usersProcessed} users`
		);

		return {
			success: true,
			result: {
				inserted_count: insertedCount,
				users_processed: usersProcessed,
				deleted_count: deletedCount
			}
		};
	} catch (error: unknown) {
		console.error('❌ Error in scheduled-detect-place-visits job:', error);
		throw error;
	}
}
