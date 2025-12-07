/**
 * Detect trips using alternative trip detection method
 *
 * Alternative method for trip detection with different heuristics than the
 * sleep-based generation method.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 900
 */

import { TripDetectionService } from '../../web/src/lib/services/trip-detection.service';

import type { FluxbaseClient, JobUtils } from './types';

// Safe wrapper for reportProgress - logs if method doesn't exist
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
	const payload = context.payload;
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		console.log(`🗺️ Processing trip detection job ${jobId}`);
		console.log(`👤 Job created by user: ${userId}`);

		const startTime = Date.now();

		safeReportProgress(job, 10, '✈️ Starting trip detection...');

		// Use trip detection service
		const tripDetectionService = new TripDetectionService(
			process.env.FLUXBASE_BASE_URL!,
			process.env.FLUXBASE_SERVICE_ROLE_KEY!
		);

		// Set up progress tracking
		tripDetectionService.setProgressTracking(jobId, async (progress) => {
			safeReportProgress(job, progress.progress, progress.message);
		});

		// Use the trip detection service (will use default date range)
		const detectedTrips = await tripDetectionService.detectTrips(userId);

		console.log(`✅ Trip detection completed: ${detectedTrips.length} trips detected`);

		// Save detected trips to the database
		if (detectedTrips.length > 0) {
			console.log(`💾 Saving ${detectedTrips.length} detected trips to database...`);

			const { data: savedTrips, error: saveError } = await fluxbase
				.from('trips')
				.insert(detectedTrips)
				.select();

			if (saveError) {
				console.error('❌ Error saving trips to database:', saveError);
				throw new Error(`Failed to save trips to database: ${saveError.message}`);
			}

			console.log(`✅ Successfully saved ${savedTrips?.length || 0} trips to database`);
		}

		const totalTime = Date.now() - startTime;
		console.log(
			`✅ Trip detection completed: ${detectedTrips.length} trips detected in ${totalTime}ms`
		);

		return {
			success: true,
			result: {
				message: `Successfully detected ${detectedTrips.length} trips`,
				suggestedTripsCount: detectedTrips.length,
				totalTime: `${Math.round(totalTime / 1000)}s`
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in trip detection job:`, error);
		throw error;
	}
}
