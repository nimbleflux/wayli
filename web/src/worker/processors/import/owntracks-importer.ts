// web/src/lib/services/queue/processors/import/owntracks-importer.ts

import { fluxbase } from '../../fluxbase';
import {
	normalizeCountryCode as normalizeCountryCodeExternal,
	getCountryForPoint as getCountryForPointExternal,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../../../lib/services/external/country-reverse-geocoding.service';
import { JobQueueService } from '../../job-queue.service.worker';
import { checkJobCancellation } from '../../../lib/utils/job-cancellation';

export async function importOwnTracksWithProgress(
	content: string,
	userId: string,
	jobId: string,
	fileName: string
): Promise<number> {
	try {
		console.log('🗺️ Starting OwnTracks import with progress tracking');

		const lines = content.split('\n').filter((line) => line.trim());
		const totalLines = lines.length;
		let importedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;

		console.log(`📊 OwnTracks file contains ${totalLines.toLocaleString()} data points`);

		await JobQueueService.updateJobProgress(jobId, 0, {
			message: `🗺️ Processing ${totalLines.toLocaleString()} OwnTracks lines...`,
			fileName,
			format: 'OwnTracks',
			totalProcessed: 0,
			totalItems: totalLines,
			eta: '0s'
		});

		const startTime = Date.now();
		let lastLogTime = startTime;

		for (let i = 0; i < lines.length; i++) {
			if (i % 100 === 0) await checkJobCancellation(jobId);

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

				await JobQueueService.updateJobProgress(jobId, progress, {
					message: `🗺️ Processing OwnTracks data... ${i.toLocaleString()}/${totalLines.toLocaleString()} (${progress}%)`,
					fileName,
					format: 'OwnTracks',
					totalProcessed: importedCount,
					totalItems: totalLines,
					rate: `${rate} lines/sec`,
					eta: `${eta}s`,
					skipped: skippedCount,
					errors: errorCount
				});

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

				// Calculate timezone difference for this location
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
						tz_diff: tzDiff, // Add timezone difference
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

		return importedCount;
	} catch (error) {
		if (error instanceof Error && error.message === 'Job was cancelled') {
			console.log(`🛑 OwnTracks import was cancelled`);
			return 0;
		}
		console.error('❌ Error in OwnTracks import:', error);
		throw error;
	}
}

function safeGetCountryForPoint(lat: number, lon: number): string | null {
	try {
		return getCountryForPointExternal(lat, lon);
	} catch (e) {
		console.warn('Failed to get country for point:', e);
		return null;
	}
}

function safeNormalizeCountryCode(countryCode: string | null): string | null {
	try {
		return normalizeCountryCodeExternal(countryCode);
	} catch (e) {
		console.warn('Failed to normalize country code:', e);
		return null;
	}
}
