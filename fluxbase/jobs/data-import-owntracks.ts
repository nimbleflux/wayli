/**
 * Import GPS data from OwnTracks format
 *
 * Processes uploaded OwnTracks JSON files, extracting location data and importing
 * them into the tracker_data table. Supports both single locations and arrays.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-read true
 */

import {
	normalizeCountryCode,
	getCountryForPoint,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../../web/src/lib/services/external/country-reverse-geocoding.service';

import type { FluxbaseClient, JobUtils } from './types';

interface DataImportPayload {
	storagePath: string;
	format: string;
	fileName: string;
}

export async function handler(
	req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = context.payload as DataImportPayload;
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		// Download file from storage
		const { data: fileData, error: downloadError } = await fluxbase.storage
			.from('temp-files')
			.download(payload.storagePath);

		if (downloadError || !fileData) {
			throw new Error(`Failed to download file from storage: ${JSON.stringify(downloadError)}`);
		}

		const fileContent = await fileData.text();

		// Execute import with progress tracking
		console.log('🗺️ Starting OwnTracks import with progress tracking');

		const lines = fileContent.split('\n').filter((line) => line.trim());
		const totalLines = lines.length;
		let importedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;

		console.log(`📊 OwnTracks file contains ${totalLines.toLocaleString()} data points`);

		job.reportProgress(
			0,
			`🗺️ Processing ${totalLines.toLocaleString()} OwnTracks lines...`
		);

		const startTime = Date.now();
		let lastLogTime = startTime;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) {
				skippedCount++;
				continue;
			}

			const currentTime = Date.now();
			if (i % 1000 === 0 || currentTime - lastLogTime > 30000) {
				const progress = Math.round((i / totalLines) * 100);
				const elapsedSeconds = (currentTime - startTime) / 1000;
				const rate = i > 0 ? (i / elapsedSeconds).toFixed(1) : '0';
				const eta = i > 0 ? ((totalLines - i) / (i / elapsedSeconds)).toFixed(0) : '0';

				console.log(
					`📈 Progress: ${i.toLocaleString()}/${totalLines.toLocaleString()} (${progress}%) - Rate: ${rate} lines/sec - ETA: ${eta}s - Imported: ${importedCount.toLocaleString()} - Skipped: ${skippedCount.toLocaleString()} - Errors: ${errorCount.toLocaleString()}`
				);

				job.reportProgress(
					progress,
					`🗺️ Processing OwnTracks data... ${i.toLocaleString()}/${totalLines.toLocaleString()} (${progress}%)`
				);

				lastLogTime = currentTime;
			}

			const parts = line.split(',');
			if (parts.length >= 3) {
				const timestamp = parseInt(parts[0]);
				const lat = parseFloat(parts[1]);
				const lon = parseFloat(parts[2]);

				// Skip points with null or invalid coordinates
				if (isNaN(timestamp) || isNaN(lat) || isNaN(lon) || lat === null || lon === null) {
					skippedCount++;
					console.log(
						`⚠️ Skipping OwnTracks line ${i}: invalid coordinates (lat: ${lat}, lon: ${lon})`
					);
					continue;
				}

				const countryCode = safeNormalizeCountryCode(safeGetCountryForPoint(lat, lon));
				const recordedAt = applyTimezoneCorrectionToTimestamp(timestamp * 1000, lat, lon);
				const tzDiff = getTimezoneDifferenceForPoint(lat, lon);

				// Create GeoJSON feature for the OwnTracks point
				const geocodeFeature = {
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: [lon, lat]
					},
					properties: {
						import_source: 'owntracks',
						data_type: 'location_point',
						event: parts[8] || null,
						vertical_accuracy: parts[5] ? parseFloat(parts[5]) : null,
						imported_at: new Date().toISOString()
					}
				};

				const { error } = await fluxbase.from('tracker_data').upsert(
					{
						user_id: userId,
						tracker_type: 'import',
						location: `POINT(${lon} ${lat})`,
						recorded_at: recordedAt,
						country_code: countryCode,
						tz_diff: tzDiff,
						altitude: parts[3] ? parseFloat(parts[3]) : null,
						accuracy: parts[4] ? parseFloat(parts[4]) : null,
						speed: parts[6] ? parseFloat(parts[6]) : null,
						heading: parts[7] ? parseFloat(parts[7]) : null,
						geocode: geocodeFeature,
						created_at: new Date().toISOString()
					} as any,
					{ onConflict: 'user_id,recorded_at', ignoreDuplicates: false }
				);

				if (!error) importedCount++;
				else {
					if ((error as { code?: string }).code === '23505') skippedCount++;
					else {
						errorCount++;
						console.error(`❌ Error inserting OwnTracks line ${i}:`, error);
					}
				}
			} else {
				skippedCount++;
			}
		}

		const totalTime = (Date.now() - startTime) / 1000;
		console.log(`✅ OwnTracks import completed!`);
		console.log(`📊 Final stats:`);
		console.log(`   📥 Imported: ${importedCount.toLocaleString()} points`);
		console.log(`   ⏭️ Skipped: ${skippedCount.toLocaleString()} points`);
		console.log(`   ❌ Errors: ${errorCount.toLocaleString()} points`);
		console.log(`   ⏱️ Total time: ${totalTime.toFixed(1)}s`);

		// Trigger distance calculation job for the user after import completes
		if (importedCount > 0) {
			console.log(`🧮 Queueing distance calculation job for user ${userId}...`);
			try {
				const { data: distanceJob, error: distanceError } = await fluxbase.jobs.submit(
					'distance-calculation',
					{ target_user_id: userId },
					{
						namespace: 'wayli',
						priority: 3 // Lower priority since import is done
					}
				);

				if (distanceError) {
					console.warn(`⚠️ Failed to queue distance calculation job: ${distanceError.message}`);
				} else {
					console.log(`✅ Distance calculation job queued: ${distanceJob?.job_id || 'unknown'}`);
				}
			} catch (distanceQueueError) {
				console.warn(`⚠️ Error queueing distance calculation:`, distanceQueueError);
				// Don't fail the import if distance calculation queueing fails
			}
		}

		return {
			success: true,
			result: {
				importedCount,
				fileName: payload.fileName,
				format: 'OwnTracks'
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in OwnTracks import job:`, error);
		throw error;
	}
}

function safeGetCountryForPoint(lat: number, lon: number): string | null {
	try {
		return getCountryForPoint(lat, lon);
	} catch (e) {
		console.warn('Failed to get country for point:', e);
		return null;
	}
}

function safeNormalizeCountryCode(countryCode: string | null): string | null {
	try {
		return normalizeCountryCode(countryCode);
	} catch (e) {
		console.warn('Failed to normalize country code:', e);
		return null;
	}
}
