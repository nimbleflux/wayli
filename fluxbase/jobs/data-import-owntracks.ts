/**
 * Import GPS data from OwnTracks format
 *
 * Processes uploaded OwnTracks CSV files using streaming for memory efficiency.
 * Extracts location data and imports them into the tracker_data table.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:memory 512
 * @fluxbase:allow-read true
 * @fluxbase:allow-env true
 */

import {
	normalizeCountryCode,
	getCountryForPoint,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../../web/src/lib/services/external/country-reverse-geocoding.service';

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

interface DataImportPayload {
	storagePath: string;
	format: string;
	fileName: string;
}

interface OwnTracksPoint {
	timestamp: number;
	lat: number;
	lon: number;
	altitude: number | null;
	accuracy: number | null;
	verticalAccuracy: number | null;
	speed: number | null;
	heading: number | null;
	event: string | null;
}

interface ErrorSummary {
	counts: Record<string, number>;
	samples: Array<{ idx: number; reason: string }>;
}

export async function handler(
	_req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = context.payload as DataImportPayload;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		// Use resumable chunked download for large files
		console.log('🗺️ Starting OwnTracks import with streaming line parsing...');
		const storage = fluxbase.storage.from('temp-files') as any;

		let lastDownloadLog = 0;
		const { data: downloadData, error: downloadError } = await storage.downloadResumable(
			payload.storagePath,
			{
				chunkSize: 5 * 1024 * 1024, // 5MB chunks
				maxRetries: 3,
				onProgress: (progress: {
					loaded?: number;
					total?: number;
					percentage?: number;
					bytesPerSecond?: number;
					currentChunk?: number;
					totalChunks?: number;
				}) => {
					const now = Date.now();
					if (now - lastDownloadLog > 5000) {
						const mb = ((progress.loaded ?? 0) / 1024 / 1024).toFixed(1);
						const totalMb = ((progress.total ?? 0) / 1024 / 1024).toFixed(1);
						const speed = ((progress.bytesPerSecond ?? 0) / 1024 / 1024).toFixed(1);
						const pct = (progress.percentage ?? 0).toFixed(1);
						console.log(
							`📥 Downloading: ${mb}/${totalMb} MB (${pct}%) - ${speed} MB/s - Chunk ${progress.currentChunk ?? '?'}/${progress.totalChunks ?? '?'}`
						);
						lastDownloadLog = now;
					}
				}
			}
		);

		if (downloadError || !downloadData) {
			throw new Error(`Failed to download file: ${JSON.stringify(downloadError)}`);
		}

		const stream: ReadableStream<Uint8Array> = downloadData.stream;
		const totalBytes = downloadData.size || 0;
		console.log(`📦 File size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

		safeReportProgress(job, 0, `🗺️ Streaming OwnTracks data...`);

		const startTime = Date.now();
		const results = await processOwnTracksStream(stream, totalBytes, userId, fluxbase, job, startTime);

		const totalTime = (Date.now() - startTime) / 1000;
		console.log(`✅ OwnTracks import completed!`);
		console.log(`📊 Final stats:`);
		console.log(`   📥 Imported: ${results.importedCount.toLocaleString()} points`);
		console.log(`   ⏭️ Skipped: ${results.skippedCount.toLocaleString()} points`);
		console.log(`   🔄 Duplicates: ${results.duplicatesCount.toLocaleString()} points`);
		console.log(`   ❌ Errors: ${results.errorCount.toLocaleString()} points`);
		console.log(`   ⏱️ Total time: ${totalTime.toFixed(1)}s`);
		console.log(`   🚀 Average rate: ${(results.importedCount / totalTime).toFixed(1)} points/sec`);

		// Trigger distance calculation RPC after import
		if (results.importedCount > 0) {
			console.log(`🧮 Triggering distance calculation RPC for user ${userId}...`);
			try {
				const { data: rpcResult, error: rpcError } = await fluxbase.rpc('calculate_distances_batch_v2', {
					p_user_id: userId,
					p_offset: 0,
					p_limit: 1000
				});

				if (rpcError) {
					console.warn(`⚠️ Failed to trigger distance calculation RPC: ${rpcError.message}`);
				} else {
					console.log(`✅ Distance calculation RPC triggered: ${rpcResult || 'completed'}`);
				}
			} catch (distanceError) {
				console.warn(`⚠️ Distance calculation trigger failed:`, distanceError);
				// Don't fail the import if distance calculation fails
			}

			// Queue reverse geocoding job to get address info for imported points
			console.log(`🌍 Queueing reverse geocoding job for user ${userId}...`);
			try {
				const onBehalfOf = context.user ? {
					user_id: context.user.id,
					user_email: context.user.email,
					user_role: context.user.role
				} : undefined;

				const { data: geocodeJob, error: geocodeError } = await fluxbaseService.jobs.submit(
					'reverse-geocoding',
					{},
					{
						namespace: 'wayli',
						priority: 4,
						onBehalfOf
					}
				);

				if (geocodeError) {
					console.warn(`⚠️ Failed to queue reverse geocoding job: ${geocodeError.message}`);
				} else {
					console.log(`✅ Reverse geocoding job queued: ${(geocodeJob as any)?.job_id || 'unknown'}`);
				}
			} catch (geocodeQueueError) {
				console.warn(`⚠️ Error queueing reverse geocoding job:`, geocodeQueueError);
			}
		}

		return {
			success: true,
			result: {
				importedCount: results.importedCount,
				fileName: payload.fileName,
				format: 'OwnTracks'
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in OwnTracks import job:`, error);
		throw error;
	}
}

/**
 * Stream-based OwnTracks processor for memory-efficient parsing of CSV files.
 * Processes lines in batches as they are read from the stream.
 */
async function processOwnTracksStream(
	stream: ReadableStream<Uint8Array>,
	totalBytes: number,
	userId: string,
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

	const BATCH_SIZE = 240;
	let pointBuffer: OwnTracksPoint[] = [];
	let lineIndex = 0;
	let bytesRead = 0;
	let lastLogTime = startTime;
	let processedPointCount = 0;

	// Buffer for incomplete lines across chunks
	let lineBuffer = '';

	console.log(`🔄 True streaming mode: Processing OwnTracks lines in batches of ${BATCH_SIZE}`);
	console.log(`📦 File size: ${totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'}`);

	// Process a batch of points
	const processBatch = async () => {
		if (pointBuffer.length === 0) return;

		const batch = pointBuffer.slice(0, BATCH_SIZE);
		pointBuffer = pointBuffer.slice(BATCH_SIZE);

		const result = await processPointChunk(batch, userId, processedPointCount, fluxbase);
		processedPointCount += batch.length;

		importedCount += result.imported;
		skippedCount += result.skipped;
		errorCount += result.errors;
		duplicatesCount += result.duplicates;

		for (const [k, v] of Object.entries(result.errorSummary.counts)) {
			errorSummary.counts[k] = (errorSummary.counts[k] || 0) + v;
		}
		for (const s of result.errorSummary.samples) {
			if (errorSummary.samples.length < 10) errorSummary.samples.push(s);
		}
	};

	// Parse a single CSV line into an OwnTracksPoint
	const parseLine = (line: string): OwnTracksPoint | null => {
		const trimmed = line.trim();
		if (!trimmed) return null;

		const parts = trimmed.split(',');
		if (parts.length < 3) return null;

		const timestamp = parseInt(parts[0]);
		const lat = parseFloat(parts[1]);
		const lon = parseFloat(parts[2]);

		if (isNaN(timestamp) || isNaN(lat) || isNaN(lon)) {
			return null;
		}

		return {
			timestamp,
			lat,
			lon,
			altitude: parts[3] ? parseFloat(parts[3]) : null,
			accuracy: parts[4] ? parseFloat(parts[4]) : null,
			verticalAccuracy: parts[5] ? parseFloat(parts[5]) : null,
			speed: parts[6] ? parseFloat(parts[6]) : null,
			heading: parts[7] ? parseFloat(parts[7]) : null,
			event: parts[8] || null
		};
	};

	// Stream the file and process line by line
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			bytesRead += value.length;
			const chunk = decoder.decode(value, { stream: true });

			// Combine with any leftover from previous chunk
			lineBuffer += chunk;

			// Split into lines, keeping the last incomplete line in buffer
			const lines = lineBuffer.split('\n');
			lineBuffer = lines.pop() || ''; // Keep incomplete line for next iteration

			// Process complete lines
			for (const line of lines) {
				lineIndex++;
				const point = parseLine(line);

				if (point) {
					pointBuffer.push(point);
				} else if (line.trim()) {
					skippedCount++;
					errorSummary.counts['invalid line'] = (errorSummary.counts['invalid line'] || 0) + 1;
					if (errorSummary.samples.length < 10) {
						errorSummary.samples.push({ idx: lineIndex, reason: 'invalid line format' });
					}
				}
			}

			// Process batches as they accumulate
			while (pointBuffer.length >= BATCH_SIZE) {
				await processBatch();
			}

			// Update progress
			const currentTime = Date.now();
			if (currentTime - lastLogTime > 5000) {
				const progress = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 100) : 0;
				const elapsedSeconds = (currentTime - startTime) / 1000;
				const rate = lineIndex > 0 ? (lineIndex / elapsedSeconds).toFixed(1) : '0';
				const mbRead = (bytesRead / 1024 / 1024).toFixed(2);
				const mbTotal = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(2) : '?';

				console.log(
					`📈 Progress: ${mbRead}/${mbTotal} MB (${progress}%) - Lines: ${lineIndex.toLocaleString()} - Rate: ${rate}/sec - Imported: ${importedCount.toLocaleString()} - Buffer: ${pointBuffer.length}`
				);

				const topErrors = Object.entries(errorSummary.counts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 3)
					.map(([k, v]) => `${k}: ${v}`)
					.join('; ');

				safeReportProgress(
					job,
					progress,
					`🗺️ Streaming OwnTracks... ${mbRead}/${mbTotal} MB - ${lineIndex.toLocaleString()} lines - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
				);

				lastLogTime = currentTime;
			}
		}

		// Process any remaining content in the line buffer
		if (lineBuffer.trim()) {
			lineIndex++;
			const point = parseLine(lineBuffer);
			if (point) {
				pointBuffer.push(point);
			} else {
				skippedCount++;
			}
		}

		// Process remaining points
		while (pointBuffer.length > 0) {
			await processBatch();
		}

		safeReportProgress(job, 100, `🗺️ Import complete - ${lineIndex.toLocaleString()} lines processed`);
		console.log(`📊 Streaming complete: ${lineIndex.toLocaleString()} total lines parsed`);
	} finally {
		reader.releaseLock();
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount };
}

async function processPointChunk(
	points: OwnTracksPoint[],
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
		tz_diff: number | null;
		created_at: string;
	}> = [];

	for (let i = 0; i < points.length; i++) {
		const point = points[i];

		const countryCode = safeNormalizeCountryCode(safeGetCountryForPoint(point.lat, point.lon));
		const recordedAt = applyTimezoneCorrectionToTimestamp(point.timestamp * 1000, point.lat, point.lon);
		const tzDiff = getTimezoneDifferenceForPoint(point.lat, point.lon);

		const geocodeFeature = {
			type: 'Feature',
			geometry: {
				type: 'Point',
				coordinates: [point.lon, point.lat]
			},
			properties: {
				import_source: 'owntracks',
				data_type: 'location_point',
				event: point.event,
				vertical_accuracy: point.verticalAccuracy,
				imported_at: new Date().toISOString()
			}
		};

		trackerData.push({
			user_id: userId,
			tracker_type: 'import',
			location: `POINT(${point.lon} ${point.lat})`,
			recorded_at: recordedAt,
			country_code: countryCode,
			geocode: geocodeFeature,
			altitude: point.altitude,
			accuracy: point.accuracy,
			speed: point.speed,
			heading: point.heading,
			tz_diff: tzDiff,
			created_at: new Date().toISOString()
		});
	}

	if (trackerData.length > 0) {
		try {
			// Deduplicate within the batch
			const deduplicatedData = Array.from(
				trackerData
					.reduce((map, item) => {
						const key = `${item.user_id}|${item.recorded_at}`;
						map.set(key, item);
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
				ignoreDuplicates: true
			});

			if (!error) {
				imported = deduplicatedData.length;
			} else {
				console.log(`❌ Batch insert failed with error:`, error);
				errors += deduplicatedData.length;
				const code = (error as any).code || 'unknown';
				const message = (error as any).message || 'unknown error';
				errorSummary.counts[`db ${code}`] = (errorSummary.counts[`db ${code}`] || 0) + deduplicatedData.length;
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

