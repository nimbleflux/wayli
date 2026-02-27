/**
 * Clear and rebuild place visits for all users or a specific user
 *
 * This job deletes all place visit records and watermarks, then triggers
 * the incremental detection RPC to rebuild from tracker data.
 *
 * @fluxbase:require-role admin
 * @fluxbase:timeout 3600
 * @fluxbase:progress-timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type { FluxbaseClient, JobUtils } from './types';

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

interface ClearAndRebuildPayload {
	user_id?: string | null;
}

export async function handler(
	req: Request,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	try {
		// Parse payload to get optional user_id
		let payload: ClearAndRebuildPayload = {};
		try {
			payload = await req.json();
		} catch {
			// No payload or invalid JSON, use defaults
		}

		const userId = payload.user_id || null;
		const targetDescription = userId ? `user ${userId}` : 'all users';

		safeReportProgress(job, 5, `Starting clear and rebuild for ${targetDescription}...`);

		let deletedCount = 0;

		// Step 1: Clear place visits
		if (userId) {
			// Clear for specific user
			safeReportProgress(job, 10, `Deleting place visits for user ${userId}...`);

			const { error: deleteError, count } = await fluxbaseService
				.from('place_visits')
				.delete()
				.eq('user_id', userId);

			if (deleteError) {
				console.error('❌ Failed to delete place visits:', deleteError);
				return {
					success: false,
					error: `Failed to delete place visits: ${deleteError.message}`
				};
			}

			deletedCount = count || 0;

			// Delete user's watermark state
			const { error: stateError } = await fluxbaseService
				.from('place_visits_state')
				.delete()
				.eq('user_id', userId);

			if (stateError) {
				console.error('❌ Failed to delete watermark state:', stateError);
				return {
					success: false,
					error: `Failed to delete watermark state: ${stateError.message}`
				};
			}
		} else {
			// Clear for all users
			safeReportProgress(job, 10, 'Deleting all place visits...');

			// Get count before truncating
			const { count } = await fluxbaseService
				.from('place_visits')
				.select('*', { count: 'exact', head: true });

			deletedCount = count || 0;

			// Truncate place_visits table (faster than DELETE for all rows)
			const { error: truncateError } = await fluxbaseService.rpc('truncate_place_visits');

			if (truncateError) {
				// Fallback to DELETE if truncate RPC doesn't exist
				const { error: deleteError } = await fluxbaseService.from('place_visits').delete().neq('id', '00000000-0000-0000-0000-000000000000');

				if (deleteError) {
					console.error('❌ Failed to clear place visits:', deleteError);
					return {
						success: false,
						error: `Failed to clear place visits: ${deleteError.message}`
					};
				}
			}

			// Reset watermark states: delete per-user rows, reset global
			safeReportProgress(job, 20, 'Resetting watermark states...');

			// Delete per-user watermark states
			const { error: deleteStateError } = await fluxbaseService
				.from('place_visits_state')
				.delete()
				.not('user_id', 'is', null);

			if (deleteStateError) {
				console.error('❌ Failed to delete per-user watermark states:', deleteStateError);
				return {
					success: false,
					error: `Failed to delete watermark states: ${deleteStateError.message}`
				};
			}

			// Reset global watermark state
			const { error: resetGlobalError } = await fluxbaseService
				.from('place_visits_state')
				.update({ last_processed_at: null, updated_at: new Date().toISOString() })
				.is('user_id', null);

			if (resetGlobalError) {
				console.error('❌ Failed to reset global watermark:', resetGlobalError);
				// Non-fatal, continue with rebuild
			}
		}

		safeReportProgress(job, 30, `Deleted ${deletedCount} place visits. Starting rebuild...`);

		// Step 2: Invoke incremental detection to rebuild (async)
		const { data, error } = await (fluxbaseService.rpc as any).invoke(
			'detect-place-visits-incremental',
			{ user_id: userId },
			{ namespace: 'wayli', async: true }
		);

		if (error) {
			console.error('❌ Failed to start place visit rebuild:', error);
			return {
				success: false,
				error: `Failed to start place visit rebuild: ${error.message}`
			};
		}

		const executionId = data?.execution_id;
		if (!executionId) {
			console.warn('No execution ID returned from RPC');
			return {
				success: false,
				error: 'RPC started but no execution ID returned'
			};
		}

		console.log(`RPC started with execution ID: ${executionId}`);

		// Poll for RPC completion while keeping job alive
		let execution;
		do {
			await sleep(5000); // Wait 5 seconds between polls

			const { data: status } = await (fluxbaseService.rpc as any).getStatus(executionId);
			execution = status;

			// This resets the job's progress timeout (null = don't update percentage)
			(job.reportProgress as (percent: number | null, message: string) => void)(
				null,
				`Rebuilding place visits: ${execution.status}`
			);
		} while (execution.status === 'pending' || execution.status === 'running');

		if (execution.status === 'failed') {
			return {
				success: false,
				error: `Place visit rebuild failed: ${execution.error}`
			};
		}

		const result = execution.result?.[0] || execution.result || {};
		const insertedCount = result.inserted_count || 0;
		const usersProcessed = result.users_processed || 0;

		safeReportProgress(
			job,
			100,
			`Completed: Deleted ${deletedCount} visits, rebuilt ${insertedCount} visits for ${usersProcessed} user(s)`
		);

		console.log(
			`✅ Clear and rebuild complete: Deleted ${deletedCount}, rebuilt ${insertedCount} visits for ${usersProcessed} users`
		);

		return {
			success: true,
			result: {
				deleted_count: deletedCount,
				inserted_count: insertedCount,
				users_processed: usersProcessed,
				user_id: userId
			}
		};
	} catch (error: unknown) {
		console.error('❌ Error in clear-and-rebuild-place-visits job:', error);
		throw error;
	}
}
