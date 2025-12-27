/**
 * Batch reverse geocode missing location data
 *
 * Processes GPS points that don't have address information, calling the Pelias
 * API to reverse geocode coordinates into addresses. Respects rate limits and
 * provides detailed progress tracking.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 7200
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import { reverseGeocode } from '../../web/src/lib/services/external/pelias.service';
import { isRetryableError } from '../../web/src/lib/utils/geocoding-utils';
import {
	createGeocodeErrorGeoJSON,
	mergeGeocodingWithExisting
} from '../../web/src/lib/utils/geojson-converter';

import type { FluxbaseClient, JobUtils } from './types';

interface ReverseGeocodingPayload {
	/** @deprecated Use onBehalfOf option in job submission instead */
	target_user_id?: string;
	/** Process all users' data (admin only) */
	all_users?: boolean;
}

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
	const payload = context.payload as ReverseGeocodingPayload;
	const jobId = context.job_id;

	const authenticatedUserId = context.user?.id;
	const userRole = context.user?.role;
	const isAdmin = userRole === 'admin' || userRole === 'dashboard_admin';

	// Check if processing all users (admin only)
	const processAllUsers = payload?.all_users === true;

	if (processAllUsers && !isAdmin) {
		return {
			success: false,
			error: 'Unauthorized: only admins can process data for all users'
		};
	}

	// Use user context from onBehalfOf (preferred) or fall back to target_user_id in payload (deprecated)
	const userId = processAllUsers ? null : (authenticatedUserId || payload?.target_user_id);

	if (!userId && !processAllUsers) {
		return {
			success: false,
			error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
		};
	}

	// Authorization check: only admins can process data for other users
	// Service role calls (no user context) are trusted - they come from other jobs
	if (
		payload?.target_user_id &&
		authenticatedUserId &&
		payload.target_user_id !== authenticatedUserId &&
		!isAdmin
	) {
		return {
			success: false,
			error: 'Unauthorized: only admins can process data for other users'
		};
	}

	// Use service role client when processing all users or operating on behalf of target_user_id
	// This bypasses RLS and allows the job to query data for the specified user(s)
	const db = processAllUsers ? fluxbaseService : (authenticatedUserId ? fluxbase : fluxbaseService);

	try {
		console.log(`🌍 Processing reverse geocoding missing job ${jobId}`);

		// Show rate limiting settings
		const rateLimit = parseInt(process.env?.PELIAS_RATE_LIMIT || '1000', 10);
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
		console.log(`🔍 Checking for points that need geocoding${processAllUsers ? ' (all users)' : ''}...`);
		let countQuery = db
			.from('tracker_data')
			.select('*', { count: 'exact', head: true })
			.is('geocode->properties->>geocoded_at', null)
			.is('geocode->properties->>geocode_error', null);

		if (!processAllUsers && userId) {
			countQuery = countQuery.eq('user_id', userId);
		}

		const { count: totalPointsNeedingGeocoding, error: countError } = await countQuery;

		if (countError) throw countError;

		const totalToScan = totalPointsNeedingGeocoding || 0;
		const totalPoints = totalToScan;

		console.log(`📊 Found ${totalPoints.toLocaleString()} points that need geocoding`);

		// If no points need geocoding, exit early
		if (totalPoints === 0) {
			console.log('✅ No points need geocoding');
			safeReportProgress(job, 100, '✅ No tracker data points found needing geocoding');
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

		safeReportProgress(
			job,
			0,
			`🌍 Found ${totalPoints.toLocaleString()} tracker data points needing geocoding. Starting processing...`
		);

		// Process in batches - fetch and process each batch directly from the database
		// Since processed records no longer match the filter (they have country set),
		// we can keep fetching batches until no more unprocessed records remain
		let batchNumber = 0;

		while (totalProcessed < totalPoints) {
			batchNumber++;

			// Fetch next batch of unprocessed points
			let batchQuery = db
				.from('tracker_data')
				.select('user_id, location, geocode, recorded_at, tracker_type')
				.is('geocode->properties->>geocoded_at', null)
				.is('geocode->properties->>geocode_error', null);

			if (!processAllUsers && userId) {
				batchQuery = batchQuery.eq('user_id', userId);
			}

			const { data: batch, error: fetchError } = await batchQuery
				.order('recorded_at', { ascending: false })
				.limit(BATCH_SIZE);

			if (fetchError) throw fetchError;

			// No more points to process
			if (!batch || batch.length === 0) {
				console.log(`📊 No more unprocessed points found after ${totalProcessed} processed`);
				break;
			}

			const results = await processPointsConcurrently(db, batch);

			totalScanned += batch.length;
			totalProcessed += results.processed;
			totalSuccess += results.success;
			totalErrors += results.errors;

			// Calculate progress based on initial total count
			const progress = Math.min(100, Math.round((totalProcessed / totalPoints) * 100));

			console.log(
				`📊 Batch ${batchNumber}: ${totalProcessed.toLocaleString()}/${totalPoints.toLocaleString()} (${progress}%) - ${results.success} ok, ${results.errors} errors`
			);

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
					const remainingScans = Math.max(totalPoints - totalProcessed, 0);
					const remainingSeconds = Math.round(remainingScans / scanRate);
					etaDisplay = formatEta(remainingSeconds);
				}
			}

			safeReportProgress(
				job,
				progress,
				`🌍 Processed ${totalProcessed.toLocaleString()}/${totalPoints.toLocaleString()} points (${totalErrors} errors) - ETA: ${etaDisplay}`
			);
		}

		console.log(
			`✅ Reverse geocoding completed: ${totalSuccess} successful, ${totalErrors} errors out of ${totalProcessed} total`
		);

		// Chain: Refresh place_visits and sync POI embeddings after geocoding completes
		// The refresh-place-visits job handles both the MV refresh and chains to sync-poi-embeddings
		if (totalSuccess > 0) {
			console.log(`🔗 Queueing refresh-place-visits job (chains to sync-poi-embeddings)...`);
			try {
				const onBehalfOf = context.user ? {
					user_id: context.user.id,
					user_email: context.user.email,
					user_role: context.user.role
				} : undefined;

				const { data: refreshJob, error: refreshError } = await fluxbaseService.jobs.submit(
					'refresh-place-visits',
					{},
					{
						namespace: 'wayli',
						priority: 5,
						onBehalfOf
					}
				);

				if (refreshError) {
					console.warn(`⚠️ Failed to queue refresh-place-visits job: ${refreshError.message}`);
				} else {
					console.log(`✅ refresh-place-visits job queued: ${(refreshJob as any)?.job_id || 'unknown'}`);
				}
			} catch (refreshQueueError) {
				console.warn(`⚠️ Error queueing refresh-place-visits job:`, refreshQueueError);
			}
		}

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

const CONCURRENCY = 20;

async function processPointsConcurrently(
	fluxbase: FluxbaseClient,
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
	let success = 0;
	let errors = 0;

	// Process in concurrent chunks
	for (let i = 0; i < points.length; i += CONCURRENCY) {
		const chunk = points.slice(i, i + CONCURRENCY);
		const results = await Promise.all(
			chunk.map((point) => processSinglePoint(fluxbase, point))
		);

		for (const result of results) {
			if (result) {
				success++;
			} else {
				errors++;
			}
		}
	}

	return { processed: points.length, success, errors };
}

async function processSinglePoint(
	fluxbase: FluxbaseClient,
	point: {
		user_id: string;
		location:
		| string
		| { type: string; coordinates: number[]; crs?: { type: string; properties: { name: string } } };
		geocode: unknown;
		recorded_at: string;
		tracker_type: string;
	}
): Promise<boolean> {
	try {
		let lat: number, lon: number;
		if (point.location && typeof point.location === 'object' && 'coordinates' in point.location) {
			const coords = (point.location as { coordinates: number[] }).coordinates;
			if (!Array.isArray(coords) || coords.length < 2) {
				console.warn(`⚠️ Invalid coordinates format for tracker data point:`, point.location);
				await updateGeocodeWithError(fluxbase, point, 'Invalid coordinates format');
				return false;
			}
			[lon, lat] = coords;
		} else if (typeof point.location === 'string') {
			const locationMatch = point.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
			if (!locationMatch) {
				console.warn(`⚠️ Invalid location format for tracker data point: ${point.location}`);
				await updateGeocodeWithError(fluxbase, point, 'Invalid location format');
				return false;
			}
			[lon, lat] = locationMatch.slice(1).map(Number);
		} else {
			console.warn(`⚠️ Unknown location format for tracker data point:`, point.location);
			await updateGeocodeWithError(fluxbase, point, 'Unknown location format');
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
			await updateGeocodeWithError(fluxbase, point, `Invalid coordinates: lat=${lat}, lon=${lon}`);
			return false;
		}

		const geocodeResult = await reverseGeocode(lat, lon);

		// Merge new geocoding data with existing properties
		const mergedGeocodeGeoJSON = mergeGeocodingWithExisting(point.geocode, lat, lon, geocodeResult);

		const { error: updateError } = await fluxbase
			.from('tracker_data')
			.update({
				geocode: mergedGeocodeGeoJSON as unknown as Record<string, unknown>,
				updated_at: new Date().toISOString()
			})
			.eq('user_id', point.user_id)
			.eq('recorded_at', point.recorded_at);

		if (updateError) {
			console.error(`❌ Database update error:`, updateError);
			await updateGeocodeWithError(fluxbase, point, `Database update error: ${updateError.message}`);
			return false;
		}

		return true;
	} catch (error: unknown) {
		console.error(`❌ Error processing tracker data point:`, (error as Error).message);
		await updateGeocodeWithError(fluxbase, point, `Geocoding error: ${(error as Error).message}`);
		return false;
	}
}

async function updateGeocodeWithError(
	fluxbase: FluxbaseClient,
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

		const { error: updateError } = await fluxbase
			.from('tracker_data')
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
