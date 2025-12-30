/**
 * KML Streaming Parser
 *
 * Memory-efficient streaming parser for KML files.
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
const IMPORT_SOURCE = 'kml';

/**
 * Parse a KML stream and import points to the database
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

	let pointBuffer: ImportPoint[] = [];
	let pointIndex = 0;
	let bytesRead = 0;
	let lastLogTime = startTime;
	let processedPointCount = 0;

	// SAX parser state
	let currentElement = '';
	let elementStack: string[] = [];
	let textContent = '';

	// KML-specific parsing state
	let currentPlacemark: Partial<ImportPoint> | null = null;
	let inPlacemark = false;
	let inPoint = false;
	let currentExtendedDataKey = '';
	let extendedData: Record<string, string> = {};

	console.log(`Streaming KML: Processing points in batches of ${BATCH_SIZE}`);

	// Process a batch of points
	const processBatch = async () => {
		if (pointBuffer.length === 0) return;

		const batch = pointBuffer.slice(0, BATCH_SIZE);
		pointBuffer = pointBuffer.slice(BATCH_SIZE);

		const result = await processPointBatch(
			batch,
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

		if (currentElement === 'placemark') {
			inPlacemark = true;
			currentPlacemark = {};
			extendedData = {};
		} else if (currentElement === 'point' && inPlacemark) {
			inPoint = true;
		} else if (currentElement === 'data' && inPlacemark) {
			// KML ExtendedData <Data name="key">
			currentExtendedDataKey = node.attributes.name || node.attributes.NAME || '';
		} else if (currentElement === 'simplearraydata' && inPlacemark) {
			// Alternative ExtendedData format
			currentExtendedDataKey = node.attributes.name || node.attributes.NAME || '';
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

		if (inPlacemark && currentPlacemark) {
			if (tag === 'name') {
				currentPlacemark.name = textContent.trim();
			} else if (tag === 'description') {
				currentPlacemark.description = textContent.trim();
			} else if (tag === 'coordinates' && inPoint) {
				// KML coordinates format: lon,lat,elevation (space-separated for multiple)
				// We only handle single points here
				const coordText = textContent.trim();
				const coords = coordText.split(',').map((c) => parseFloat(c.trim()));
				if (coords.length >= 2) {
					currentPlacemark.lon = coords[0];
					currentPlacemark.lat = coords[1];
					if (coords.length >= 3 && !isNaN(coords[2])) {
						currentPlacemark.ele = coords[2];
					}
				}
			} else if (tag === 'when') {
				// TimeStamp element
				currentPlacemark.time = textContent.trim();
			} else if (tag === 'begin' && !currentPlacemark.time) {
				// TimeSpan begin - use as timestamp if no TimeStamp
				currentPlacemark.time = textContent.trim();
			} else if (tag === 'value' && currentExtendedDataKey) {
				// ExtendedData value
				extendedData[currentExtendedDataKey] = textContent.trim();
			} else if (tag === 'data' || tag === 'simplearraydata') {
				currentExtendedDataKey = '';
			}
		}

		if (tag === 'point') {
			inPoint = false;
		} else if (tag === 'placemark') {
			// Finalize placemark - only add if it has valid Point coordinates
			if (currentPlacemark && currentPlacemark.lat !== undefined && currentPlacemark.lon !== undefined) {
				// Add extended data if any
				if (Object.keys(extendedData).length > 0) {
					currentPlacemark.extendedData = { ...extendedData };

					// Check for common timestamp fields in extended data
					if (!currentPlacemark.time) {
						const timeField =
							extendedData.timestamp || extendedData.time || extendedData.datetime || extendedData.recorded_at;
						if (timeField) {
							currentPlacemark.time = timeField;
						}
					}

					// Check for country code in extended data
					const countryField = extendedData.country_code || extendedData.countrycode || extendedData.country;
					if (countryField) {
						currentPlacemark.country_code = countryField;
					}

					// Check for timezone in extended data
					const tzField = extendedData.tz_diff || extendedData.timezone_offset || extendedData.utc_offset;
					if (tzField) {
						const val = parseFloat(tzField);
						if (!isNaN(val)) {
							currentPlacemark.tz_diff = val;
						}
					}
				}

				pointBuffer.push(currentPlacemark as ImportPoint);
				pointIndex++;
			}

			currentPlacemark = null;
			inPlacemark = false;
			extendedData = {};
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
					`Streaming KML... ${mbRead}/${mbTotal} MB - ${pointIndex.toLocaleString()} points - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
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
