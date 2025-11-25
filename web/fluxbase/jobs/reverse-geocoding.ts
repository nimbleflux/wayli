/**
 * Batch reverse geocode missing location data
 *
 * Processes GPS points that don't have address information, calling the Nominatim
 * API to reverse geocode coordinates into addresses. Respects rate limits and
 * provides detailed progress tracking.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 7200
 * @fluxbase:allow-net true
 */

import { reverseGeocode } from '../../src/lib/services/external/nominatim.service';
import { isRetryableError } from '../../src/lib/utils/geocoding-utils';
import {
	createGeocodeErrorGeoJSON,
	mergeGeocodingWithExisting
} from '../../src/lib/utils/geojson-converter';

export async function handler(request: Request) {
	const context = Fluxbase.getJobContext();
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		console.log(`🌍 Processing reverse geocoding missing job ${jobId}`);

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
		const BATCH_SIZE = 100;

		let totalProcessed = 0;
		let totalSuccess = 0;
		let totalErrors = 0;
		let totalScanned = 0;

		// Moving-average window for ETA
		const RATE_WINDOW_MS = 15_000;
		const scanSamples: Array<{ time: number; scanned: number }> = [];

		// First, count total points that need geocoding
		console.log(`🔍 Checking for points that need geocoding...`);
		const { count: totalPointsNeedingGeocoding, error: countError } = await Fluxbase.database().from(
			'tracker_data'
		)
			.select('*', { count: 'exact', head: true })
			.eq('user_id', userId)
			.is('geocode->properties->>country', null)
			.is('geocode->properties->>geocode_error', null);

		if (countError) throw countError;

		const totalToScan = totalPointsNeedingGeocoding || 0;
		const totalPoints = totalToScan;

		console.log(`📊 Found ${totalPoints.toLocaleString()} points that need geocoding`);

		// If no points need geocoding, exit early
		if (totalPoints === 0) {
			console.log('✅ No points need geocoding');
			Fluxbase.reportProgress(100, 'No tracker data points found needing geocoding');
			return {
				success: true,
				result: {
					message: 'No points need geocoding',
					totalProcessed: 0,
					totalSuccess: 0,
					totalErrors: 0
				}
			};
		}

		console.log(
			`🌍 [REVERSE_GEOCODING] Found ${totalPoints.toLocaleString()} points needing geocoding. Starting processing...`
		);

		Fluxbase.reportProgress(
			0,
			`Found ${totalPoints.toLocaleString()} tracker data points needing geocoding. Starting processing...`
		);

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
			const { data: batch, error: fetchError } = await Fluxbase.database().from('tracker_data')
				.select('user_id, location, geocode, recorded_at, tracker_type')
				.eq('user_id', userId)
				.is('geocode->properties->>country', null)
				.is('geocode->properties->>geocode_error', null)
				.order('recorded_at', { ascending: false })
				.range(offset, offset + pageSize - 1);

			if (fetchError) throw fetchError;

			if (!batch || batch.length === 0) {
				break;
			}

			allPointsNeedingGeocoding.push(...batch);
			offset += pageSize;

			if (offset > 1000000) {
				console.warn('⚠️ Too many records, stopping at 1M');
				break;
			}
		}

		console.log(`📊 Fetched ${allPointsNeedingGeocoding.length} points that need geocoding`);

		const actualPointsToProcess = allPointsNeedingGeocoding?.length || 0;
		const totalBatches = Math.ceil(actualPointsToProcess / BATCH_SIZE);

		console.log(`📊 Processing ${totalBatches} batches of ${BATCH_SIZE} points each`);

		// Process in batches
		for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
			const startIndex = batchIndex * BATCH_SIZE;
			const batch = allPointsNeedingGeocoding.slice(startIndex, startIndex + BATCH_SIZE);

			if (batch.length > 0) {
				const results = await processPointsSequentially(batch);
				console.log(
					`📊 Batch ${batchIndex + 1}/${totalBatches} completed: ${results.processed} processed, ${results.success} successful, ${results.errors} errors`
				);

				totalScanned += batch.length;
				totalProcessed += results.processed;
				totalSuccess += results.success;
				totalErrors += results.errors;

				// Calculate progress
				const progress =
					actualPointsToProcess === 0
						? 100
						: Math.min(100, Math.round((totalProcessed / actualPointsToProcess) * 100));

				// Debug logging
				if (totalProcessed % 100 === 0 || progress % 5 === 0) {
					console.log(
						`📊 [PROGRESS] totalProcessed: ${totalProcessed}, actualPointsToProcess: ${actualPointsToProcess}, progress: ${progress}%, batch: ${batchIndex + 1}/${totalBatches}`
					);
				}

				// ETA calculation
				const now = Date.now();
				scanSamples.push({ time: now, scanned: totalScanned });
				while (scanSamples.length > 1 && scanSamples[0].time < now - RATE_WINDOW_MS) {
					scanSamples.shift();
				}

				const MIN_ELAPSED_SECONDS = 3;
				const MIN_SAMPLES = 2;
				const MIN_POINTS_PROCESSED = Math.min(50, Math.ceil(totalPoints * 0.02));
				const elapsedSeconds = (now - startTime) / 1000;

				let etaDisplay = 'Calculating...';

				if (
					elapsedSeconds >= MIN_ELAPSED_SECONDS &&
					scanSamples.length >= MIN_SAMPLES &&
					totalProcessed >= MIN_POINTS_PROCESSED
				) {
					let scanRate = 0;

					if (scanSamples.length >= 2) {
						const first = scanSamples[0];
						const last = scanSamples[scanSamples.length - 1];
						const deltaScanned = last.scanned - first.scanned;
						const deltaSeconds = (last.time - first.time) / 1000;
						if (deltaSeconds >= 1 && deltaScanned >= 0) {
							scanRate = deltaScanned / deltaSeconds;
							if (!isFinite(scanRate)) {
								scanRate = 0;
							}
						}
					}

					if (scanRate === 0 && elapsedSeconds >= MIN_ELAPSED_SECONDS) {
						scanRate = totalScanned > 0 ? totalScanned / elapsedSeconds : 0;
						if (!isFinite(scanRate)) {
							scanRate = 0;
						}
					}

					if (scanRate > 0) {
						const remainingScans = Math.max(actualPointsToProcess - totalProcessed, 0);
						const remainingSeconds = Math.round(remainingScans / scanRate);
						etaDisplay = formatEta(remainingSeconds);
					}
				}

				Fluxbase.reportProgress(
					progress,
					`Processed ${totalProcessed.toLocaleString()}/${actualPointsToProcess.toLocaleString()} points (${totalErrors} errors) - ETA: ${etaDisplay}`
				);
			}
		}

		console.log(
			`✅ Reverse geocoding completed: ${totalSuccess} successful, ${totalErrors} errors out of ${totalProcessed} total`
		);

		return {
			success: true,
			result: {
				message: `Reverse geocoding completed: ${totalSuccess.toLocaleString()} successful, ${totalErrors.toLocaleString()} errors out of ${totalProcessed.toLocaleString()} total`,
				totalProcessed,
				totalSuccess,
				totalErrors,
				totalPoints
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in reverse geocoding missing job:`, error);
		throw error;
	}
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
	}>
): Promise<{ processed: number; success: number; errors: number }> {
	let processed = 0;
	let success = 0;
	let errors = 0;

	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const result = await processSinglePoint(point);

		processed++;
		if (result) {
			success++;
		} else {
			errors++;
		}

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

		// Extract country_code from the geocoded address
		let extractedCountryCode = null;
		if (geocodeResult.address && typeof geocodeResult.address === 'object') {
			const address = geocodeResult.address as Record<string, string>;
			extractedCountryCode = address.country_code || address.country;
		}

		// Add country_code to the geocode properties
		if (extractedCountryCode) {
			(mergedGeocodeGeoJSON.properties as Record<string, unknown>).country_code =
				extractedCountryCode;
		}

		const { error: updateError } = await Fluxbase.database().from('tracker_data')
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

		// Add geocode_error field and retryable/permanent flags
		const retryable = isRetryableError({ error: true, error_message: errorMessage });
		(errorGeoJSON.properties as Record<string, unknown>).geocode_error = errorMessage;
		if (retryable) {
			(errorGeoJSON.properties as Record<string, unknown>).retryable = true;
		} else {
			(errorGeoJSON.properties as Record<string, unknown>).permanent = true;
		}

		const { error: updateError } = await Fluxbase.database().from('tracker_data')
			.update({
				geocode: errorGeoJSON as unknown as Record<string, unknown>,
				updated_at: new Date().toISOString()
			})
			.eq('user_id', point.user_id)
			.eq('recorded_at', point.recorded_at);

		if (updateError) {
			console.error(`❌ Failed to update geocode with error:`, updateError);
		} else if (Math.random() < 0.01) {
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
