// web/src/lib/services/queue/processors/reverse-geocoding-processor.service.ts

import { fluxbase } from '../fluxbase';
import { reverseGeocode } from '../../lib/services/external/nominatim.service';
import { JobQueueService } from '../job-queue.service.worker';
import {
	needsGeocoding,
	isRetryableError,
	createPermanentError,
	createRetryableError
} from '../../lib/utils/geocoding-utils';
import { checkJobCancellation } from '../../lib/utils/job-cancellation';
import {
	convertNominatimToGeoJSON,
	createGeocodeErrorGeoJSON,
	mergeGeocodingWithExisting
} from '../../lib/utils/geojson-converter';
import type { Feature } from 'geojson';

import type { Job } from '../../lib/types/job-queue.types';

export async function processReverseGeocodingMissing(job: Job): Promise<void> {
	console.log(`🌍 Processing reverse geocoding missing job ${job.id}`);

	// Show rate limiting settings
	const rateLimit = parseInt(process.env?.NOMINATIM_RATE_LIMIT || '1000', 10);
	const rateLimitEnabled = rateLimit > 0;
	const minInterval = rateLimit > 0 ? 1000 / rateLimit : 0;

	console.log(`⚙️ Rate limiting settings: ${rateLimitEnabled ? 'ENABLED' : 'DISABLED'}`);
	if (rateLimitEnabled) {
		console.log(`⚙️ Rate limit: ${rateLimit} requests/second (${minInterval}ms interval)`);
	} else {
		console.log(`⚙️ Rate limit: DISABLED (rateLimit=0)`);
	}

	const startTime = Date.now();
	const BATCH_SIZE = 100; // Process 100 records per batch for more frequent progress updates
	const userId = job.created_by;

	let totalProcessed = 0;
	let totalSuccess = 0;
	let totalErrors = 0;
	let totalScanned = 0; // count of all tracker_data rows scanned in this job
	let totalToScan = 0; // total tracker_data rows that will be scanned (with non-null location)

	// Moving-average window for ETA (based on scanned rows throughput)
	const RATE_WINDOW_MS = 15_000; // 15s window per requirement
	const scanSamples: Array<{ time: number; scanned: number }> = [];

	// Don't restore previous progress - always recalculate based on current batch progress
	// This ensures progress is accurate when a job is restarted

	try {
		await checkJobCancellation(job.id);

		// First, count total points that need geocoding (where country is null and geocode_error is null)
		console.log(`🔍 Checking for points that need geocoding...`);
		const { count: totalPointsNeedingGeocoding, error: countError } = await fluxbase
			.from('tracker_data')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', userId)
			.is('geocode->properties->>country', null)
			.is('geocode->properties->>geocode_error', null);

		if (countError) throw countError;

		totalToScan = totalPointsNeedingGeocoding || 0;
		const totalPoints = totalToScan;

		console.log(`📊 Found ${totalPoints.toLocaleString()} points that need geocoding`);

		// If no points need geocoding, exit early
		if (totalPoints === 0) {
			console.log('✅ No points need geocoding');
			await JobQueueService.updateJobProgress(job.id, 100, {
				totalProcessed: 0,
				totalSuccess: 0,
				totalErrors: 0,
				message: 'No tracker data points found needing geocoding',
				processedCount: 0,
				successCount: 0,
				errorCount: 0,
				totalCount: 0
			});
			return;
		}

		// Log the total count upfront
		console.log(
			`🌍 [REVERSE_GEOCODING] Found ${totalPoints.toLocaleString()} points needing geocoding. Starting processing...`
		);

		await JobQueueService.updateJobProgress(job.id, 0, {
			message: `Found ${totalPoints.toLocaleString()} tracker data points needing geocoding. Starting processing...`,
			totalProcessed: 0,
			totalSuccess: 0,
			totalErrors: 0,
			totalPoints,
			totalToScan: totalToScan || 0,
			processedCount: 0,
			successCount: 0,
			errorCount: 0,
			totalCount: totalPoints
		});

		// Fetch all points that need geocoding using pagination
		console.log(`🔍 Fetching all points that need geocoding...`);
		const allPointsNeedingGeocoding: Array<{
			user_id: string;
			location:
				| string
				| {
						type: string;
						coordinates: number[];
						crs?: { type: string; properties: { name: string } };
				  };
			geocode: unknown;
			recorded_at: string;
			tracker_type: string;
		}> = [];

		let offset = 0;
		const pageSize = 1000;

		while (true) {
			const { data: batch, error: fetchError } = await fluxbase
				.from('tracker_data')
				.select('user_id, location, geocode, recorded_at, tracker_type')
				.eq('user_id', userId)
				.is('geocode->properties->>country', null)
				.is('geocode->properties->>geocode_error', null)
				.order('recorded_at', { ascending: false })
				.range(offset, offset + pageSize - 1);

			if (fetchError) throw fetchError;

			if (!batch || batch.length === 0) {
				break; // No more data
			}

			allPointsNeedingGeocoding.push(...batch);
			offset += pageSize;

			// Safety check to prevent infinite loops
			if (offset > 1000000) {
				console.warn('⚠️ Too many records, stopping at 1M');
				break;
			}
		}

		console.log(`📊 Fetched ${allPointsNeedingGeocoding.length} points that need geocoding`);

		// Process all points that need geocoding
		const actualPointsToProcess = allPointsNeedingGeocoding?.length || 0;

		const result = await processTrackerDataInBatches(
			allPointsNeedingGeocoding || [],
			BATCH_SIZE,
			job.id,
			actualPointsToProcess,
			startTime,
			(scanned, processed, success, errors, batchIndex, totalBatches) => {
				totalScanned += scanned;
				totalProcessed += processed;
				totalSuccess += success;
				totalErrors += errors;

				// Progress is based on actual points processed, not database rows scanned
				// This gives accurate progress for the user since we're only processing points that need geocoding
				let progress: number;
				if (actualPointsToProcess === 0) {
					console.log(`⚠️ Warning: actualPointsToProcess is 0, setting progress to 100`);
					progress = 100;
				} else {
					const progressCalc = (totalProcessed / actualPointsToProcess) * 100;

					progress = Math.min(100, Math.round(progressCalc));
				}

				// Debug logging and progress update (every 100 records for more frequent updates)
				if (totalProcessed % 100 === 0 || progress % 5 === 0) {
					console.log(
						`📊 [PROGRESS] totalProcessed: ${totalProcessed}, actualPointsToProcess: ${actualPointsToProcess}, progress: ${progress}%, batch: ${batchIndex + 1}/${totalBatches}`
					);
				}

				// ETA based on moving-average processing throughput to avoid noisy estimates
				const now = Date.now();

				scanSamples.push({ time: now, scanned: totalScanned });
				// Trim samples to window
				while (scanSamples.length > 1 && scanSamples[0].time < now - RATE_WINDOW_MS) {
					scanSamples.shift();
				}

				// Minimum thresholds to ensure accurate ETA
				// Use adaptive thresholds based on total points to show ETA sooner
				const MIN_ELAPSED_SECONDS = 3; // Reduced from 5 to show ETA sooner
				const MIN_SAMPLES = 2; // Reduced from 3 - we only need 2 samples for a rate
				// Dynamic minimum based on total points: 50 points OR 2% of total, whichever is smaller
				const MIN_POINTS_PROCESSED = Math.min(50, Math.ceil(totalPoints * 0.02));
				const elapsedSeconds = (now - startTime) / 1000;

				let etaDisplay = 'Calculating...';

				// Only calculate ETA if we have enough data to make an accurate estimate
				if (
					elapsedSeconds >= MIN_ELAPSED_SECONDS &&
					scanSamples.length >= MIN_SAMPLES &&
					totalProcessed >= MIN_POINTS_PROCESSED
				) {
					let scanRate = 0;

					// Try to use moving average first (prioritizes recent performance)
					if (scanSamples.length >= 2) {
						const first = scanSamples[0];
						const last = scanSamples[scanSamples.length - 1];
						const deltaScanned = last.scanned - first.scanned;
						const deltaSeconds = (last.time - first.time) / 1000;
						// Reduced minimum interval from 2s to 1s for faster adaptation
						if (deltaSeconds >= 1 && deltaScanned >= 0) {
							scanRate = deltaScanned / deltaSeconds; // rows per second
							// Safety check to prevent Infinity
							if (!isFinite(scanRate)) {
								scanRate = 0;
							}
						}
					}

					// Fallback to global average if window is insufficient
					if (scanRate === 0 && elapsedSeconds >= MIN_ELAPSED_SECONDS) {
						scanRate = totalScanned > 0 ? totalScanned / elapsedSeconds : 0;
						// Safety check to prevent Infinity
						if (!isFinite(scanRate)) {
							scanRate = 0;
						}
					}

					// Calculate ETA if we have a valid scan rate
					if (scanRate > 0) {
						const remainingScans = Math.max(actualPointsToProcess - totalProcessed, 0);
						const remainingSeconds = Math.round(remainingScans / scanRate);
						etaDisplay = formatEta(remainingSeconds);
					}
				}

				JobQueueService.updateJobProgress(job.id, progress, {
					totalProcessed,
					totalSuccess,
					totalErrors,
					totalPoints,
					totalScanned,
					totalToScan: totalToScan || 0,
					currentBatch: batchIndex + 1,
					totalBatches: totalBatches,
					message: `Processed ${totalProcessed.toLocaleString()}/${actualPointsToProcess.toLocaleString()} points (${totalErrors} errors)`,
					processedCount: totalProcessed,
					successCount: totalSuccess,
					errorCount: totalErrors,
					totalCount: actualPointsToProcess,
					estimatedTimeRemaining: etaDisplay
				});
			}
		);

		console.log(
			`✅ Reverse geocoding completed: ${totalSuccess} successful, ${totalErrors} errors out of ${totalProcessed} total`
		);

		await JobQueueService.updateJobProgress(job.id, 100, {
			totalProcessed,
			totalSuccess,
			totalErrors,
			totalPoints,
			message: `✅ Reverse geocoding completed: ${totalSuccess.toLocaleString()} successful, ${totalErrors.toLocaleString()} errors out of ${totalProcessed.toLocaleString()} total`,
			processedCount: totalProcessed,
			successCount: totalSuccess,
			errorCount: totalErrors,
			totalCount: totalPoints,
			completed: true
		});
	} catch (error: unknown) {
		if (error instanceof Error && error.message === 'Job was cancelled') {
			console.log(`🛑 Reverse geocoding job ${job.id} was cancelled`);
			return;
		}
		console.error(`❌ Error in reverse geocoding missing job:`, error);
		throw error;
	}
}

async function processTrackerDataInBatches(
	points: Array<{
		user_id: string;
		location:
			| string
			| {
					type: string;
					coordinates: number[];
					crs?: { type: string; properties: { name: string } };
			  };
		geocode: unknown;
		recorded_at: string;
		tracker_type: string;
	}>,
	batchSize: number,
	jobId: string,
	totalPoints: number,
	startTime: number,
	progressCallback: (
		scanned: number,
		processed: number,
		success: number,
		errors: number,
		batchIndex: number,
		totalBatches: number
	) => void
): Promise<{ processed: number; success: number; errors: number }> {
	let totalProcessed = 0;

	// Process requests sequentially to respect rate limits
	console.log(`🚀 Processing geocoding requests sequentially to respect rate limits`);

	// Process all points in batches
	console.log(`📊 Processing ${points.length} points that need geocoding`);

	if (!points || points.length === 0) {
		console.log('✅ No points need geocoding');
		return { processed: 0, success: 0, errors: 0 };
	}

	const totalPointsToProcess = points.length;
	console.log(`📊 Found ${totalPointsToProcess.toLocaleString()} points to process in total`);

	// Process in batches
	const totalBatches = Math.ceil(totalPointsToProcess / batchSize);
	console.log(`📊 Processing ${totalBatches} batches of ${batchSize} points each`);

	for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
		await checkJobCancellation(jobId);

		const startIndex = batchIndex * batchSize;
		const batch = points.slice(startIndex, startIndex + batchSize);

		if (batch.length > 0) {
			const results = await processPointsSequentially(batch, jobId);
			console.log(
				`📊 Batch ${batchIndex + 1}/${totalBatches} completed: ${results.processed} processed, ${results.success} successful, ${results.errors} errors`
			);

			totalProcessed += results.processed;

			// Emit progress with correct batch information
			progressCallback(
				batch.length,
				results.processed,
				results.success,
				results.errors,
				batchIndex,
				totalBatches
			);
		}
	}

	console.log(
		`✅ Finished processing all batches. Total processed: ${totalProcessed.toLocaleString()}`
	);

	return { processed: totalProcessed, success: 0, errors: 0 };
}

async function processPointsSequentially(
	points: Array<{
		user_id: string;
		location:
			| string
			| {
					type: string;
					coordinates: number[];
					crs?: { type: string; properties: { name: string } };
			  };
		geocode: unknown;
		recorded_at: string;
		tracker_type: string;
		raw_data?: unknown;
	}>,
	jobId: string
): Promise<{ processed: number; success: number; errors: number }> {
	let processed = 0;
	let success = 0;
	let errors = 0;

	// Process each point sequentially
	for (let i = 0; i < points.length; i++) {
		await checkJobCancellation(jobId);

		const point = points[i];
		const result = await processSinglePoint(point);

		processed++;
		if (result) {
			success++;
		} else {
			errors++;
		}

		// Log progress every 100 points
		if ((i + 1) % 100 === 0) {
			console.log(`📊 Processed ${i + 1}/${points.length} points in current batch`);
		}
	}

	return { processed, success, errors };
}

async function processSinglePoint(point: {
	user_id: string;
	location:
		| string
		| { type: string; coordinates: number[]; crs?: { type: string; properties: { name: string } } };
	geocode: unknown;
	recorded_at: string;
	tracker_type: string;
}): Promise<boolean> {
	try {
		let lat: number, lon: number;
		if (point.location && typeof point.location === 'object' && 'coordinates' in point.location) {
			const coords = (point.location as { coordinates: number[] }).coordinates;
			if (!Array.isArray(coords) || coords.length < 2) {
				console.warn(`⚠️ Invalid coordinates format for tracker data point:`, point.location);
				await updateGeocodeWithError(point, 'Invalid coordinates format');
				return false;
			}
			[lon, lat] = coords;
		} else if (typeof point.location === 'string') {
			const locationMatch = point.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
			if (!locationMatch) {
				console.warn(`⚠️ Invalid location format for tracker data point: ${point.location}`);
				await updateGeocodeWithError(point, 'Invalid location format');
				return false;
			}
			[lon, lat] = locationMatch.slice(1).map(Number);
		} else {
			console.warn(`⚠️ Unknown location format for tracker data point:`, point.location);
			await updateGeocodeWithError(point, 'Unknown location format');
			return false;
		}

		if (
			typeof lat !== 'number' ||
			typeof lon !== 'number' ||
			isNaN(lat) ||
			isNaN(lon) ||
			lat < -90 ||
			lat > 90 ||
			lon < -180 ||
			lon > 180
		) {
			console.warn(`⚠️ Invalid coordinates for tracker data point: lat=${lat}, lon=${lon}`);
			await updateGeocodeWithError(point, `Invalid coordinates: lat=${lat}, lon=${lon}`);
			return false;
		}

		const geocodeResult = await reverseGeocode(lat, lon);

		// Merge new geocoding data with existing properties
		const mergedGeocodeGeoJSON = mergeGeocodingWithExisting(point.geocode, lat, lon, geocodeResult);

		// Extract country_code from the geocoded address for efficient querying
		let extractedCountryCode = null;
		if (geocodeResult.address && typeof geocodeResult.address === 'object') {
			const address = geocodeResult.address as Record<string, string>;
			extractedCountryCode = address.country_code || address.country;
		}

		// Add country_code to the geocode properties for efficient querying
		if (extractedCountryCode) {
			(mergedGeocodeGeoJSON.properties as Record<string, unknown>).country_code =
				extractedCountryCode;
		}

		const { error: updateError } = await (fluxbase as any)
			.from('tracker_data')
			.update({
				geocode: mergedGeocodeGeoJSON as unknown as Record<string, unknown>,
				updated_at: new Date().toISOString()
			})
			.eq('user_id', point.user_id)
			.eq('recorded_at', point.recorded_at);

		if (updateError) {
			console.error(`❌ Database update error:`, updateError);
			await updateGeocodeWithError(point, `Database update error: ${updateError.message}`);
			return false;
		}

		return true;
	} catch (error: unknown) {
		console.error(`❌ Error processing tracker data point:`, (error as Error).message);
		await updateGeocodeWithError(point, `Geocoding error: ${(error as Error).message}`);

		return false;
	}
}

async function updateGeocodeWithError(
	point: {
		user_id: string;
		location:
			| string
			| {
					type: string;
					coordinates: number[];
					crs?: { type: string; properties: { name: string } };
			  };
		geocode: unknown;
		recorded_at: string;
		tracker_type: string;
		raw_data?: unknown;
	},
	errorMessage: string
): Promise<void> {
	try {
		// Extract coordinates from the point location
		let lat: number, lon: number;
		if (point.location && typeof point.location === 'object' && 'coordinates' in point.location) {
			const coords = (point.location as { coordinates: number[] }).coordinates;
			if (Array.isArray(coords) && coords.length >= 2) {
				[lon, lat] = coords;
			} else {
				console.error(`❌ Invalid coordinates in updateGeocodeWithError:`, point.location);
				return;
			}
		} else if (typeof point.location === 'string') {
			const locationMatch = point.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
			if (locationMatch) {
				[lon, lat] = locationMatch.slice(1).map(Number);
			} else {
				console.error(`❌ Invalid location format in updateGeocodeWithError: ${point.location}`);
				return;
			}
		} else {
			console.error(`❌ Unknown location format in updateGeocodeWithError:`, point.location);
			return;
		}

		// Create GeoJSON error feature
		const errorGeoJSON = createGeocodeErrorGeoJSON(lat, lon, errorMessage);

		// Add geocode_error field and retryable/permanent flags based on error type
		const retryable = isRetryableError({ error: true, error_message: errorMessage });
		(errorGeoJSON.properties as Record<string, unknown>).geocode_error = errorMessage;
		if (retryable) {
			(errorGeoJSON.properties as Record<string, unknown>).retryable = true;
		} else {
			(errorGeoJSON.properties as Record<string, unknown>).permanent = true;
		}

		const { error: updateError } = await (fluxbase as any)
			.from('tracker_data')
			.update({
				geocode: errorGeoJSON as unknown as Record<string, unknown>,
				updated_at: new Date().toISOString()
			})
			.eq('user_id', point.user_id)
			.eq('recorded_at', point.recorded_at);
		if (updateError) {
			console.error(`❌ Failed to update geocode with error:`, updateError);
		}
		// Only log occasionally for successful error updates
		else if (Math.random() < 0.01) {
			// Log ~1% of the time
			console.log(
				`⚠️ Updated geocode with ${retryable ? 'retryable' : 'permanent'} error: ${errorMessage}`
			);
		}
	} catch (error) {
		console.error(`❌ Error updating geocode with error:`, error);
	}
}

function formatEta(seconds: number): string {
	if (!seconds || seconds <= 0 || !isFinite(seconds)) return 'Calculating...';
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}m ${s}s`;
	}
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	return `${h}h ${m}m ${s}s`;
}
