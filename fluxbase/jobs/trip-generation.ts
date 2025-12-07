/**
 * Generate trips from GPS data using sleep-based detection
 *
 * Analyzes GPS data to detect trips based on sleep patterns, home address detection,
 * and movement analysis. Supports custom date ranges and home address overrides.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1200
 */

import { TripDetectionService } from '../../web/src/lib/services/trip-detection.service';
import { UserProfileService } from '../../web/src/lib/services/user-profile.service';
import { forwardGeocode } from '../../web/src/lib/services/external/pelias.service';

import type { TripGenerationData, HomeAddress } from '../../web/src/lib/types/trip-generation.types';
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
	const payload = context.payload as TripGenerationData;
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		console.log(`🗺️ Processing sleep-based trip generation job ${jobId}`);
		console.log(`👤 Job created by user: ${userId}`);
		console.log(`📋 Job data:`, JSON.stringify(payload, null, 2));

		const startTime = Date.now();

		const {
			startDate,
			endDate,
			useCustomHomeAddress,
			customHomeAddress,
			minTripDurationHours,
			minDataPointsPerDay
		} = payload;

		console.log(`📅 Job parameters:`);
		console.log(`  - startDate: ${startDate || 'not specified'}`);
		console.log(`  - endDate: ${endDate || 'not specified'}`);
		console.log(`  - useCustomHomeAddress: ${useCustomHomeAddress}`);
		console.log(`  - customHomeAddress: ${customHomeAddress || 'not specified'}`);

		safeReportProgress(
			job,
			5,
			'✈️ Determining available date ranges for sleep-based trip generation...'
		);

		// Get user's home address
		let homeAddress: HomeAddress | null = null;
		if (useCustomHomeAddress && customHomeAddress) {
			// Geocode the custom home address to get coordinates
			console.log(`🏠 Geocoding custom home address: ${customHomeAddress}`);

			safeReportProgress(job, 8, `🏠 Geocoding custom home address: ${customHomeAddress}...`);

			try {
				const geocodeResult = await forwardGeocode(customHomeAddress);
				if (geocodeResult) {
					homeAddress = {
						display_name: geocodeResult.display_name,
						coordinates: {
							lat: geocodeResult.lat,
							lng: geocodeResult.lon
						}
					};
					console.log(
						`✅ Successfully geocoded custom home address: ${geocodeResult.display_name} (${geocodeResult.lat}, ${geocodeResult.lon})`
					);
				} else {
					console.warn(`⚠️ Could not geocode custom home address: ${customHomeAddress}`);
					homeAddress = {
						display_name: customHomeAddress,
						coordinates: undefined
					};
				}
			} catch (error) {
				console.error(`❌ Error geocoding custom home address: ${customHomeAddress}`, error);
				homeAddress = {
					display_name: customHomeAddress,
					coordinates: undefined
				};
			}
		} else {
			// Get user's stored home address from user_profiles table
			const userProfile = await UserProfileService.getUserProfile(userId);
			if (userProfile?.home_address) {
				if (typeof userProfile.home_address === 'string') {
					homeAddress = {
						display_name: userProfile.home_address,
						coordinates: undefined
					};
				} else {
					homeAddress = {
						display_name: userProfile.home_address.display_name,
						coordinates: userProfile.home_address.coordinates,
						address: userProfile.home_address.address
					};
				}
			}
		}

		safeReportProgress(
			job,
			10,
			`🏠 Retrieved home address, fetching GPS data for sleep pattern analysis...`
		);

		// Configure UserProfileService for worker environment
		UserProfileService.useNodeEnvironmentConfig();

		// Use trip detection service
		const tripDetectionService = new TripDetectionService(
			process.env.FLUXBASE_BASE_URL!,
			process.env.FLUXBASE_SERVICE_ROLE_KEY!
		);

		// Set up progress tracking for trip detection with ETA calculation
		const progressSamples: Array<{ time: number; progress: number }> = [];
		const PROGRESS_WINDOW_MS = 15_000;

		const calculateEta = (currentProgress: number): number | null => {
			const now = Date.now();

			if (currentProgress < 5) {
				return null;
			}

			progressSamples.push({ time: now, progress: currentProgress });

			while (progressSamples.length > 0 && now - progressSamples[0].time > PROGRESS_WINDOW_MS) {
				progressSamples.shift();
			}

			if (progressSamples.length < 2 || currentProgress <= 0) {
				return null;
			}

			const oldestSample = progressSamples[0];
			const progressDelta = currentProgress - oldestSample.progress;
			const timeDelta = now - oldestSample.time;

			if (progressDelta <= 0 || timeDelta <= 0) {
				return null;
			}

			const progressRate = progressDelta / timeDelta;
			const remainingProgress = 100 - currentProgress;
			const etaMs = remainingProgress / progressRate;

			return Math.round(etaMs / 1000);
		};

		const formatEta = (seconds: number | null): string => {
			if (!seconds || seconds <= 0) return 'Calculating...';
			const cappedSeconds = Math.min(seconds, 86400);
			const s = Math.floor(cappedSeconds % 60);
			const m = Math.floor((cappedSeconds / 60) % 60);
			const h = Math.floor(cappedSeconds / 3600);
			if (h > 0) return `${h}h ${m}m ${s}s`;
			if (m > 0) return `${m}m ${s}s`;
			return `${s}s`;
		};

		tripDetectionService.setProgressTracking(jobId, async (progress) => {
			const eta = calculateEta(progress.progress);
			safeReportProgress(
				job,
				progress.progress,
				`${progress.message}${eta ? ` - ETA: ${formatEta(eta)}` : ''}`
			);
		});

		// Use the new trip detection V2 service with the determined date ranges
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
		}

		const totalTime = Date.now() - startTime;
		console.log(
			`✅ Trip generation completed: ${detectedTrips.length} trips detected in ${totalTime}ms`
		);

		return {
			success: true,
			result: {
				message: `Trip generation completed: ${detectedTrips.length} trips detected`,
				tripsGenerated: detectedTrips.length,
				totalTime: `${Math.round(totalTime / 1000)}s`
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in sleep-based trip generation job:`, error);
		throw error;
	}
}
