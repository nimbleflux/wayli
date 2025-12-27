/**
 * Import GPS data from GPX format
 *
 * Processes uploaded GPX files using streaming XML parsing for memory efficiency.
 * Extracts track points, routes, and waypoints and imports them into the tracker_data table.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:memory 512
 * @fluxbase:allow-read true
 * @fluxbase:allow-env true
 */

import {
	getCountryForPoint,
	normalizeCountryCode,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '_shared/services/external/country-reverse-geocoding.service';

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

/**
 * Wait for an RPC job to complete by polling its status.
 */
async function waitForRpcCompletion(
	fluxbase: FluxbaseClient,
	executionId: string,
	job: JobUtils,
	maxWaitMs: number = 300000, // 5 minutes max
	pollIntervalMs: number = 2000 // Poll every 2 seconds
): Promise<void> {
	const startTime = Date.now();
	console.log(`⏳ Waiting for RPC execution ${executionId} to complete...`);

	while (Date.now() - startTime < maxWaitMs) {
		try {
			const { data: status } = await (fluxbase.rpc as any).getStatus(executionId);
			console.log(`📊 RPC status for ${executionId}:`, JSON.stringify(status));

			if (status?.status === 'completed' || status?.status === 'success') {
				console.log(`✅ RPC execution ${executionId} completed successfully`);
				return;
			}

			if (status?.status === 'failed' || status?.status === 'error') {
				console.warn(`⚠️ RPC execution ${executionId} failed: ${status?.error_message || status?.error || status?.message || 'unknown error'}`);
				return;
			}

			// Still running, log progress if available
			if (status?.progress !== undefined) {
				safeReportProgress(job, status.progress, `🧮 Distance calculation: ${status.progress}%`);
			}
		} catch (err) {
			console.warn(`⚠️ Error checking RPC status:`, err);
		}

		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	console.warn(`⚠️ RPC execution ${executionId} timed out after ${maxWaitMs / 1000}s`);
}

interface DataImportPayload {
	storagePath: string;
	format: string;
	fileName: string;
}

interface GPXPoint {
	lat: number;
	lon: number;
	time?: string;
	ele?: number;
	name?: string;
	desc?: string;
	type: 'waypoint' | 'trackpoint' | 'routepoint';
	country_code?: string;
	tz_diff?: number;
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
		console.log('🗺️ Starting GPX import with streaming XML parsing...');
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

		safeReportProgress(job, 0, `🗺️ Streaming GPX data...`);

		const startTime = Date.now();
		const results = await processGPXStream(stream, totalBytes, userId, fluxbase, job, startTime, payload.fileName);

		const totalTime = (Date.now() - startTime) / 1000;
		console.log(`✅ GPX import completed!`);
		console.log(`📊 Final stats:`);
		console.log(`   📥 Imported: ${results.importedCount.toLocaleString()} points`);
		console.log(`   ⏭️ Skipped (invalid): ${results.skippedCount.toLocaleString()} points`);
		console.log(`   🔄 Duplicates (in batch): ${results.duplicatesCount.toLocaleString()} points`);
		console.log(`   📋 Already exists: ${results.alreadyExistsCount.toLocaleString()} points`);
		console.log(`   ❌ Errors: ${results.errorCount.toLocaleString()} points`);
		console.log(`   ⏱️ Total time: ${totalTime.toFixed(1)}s`);
		console.log(`   🚀 Average rate: ${(results.importedCount / totalTime).toFixed(1)} points/sec`);

		// Trigger distance calculation RPC after import
		if (results.importedCount > 0) {
			console.log(`🧮 Triggering distance calculation RPC for user ${userId}...`);
			try {
				const { data: rpcResult, error: rpcError } = await fluxbase.rpc.invoke('calculate-distances-batch', {}, {
					namespace: 'wayli',
					async: true  // run asynchronously to avoid request timeout
				});

				if (rpcError) {
					console.warn(`⚠️ Failed to trigger distance calculation RPC: ${rpcError.message}`);
				} else {
					console.log(`✅ Distance calculation RPC triggered: ${rpcResult || 'started'}`);

					// Wait for RPC job to complete
					const executionId = (rpcResult as any)?.execution_id || rpcResult;
					if (executionId) {
						await waitForRpcCompletion(fluxbase, executionId, job);
					}
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

		// Clean up: remove the uploaded file from storage after successful import
		console.log(`🧹 Removing uploaded file from storage: ${payload.storagePath}`);
		try {
			const { error: removeError } = await fluxbase.storage
				.from('temp-files')
				.remove([payload.storagePath]);

			if (removeError) {
				console.warn(`⚠️ Failed to remove uploaded file: ${removeError.message}`);
			} else {
				console.log(`✅ Uploaded file removed from storage`);
			}
		} catch (cleanupError) {
			console.warn(`⚠️ Error removing uploaded file:`, cleanupError);
			// Don't fail the import if cleanup fails
		}

		return {
			success: true,
			result: {
				importedCount: results.importedCount,
				fileName: payload.fileName,
				format: 'GPX'
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in GPX import job:`, error);
		throw error;
	}
}

/**
 * Stream-based GPX processor using SAX-style parsing for memory efficiency.
 * Processes points in batches as they are parsed from the stream.
 */
async function processGPXStream(
	stream: ReadableStream<Uint8Array>,
	totalBytes: number,
	userId: string,
	fluxbase: FluxbaseClient,
	job: JobUtils,
	startTime: number,
	fileName: string
): Promise<{
	importedCount: number;
	skippedCount: number;
	errorCount: number;
	duplicatesCount: number;
	alreadyExistsCount: number;
}> {
	// Import SAX parser for streaming XML
	const sax = await import('npm:sax');
	const saxParser = sax.parser(true, { trim: true, normalize: true });

	let importedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;
	let duplicatesCount = 0;
	let alreadyExistsCount = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	const BATCH_SIZE = 240;
	let pointBuffer: GPXPoint[] = [];
	let pointIndex = 0;
	let bytesRead = 0;
	let lastLogTime = startTime;
	let processedPointCount = 0;

	// SAX parser state
	let currentElement = '';
	let currentPoint: Partial<GPXPoint> | null = null;
	let elementStack: string[] = [];
	let textContent = '';

	console.log(`🔄 True streaming mode: Processing GPX points in batches of ${BATCH_SIZE}`);

	// Process a batch of points
	const processBatch = async () => {
		if (pointBuffer.length === 0) return;

		const batch = pointBuffer.slice(0, BATCH_SIZE);
		pointBuffer = pointBuffer.slice(BATCH_SIZE);

		const result = await processPointChunk(batch, userId, processedPointCount, fluxbase, fileName);
		processedPointCount += batch.length;

		importedCount += result.imported;
		skippedCount += result.skipped;
		errorCount += result.errors;
		duplicatesCount += result.duplicates;
		alreadyExistsCount += result.alreadyExists;

		for (const [k, v] of Object.entries(result.errorSummary.counts)) {
			errorSummary.counts[k] = (errorSummary.counts[k] || 0) + v;
		}
		for (const s of result.errorSummary.samples) {
			if (errorSummary.samples.length < 10) errorSummary.samples.push(s);
		}
	};

	// Set up SAX parser handlers
	saxParser.onopentag = (node: { name: string; attributes: Record<string, string> }) => {
		elementStack.push(node.name.toLowerCase());
		currentElement = node.name.toLowerCase();
		textContent = '';

		if (currentElement === 'trkpt' || currentElement === 'rtept') {
			currentPoint = {
				lat: parseFloat(node.attributes.lat || node.attributes.LAT || ''),
				lon: parseFloat(node.attributes.lon || node.attributes.LON || ''),
				type: currentElement === 'trkpt' ? 'trackpoint' : 'routepoint'
			};
		} else if (currentElement === 'wpt') {
			currentPoint = {
				lat: parseFloat(node.attributes.lat || node.attributes.LAT || ''),
				lon: parseFloat(node.attributes.lon || node.attributes.LON || ''),
				type: 'waypoint'
			};
		}
	};

	saxParser.ontext = (text: string) => {
		textContent += text;
	};

	saxParser.oncdata = (text: string) => {
		textContent += text;
	};

	saxParser.onclosetag = (tagName: string) => {
		const tag = tagName.toLowerCase();

		if (currentPoint) {
			if (tag === 'time') {
				currentPoint.time = textContent.trim();
			} else if (tag === 'ele') {
				currentPoint.ele = parseFloat(textContent.trim());
			} else if (tag === 'name') {
				currentPoint.name = textContent.trim();
			} else if (tag === 'desc') {
				currentPoint.desc = textContent.trim();
			} else if (tag === 'country' || tag === 'countrycode' || tag === 'country_code') {
				currentPoint.country_code = textContent.trim();
			} else if (tag === 'tz_diff' || tag === 'tzdiff' || tag === 'timezone_offset' || tag === 'utc_offset') {
				const val = parseFloat(textContent.trim());
				if (!isNaN(val)) {
					currentPoint.tz_diff = val;
				}
			}
		}

		if (tag === 'trkpt' || tag === 'rtept' || tag === 'wpt') {
			if (currentPoint && currentPoint.lat !== undefined && currentPoint.lon !== undefined) {
				pointBuffer.push(currentPoint as GPXPoint);
				pointIndex++;
			}
			currentPoint = null;
		}

		elementStack.pop();
		currentElement = elementStack[elementStack.length - 1] || '';
		textContent = '';
	};

	// Stream the file through the SAX parser
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	// Create a promise that resolves when parsing is complete
	let parseResolve: () => void;
	let parseReject: (err: Error) => void;
	const parseComplete = new Promise<void>((resolve, reject) => {
		parseResolve = resolve;
		parseReject = reject;
	});

	saxParser.onend = () => parseResolve();
	saxParser.onerror = (err: Error) => {
		console.error('SAX parser error:', err);
		parseReject(err);
	};

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				saxParser.close();
				await parseComplete;
				break;
			}

			bytesRead += value.length;
			const chunk = decoder.decode(value, { stream: true });

			try {
				saxParser.write(chunk);
			} catch (parseErr) {
				console.warn('SAX parse warning:', parseErr);
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
				const rate = pointIndex > 0 ? (pointIndex / elapsedSeconds).toFixed(1) : '0';
				const mbRead = (bytesRead / 1024 / 1024).toFixed(2);
				const mbTotal = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(2) : '?';

				console.log(
					`📈 Progress: ${mbRead}/${mbTotal} MB (${progress}%) - Points: ${pointIndex.toLocaleString()} - Rate: ${rate}/sec - Imported: ${importedCount.toLocaleString()} - Buffer: ${pointBuffer.length}`
				);

				const topErrors = Object.entries(errorSummary.counts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 3)
					.map(([k, v]) => `${k}: ${v}`)
					.join('; ');

				safeReportProgress(
					job,
					progress,
					`🗺️ Streaming GPX... ${mbRead}/${mbTotal} MB - ${pointIndex.toLocaleString()} points - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
				);

				lastLogTime = currentTime;
			}
		}

		// Process remaining points
		while (pointBuffer.length > 0) {
			await processBatch();
		}

		safeReportProgress(job, 100, `🗺️ Import complete - ${pointIndex.toLocaleString()} points processed`);
		console.log(`📊 Streaming complete: ${pointIndex.toLocaleString()} total points parsed`);
	} finally {
		reader.releaseLock();
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount, alreadyExistsCount };
}

async function processPointChunk(
	points: GPXPoint[],
	userId: string,
	chunkStart: number,
	fluxbase: FluxbaseClient,
	fileName: string
): Promise<{
	imported: number;
	skipped: number;
	errors: number;
	duplicates: number;
	alreadyExists: number;
	errorSummary: ErrorSummary;
}> {
	let imported = 0;
	let skipped = 0;
	let errors = 0;
	let duplicates = 0;
	let alreadyExists = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	const trackerData: Array<{
		user_id: string;
		tracker_type: string;
		location: string;
		recorded_at: string;
		country_code: string | null;
		geocode: unknown;
		altitude: number | null;
		tz_diff: number | null;
		created_at: string;
	}> = [];

	for (let i = 0; i < points.length; i++) {
		const point = points[i];

		if (isNaN(point.lat) || isNaN(point.lon)) {
			skipped++;
			errorSummary.counts['invalid coordinates'] = (errorSummary.counts['invalid coordinates'] || 0) + 1;
			if (errorSummary.samples.length < 10)
				errorSummary.samples.push({ idx: chunkStart + i, reason: 'invalid coordinates' });
			continue;
		}

		// Use imported country code if available, otherwise calculate
		const countryCode = point.country_code
			? safeNormalizeCountryCode(point.country_code)
			: safeNormalizeCountryCode(safeGetCountryForPoint(point.lat, point.lon));
		let recordedAt = point.time || new Date().toISOString();

		if (point.time) {
			recordedAt = applyTimezoneCorrectionToTimestamp(point.time, point.lat, point.lon);
		}

		// Use imported timezone if available, otherwise calculate
		const tzDiff = point.tz_diff !== undefined ? point.tz_diff : getTimezoneDifferenceForPoint(point.lat, point.lon);

		const geocodeFeature = {
			type: 'Feature',
			geometry: {
				type: 'Point',
				coordinates: [point.lon, point.lat]
			},
			properties: {
				name: point.name || undefined,
				description: point.desc || `Imported from ${fileName}`,
				import_source: 'gpx',
				data_type: point.type,
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
			altitude: point.ele ?? null,
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

			// Filter out records that already exist in the database
			const timestamps = deduplicatedData.map((d) => d.recorded_at);
			const existingTimestamps = await filterExistingRecords(fluxbase, userId, timestamps);
			const newRecords = deduplicatedData.filter((d) => !existingTimestamps.has(d.recorded_at));
			alreadyExists += deduplicatedData.length - newRecords.length;

			if (newRecords.length === 0) {
				// All records already exist, nothing to insert
				return { imported, skipped, errors, duplicates, alreadyExists, errorSummary };
			}

			const { error } = await fluxbase.from('tracker_data').insert(newRecords);

			if (!error) {
				imported = newRecords.length;
			} else {
				console.log(`❌ Batch insert failed with error:`, error);
				errors += newRecords.length;
				const code = (error as any).code || 'unknown';
				const message = (error as any).message || 'unknown error';
				errorSummary.counts[`db ${code}`] = (errorSummary.counts[`db ${code}`] || 0) + newRecords.length;
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

	return { imported, skipped, errors, duplicates, alreadyExists, errorSummary };
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

/**
 * Filter out records that already exist in the database.
 * Returns a Set of recorded_at timestamps that already exist.
 * Chunks queries to avoid "Request Header Fields Too Large" errors.
 */
async function filterExistingRecords(
	fluxbase: FluxbaseClient,
	userId: string,
	recordedAtTimestamps: string[]
): Promise<Set<string>> {
	if (recordedAtTimestamps.length === 0) return new Set();

	const existingSet = new Set<string>();
	const CHUNK_SIZE = 50; // Avoid header size limits

	try {
		// Process in chunks to avoid "Request Header Fields Too Large" error
		for (let i = 0; i < recordedAtTimestamps.length; i += CHUNK_SIZE) {
			const chunk = recordedAtTimestamps.slice(i, i + CHUNK_SIZE);
			const { data: existing, error } = await fluxbase
				.from('tracker_data')
				.select('recorded_at')
				.eq('user_id', userId)
				.in('recorded_at', chunk);

			if (error) {
				console.warn('Failed to check existing records chunk:', error);
				// Continue with other chunks rather than failing completely
				continue;
			}

			for (const r of existing || []) {
				existingSet.add((r as { recorded_at: string }).recorded_at);
			}
		}

		return existingSet;
	} catch (e) {
		console.warn('Error checking existing records:', e);
		return new Set();
	}
}

