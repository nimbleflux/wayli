/**
 * Scheduled sync of trip embeddings for all users
 *
 * Runs daily at 5 AM to submit sync-trip-embeddings jobs for all users
 * who have approved/completed trips.
 *
 * @fluxbase:require-role admin
 * @fluxbase:timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 5 * * *
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
		safeReportProgress(job, 5, 'Fetching users with trips...');

		// Get all users with active, completed, or planned trips
		const { data: users, error: usersError } = await fluxbaseService
			.from('trips')
			.select('user_id')
			.in('status', ['active', 'completed', 'planned']);

		if (usersError) {
			console.error('Failed to fetch users:', usersError);
			return {
				success: false,
				error: `Failed to fetch users: ${usersError.message}`
			};
		}

		// Get unique user IDs
		const uniqueUserIds = [...new Set(users?.map((u) => u.user_id) || [])];
		console.log(`📊 Found ${uniqueUserIds.length} users with trips`);

		if (uniqueUserIds.length === 0) {
			safeReportProgress(job, 100, 'No users with trips found');
			return {
				success: true,
				result: {
					users_found: 0,
					jobs_submitted: 0,
					errors: 0
				}
			};
		}

		safeReportProgress(job, 15, `Submitting jobs for ${uniqueUserIds.length} users...`);

		// Submit sync-trip-embeddings job for each user (fire-and-forget)
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
					'sync-trip-embeddings',
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
				const progress = 15 + Math.round(((submitted + errors) / uniqueUserIds.length) * 80);
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

		console.log(`✅ Scheduled trip embeddings sync complete: ${submitted} jobs submitted, ${errors} errors`);

		return {
			success: errors === 0,
			result: {
				users_found: uniqueUserIds.length,
				jobs_submitted: submitted,
				errors
			}
		};
	} catch (error: unknown) {
		console.error('❌ Error in scheduled-sync-trip-embeddings job:', error);
		throw error;
	}
}
