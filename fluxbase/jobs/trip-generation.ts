/**
 * Generate trips from GPS data using sleep-based detection
 *
 * Analyzes GPS data to detect trips based on sleep patterns, home address detection,
 * and movement analysis. Supports custom date ranges and home address overrides.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1200
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import { TripDetectionService } from '_shared/services/trip-detection.service';
import { UserProfileService } from '_shared/services/user-profile.service';
import { forwardGeocode } from '_shared/services/external/pelias.service';

import type { TripGenerationData, HomeAddress } from '_shared/types/trip-generation.types';
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

		// Configure services with the fluxbase client passed to the handler
		UserProfileService.setFluxbaseClient(fluxbaseService as any);

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
						},
						address: geocodeResult.address
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
			// Get user's stored home address from user_profiles table (using basic method for job context)
			const userProfile = await UserProfileService.getUserProfileBasic(userId);
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

		// Use trip detection service with the service role client to bypass RLS
		const tripDetectionService = new TripDetectionService(fluxbaseService);

		// Set custom home location if we have one (either from custom address or user profile)
		if (homeAddress && homeAddress.coordinates) {
			const customHomeLocation: Location = {
				coordinates: {
					lat: homeAddress.coordinates.lat,
					lng: homeAddress.coordinates.lng
				},
				address: {
					city: homeAddress.address?.city || homeAddress.address?.town || homeAddress.address?.village,
					country_code: homeAddress.address?.country
				}
			};
			tripDetectionService.setCustomHomeAddress(customHomeLocation);
			console.log(`✅ Set custom home location: ${homeAddress.display_name}`);
		}

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

		// Note: Trip embeddings are synced when trips are APPROVED (not when detected)
		// The sync-trip-embeddings job should be triggered from the UI/API when
		// user approves trips, since embeddings only make sense for approved trips.

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
