/**
 * Export user data in various formats
 *
 * Generates exports of user's GPS data, trips, and want-to-visit lists in
 * GeoJSON or JSON format. Creates downloadable files in storage.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 900
 * @fluxbase:progress-timeout 900
 * @fluxbase:allow-read true
 * @fluxbase:allow-write true
 */

// Deno runtime types (available at runtime in Fluxbase Jobs)
declare const Deno: {
	open(
		path: string,
		options: { write?: boolean; create?: boolean; truncate?: boolean }
	): Promise<{ write(data: Uint8Array): Promise<number>; close(): void }>;
	readFile(path: string): Promise<Uint8Array>;
	remove(path: string): Promise<void>;
	stat(path: string): Promise<{ size: number }>;
};

import JSZip from 'jszip';
import {
	isGeoJSONGeocode,
	getDisplayNameFromGeoJSON,
	getAddressFromGeoJSON
} from '../../web/src/lib/utils/geojson-converter';

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

interface DataExportPayload {
	format: string;
	includeLocationData: boolean;
	includeWantToVisit: boolean;
	includeTrips: boolean;
	dateRange?: string;
	startDate?: string | null;
	endDate?: string | null;
}

interface TrackerLocation {
	location: { coordinates: [number, number] };
	recorded_at: string;
	altitude?: number;
	accuracy?: number;
	speed?: number;
	heading?: number;
	battery_level?: number;
	is_charging?: boolean;
	activity_type?: string;
	country_code?: string;
	geocode?: Record<string, unknown> | null;
}

interface ExportCounts {
	locations: number;
	wantToVisit: number;
	trips: number;
	total: number;
}

// Count records to be exported
async function countRecords(
	fluxbase: FluxbaseClient,
	userId: string,
	payload: DataExportPayload
): Promise<ExportCounts> {
	const counts: ExportCounts = { locations: 0, wantToVisit: 0, trips: 0, total: 0 };

	if (payload.includeLocationData) {
		let query = fluxbase.from('tracker_data').select('*', { count: 'exact', head: true }).eq('user_id', userId);
		if (payload.startDate) query = query.gte('recorded_at', payload.startDate);
		if (payload.endDate) query = query.lte('recorded_at', payload.endDate);
		const { count } = await query;
		counts.locations = count || 0;
	}

	if (payload.includeWantToVisit) {
		let query = fluxbase.from('want_to_visit_places').select('*', { count: 'exact', head: true }).eq('user_id', userId);
		if (payload.startDate) query = query.gte('created_at', payload.startDate);
		if (payload.endDate) query = query.lte('created_at', payload.endDate);
		const { count } = await query;
		counts.wantToVisit = count || 0;
	}

	if (payload.includeTrips) {
		let query = fluxbase.from('trips').select('*', { count: 'exact', head: true }).eq('user_id', userId);
		if (payload.startDate) query = query.gte('start_date', payload.startDate);
		if (payload.endDate) query = query.lte('end_date', payload.endDate);
		const { count } = await query;
		counts.trips = count || 0;
	}

	counts.total = counts.locations + counts.wantToVisit + counts.trips;
	return counts;
}

export async function handler(
	req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = context.payload as DataExportPayload;
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		console.log(`📦 Starting export job ${jobId}`);
		console.log('📋 Job data:', {
			userId,
			includeLocationData: payload.includeLocationData,
			includeWantToVisit: payload.includeWantToVisit,
			includeTrips: payload.includeTrips,
			startDate: payload.startDate,
			endDate: payload.endDate
		});

		console.log('⚙️ Export configuration:', {
			'Location Data': payload.includeLocationData ? '✅ INCLUDED' : '❌ EXCLUDED',
			'Want to Visit': payload.includeWantToVisit ? '✅ INCLUDED' : '❌ EXCLUDED',
			Trips: payload.includeTrips ? '✅ INCLUDED' : '❌ EXCLUDED',
			Format: payload.format,
			'Date Range':
				payload.startDate && payload.endDate
					? `${payload.startDate} to ${payload.endDate}`
					: 'All time'
		});

		safeReportProgress(job, 1, '📊 Counting records to export...');

		// First, count all records to be exported
		const counts = await countRecords(fluxbase, userId, payload);
		console.log('📊 Record counts:', counts);

		if (counts.total === 0) {
			console.log('⚠️ No records to export');
			return {
				success: false,
				error: 'No records found to export'
			};
		}

		safeReportProgress(job, 5, `📊 Found ${counts.total.toLocaleString()} records to export`);

		const zip = new JSZip();
		let totalFiles = 0;
		let processedRecords = 0;
		const tempFiles: string[] = []; // Track temp files for cleanup

		// Helper to calculate and report progress based on records processed
		const reportProgress = (currentProcessed: number, message: string) => {
			// Progress from 5% to 90% based on records processed
			const percent = Math.round(5 + (currentProcessed / counts.total) * 85);
			safeReportProgress(job, Math.min(percent, 90), message);
		};

		// Export location data if requested
		if (payload.includeLocationData && counts.locations > 0) {
			console.log(`📍 Starting location data export (${counts.locations.toLocaleString()} records)...`);
			const locationTempPath = await exportLocationDataToFile(
				fluxbase,
				userId,
				payload.startDate,
				payload.endDate,
				counts.locations,
				(processed, total) => {
					// Update progress based on actual records processed
					reportProgress(processed, `📍 Exporting locations: ${processed.toLocaleString()} / ${total.toLocaleString()}`);
				}
			);
			if (locationTempPath) {
				const fileSize = (await Deno.stat(locationTempPath)).size;
				console.log(`✅ Location data exported to temp file, size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
				// Use lazy loading - content is only read when zip is generated
				zip.file('locations.geojson', Deno.readFile(locationTempPath), { binary: true });
				tempFiles.push(locationTempPath);
				totalFiles++;
				processedRecords = counts.locations;
				reportProgress(processedRecords, `📍 Exported ${counts.locations.toLocaleString()} locations`);
				console.log('📦 Added locations.geojson to ZIP (lazy loaded)');
			}
		} else if (payload.includeLocationData) {
			console.log(`⏭️ No location data found for user ${userId}`);
		} else {
			console.log('⏭️ Location data export skipped (not requested)');
		}

		// Export want-to-visit data if requested
		if (payload.includeWantToVisit && counts.wantToVisit > 0) {
			console.log(`📌 Starting want-to-visit export (${counts.wantToVisit.toLocaleString()} records)...`);
			const wantToVisitTempPath = await exportWantToVisitToFile(
				fluxbase,
				userId,
				payload.startDate,
				payload.endDate
			);
			if (wantToVisitTempPath) {
				const fileSize = (await Deno.stat(wantToVisitTempPath)).size;
				console.log(`✅ Want-to-visit data exported to temp file, size: ${(fileSize / 1024).toFixed(2)} KB`);
				zip.file('want-to-visit.json', Deno.readFile(wantToVisitTempPath), { binary: true });
				tempFiles.push(wantToVisitTempPath);
				totalFiles++;
				processedRecords += counts.wantToVisit;
				reportProgress(processedRecords, `📌 Exported ${counts.wantToVisit.toLocaleString()} want-to-visit places`);
				console.log('📦 Added want-to-visit.json to ZIP (lazy loaded)');
			}
		} else if (payload.includeWantToVisit) {
			console.log(`⏭️ No want-to-visit data found for user ${userId}`);
		} else {
			console.log('⏭️ Want-to-visit export skipped (not requested)');
		}

		// Export trips data if requested
		if (payload.includeTrips && counts.trips > 0) {
			console.log(`✈️ Starting trips export (${counts.trips.toLocaleString()} records)...`);
			const tripsTempPath = await exportTripsToFile(fluxbase, userId, payload.startDate, payload.endDate);
			if (tripsTempPath) {
				const fileSize = (await Deno.stat(tripsTempPath)).size;
				console.log(`✅ Trips data exported to temp file, size: ${(fileSize / 1024).toFixed(2)} KB`);
				zip.file('trips.json', Deno.readFile(tripsTempPath), { binary: true });
				tempFiles.push(tripsTempPath);
				totalFiles++;
				processedRecords += counts.trips;
				reportProgress(processedRecords, `✈️ Exported ${counts.trips.toLocaleString()} trips`);
				console.log('📦 Added trips.json to ZIP (lazy loaded)');
			}
		} else if (payload.includeTrips) {
			console.log(`⏭️ No trips data found for user ${userId}`);
		} else {
			console.log('⏭️ Trips export skipped (not requested)');
		}

		// Generate zip file and stream upload directly (memory efficient)
		safeReportProgress(job, 90, '📦 Generating & uploading ZIP file...');
		console.log(`📦 Generating zip file for job ${jobId} with ${totalFiles} files`);

		const fileName = `export_${userId}_${Date.now()}.zip`;
		const filePath = `${userId}/${fileName}`;

		// Before uploading, delete old export files (keep only 5 most recent)
		try {
			const exportJobs = await getUserExportJobs(fluxbaseService, userId);
			const oldJobs = exportJobs.filter((j, idx) => idx >= 5 && j.file_path);
			if (oldJobs.length > 0) {
				const oldPaths = oldJobs
					.map((j) => j.file_path)
					.filter((p): p is string => typeof p === 'string');
				if (oldPaths.length > 0) {
					console.log(`🗑️ Deleting old export files:`, oldPaths);
					await fluxbaseService.storage.from('temp-files').remove(oldPaths);
				}
			}
		} catch (cleanupError) {
			console.warn('⚠️ Failed to cleanup old exports:', cleanupError);
		}

		// Generate zip file
		let lastZipProgress = 0;
		const zipData = await zip.generateAsync(
			{
				type: 'uint8array',
				streamFiles: true,
				compression: 'DEFLATE',
				compressionOptions: { level: 6 }
			},
			(metadata: { percent: number; currentFile: string | null }) => {
				const currentProgress = Math.floor(metadata.percent / 10) * 10;
				if (currentProgress > lastZipProgress) {
					lastZipProgress = currentProgress;
					const jobProgress = Math.round(90 + (metadata.percent / 100) * 4);
					safeReportProgress(job, jobProgress, `📦 Compressing: ${Math.round(metadata.percent)}%`);
				}
			}
		);

		const zipFileSize = zipData.length;
		console.log(`📊 Zip file generated: ${(zipFileSize / 1024 / 1024).toFixed(2)} MB`);

		safeReportProgress(job, 95, '📤 Uploading export file...');
		console.log('📤 Uploading to storage...');
		const storage = fluxbaseService.storage.from('temp-files');

		// Upload zip data directly
		const { error: uploadError } = await storage.upload(filePath, zipData, {
			contentType: 'application/zip',
			upsert: true
		});

		if (uploadError) {
			console.error(`❌ Upload failed:`, uploadError);
			throw new Error(`Failed to upload export file: ${uploadError.message}`);
		}

		console.log(`✅ Upload successful, total size: ${(zipFileSize / 1024 / 1024).toFixed(2)} MB`);

		// Cleanup temp files (location data temp file)
		for (const tempFile of tempFiles) {
			try {
				await Deno.remove(tempFile);
				console.log(`🗑️ Cleaned up temp file: ${tempFile}`);
			} catch {
				console.warn(`⚠️ Failed to cleanup temp file: ${tempFile}`);
			}
		}

		safeReportProgress(job, 100, '✅ Export completed!');

		console.log(`✅ Export job ${jobId} completed successfully.`);

		// Return result directly (not wrapped) - this becomes job.result
		return {
			totalFiles,
			totalRecords: counts.total,
			locationRecords: counts.locations,
			wantToVisitRecords: counts.wantToVisit,
			tripRecords: counts.trips,
			format: payload.format,
			exportedAt: new Date().toISOString(),
			file_path: filePath,
			file_size: zipFileSize
		};
	} catch (error: unknown) {
		console.error(`❌ Export processing failed for job ${jobId}:`, error);
		throw error;
	}
}

async function exportLocationDataToFile(
	fluxbase: FluxbaseClient,
	userId: string,
	startDate?: string | null,
	endDate?: string | null,
	totalCount?: number,
	onProgress?: (processed: number, total: number) => void
): Promise<string | null> {
	console.log('📍 exportLocationDataToFile', { userId, startDate, endDate, totalCount });
	const batchSize = 1000; // Supabase has a default limit of 1000 rows
	let totalFetched = 0;
	let batchNum = 0;
	let firstFeature = true;

	// Stream to temp file to avoid OOM for large exports
	const tempPath = `/tmp/export_locations_${Date.now()}.geojson`;
	const encoder = new TextEncoder();

	// Open file for writing
	const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });

	try {
		// Write GeoJSON header
		await file.write(encoder.encode('{"type":"FeatureCollection","features":['));

		// Use cursor-based pagination with recorded_at timestamp
		let lastRecordedAt: string | null = null;

		while (true) {
			let query = fluxbase.from('tracker_data').select('*').eq('user_id', userId);

			// Apply date range filters
			if (startDate) query = query.gte('recorded_at', startDate);
			if (endDate) query = query.lte('recorded_at', endDate);

			// Cursor-based pagination: fetch records after the last timestamp
			if (lastRecordedAt) {
				query = query.gt('recorded_at', lastRecordedAt);
			}

			query = query.order('recorded_at', { ascending: true }).limit(batchSize);
			const { data: locations, error } = await query;
			batchNum++;
			console.log(`📈 exportLocationData batch ${batchNum}`, {
				cursor: lastRecordedAt,
				count: locations?.length,
				error: error?.message
			});
			if (error) throw error;
			if (!locations || locations.length === 0) break;

			// Write features one by one to stream
			for (const location of locations as TrackerLocation[]) {
				// Handle geocode data - if it's in GeoJSON format, extract the properties
				let geocodeProperties = null;
				if (location.geocode) {
					if (isGeoJSONGeocode(location.geocode)) {
						const geocodeGeoJSON = location.geocode as Record<string, unknown>;
						geocodeProperties = geocodeGeoJSON.properties || null;
					} else {
						geocodeProperties = location.geocode;
					}
				}

				const feature = JSON.stringify({
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: [location.location.coordinates[0], location.location.coordinates[1]]
					},
					properties: {
						recorded_at: location.recorded_at,
						altitude: location.altitude,
						accuracy: location.accuracy,
						speed: location.speed,
						heading: location.heading,
						battery_level: location.battery_level,
						is_charging: location.is_charging,
						activity_type: location.activity_type,
						country_code: location.country_code,
						geocode: geocodeProperties
					}
				});

				if (!firstFeature) {
					await file.write(encoder.encode(','));
				}
				await file.write(encoder.encode(feature));
				firstFeature = false;
			}

			totalFetched += locations.length;

			// Update cursor for next batch
			const lastLocation = locations[locations.length - 1] as TrackerLocation;
			lastRecordedAt = lastLocation.recorded_at;

			// Report progress after each batch
			if (onProgress && totalCount) {
				onProgress(totalFetched, totalCount);
			}

			// If less than batchSize, this was the last batch
			if (locations.length < batchSize) break;
		}

		// Write GeoJSON footer
		await file.write(encoder.encode(']}'));
	} finally {
		file.close();
	}

	console.log(`✅ exportLocationDataToFile done: ${totalFetched.toLocaleString()} points in ${batchNum} batches`);

	if (totalFetched === 0) {
		await Deno.remove(tempPath);
		return null;
	}

	// Return temp file path - content will be read lazily by JSZip
	const fileSize = (await Deno.stat(tempPath)).size;
	console.log(`📁 Location file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

	return tempPath;
}

async function exportWantToVisitToFile(
	fluxbase: FluxbaseClient,
	userId: string,
	startDate?: string | null,
	endDate?: string | null
): Promise<string | null> {
	console.log('📌 exportWantToVisitToFile starting', { userId, startDate, endDate });
	let query = fluxbase.from('want_to_visit_places').select('*').eq('user_id', userId);
	if (startDate) query = query.gte('created_at', startDate);
	if (endDate) query = query.lte('created_at', endDate);
	query = query.order('created_at', { ascending: true });
	const { data: wantToVisit, error } = await query;
	console.log('📊 exportWantToVisitToFile query result', {
		count: wantToVisit?.length || 0,
		error: error?.message
	});
	if (error || !wantToVisit || wantToVisit.length === 0) {
		console.log('⏭️ exportWantToVisitToFile returning null');
		return null;
	}

	// Write to temp file
	const tempPath = `/tmp/export_want_to_visit_${Date.now()}.json`;
	const encoder = new TextEncoder();
	const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
	try {
		await file.write(encoder.encode(JSON.stringify(wantToVisit, null, 2)));
	} finally {
		file.close();
	}

	console.log(`✅ exportWantToVisitToFile completed: ${tempPath}`);
	return tempPath;
}

async function exportTripsToFile(
	fluxbase: FluxbaseClient,
	userId: string,
	startDate?: string | null,
	endDate?: string | null
): Promise<string | null> {
	console.log('✈️ exportTripsToFile starting', { userId, startDate, endDate });
	let query = fluxbase.from('trips').select('*').eq('user_id', userId);
	if (startDate) query = query.gte('start_date', startDate);
	if (endDate) query = query.lte('end_date', endDate);
	query = query.order('start_date', { ascending: true });
	const { data: trips, error } = await query;
	console.log('📊 exportTripsToFile query result', {
		count: trips?.length || 0,
		error: error?.message
	});
	if (error || !trips || trips.length === 0) {
		console.log('⏭️ exportTripsToFile returning null');
		return null;
	}

	// Write to temp file
	const tempPath = `/tmp/export_trips_${Date.now()}.json`;
	const encoder = new TextEncoder();
	const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
	try {
		await file.write(encoder.encode(JSON.stringify(trips, null, 2)));
	} finally {
		file.close();
	}

	console.log(`✅ exportTripsToFile completed: ${tempPath}`);
	return tempPath;
}

async function getUserExportJobs(
	fluxbase: FluxbaseClient,
	userId: string
): Promise<Array<{ file_path: string | null }>> {
	// Use Fluxbase Jobs API to query completed export jobs
	const { data, error } = await fluxbase.jobs.list({
		status: 'completed',
		job_name: 'data-export',
		limit: 100
	});

	if (error) throw error;

	if (!data) return [];

	// Handle both array response and paginated object response { jobs: [...] }
	const jobs: any[] = Array.isArray(data) ? data : (data as any)?.jobs || [];

	// Filter jobs by user and extract file paths from job results
	return jobs
		.filter((job) => job.created_by === userId)
		.map((job) => {
			const result = job.result as Record<string, unknown> | null;
			return {
				file_path: result?.file_path as string | null
			};
		});
}
