/**
 * Export user data in various formats
 *
 * Generates exports of user's GPS data, trips, and want-to-visit lists in
 * GeoJSON or JSON format. Creates downloadable files in storage.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 900
 * @fluxbase:allow-read true
 */

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

		safeReportProgress(job, 10, '📦 Starting export process...');

		await new Promise((resolve) => setTimeout(resolve, 500));

		const zip = new JSZip();
		let totalFiles = 0;

		// Export location data if requested
		if (payload.includeLocationData) {
			console.log('📍 Starting location data export...');
			safeReportProgress(job, 25, '📍 Exporting location data...');
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const locationData = await exportLocationData(
				fluxbase,
				userId,
				payload.startDate,
				payload.endDate
			);
			if (locationData) {
				console.log(`✅ Location data exported successfully, length: ${locationData.length.toLocaleString()}`);
				zip.file('locations.geojson', locationData);
				totalFiles++;
				console.log('📦 Added locations.geojson to ZIP file');
			} else {
				console.log(`⏭️ No location data found for user ${userId}`);
			}
		} else {
			console.log('⏭️ Location data export skipped (not requested)');
		}

		// Export want-to-visit data if requested
		if (payload.includeWantToVisit) {
			console.log('📌 Starting want-to-visit export...');
			safeReportProgress(job, 50, '📌 Exporting want-to-visit data...');
			await new Promise((resolve) => setTimeout(resolve, 1000));
			console.log('🔍 Calling exportWantToVisit');
			const wantToVisitData = await exportWantToVisit(
				fluxbase,
				userId,
				payload.startDate,
				payload.endDate
			);
			console.log('📊 exportWantToVisit returned', {
				hasData: !!wantToVisitData,
				dataLength: wantToVisitData?.length || 0
			});
			if (wantToVisitData) {
				console.log(`✅ Want-to-visit data exported successfully, length: ${wantToVisitData.length.toLocaleString()}`);
				zip.file('want-to-visit.json', wantToVisitData);
				totalFiles++;
				console.log('📦 Added want-to-visit.json to ZIP file');
			} else {
				console.log(`⏭️ No want-to-visit data found for user ${userId}`);
			}
		} else {
			console.log('⏭️ Want-to-visit export skipped (not requested)');
		}

		// Export trips data if requested
		if (payload.includeTrips) {
			console.log(`✈️ Starting trips export for job ${jobId}...`);
			safeReportProgress(job, 75, '✈️ Exporting trips data...');
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const tripsData = await exportTrips(fluxbase, userId, payload.startDate, payload.endDate);
			console.log(`📊 Trips export completed for job ${jobId}, data length: ${tripsData?.length || 0}`);
			if (tripsData) {
				console.log(`✅ Trips data exported successfully, length: ${tripsData.length.toLocaleString()}`);
				zip.file('trips.json', tripsData);
				totalFiles++;
				console.log('📦 Added trips.json to ZIP file');
			} else {
				console.log(`⏭️ No trips data found for user ${userId}`);
			}
		} else {
			console.log('⏭️ Trips export skipped (not requested)');
		}

		// Generate zip file
		console.log(`📦 Generating zip file for job ${jobId} with ${totalFiles} files`);
		const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
		console.log(`📊 Zip file generated, size: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

		// Upload to storage
		const fileName = `export_${userId}_${Date.now()}.zip`;
		const filePath = `${userId}/${fileName}`;
		console.log(`📤 Uploading zip file to storage: ${filePath}`);

		// Before uploading, delete old export files (keep only 5 most recent)
		const exportJobs = await getUserExportJobs(fluxbase, userId);
		const oldJobs = exportJobs.filter((job, idx) => idx >= 5 && job.file_path);
		if (oldJobs.length > 0) {
			const oldPaths = oldJobs
				.map((job) => job.file_path)
				.filter((p): p is string => typeof p === 'string');
			if (oldPaths.length > 0) {
				console.log(`🗑️ Deleting old export files:`, oldPaths);
				await fluxbase.storage.from('exports').remove(oldPaths);
			}
		}

		const { error: uploadError } = await fluxbase.storage
			.from('exports')
			.upload(filePath, zipBuffer, {
				contentType: 'application/zip',
				upsert: false
			});

		if (uploadError) {
			console.error(`❌ Failed to upload export file: ${uploadError.message}`);
			throw new Error(`Failed to upload export file: ${uploadError.message}`);
		}

		safeReportProgress(job, 100, '✅ Finalizing export...');

		console.log(`✅ Export job ${jobId} completed successfully.`);

		return {
			success: true,
			result: {
				totalFiles,
				format: payload.format,
				exportedAt: new Date().toISOString(),
				file_path: filePath,
				file_size: zipBuffer.length
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Export processing failed for job ${jobId}:`, error);
		throw error;
	}
}

async function exportLocationData(
	fluxbase: FluxbaseClient,
	userId: string,
	startDate?: string | null,
	endDate?: string | null
): Promise<string | null> {
	console.log('📍 exportLocationData', { userId, startDate, endDate });
	const batchSize = 1000;
	let offset = 0;
	let totalFetched = 0;
	let batchNum = 0;
	let firstFeature = true;
	let geojson = '{"type":"FeatureCollection","features":[';

	while (true) {
		let query = fluxbase.from('tracker_data').select('*').eq('user_id', userId);
		if (startDate) query = query.gte('recorded_at', startDate);
		if (endDate) query = query.lte('recorded_at', endDate);
		query = query.order('recorded_at', { ascending: true }).range(offset, offset + batchSize - 1);
		const { data: locations, error } = await query;
		batchNum++;
		console.log(`📈 exportLocationData batch ${batchNum}`, {
			offset,
			count: locations?.length,
			error
		});
		if (error) throw error;
		if (!locations || locations.length === 0) break;

		const features = locations.map((location: TrackerLocation) => {
			// Handle geocode data - if it's in GeoJSON format, extract the properties
			let geocodeProperties = null;
			if (location.geocode) {
				if (isGeoJSONGeocode(location.geocode)) {
					// Extract properties from GeoJSON geocode
					const geocodeGeoJSON = location.geocode as Record<string, unknown>;
					geocodeProperties = geocodeGeoJSON.properties || null;
				} else {
					// Legacy format - use as is
					geocodeProperties = location.geocode;
				}
			}

			return JSON.stringify({
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
		});

		if (!firstFeature) geojson += ',';
		geojson += features.join(',');
		firstFeature = false;

		totalFetched += locations.length;
		offset += batchSize;

		// If less than batchSize, this was the last batch
		if (locations.length < batchSize) break;
	}

	geojson += ']}';
	console.log(`✅ exportLocationData done: ${totalFetched.toLocaleString()} points in ${batchNum} batches`);
	return geojson;
}

async function exportWantToVisit(
	fluxbase: FluxbaseClient,
	userId: string,
	startDate?: string | null,
	endDate?: string | null
): Promise<string | null> {
	console.log('📌 exportWantToVisit starting', { userId, startDate, endDate });
	let query = fluxbase.from('want_to_visit_places').select('*').eq('user_id', userId);
	if (startDate) query = query.gte('created_at', startDate);
	if (endDate) query = query.lte('created_at', endDate);
	query = query.order('created_at', { ascending: true });
	const { data: wantToVisit, error } = await query;
	console.log('📊 exportWantToVisit query result', {
		count: wantToVisit?.length || 0,
		error: error?.message
	});
	if (error || !wantToVisit || wantToVisit.length === 0) {
		console.log('⏭️ exportWantToVisit returning null');
		return null;
	}
	const result = JSON.stringify(wantToVisit, null, 2);
	console.log(`✅ exportWantToVisit completed: ${result.length.toLocaleString()} bytes`);
	return result;
}

async function exportTrips(
	fluxbase: FluxbaseClient,
	userId: string,
	startDate?: string | null,
	endDate?: string | null
): Promise<string | null> {
	console.log('✈️ exportTrips starting', { userId, startDate, endDate });
	let query = fluxbase.from('trips').select('*').eq('user_id', userId);
	if (startDate) query = query.gte('start_date', startDate);
	if (endDate) query = query.lte('end_date', endDate);
	query = query.order('start_date', { ascending: true });
	const { data: trips, error } = await query;
	console.log('📊 exportTrips query result', {
		count: trips?.length || 0,
		error: error?.message
	});
	if (error || !trips || trips.length === 0) {
		console.log('⏭️ exportTrips returning null');
		return null;
	}
	const result = JSON.stringify(trips, null, 2);
	console.log(`✅ exportTrips completed: ${result.length.toLocaleString()} bytes`);
	return result;
}

async function getUserExportJobs(
	fluxbase: FluxbaseClient,
	userId: string
): Promise<Array<{ file_path: string | null }>> {
	// Use Fluxbase Jobs API to query completed export jobs
	const { data: jobs, error } = await fluxbase.jobs.list({
		status: 'completed',
		job_name: 'data-export',
		limit: 100
	});

	if (error) throw error;

	if (!jobs) return [];

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
