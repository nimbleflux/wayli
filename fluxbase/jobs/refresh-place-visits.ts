/**
 * Refresh Place Visits Materialized View
 *
 * Refreshes the place_visits materialized view which detects POI visits
 * from tracker_data.geocode.nearby_pois. Should be scheduled to run hourly.
 *
 * @fluxbase:require-role service_role
 * @fluxbase:timeout 600
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
	req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const jobId = context.job_id;

	try {
		console.log(`🔄 Starting place_visits materialized view refresh (job ${jobId})`);
		safeReportProgress(job, 0, '🔄 Starting materialized view refresh...');

		const startTime = Date.now();

		// Call the refresh function using service role client
		// The function uses REFRESH MATERIALIZED VIEW CONCURRENTLY for non-blocking refresh
		const { error } = await fluxbaseService.rpc('refresh_place_visits');

		if (error) {
			console.error(`❌ Error refreshing place_visits:`, error);
			throw new Error(`Failed to refresh place_visits: ${error.message}`);
		}

		const duration = Date.now() - startTime;
		console.log(`✅ place_visits materialized view refreshed in ${duration}ms`);

		safeReportProgress(job, 100, `✅ Materialized view refreshed in ${Math.round(duration / 1000)}s`);

		return {
			success: true,
			result: {
				message: 'place_visits materialized view refreshed successfully',
				duration_ms: duration
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in refresh-place-visits job:`, error);
		throw error;
	}
}
