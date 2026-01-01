/**
 * Scheduled nightly incremental refresh of place_visits
 *
 * Runs daily at 3 AM to:
 * 1. Run incremental place visit detection (only new data since last refresh)
 * 2. Submit sync-poi-embeddings jobs for all users with place visit data
 *
 * The incremental approach only processes tracker_data since the last refresh,
 * making it much more efficient than a full materialized view refresh.
 *
 * Each user's sync-poi-embeddings job will chain to compute-user-preferences.
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
		safeReportProgress(job, 5, 'Running incremental place visit detection...');

		// Step 1: Run incremental place visit detection (processes only new data)
		const { data: refreshResult, error: refreshError } = await (fluxbaseService.rpc as any).invoke(
			'refresh-place-visits',
			{},
			{ namespace: 'wayli' }
		);

		if (refreshError) {
			console.error('Failed to run incremental place visit detection:', refreshError);
			return {
				success: false,
				error: `Failed to refresh place_visits: ${refreshError.message}`
			};
		}

		console.log('Place visits incrementally refreshed:', refreshResult);
		safeReportProgress(job, 20, 'Place visits refreshed. Fetching users...');

		// Step 2: Get all users with place visit data
		const { data: users, error: usersError } = await fluxbaseService
			.from('place_visits')
			.select('user_id')
			.limit(10000);

		if (usersError) {
			console.error('Failed to fetch users:', usersError);
			return {
				success: false,
				error: `Failed to fetch users: ${usersError.message}`
			};
		}

		// Get unique user IDs
		const uniqueUserIds = [...new Set(users?.map((u) => u.user_id) || [])];
		console.log(`Found ${uniqueUserIds.length} users with place visit data`);

		if (uniqueUserIds.length === 0) {
			safeReportProgress(job, 100, 'No users with place visit data found');
			return {
				success: true,
				result: {
					users_found: 0,
					jobs_submitted: 0,
					errors: 0
				}
			};
		}

		safeReportProgress(job, 30, `Submitting jobs for ${uniqueUserIds.length} users...`);

		// Step 3: Submit sync-poi-embeddings job for each user (fire-and-forget)
		let submitted = 0;
		let errors = 0;

		for (const userId of uniqueUserIds) {
			try {
				// Get user profile for role info
				const { data: profile } = await fluxbaseService
					.from('user_profiles')
					.select('role')
					.eq('id', userId)
					.single();

				// Submit job on behalf of this user
				const { error: submitError } = await fluxbaseService.jobs.submit(
					'sync-poi-embeddings',
					{},
					{
						namespace: 'wayli',
						priority: 5,
						onBehalfOf: {
							user_id: userId,
							user_email: '', // Not needed for job execution
							user_role: profile?.role || 'authenticated'
						}
					}
				);

				if (submitError) {
					console.warn(`Failed to submit job for user ${userId}:`, submitError.message);
					errors++;
				} else {
					submitted++;
				}
			} catch (err) {
				console.error(`Error processing user ${userId}:`, err);
				errors++;
			}

			// Update progress periodically
			if (submitted % 10 === 0 || errors % 10 === 0) {
				const progress = 30 + Math.round(((submitted + errors) / uniqueUserIds.length) * 65);
				safeReportProgress(
					job,
					progress,
					`Submitted ${submitted} jobs, ${errors} errors (${submitted + errors}/${uniqueUserIds.length})`
				);
			}
		}

		safeReportProgress(
			job,
			100,
			`Completed: ${submitted} jobs submitted, ${errors} errors`
		);

		console.log(`Scheduled incremental refresh complete: ${submitted} jobs submitted, ${errors} errors`);

		return {
			success: errors === 0,
			result: {
				users_found: uniqueUserIds.length,
				jobs_submitted: submitted,
				errors
			}
		};
	} catch (error: unknown) {
		console.error('Error in scheduled-refresh-place-visits job:', error);
		throw error;
	}
}
