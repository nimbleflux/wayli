import { fluxbase } from '../../fluxbase';
import {
	getCountryForPoint as getCountryForPointExternal,
	normalizeCountryCode as normalizeCountryCodeExternal,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../../../lib/services/external/country-reverse-geocoding.service';
import { JobQueueService } from '../../job-queue.service.worker';
import { checkJobCancellation } from '../../../lib/utils/job-cancellation';
import { isGeoJSONGeocode } from '../../../lib/utils/geojson-converter';

import type { Feature } from 'geojson';

interface ErrorSummary {
	counts: Record<string, number>;
	samples: Array<{ idx: number; reason: string }>;
}

export async function importGeoJSONWithProgress(
	content: string,
	userId: string,
	jobId: string,
	fileName: string
): Promise<number> {
	try {
		console.log('🗺️ Starting GeoJSON import with progress tracking');
		const geojson = JSON.parse(content);
		let importedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;

		if (geojson.type === 'FeatureCollection' && geojson.features) {
			const totalFeatures = geojson.features.length as number;
			console.log(`📊 Processing ${totalFeatures.toLocaleString()} features from ${fileName}`);

			await JobQueueService.updateJobProgress(jobId, 0, {
				message: `🗺️ Processing ${totalFeatures.toLocaleString()} GeoJSON features...`,
				fileName,
				format: 'GeoJSON',
				totalProcessed: 0,
				totalItems: totalFeatures,
				eta: '0s'
			});

			const startTime = Date.now();
			const lastLogTime = startTime;

			const results = await processFeaturesInParallel(
				geojson.features as Feature[],
				userId,
				jobId,
				fileName,
				startTime,
				lastLogTime
			);

			importedCount = results.importedCount;
			skippedCount = results.skippedCount;
			errorCount = results.errorCount;
			const duplicatesCount = results.duplicatesCount;

			const totalTime = (Date.now() - startTime) / 1000;
			console.log(`✅ GeoJSON import completed!`);
			console.log(`📊 Final stats:`);
			console.log(`   📥 Imported: ${importedCount.toLocaleString()} points`);
			console.log(`   ⏭️ Skipped: ${skippedCount.toLocaleString()} points`);
			console.log(`   🔄 Duplicates: ${duplicatesCount.toLocaleString()} points`);
			console.log(`   ❌ Errors: ${errorCount.toLocaleString()} points`);
			console.log(`   ⏱️ Total time: ${totalTime.toFixed(1)}s`);
			console.log(`   🚀 Average rate: ${(importedCount / totalTime).toFixed(1)} points/sec`);

			// Update final job progress with duplicates count in metadata
			await JobQueueService.updateJobProgress(jobId, 100, {
				message: `✅ GeoJSON import completed!`,
				fileName,
				format: 'GeoJSON',
				totalProcessed: importedCount,
				totalItems: totalFeatures,
				imported: importedCount,
				skipped: skippedCount,
				duplicates: duplicatesCount,
				errors: errorCount,
				totalTime: `${totalTime.toFixed(1)}s`,
				averageRate: `${(importedCount / totalTime).toFixed(1)} points/sec`
			});
		}

		return importedCount;
	} catch (error) {
		if (error instanceof Error && error.message === 'Job was cancelled') {
			console.log(`🛑 GeoJSON import was cancelled`);
			return 0;
		}
		console.error('❌ Error in GeoJSON import:', error);
		throw error;
	}
}

async function processFeaturesInParallel(
	features: Feature[],
	userId: string,
	jobId: string,
	fileName: string,
	startTime: number,
	lastLogTimeInitial: number
): Promise<{
	importedCount: number;
	skippedCount: number;
	errorCount: number;
	duplicatesCount: number;
}> {
	const totalFeatures = features.length;
	let importedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;
	let duplicatesCount = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	const CHUNK_SIZE = 30;
	const CONCURRENT_CHUNKS = 8;

	console.log(
		`🔄 Processing: ${CHUNK_SIZE} features per chunk, ${CONCURRENT_CHUNKS} concurrent chunks (optimized for progress updates)`
	);

	let lastLogTime = lastLogTimeInitial;

	for (let i = 0; i < features.length; i += CHUNK_SIZE * CONCURRENT_CHUNKS) {
		await checkJobCancellation(jobId);

		const chunkPromises: Promise<{
			imported: number;
			skipped: number;
			errors: number;
			duplicates: number;
			errorSummary: ErrorSummary;
		}>[] = [];

		for (let j = 0; j < CONCURRENT_CHUNKS && i + j * CHUNK_SIZE < features.length; j++) {
			const chunkStart = i + j * CHUNK_SIZE;
			const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, features.length);
			const chunk = features.slice(chunkStart, chunkEnd);

			chunkPromises.push(
				processFeatureChunk(chunk, userId, chunkStart, jobId, totalFeatures, fileName)
			);
		}

		const chunkResults = await Promise.allSettled(chunkPromises);

		for (const result of chunkResults) {
			if (result.status === 'fulfilled') {
				importedCount += result.value.imported;
				skippedCount += result.value.skipped;
				errorCount += result.value.errors;
				duplicatesCount += result.value.duplicates;
				// merge error summaries
				for (const [k, v] of Object.entries(result.value.errorSummary.counts)) {
					errorSummary.counts[k] = (errorSummary.counts[k] || 0) + v;
				}
				for (const s of result.value.errorSummary.samples) {
					if (errorSummary.samples.length < 10) errorSummary.samples.push(s);
				}
			} else {
				errorCount += CHUNK_SIZE; // Count failed chunks as errors
				console.error('❌ Chunk processing failed:', result.reason);
			}
		}

		const currentTime = Date.now();
		const processed = Math.min(i + CHUNK_SIZE * CONCURRENT_CHUNKS, totalFeatures);
		const progress = Math.round((processed / totalFeatures) * 100);

		if (processed % 100 === 0 || currentTime - lastLogTime > 10000) {
			const elapsedSeconds = (currentTime - startTime) / 1000;
			const rate = processed > 0 ? (processed / elapsedSeconds).toFixed(1) : '0';
			const eta =
				processed > 0
					? ((totalFeatures - processed) / (processed / elapsedSeconds)).toFixed(0)
					: '0';

			console.log(
				`📈 Progress: ${processed.toLocaleString()}/${totalFeatures.toLocaleString()} (${progress}%) - Rate: ${rate} features/sec - ETA: ${eta}s - Imported: ${importedCount.toLocaleString()} - Skipped: ${skippedCount.toLocaleString()} - Duplicates: ${duplicatesCount.toLocaleString()} - Errors: ${errorCount.toLocaleString()}`
			);

			const topErrors = Object.entries(errorSummary.counts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([k, v]) => `${k}: ${v}`)
				.join('; ');

			await JobQueueService.updateJobProgress(jobId, progress, {
				message: `🗺️ Processing GeoJSON features... ${processed.toLocaleString()}/${totalFeatures.toLocaleString()} (${progress}%)`,
				fileName,
				format: 'GeoJSON',
				totalProcessed: importedCount,
				totalItems: totalFeatures,
				currentFeature: processed + 1,
				rate: `${rate} features/sec`,
				eta: `${eta}s`,
				skipped: skippedCount,
				duplicates: duplicatesCount,
				errors: errorCount,
				errorSummary: topErrors,
				errorSamples: errorSummary.samples
			});

			lastLogTime = currentTime;
		}

		if (importedCount > 0 && importedCount % 1000 === 0) {
			const elapsedSeconds = (currentTime - startTime) / 1000;
			const eta =
				processed > 0
					? ((totalFeatures - processed) / (processed / elapsedSeconds)).toFixed(0)
					: '0';
			console.log(`🎉 Milestone: Imported ${importedCount.toLocaleString()} points!`);
			await JobQueueService.updateJobProgress(jobId, progress, {
				message: `🎉 Imported ${importedCount.toLocaleString()} points!`,
				fileName,
				format: 'GeoJSON',
				totalProcessed: importedCount,
				totalItems: totalFeatures,
				currentFeature: processed + 1,
				eta: `${eta}s`
			});
		}
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount };
}

async function processFeatureChunk(
	features: Feature[],
	userId: string,
	chunkStart: number,
	jobId?: string,
	totalFeatures?: number,
	fileName?: string
): Promise<{
	imported: number;
	skipped: number;
	errors: number;
	duplicates: number;
	errorSummary: ErrorSummary;
}> {
	let imported = 0;
	let skipped = 0;
	let errors = 0;
	let duplicates = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	const trackerData: Array<{
		user_id: string;
		tracker_type: string;
		location: string;
		recorded_at: string;
		country_code: string | null;
		geocode: unknown;
		altitude: number | null;
		accuracy: number | null;
		speed: number | null;
		heading: number | null;
		activity_type: string | null;
		raw_data: Record<string, unknown>;
		created_at?: string;
	}> = [];

	for (let i = 0; i < features.length; i++) {
		const feature = features[i];
		if (!feature || !feature.geometry) {
			skipped++;
			errorSummary.counts['missing geometry'] = (errorSummary.counts['missing geometry'] || 0) + 1;
			if (errorSummary.samples.length < 10)
				errorSummary.samples.push({ idx: chunkStart + i, reason: 'missing geometry' });
			continue;
		}

		if (feature.geometry?.type === 'Point' && feature.geometry.coordinates) {
			const [longitude, latitude] = feature.geometry.coordinates;

			// Skip points with null or invalid coordinates
			if (longitude === null || latitude === null || isNaN(longitude) || isNaN(latitude)) {
				skipped++;
				errorSummary.counts['null coordinates'] =
					(errorSummary.counts['null coordinates'] || 0) + 1;
				if (errorSummary.samples.length < 10)
					errorSummary.samples.push({ idx: chunkStart + i, reason: 'null coordinates' });
				continue;
			}

			const properties = feature.properties || {};

			let recordedAt = new Date().toISOString();

			// Process timestamp from properties
			if (
				(properties as Record<string, unknown>).timestamp &&
				typeof (properties as Record<string, unknown>).timestamp === 'number'
			) {
				const timestamp = (properties as Record<string, unknown>).timestamp as number;
				const rawTimestamp = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
				recordedAt = applyTimezoneCorrectionToTimestamp(rawTimestamp, latitude, longitude);
			} else if (
				(properties as Record<string, unknown>).time &&
				(typeof (properties as Record<string, unknown>).time === 'string' ||
					typeof (properties as Record<string, unknown>).time === 'number')
			) {
				const rawTimestamp = (properties as Record<string, unknown>).time as string | number;
				recordedAt = applyTimezoneCorrectionToTimestamp(rawTimestamp, latitude, longitude);
			} else if (
				(properties as Record<string, unknown>).date &&
				(typeof (properties as Record<string, unknown>).date === 'string' ||
					typeof (properties as Record<string, unknown>).date === 'number')
			) {
				const rawTimestamp = (properties as Record<string, unknown>).date as string | number;
				recordedAt = applyTimezoneCorrectionToTimestamp(rawTimestamp, latitude, longitude);
			}

			let countryCode: string | null = null;
			if (typeof (properties as Record<string, unknown>).countrycode === 'string') {
				countryCode = (properties as Record<string, unknown>).countrycode as string;
			} else if (typeof (properties as Record<string, unknown>).country_code === 'string') {
				countryCode = (properties as Record<string, unknown>).country_code as string;
			} else if (typeof (properties as Record<string, unknown>).country === 'string') {
				countryCode = (properties as Record<string, unknown>).country as string;
			}

			if (!countryCode) {
				countryCode = safeGetCountryForPoint(latitude, longitude);
			}

			countryCode = safeNormalizeCountryCode(countryCode);

			// Store the complete GeoJSON feature in the geocode column
			const geocodeFeature = {
				type: 'Feature',
				geometry: {
					type: 'Point',
					coordinates: [longitude, latitude]
				},
				properties: {
					// Store all original properties from the imported GeoJSON
					...(properties as Record<string, unknown>),
					// Add import metadata
					imported_at: new Date().toISOString(),
					import_source: 'geojson'
				}
			};

			const altitude =
				typeof (properties as Record<string, unknown>).altitude === 'number'
					? ((properties as Record<string, unknown>).altitude as number)
					: typeof (properties as Record<string, unknown>).elevation === 'number'
						? ((properties as Record<string, unknown>).elevation as number)
						: null;

			const accuracy =
				typeof (properties as any).accuracy === 'number'
					? ((properties as any).accuracy as number)
					: null;
			const speed =
				typeof (properties as any).speed === 'number'
					? ((properties as any).speed as number)
					: typeof (properties as any).velocity === 'number'
						? ((properties as any).velocity as number)
						: null;

			const heading =
				typeof (properties as any).heading === 'number'
					? ((properties as any).heading as number)
					: typeof (properties as any).bearing === 'number'
						? ((properties as any).bearing as number)
						: typeof (properties as any).course === 'number'
							? ((properties as any).course as number)
							: null;

			const activityType =
				typeof (properties as any).activity_type === 'string'
					? ((properties as any).activity_type as string)
					: null;

			// Calculate timezone difference for this location
			const tzDiff = getTimezoneDifferenceForPoint(latitude, longitude);

			trackerData.push({
				user_id: userId,
				tracker_type: 'geojson',
				location: `POINT(${longitude} ${latitude})`,
				recorded_at: recordedAt,
				country_code: countryCode,
				geocode: geocodeFeature,
				altitude,
				accuracy,
				speed,
				heading,
				activity_type: activityType,
				tz_diff: tzDiff, // Add timezone difference
				created_at: new Date().toISOString()
			});
		} else {
			skipped++;
			const reason = feature.geometry
				? `unsupported geometry ${feature.geometry.type}`
				: 'missing geometry';
			errorSummary.counts[reason] = (errorSummary.counts[reason] || 0) + 1;
			if (errorSummary.samples.length < 10)
				errorSummary.samples.push({ idx: chunkStart + i, reason });
		}
	}

	if (trackerData.length > 0) {
		try {
			// Deduplicate within the batch - keep only the last occurrence of each (user_id, recorded_at)
			const deduplicatedData = Array.from(
				trackerData
					.reduce((map, item) => {
						const key = `${item.user_id}|${item.recorded_at}`;
						map.set(key, item); // This will overwrite duplicates, keeping the last one
						return map;
					}, new Map<string, (typeof trackerData)[0]>())
					.values()
			);

			const duplicatesInBatch = trackerData.length - deduplicatedData.length;
			if (duplicatesInBatch > 0) {
				duplicates += duplicatesInBatch;
				skipped += duplicatesInBatch;
			}

			const { error } = await fluxbase.from('tracker_data').upsert(deduplicatedData, {
				onConflict: 'user_id,recorded_at',
				ignoreDuplicates: false
			});

			if (!error) {
				imported = deduplicatedData.length;
				// Note: Progress updates with ETA are handled in processFeaturesInParallel
			} else {
				console.log(`❌ Batch insert failed with error:`, error);
				// For insert failures, we'll handle duplicates during deduplication phase
				errors += deduplicatedData.length;
				const code = (error as any).code || 'unknown';
				const message = (error as any).message || 'unknown error';
				errorSummary.counts[`db ${code}`] =
					(errorSummary.counts[`db ${code}`] || 0) + deduplicatedData.length;
				if (errorSummary.samples.length < 10)
					errorSummary.samples.push({ idx: chunkStart, reason: `db ${code}: ${message}` });
			}
		} catch (outerError: any) {
			console.log(`❌ Outer batch processing error:`, outerError);
			// For outer errors, we'll handle duplicates during deduplication phase
			errors += deduplicatedData.length;
			const msg = outerError?.message || 'outer processing error';
			errorSummary.counts[msg] = (errorSummary.counts[msg] || 0) + deduplicatedData.length;
			if (errorSummary.samples.length < 10)
				errorSummary.samples.push({ idx: chunkStart, reason: msg });
		}
	}

	return { imported, skipped, errors, duplicates, errorSummary };
}

function safeGetCountryForPoint(lat: number, lon: number): string | null {
	try {
		return getCountryForPointExternal(lat, lon);
	} catch (error) {
		console.warn('Failed to get country for point:', error);
		return null;
	}
}

function safeNormalizeCountryCode(countryCode: string | null): string | null {
	try {
		return normalizeCountryCodeExternal(countryCode);
	} catch (error) {
		console.warn('Failed to normalize country code:', error);
		return null;
	}
}

/**
 * Remove duplicate tracking points for a user based on user_id and recorded_at
 * Keeps the most recent record for each unique (user_id, recorded_at) combination
 */
export async function removeDuplicateTrackingPoints(userId: string): Promise<{ removed: number }> {
	try {
		console.log(`🧹 Removing duplicate tracking points for user ${userId}...`);

		const { data, error } = await fluxbase.rpc('remove_duplicate_tracking_points', {
			target_user_id: userId
		});

		if (error) {
			console.error(`❌ Error removing duplicates:`, error);
			throw error;
		}

		const removed = data || 0;
		console.log(`✅ Removed ${removed} duplicate tracking points`);

		return { removed };
	} catch (error) {
		console.error(`❌ Failed to remove duplicates:`, error);
		throw error;
	}
}
