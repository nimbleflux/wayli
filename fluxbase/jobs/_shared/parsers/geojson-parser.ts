/**
 * GeoJSON Streaming Parser
 *
 * Memory-efficient streaming parser for GeoJSON files.
 * Uses JSONParser with keepStack: false for optimal memory usage.
 */

import { JSONParser } from 'npm:@streamparser/json';
import type { Feature } from 'npm:@types/geojson';

import {
	type ImportPoint,
	type ParseResult,
	type ErrorSummary,
	safeReportProgress,
	processPointBatch,
	mergeErrorSummaries,
	formatTopErrors,
	applyTimezoneCorrection,
	getTimezoneForPoint
} from '../utils/import-helpers.ts';

import type { FluxbaseClient, JobUtils } from '../../types.d.ts';

const BATCH_SIZE = 240;
const TRACKER_TYPE = 'geojson';
const IMPORT_SOURCE = 'geojson';

/**
 * Parse a GeoJSON stream and import points to the database
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

	let featureBuffer: ImportPoint[] = [];
	let featureIndex = 0;
	let bytesRead = 0;
	let lastLogTime = startTime;
	let processedFeatureCount = 0;

	console.log(`Streaming GeoJSON: Processing features in batches of ${BATCH_SIZE}`);

	// Create streaming JSON parser with memory optimization
	const parser = new JSONParser({
		paths: ['$.features.*'],
		keepStack: false // Memory optimization: don't keep full stack
	});

	// Process a batch of features
	const processBatch = async () => {
		if (featureBuffer.length === 0) return;

		const batch = featureBuffer.slice(0, BATCH_SIZE);
		featureBuffer = featureBuffer.slice(BATCH_SIZE);

		const result = await processPointBatch(
			batch,
			userId,
			processedFeatureCount,
			fluxbase,
			fileName,
			TRACKER_TYPE,
			IMPORT_SOURCE
		);
		processedFeatureCount += batch.length;

		importedCount += result.imported;
		skippedCount += result.skipped;
		errorCount += result.errors;
		duplicatesCount += result.duplicates;
		alreadyExistsCount += result.alreadyExists;
		mergeErrorSummaries(errorSummary, result.errorSummary);
	};

	// Set up parser to collect features
	parser.onValue = ({ value }: { value: unknown }) => {
		const feature = value as Feature;
		const point = featureToImportPoint(feature);
		if (point) {
			featureBuffer.push(point);
			featureIndex++;
		} else {
			skippedCount++;
			const reason = feature?.geometry
				? `unsupported geometry ${feature.geometry.type}`
				: 'missing geometry';
			errorSummary.counts[reason] = (errorSummary.counts[reason] || 0) + 1;
			if (errorSummary.samples.length < 10) {
				errorSummary.samples.push({ idx: featureIndex, reason });
			}
			featureIndex++;
		}
	};

	// Stream the file through the parser
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			bytesRead += value.length;
			const chunk = decoder.decode(value, { stream: true });
			parser.write(chunk);

			// Process batches as they accumulate
			while (featureBuffer.length >= BATCH_SIZE) {
				await processBatch();
			}

			// Update progress (throttled to every 5 seconds)
			const currentTime = Date.now();
			if (currentTime - lastLogTime > 5000) {
				const progress = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 100) : 0;
				const elapsedSeconds = (currentTime - startTime) / 1000;
				const rate = featureIndex > 0 ? (featureIndex / elapsedSeconds).toFixed(1) : '0';
				const mbRead = (bytesRead / 1024 / 1024).toFixed(2);
				const mbTotal = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(2) : '?';

				console.log(
					`Progress: ${mbRead}/${mbTotal} MB (${progress}%) - Features: ${featureIndex.toLocaleString()} - Rate: ${rate}/sec - Imported: ${importedCount.toLocaleString()} - Buffer: ${featureBuffer.length}`
				);

				const topErrors = formatTopErrors(errorSummary);
				safeReportProgress(
					job,
					progress,
					`Streaming GeoJSON... ${mbRead}/${mbTotal} MB - ${featureIndex.toLocaleString()} features - ${rate}/sec${topErrors ? ` - Errors: ${topErrors}` : ''}`
				);

				lastLogTime = currentTime;
			}
		}

		// Process remaining features
		while (featureBuffer.length > 0) {
			await processBatch();
		}

		safeReportProgress(job, 100, `Import complete - ${featureIndex.toLocaleString()} features processed`);
		console.log(`Streaming complete: ${featureIndex.toLocaleString()} total features parsed`);
	} finally {
		reader.releaseLock();
	}

	return { importedCount, skippedCount, errorCount, duplicatesCount, alreadyExistsCount };
}

/**
 * Convert a GeoJSON Feature to an ImportPoint
 */
function featureToImportPoint(feature: Feature): ImportPoint | null {
	if (!feature || !feature.geometry) {
		return null;
	}

	if (feature.geometry.type !== 'Point' || !feature.geometry.coordinates) {
		return null;
	}

	const [longitude, latitude] = feature.geometry.coordinates;

	if (longitude === null || latitude === null || isNaN(longitude) || isNaN(latitude)) {
		return null;
	}

	const properties = (feature.properties || {}) as Record<string, unknown>;

	// Extract timestamp from various field names
	let time: string | undefined;
	if (typeof properties.recorded_at === 'string') {
		time = properties.recorded_at;
	} else if (typeof properties.timestamp === 'number') {
		const ts = properties.timestamp < 10000000000 ? properties.timestamp * 1000 : properties.timestamp;
		time = applyTimezoneCorrection(ts, latitude, longitude);
	} else if (properties.time !== undefined) {
		time = applyTimezoneCorrection(properties.time as string | number, latitude, longitude);
	} else if (properties.date !== undefined) {
		time = applyTimezoneCorrection(properties.date as string | number, latitude, longitude);
	}

	// Extract country code
	let country_code: string | undefined;
	if (typeof properties.countrycode === 'string') {
		country_code = properties.countrycode;
	} else if (typeof properties.country_code === 'string') {
		country_code = properties.country_code;
	} else if (typeof properties.country === 'string') {
		country_code = properties.country;
	}

	// Extract timezone
	let tz_diff: number | undefined;
	if (typeof properties.tz_diff === 'number') {
		tz_diff = properties.tz_diff;
	} else if (typeof properties.timezone_offset === 'number') {
		tz_diff = properties.timezone_offset;
	} else if (typeof properties.utc_offset === 'number') {
		tz_diff = properties.utc_offset;
	}

	// Extract other fields
	const altitude = typeof properties.altitude === 'number'
		? properties.altitude
		: typeof properties.elevation === 'number'
			? properties.elevation
			: undefined;

	const accuracy = typeof properties.accuracy === 'number' ? properties.accuracy : undefined;

	const speed = typeof properties.speed === 'number'
		? properties.speed
		: typeof properties.velocity === 'number'
			? properties.velocity
			: undefined;

	const heading = typeof properties.heading === 'number'
		? properties.heading
		: typeof properties.bearing === 'number'
			? properties.bearing
			: typeof properties.course === 'number'
				? properties.course
				: undefined;

	const activity_type = typeof properties.activity_type === 'string'
		? properties.activity_type
		: undefined;

	// Build extended data from geocode properties if present
	const extendedData = buildExtendedData(properties);

	return {
		lat: latitude,
		lon: longitude,
		ele: altitude,
		time,
		country_code,
		tz_diff,
		accuracy,
		speed,
		heading,
		activity_type,
		extendedData
	};
}

/**
 * Build extended data object from GeoJSON properties
 * Handles both nested geocode format (Wayli export) and flat format
 */
function buildExtendedData(properties: Record<string, unknown>): Record<string, unknown> | undefined {
	const nestedGeocode = properties.geocode as Record<string, unknown> | undefined;
	const hasNestedGeocode = nestedGeocode && typeof nestedGeocode === 'object' && nestedGeocode.geocoded_at;
	const hasFlatGeocode = !!properties.geocoded_at;

	if (hasNestedGeocode) {
		// Wayli export format: geocode data is nested in properties.geocode
		return {
			...nestedGeocode
		};
	} else if (hasFlatGeocode) {
		// Direct format: geocoded_at is already at properties level
		const {
			geocoded_at,
			geocoding_provider,
			label,
			display_name,
			address,
			city,
			country,
			confidence,
			layer,
			addendum,
			nearby_pois
		} = properties;

		return {
			...(geocoded_at && { geocoded_at }),
			...(geocoding_provider && { geocoding_provider }),
			...(label && { label }),
			...(display_name && { display_name }),
			...(address && { address }),
			...(city && { city }),
			...(country && { country }),
			...(confidence && { confidence }),
			...(layer && { layer }),
			...(addendum && { addendum }),
			...(nearby_pois && { nearby_pois })
		};
	}

	return undefined;
}
