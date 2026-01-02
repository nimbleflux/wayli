/**
 * Detect trips using alternative trip detection method
 *
 * Alternative method for trip detection with different heuristics than the
 * sleep-based generation method.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 900
 */

import { TripDetectionService } from '_shared/services/trip-detection.service';
import { forwardGeocode } from '_shared/services/external/pelias.service';

import type { TripGenerationData } from '_shared/types/trip-generation.types';
import type { Location } from '_shared/services/trip-detection.service';
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
	const payload = context.payload as Partial<TripGenerationData>;
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

		// Extract payload options
		const { startDate, endDate, useCustomHomeAddress, customHomeAddress } = payload || {};

		console.log(`📅 Job parameters:`);
		console.log(`  - startDate: ${startDate || 'not specified'}`);
		console.log(`  - endDate: ${endDate || 'not specified'}`);
		console.log(`  - useCustomHomeAddress: ${useCustomHomeAddress || false}`);
		console.log(`  - customHomeAddress: ${customHomeAddress || 'not specified'}`);

		safeReportProgress(job, 5, '✈️ Starting trip detection...');

		// Use trip detection service with the provided Fluxbase client
		const tripDetectionService = new TripDetectionService(fluxbase);

		// Handle custom home address if specified
		if (useCustomHomeAddress && customHomeAddress) {
			console.log(`🏠 Geocoding custom home address: ${customHomeAddress}`);
			safeReportProgress(job, 8, `🏠 Geocoding custom home address: ${customHomeAddress}...`);

			try {
				const geocodeResult = await forwardGeocode(customHomeAddress);
				if (geocodeResult) {
					const customHomeLocation: Location = {
						coordinates: {
							lat: geocodeResult.lat,
							lng: geocodeResult.lon
						},
						address: {
							city: geocodeResult.address?.city || geocodeResult.address?.town || geocodeResult.address?.village,
							country_code: geocodeResult.address?.country_code
						}
					};
					tripDetectionService.setCustomHomeAddress(customHomeLocation);
					console.log(
						`✅ Successfully geocoded custom home address: ${geocodeResult.display_name} (${geocodeResult.lat}, ${geocodeResult.lon})`
					);
				} else {
					console.warn(`⚠️ Could not geocode custom home address: ${customHomeAddress}`);
				}
			} catch (error) {
				console.error(`❌ Error geocoding custom home address: ${customHomeAddress}`, error);
			}
		}

		safeReportProgress(job, 10, '✈️ Detecting trips...');

		// Set up progress tracking
		tripDetectionService.setProgressTracking(jobId, async (progress) => {
			safeReportProgress(job, progress.progress, progress.message);
		});

		// Use the trip detection service with optional date range from payload
		const detectedTrips = await tripDetectionService.detectTrips(userId, startDate, endDate);

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

			// Chain: Submit sync-trip-embeddings job for this user
			console.log(`🔗 Submitting sync-trip-embeddings job for user ${userId}...`);
			try {
				const { error: submitError } = await fluxbaseService.jobs.submit(
					'sync-trip-embeddings',
					{},
					{
						namespace: 'wayli',
						priority: 6,
						onBehalfOf: {
							user_id: userId,
							user_email: context.user?.email || '',
							user_role: context.user?.role || 'authenticated'
						}
					}
				);

				if (submitError) {
					console.warn(`⚠️ Failed to submit sync-trip-embeddings job: ${submitError.message}`);
				} else {
					console.log(`✅ sync-trip-embeddings job submitted for user ${userId}`);
				}
			} catch (chainError) {
				console.warn(`⚠️ Error submitting sync-trip-embeddings job:`, chainError);
			}
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
