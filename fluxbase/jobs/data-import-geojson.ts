/**
 * Import GPS data from GeoJSON format
 *
 * Processes uploaded GeoJSON files, extracting GPS points and importing them into
 * the tracker_data table. Supports feature collections and individual features.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:memory 512
 * @fluxbase:allow-read true
 */

import {
	getCountryForPoint,
	normalizeCountryCode,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../../web/src/lib/services/external/country-reverse-geocoding.service';

import { JSONParser } from 'npm:@streamparser/json';
import type { Feature } from 'geojson';
import type { FluxbaseClient, JobUtils } from './types';

interface DataImportPayload {
	storagePath: string;
	format: string;
	fileName: string;
}

interface ErrorSummary {
	counts: Record<string, number>;
	samples: Array<{ idx: number; reason: string }>;
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

		// Execute import with streaming JSON parser for memory efficiency
		console.log('🗺️ Starting GeoJSON import with streaming parser');
		job.reportProgress(0, `🗺️ Streaming GeoJSON features...`);

		const startTime = Date.now();
		const results = await processGeoJSONStream(fileData, userId, jobId, fluxbase, job, startTime);

		const importedCount = results.importedCount;
		const skippedCount = results.skippedCount;
		const errorCount = results.errorCount;
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
					console.log(`✅ Distance calculation job queued: ${(distanceJob as any)?.job_id || 'unknown'}`);
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
				format: 'GeoJSON'
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in GeoJSON import job:`, error);
		throw error;
	}
}

/**
 * Stream-based GeoJSON processor for memory-efficient parsing of large files.
 * Instead of loading the entire file into memory, this streams through the file
 * and processes features in batches as they are parsed.
 */
async function processGeoJSONStream(
	fileData: Blob,
	userId: string,
	_jobId: string,
	fluxbase: FluxbaseClient,
	job: JobUtils,
	startTime: number
): Promise<{
	importedCount: number;
	skippedCount: number;
	errorCount: number;
	duplicatesCount: number;
}> {
	let importedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;
	let duplicatesCount = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	const BATCH_SIZE = 240; // Process features in batches (30 * 8 to match previous concurrent chunk size)
	let featureBuffer: Feature[] = [];
	let featureIndex = 0;
	let bytesRead = 0;
	const totalBytes = fileData.size;
	let lastLogTime = startTime;

	console.log(`🔄 Streaming mode: Processing features in batches of ${BATCH_SIZE}`);
	console.log(`📦 File size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

	// Create streaming JSON parser that extracts features from FeatureCollection
	const parser = new JSONParser({
		paths: ['$.features.*'],
		keepStack: false // Memory optimization: don't keep full stack
	});

	// Process a batch of features
	const processBatch = async () => {
		if (featureBuffer.length === 0) return;

		const batch = featureBuffer;
		featureBuffer = []; // Clear buffer immediately to free memory

		const result = await processFeatureChunk(batch, userId, featureIndex - batch.length, fluxbase);

		importedCount += result.imported;
		skippedCount += result.skipped;
		errorCount += result.errors;
		duplicatesCount += result.duplicates;

		// Merge error summaries
		for (const [k, v] of Object.entries(result.errorSummary.counts)) {
			errorSummary.counts[k] = (errorSummary.counts[k] || 0) + v;
		}
		for (const s of result.errorSummary.samples) {
			if (errorSummary.samples.length < 10) errorSummary.samples.push(s);
		}
	};

	// Set up parser to collect features
	parser.onValue = ({ value }: { value: unknown }) => {
		featureBuffer.push(value as Feature);
		featureIndex++;
	};

	// Stream the file through the parser
	const reader = fileData.stream().getReader();
	const decoder = new TextDecoder();

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			bytesRead += value.length;
			const chunk = decoder.decode(value, { stream: true });
			parser.write(chunk);

			// Process batch when buffer is full
			if (featureBuffer.length >= BATCH_SIZE) {
				await processBatch();

				// Update progress based on bytes read
				const currentTime = Date.now();
				const progress = Math.round((bytesRead / totalBytes) * 100);

				if (currentTime - lastLogTime > 5000) {
					const elapsedSeconds = (currentTime - startTime) / 1000;
					const rate = featureIndex > 0 ? (featureIndex / elapsedSeconds).toFixed(1) : '0';
					const mbRead = (bytesRead / 1024 / 1024).toFixed(2);
					const mbTotal = (totalBytes / 1024 / 1024).toFixed(2);

					console.log(
						`📈 Progress: ${mbRead}/${mbTotal} MB (${progress}%) - Features: ${featureIndex.toLocaleString()} - Rate: ${rate}/sec - Imported: ${importedCount.toLocaleString()}`
					);

					const topErrors = Object.entries(errorSummary.counts)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 3)
						.map(([k, v]) => `${k}: ${v}`)
						.join('; ');

					job.reportProgress(
						progress,
						`🗺️ Streaming GeoJSON... ${mbRead}/${mbTotal} MB - ${featureIndex.toLocaleString()} features - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
					);

					lastLogTime = currentTime;
				}
			}
		}

		// Process any remaining features in the buffer
		if (featureBuffer.length > 0) {
			await processBatch();
		}

		// Final progress update
		job.reportProgress(100, `🗺️ Import complete - ${featureIndex.toLocaleString()} features processed`);

		console.log(`📊 Streaming complete: ${featureIndex.toLocaleString()} total features parsed`);
	} finally {
		reader.releaseLock();
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount };
}

async function processFeatureChunk(
	features: Feature[],
	userId: string,
	chunkStart: number,
	fluxbase: FluxbaseClient
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
		tz_diff: number | null;
		created_at: string;
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
				tz_diff: tzDiff,
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
			} else {
				console.log(`❌ Batch insert failed with error:`, error);
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
			errors += trackerData.length;
			const msg = outerError?.message || 'outer processing error';
			errorSummary.counts[msg] = (errorSummary.counts[msg] || 0) + trackerData.length;
			if (errorSummary.samples.length < 10)
				errorSummary.samples.push({ idx: chunkStart, reason: msg });
		}
	}

	return { imported, skipped, errors, duplicates, errorSummary };
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
