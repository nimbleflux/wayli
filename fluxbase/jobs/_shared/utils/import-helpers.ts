/**
 * Shared utilities for data import jobs
 *
 * Contains common functions used by all import format parsers (GeoJSON, GPX, KML).
 */

import {
	getCountryForPoint,
	normalizeCountryCode,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../services/external/country-reverse-geocoding.service.ts';

import type { FluxbaseClient, JobUtils } from '../../types.d.ts';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ErrorSummary {
	counts: Record<string, number>;
	samples: Array<{ idx: number; reason: string }>;
}

export interface ParseResult {
	importedCount: number;
	skippedCount: number;
	errorCount: number;
	duplicatesCount: number;
	alreadyExistsCount: number;
}

export interface ProcessChunkResult extends ParseResult {
	errorSummary: ErrorSummary;
}

export interface ImportPoint {
	lat: number;
	lon: number;
	ele?: number;
	time?: string;
	name?: string;
	description?: string;
	country_code?: string;
	tz_diff?: number;
	accuracy?: number;
	speed?: number;
	heading?: number;
	activity_type?: string;
	extendedData?: Record<string, unknown>;
}

export interface TrackerDataRecord {
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
}

// ============================================================================
// Progress Reporting
// ============================================================================

/**
 * Safe wrapper for reportProgress - logs if method doesn't exist
 */
export function safeReportProgress(job: JobUtils, percent: number, message: string): void {
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

// ============================================================================
// Country & Timezone Helpers
// ============================================================================

/**
 * Safely get country code for a point, returning null on error
 */
export function safeGetCountryForPoint(lat: number, lon: number): string | null {
	try {
		return getCountryForPoint(lat, lon);
	} catch (e) {
		console.warn('Failed to get country for point:', e);
		return null;
	}
}

/**
 * Safely normalize country code, returning null on error
 */
export function safeNormalizeCountryCode(countryCode: string | null): string | null {
	try {
		return normalizeCountryCode(countryCode);
	} catch (e) {
		console.warn('Failed to normalize country code:', e);
		return null;
	}
}

/**
 * Get country code for a point, using provided value or calculating from coordinates
 */
export function getCountryCodeForPoint(
	lat: number,
	lon: number,
	providedCode?: string | null
): string | null {
	if (providedCode) {
		return safeNormalizeCountryCode(providedCode);
	}
	return safeNormalizeCountryCode(safeGetCountryForPoint(lat, lon));
}

/**
 * Get timezone difference for a point
 */
export function getTimezoneForPoint(lat: number, lon: number, providedTzDiff?: number): number | null {
	if (providedTzDiff !== undefined) {
		return providedTzDiff;
	}
	return getTimezoneDifferenceForPoint(lat, lon);
}

/**
 * Apply timezone correction to a timestamp
 */
export function applyTimezoneCorrection(
	timestamp: string | number,
	lat: number,
	lon: number
): string {
	return applyTimezoneCorrectionToTimestamp(timestamp, lat, lon);
}

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Filter out records that already exist in the database.
 * Returns a Set of recorded_at timestamps that already exist.
 * Chunks queries to avoid "Request Header Fields Too Large" errors.
 */
export async function filterExistingRecords(
	fluxbase: FluxbaseClient,
	userId: string,
	recordedAtTimestamps: string[]
): Promise<Set<string>> {
	if (recordedAtTimestamps.length === 0) return new Set();

	const existingSet = new Set<string>();
	const CHUNK_SIZE = 50; // Avoid header size limits

	try {
		for (let i = 0; i < recordedAtTimestamps.length; i += CHUNK_SIZE) {
			const chunk = recordedAtTimestamps.slice(i, i + CHUNK_SIZE);
			const { data: existing, error } = await fluxbase
				.from('tracker_data')
				.select('recorded_at')
				.eq('user_id', userId)
				.in('recorded_at', chunk);

			if (error) {
				console.warn('Failed to check existing records chunk:', error);
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

/**
 * Deduplicate records within a batch by (user_id, recorded_at)
 */
export function deduplicateBatch<T extends { user_id: string; recorded_at: string }>(
	records: T[]
): { deduplicated: T[]; duplicateCount: number } {
	const deduplicatedData = Array.from(
		records
			.reduce((map, item) => {
				const key = `${item.user_id}|${item.recorded_at}`;
				map.set(key, item);
				return map;
			}, new Map<string, T>())
			.values()
	);

	return {
		deduplicated: deduplicatedData,
		duplicateCount: records.length - deduplicatedData.length
	};
}

// ============================================================================
// RPC Helpers
// ============================================================================

/**
 * Wait for an RPC job to complete by polling its status.
 */
export async function waitForRpcCompletion(
	fluxbase: FluxbaseClient,
	executionId: string,
	job: JobUtils,
	maxWaitMs: number = 300000, // 5 minutes max
	pollIntervalMs: number = 2000 // Poll every 2 seconds
): Promise<void> {
	const startTime = Date.now();
	console.log(`Waiting for RPC execution ${executionId} to complete...`);

	while (Date.now() - startTime < maxWaitMs) {
		try {
			const { data: status } = await (fluxbase.rpc as any).getStatus(executionId);
			console.log(`RPC status for ${executionId}:`, JSON.stringify(status));

			if (status?.status === 'completed' || status?.status === 'success') {
				console.log(`RPC execution ${executionId} completed successfully`);
				return;
			}

			if (status?.status === 'failed' || status?.status === 'error') {
				console.warn(
					`RPC execution ${executionId} failed: ${status?.error_message || status?.error || status?.message || 'unknown error'}`
				);
				return;
			}

			if (status?.progress !== undefined) {
				safeReportProgress(job, status.progress, `Distance calculation: ${status.progress}%`);
			}
		} catch (err) {
			console.warn(`Error checking RPC status:`, err);
		}

		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	console.warn(`RPC execution ${executionId} timed out after ${maxWaitMs / 1000}s`);
}

// ============================================================================
// Point Processing
// ============================================================================

/**
 * Convert an ImportPoint to a TrackerDataRecord for database insertion
 */
export function pointToTrackerRecord(
	point: ImportPoint,
	userId: string,
	trackerType: string,
	fileName: string,
	importSource: string
): TrackerDataRecord | null {
	if (isNaN(point.lat) || isNaN(point.lon)) {
		return null;
	}

	const countryCode = getCountryCodeForPoint(point.lat, point.lon, point.country_code);
	let recordedAt = point.time || new Date().toISOString();

	if (point.time) {
		recordedAt = applyTimezoneCorrection(point.time, point.lat, point.lon);
	}

	const tzDiff = getTimezoneForPoint(point.lat, point.lon, point.tz_diff);

	const geocodeFeature = {
		type: 'Feature',
		geometry: {
			type: 'Point',
			coordinates: [point.lon, point.lat]
		},
		properties: {
			name: point.name || undefined,
			description: point.description || `Imported from ${fileName}`,
			import_source: importSource,
			imported_at: new Date().toISOString(),
			...(point.extendedData || {})
		}
	};

	return {
		user_id: userId,
		tracker_type: trackerType,
		location: `POINT(${point.lon} ${point.lat})`,
		recorded_at: recordedAt,
		country_code: countryCode,
		geocode: geocodeFeature,
		altitude: point.ele ?? null,
		accuracy: point.accuracy ?? null,
		speed: point.speed ?? null,
		heading: point.heading ?? null,
		activity_type: point.activity_type ?? null,
		tz_diff: tzDiff,
		created_at: new Date().toISOString()
	};
}

/**
 * Process a batch of points and insert into database
 */
export async function processPointBatch(
	points: ImportPoint[],
	userId: string,
	chunkStart: number,
	fluxbase: FluxbaseClient,
	fileName: string,
	trackerType: string,
	importSource: string
): Promise<ProcessChunkResult> {
	let imported = 0;
	let skipped = 0;
	let errors = 0;
	let duplicates = 0;
	let alreadyExists = 0;
	const errorSummary: ErrorSummary = { counts: {}, samples: [] };

	const trackerData: TrackerDataRecord[] = [];

	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const record = pointToTrackerRecord(point, userId, trackerType, fileName, importSource);

		if (!record) {
			skipped++;
			errorSummary.counts['invalid coordinates'] = (errorSummary.counts['invalid coordinates'] || 0) + 1;
			if (errorSummary.samples.length < 10) {
				errorSummary.samples.push({ idx: chunkStart + i, reason: 'invalid coordinates' });
			}
			continue;
		}

		trackerData.push(record);
	}

	if (trackerData.length > 0) {
		try {
			// Deduplicate within the batch
			const { deduplicated, duplicateCount } = deduplicateBatch(trackerData);
			if (duplicateCount > 0) {
				duplicates += duplicateCount;
				skipped += duplicateCount;
			}

			// Filter out records that already exist in the database
			const timestamps = deduplicated.map((d) => d.recorded_at);
			const existingTimestamps = await filterExistingRecords(fluxbase, userId, timestamps);
			const newRecords = deduplicated.filter((d) => !existingTimestamps.has(d.recorded_at));
			alreadyExists += deduplicated.length - newRecords.length;

			if (newRecords.length === 0) {
				return { imported, skipped, errors, duplicates, alreadyExists, errorSummary };
			}

			const { error } = await fluxbase.from('tracker_data').insert(newRecords);

			if (!error) {
				imported = newRecords.length;
			} else {
				console.log(`Batch insert failed with error:`, error);
				errors += newRecords.length;
				const code = (error as any).code || 'unknown';
				const message = (error as any).message || 'unknown error';
				errorSummary.counts[`db ${code}`] = (errorSummary.counts[`db ${code}`] || 0) + newRecords.length;
				if (errorSummary.samples.length < 10) {
					errorSummary.samples.push({ idx: chunkStart, reason: `db ${code}: ${message}` });
				}
			}
		} catch (outerError: any) {
			console.log(`Outer batch processing error:`, outerError);
			errors += trackerData.length;
			const msg = outerError?.message || 'outer processing error';
			errorSummary.counts[msg] = (errorSummary.counts[msg] || 0) + trackerData.length;
			if (errorSummary.samples.length < 10) {
				errorSummary.samples.push({ idx: chunkStart, reason: msg });
			}
		}
	}

	return { imported, skipped, errors, duplicates, alreadyExists, errorSummary };
}

// ============================================================================
// Error Summary Helpers
// ============================================================================

/**
 * Merge error summaries from multiple batches
 */
export function mergeErrorSummaries(target: ErrorSummary, source: ErrorSummary): void {
	for (const [k, v] of Object.entries(source.counts)) {
		target.counts[k] = (target.counts[k] || 0) + v;
	}
	for (const s of source.samples) {
		if (target.samples.length < 10) {
			target.samples.push(s);
		}
	}
}

/**
 * Format top errors for progress message
 */
export function formatTopErrors(errorSummary: ErrorSummary, limit: number = 3): string {
	return Object.entries(errorSummary.counts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([k, v]) => `${k}: ${v}`)
		.join('; ');
}
