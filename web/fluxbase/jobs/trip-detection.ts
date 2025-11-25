/**
 * Detect trips using alternative trip detection method
 *
 * Alternative method for trip detection with different heuristics than the
 * sleep-based generation method.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 900
 */

import { TripDetectionService } from '../../src/lib/services/trip-detection.service';

export async function handler(request: Request) {
	const context = Fluxbase.getJobContext();
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

		Fluxbase.reportProgress(10, 'Starting trip detection...');

		// Use trip detection service
		const tripDetectionService = new TripDetectionService(
			process.env.FLUXBASE_BASE_URL!,
			process.env.FLUXBASE_SERVICE_ROLE_KEY!
		);

		// Set up progress tracking
		tripDetectionService.setProgressTracking(jobId, async (progress) => {
			Fluxbase.reportProgress(progress.progress, progress.message);
		});

		// Use the trip detection service (will use default date range)
		const detectedTrips = await tripDetectionService.detectTrips(userId);

		console.log(`✅ Trip detection completed: ${detectedTrips.length} trips detected`);

		// Save detected trips to the database
		if (detectedTrips.length > 0) {
			console.log(`💾 Saving ${detectedTrips.length} detected trips to database...`);

			const { data: savedTrips, error: saveError } = await Fluxbase.database().from('trips')
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
