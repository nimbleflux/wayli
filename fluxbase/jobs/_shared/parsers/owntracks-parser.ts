/**
 * OwnTracks Streaming Parser
 *
 * Memory-efficient streaming parser for OwnTracks CSV/REC files.
 * Uses line-by-line parsing for streaming large files.
 *
 * OwnTracks CSV format:
 * timestamp,lat,lon,altitude,accuracy,verticalAccuracy,speed,heading,event,country_code,tz_diff
 */

import {
	type ImportPoint,
	type ParseResult,
	type ErrorSummary,
	safeReportProgress,
	processPointBatch,
	mergeErrorSummaries,
	formatTopErrors
} from '../utils/import-helpers.ts';

import type { FluxbaseClient, JobUtils } from '../../types.d.ts';

const BATCH_SIZE = 240;
const TRACKER_TYPE = 'import';
const IMPORT_SOURCE = 'owntracks';

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
	country_code: string | null;
	tz_diff: number | null;
}

/**
 * Parse an OwnTracks stream and import points to the database
 */
export async function parseStream(
	stream: ReadableStream<Uint8Array>,
	totalBytes: number,
	userId: string,
	fluxbase: FluxbaseClient,
	job: JobUtils,
	startTime: number,
	fileName: string
): Promise<ParseResult> {
	let importedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;
	let duplicatesCount = 0;
	let alreadyExistsCount = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	let pointBuffer: OwnTracksPoint[] = [];
	let lineIndex = 0;
	let bytesRead = 0;
	let lastLogTime = startTime;
	let processedPointCount = 0;

	// Buffer for incomplete lines across chunks
	let lineBuffer = '';

	console.log(`Streaming OwnTracks: Processing lines in batches of ${BATCH_SIZE}`);

	// Process a batch of points
	const processBatch = async () => {
		if (pointBuffer.length === 0) return;

		const batch = pointBuffer.slice(0, BATCH_SIZE);
		pointBuffer = pointBuffer.slice(BATCH_SIZE);

		// Convert OwnTracksPoints to ImportPoints
		const importPoints: ImportPoint[] = batch.map((p) => ({
			lat: p.lat,
			lon: p.lon,
			ele: p.altitude ?? undefined,
			time: new Date(p.timestamp * 1000).toISOString(),
			accuracy: p.accuracy ?? undefined,
			speed: p.speed ?? undefined,
			heading: p.heading ?? undefined,
			country_code: p.country_code ?? undefined,
			tz_diff: p.tz_diff ?? undefined,
			extendedData: {
				data_type: 'location_point',
				event: p.event,
				vertical_accuracy: p.verticalAccuracy
			}
		}));

		const result = await processPointBatch(
			importPoints,
			userId,
			processedPointCount,
			fluxbase,
			fileName,
			TRACKER_TYPE,
			IMPORT_SOURCE
		);
		processedPointCount += batch.length;

		importedCount += result.imported;
		skippedCount += result.skipped;
		errorCount += result.errors;
		duplicatesCount += result.duplicates;
		alreadyExistsCount += result.alreadyExists;
		mergeErrorSummaries(errorSummary, result.errorSummary);
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
			event: parts[8] || null,
			country_code: parts[9] || null,
			tz_diff: parts[10] ? parseFloat(parts[10]) : null
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
					`Progress: ${mbRead}/${mbTotal} MB (${progress}%) - Lines: ${lineIndex.toLocaleString()} - Rate: ${rate}/sec - Imported: ${importedCount.toLocaleString()} - Buffer: ${pointBuffer.length}`
				);

				const topErrors = formatTopErrors(errorSummary);
				safeReportProgress(
					job,
					progress,
					`Streaming OwnTracks... ${mbRead}/${mbTotal} MB - ${lineIndex.toLocaleString()} lines - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
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

		safeReportProgress(job, 100, `Import complete - ${lineIndex.toLocaleString()} lines processed`);
		console.log(`Streaming complete: ${lineIndex.toLocaleString()} total lines parsed`);
	} finally {
		reader.releaseLock();
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount, alreadyExistsCount };
}
