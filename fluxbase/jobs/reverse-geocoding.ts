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

import { reverseGeocode } from '_shared/services/external/pelias.service';
import {
	getCountryForPoint,
	normalizeCountryCode
} from '_shared/services/external/country-reverse-geocoding.service';
import { isRetryableError } from '_shared/utils/geocoding-utils';
import {
	createGeocodeErrorGeoJSON,
	mergeGeocodingWithExisting
} from '_shared/utils/geojson-converter';

import type { FluxbaseClient, JobUtils } from './types';

// Deno type declaration for environment access
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

// Safe environment access for both Deno and Node
function getEnv(key: string): string | undefined {
	if (typeof Deno !== 'undefined') {
		return Deno.env.get(key);
	}
	if (typeof process !== 'undefined' && process.env) {
		return process.env[key];
	}
	return undefined;
}

interface ReverseGeocodingPayload {
	/** @deprecated Use onBehalfOf option in job submission instead */
	target_user_id?: string;
	/** Process all users' data (admin only) */
	all_users?: boolean;
	/** Force re-geocode all points, even those already geocoded */
	force?: boolean;
	/** Only fill missing country codes (skip full geocoding) */
	fill_country_codes_only?: boolean;
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

	// Check for force mode (re-geocode everything) or fill_country_codes_only mode
	const forceMode = payload?.force === true;
	const fillCountryCodesOnly = payload?.fill_country_codes_only === true;

	// Authorization check: force and fill_country_codes_only are admin-only features
	if ((forceMode || fillCountryCodesOnly) && !isAdmin) {
		return {
			success: false,
			error: 'Unauthorized: only admins can use force or fill_country_codes_only modes'
		};
	}

	try {
		const modeLabel = forceMode ? ' (FORCE MODE)' : fillCountryCodesOnly ? ' (FILL COUNTRY CODES)' : '';
		console.log(`🌍 Processing reverse geocoding job ${jobId}${modeLabel}`);

		// Show rate limiting settings
		const rateLimit = parseInt(getEnv('PELIAS_RATE_LIMIT') || '1000', 10);
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

		// First, count total points that need processing based on mode
		const modeDescription = forceMode
			? 'for re-geocoding (force mode)'
			: fillCountryCodesOnly
				? 'with missing country codes'
				: 'that need geocoding';
		console.log(`🔍 Checking for points ${modeDescription}${processAllUsers ? ' (all users)' : ''}...`);

		let countQuery = db.from('tracker_data').select('*', { count: 'exact', head: true });

		if (forceMode) {
			// Force mode: count ALL points (we'll re-geocode everything)
			// No filter needed - process all points
		} else if (fillCountryCodesOnly) {
			// Fill country codes mode: find points that have geocode data but missing country_code
			// Note: Using .is() instead of .or() to avoid parser bug with is.null in or() clauses
			countQuery = countQuery
				.not('geocode->properties->>geocoded_at', 'is', null) // Has been geocoded
				.is('country_code', null); // But missing country_code
		} else {
			// Default mode: only points that haven't been geocoded yet
			countQuery = countQuery
				.is('geocode->properties->>geocoded_at', null)
				.is('geocode->properties->>geocode_error', null);
		}

		if (!processAllUsers && userId) {
			countQuery = countQuery.eq('user_id', userId);
		}

		const { count: totalPointsNeedingGeocoding, error: countError } = await countQuery;

		if (countError) throw countError;

		const totalToScan = totalPointsNeedingGeocoding || 0;
		const totalPoints = totalToScan;

		console.log(`📊 Found ${totalPoints.toLocaleString()} points ${modeDescription}`);

		// If no points need processing, exit early
		if (totalPoints === 0) {
			const noPointsMessage = forceMode
				? 'No tracker data points found'
				: fillCountryCodesOnly
					? 'No points with missing country codes found'
					: 'No points need geocoding';
			console.log(`✅ ${noPointsMessage}`);
			safeReportProgress(job, 100, `✅ ${noPointsMessage}`);
			return {
				success: true,
				result: {
					message: noPointsMessage,
					totalProcessed: 0,
					totalSuccess: 0,
					totalErrors: 0
				}
			};
		}

		const actionLabel = fillCountryCodesOnly ? 'updating country codes' : 'geocoding';
		console.log(
			`🌍 [REVERSE_GEOCODING] Found ${totalPoints.toLocaleString()} points ${modeDescription}. Starting ${actionLabel}...`
		);

		safeReportProgress(
			job,
			0,
			`🌍 Found ${totalPoints.toLocaleString()} tracker data points ${modeDescription}. Starting ${actionLabel}...`
		);

		// Process in batches - fetch and process each batch directly from the database
		// For force mode, we need offset-based pagination since records stay after processing
		// For other modes, records are modified and no longer match the filter
		let batchNumber = 0;
		let offset = 0;

		while (totalProcessed < totalPoints) {
			batchNumber++;

			// Build query based on mode
			let batchQuery = db
				.from('tracker_data')
				.select('user_id, location, geocode, recorded_at, tracker_type');

			if (forceMode) {
				// Force mode: no filter, use offset pagination
				// No additional filters needed
			} else if (fillCountryCodesOnly) {
				// Fill country codes mode: find points that have geocode data but missing country_code
				// Note: Using .is() instead of .or() to avoid parser bug with is.null in or() clauses
				batchQuery = batchQuery
					.not('geocode->properties->>geocoded_at', 'is', null)
					.is('country_code', null);
			} else {
				// Default mode: only points that haven't been geocoded yet
				batchQuery = batchQuery
					.is('geocode->properties->>geocoded_at', null)
					.is('geocode->properties->>geocode_error', null);
			}

			if (!processAllUsers && userId) {
				batchQuery = batchQuery.eq('user_id', userId);
			}

			// For force mode, use offset-based pagination; otherwise, records drop out of filter after processing
			let finalQuery = batchQuery.order('recorded_at', { ascending: false }).limit(BATCH_SIZE);
			if (forceMode) {
				finalQuery = finalQuery.range(offset, offset + BATCH_SIZE - 1);
			}

			const { data: batch, error: fetchError } = await finalQuery;

			if (fetchError) throw fetchError;

			// No more points to process
			if (!batch || batch.length === 0) {
				console.log(`📊 No more points found after ${totalProcessed} processed`);
				break;
			}

			// Process points - use different processor for fill_country_codes_only mode
			const results = fillCountryCodesOnly
				? await processPointsForCountryCodeOnly(db, batch)
				: await processPointsConcurrently(db, batch);

			// Update offset for force mode pagination
			if (forceMode) {
				offset += batch.length;
			}

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

		// Chain: Run incremental place visit detection after geocoding completes
		// This directly invokes the RPC which processes new data since last refresh
		if (totalSuccess > 0) {
			console.log(`Running incremental place visit detection...`);
			try {
				const { data: refreshResult, error: refreshError } = await (fluxbaseService.rpc as any).invoke(
					'detect-place-visits-incremental',
					{},
					{ namespace: 'wayli' }
				);

				if (refreshError) {
					console.warn(`Failed to run place visit detection: ${refreshError.message}`);
				} else {
					console.log(`Place visit detection completed:`, refreshResult);
				}
			} catch (refreshError) {
				console.warn(`Error running place visit detection:`, refreshError);
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

/**
 * Process points to only fill in missing country codes.
 * This re-geocodes the point but only updates the country_code field.
 */
async function processPointsForCountryCodeOnly(
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
			chunk.map((point) => processSinglePointCountryCodeOnly(fluxbase, point))
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

/**
 * Process a single point to fill in the missing country code.
 * Uses local GeoJSON point-in-polygon lookup instead of Pelias API for speed.
 */
async function processSinglePointCountryCodeOnly(
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
				return false;
			}
			[lon, lat] = coords;
		} else if (typeof point.location === 'string') {
			const locationMatch = point.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
			if (!locationMatch) {
				return false;
			}
			[lon, lat] = locationMatch.slice(1).map(Number);
		} else {
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
			return false;
		}

		// Use local GeoJSON point-in-polygon lookup (fast, no network request)
		const rawCountryCode = getCountryForPoint(lat, lon);
		const newCountryCode = normalizeCountryCode(rawCountryCode);

		if (!newCountryCode) {
			// Point is in ocean or not covered by countries.geojson
			return false;
		}

		// Update the existing geocode data with the new country code
		const existingGeocode = point.geocode as Record<string, unknown> | null;
		if (!existingGeocode || typeof existingGeocode !== 'object') {
			return false;
		}

		// Deep clone and update
		const updatedGeocode = JSON.parse(JSON.stringify(existingGeocode));
		if (!updatedGeocode.properties) {
			updatedGeocode.properties = {};
		}
		if (!updatedGeocode.properties.address) {
			updatedGeocode.properties.address = {};
		}
		updatedGeocode.properties.address.country_code = newCountryCode;

		const { error: updateError } = await fluxbase
			.from('tracker_data')
			.update({
				geocode: updatedGeocode,
				country_code: newCountryCode,
				updated_at: new Date().toISOString()
			})
			.eq('user_id', point.user_id)
			.eq('recorded_at', point.recorded_at);

		if (updateError) {
			console.error(`❌ Database update error:`, updateError);
			return false;
		}

		return true;
	} catch (error: unknown) {
		console.error(`❌ Error processing point for country code:`, (error as Error).message);
		return false;
	}
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
