/**
 * GPX Streaming Parser
 *
 * Memory-efficient streaming parser for GPX files.
 * Uses SAX-style XML parsing for streaming.
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
const IMPORT_SOURCE = 'gpx';

interface GPXPoint extends ImportPoint {
	type: 'waypoint' | 'trackpoint' | 'routepoint';
}

/**
 * Parse a GPX stream and import points to the database
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
	// Import SAX parser for streaming XML
	const sax = await import('npm:sax');
	const saxParser = sax.parser(true, { trim: true, normalize: true });

	let importedCount = 0;
	let skippedCount = 0;
	let errorCount = 0;
	let duplicatesCount = 0;
	let alreadyExistsCount = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

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

	console.log(`Streaming GPX: Processing points in batches of ${BATCH_SIZE}`);

	// Process a batch of points
	const processBatch = async () => {
		if (pointBuffer.length === 0) return;

		const batch = pointBuffer.slice(0, BATCH_SIZE);
		pointBuffer = pointBuffer.slice(BATCH_SIZE);

		// Convert GPXPoints to ImportPoints (strip the 'type' field for processing)
		const importPoints: ImportPoint[] = batch.map((p) => ({
			lat: p.lat,
			lon: p.lon,
			ele: p.ele,
			time: p.time,
			name: p.name,
			description: p.description,
			country_code: p.country_code,
			tz_diff: p.tz_diff,
			extendedData: { data_type: p.type }
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
				currentPoint.description = textContent.trim();
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
					`Progress: ${mbRead}/${mbTotal} MB (${progress}%) - Points: ${pointIndex.toLocaleString()} - Rate: ${rate}/sec - Imported: ${importedCount.toLocaleString()} - Buffer: ${pointBuffer.length}`
				);

				const topErrors = formatTopErrors(errorSummary);
				safeReportProgress(
					job,
					progress,
					`Streaming GPX... ${mbRead}/${mbTotal} MB - ${pointIndex.toLocaleString()} points - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
				);

				lastLogTime = currentTime;
			}
		}

		// Process remaining points
		while (pointBuffer.length > 0) {
			await processBatch();
		}

		safeReportProgress(job, 100, `Import complete - ${pointIndex.toLocaleString()} points processed`);
		console.log(`Streaming complete: ${pointIndex.toLocaleString()} total points parsed`);
	} finally {
		reader.releaseLock();
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount, alreadyExistsCount };
}
