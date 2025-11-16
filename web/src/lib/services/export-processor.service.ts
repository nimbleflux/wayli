import JSZip from 'jszip';

import { fluxbase } from '../../worker/fluxbase';
import { checkJobCancellation } from '../utils/job-cancellation';
import {
	isGeoJSONGeocode,
	getDisplayNameFromGeoJSON,
	getAddressFromGeoJSON
} from '../utils/geojson-converter';

import { ExportService } from './export.service.worker';

import type { Job } from '../types/job-queue.types';

// Add TrackerLocation interface at the top
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

export class ExportProcessorService {
	private static fluxbase = fluxbase;

	static async processExport(job: Job): Promise<void> {
		console.log(`[ExportWorker] Starting export job ${job.id}`);
		// Extract data from job - the actual structure from the export Edge Function
		const jobData = job.data as {
			format: string;
			includeLocationData: boolean;
			includeWantToVisit: boolean;
			includeTrips: boolean;
			dateRange?: string;
			startDate?: string | null;
			endDate?: string | null;
		};

		// Use the job creator as the userId
		const userId = job.created_by;
		console.log('[ExportWorker] Job data:', {
			userId,
			includeLocationData: jobData.includeLocationData,
			includeWantToVisit: jobData.includeWantToVisit,
			includeTrips: jobData.includeTrips,
			startDate: jobData.startDate,
			endDate: jobData.endDate
		});

		console.log('[ExportWorker] Export configuration:', {
			'Location Data': jobData.includeLocationData ? '✅ INCLUDED' : '❌ EXCLUDED',
			'Want to Visit': jobData.includeWantToVisit ? '✅ INCLUDED' : '❌ EXCLUDED',
			Trips: jobData.includeTrips ? '✅ INCLUDED' : '❌ EXCLUDED',
			Format: jobData.format,
			'Date Range':
				jobData.startDate && jobData.endDate
					? `${jobData.startDate} to ${jobData.endDate}`
					: 'All time'
		});

		try {
			// Check for cancellation before starting
			await checkJobCancellation(job.id);

			// Update job status to running
			await ExportService.updateExportJobProgress(job.id, 10, {
				message: 'Starting export process...'
			});

			// Add a small delay to make the "running" status visible
			await new Promise((resolve) => setTimeout(resolve, 500));

			const zip = new JSZip();
			let totalFiles = 0;

			// Export location data if requested
			if (jobData.includeLocationData) {
				// Check for cancellation before location data export
				await checkJobCancellation(job.id);

				console.log('[ExportWorker] Starting location data export...');
				await ExportService.updateExportJobProgress(job.id, 25, {
					message: 'Exporting location data...'
				});
				// Add a small delay to make progress updates visible
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const locationData = await this.exportLocationData(
					userId,
					jobData.startDate,
					jobData.endDate
				);
				if (locationData) {
					console.log(
						'[ExportWorker] Location data exported successfully, length:',
						locationData.length
					);
					zip.file('locations.geojson', locationData);
					totalFiles++;
					console.log('[ExportWorker] Added locations.geojson to ZIP file');
				} else {
					console.log(`[ExportWorker] No location data found for user ${userId}`);
				}
			} else {
				console.log('[ExportWorker] Location data export skipped (not requested)');
			}

			// Export want-to-visit data if requested
			if (jobData.includeWantToVisit) {
				// Check for cancellation before want-to-visit export
				await checkJobCancellation(job.id);

				console.log('[ExportWorker] Starting want-to-visit export...');
				await ExportService.updateExportJobProgress(job.id, 50, {
					message: 'Exporting want-to-visit data...'
				});
				// Add a small delay to make progress updates visible
				await new Promise((resolve) => setTimeout(resolve, 1000));
				console.log('[ExportWorker] Calling exportWantToVisit');
				const wantToVisitData = await this.exportWantToVisit(
					userId,
					jobData.startDate,
					jobData.endDate
				);
				console.log('[ExportWorker] exportWantToVisit returned', {
					hasData: !!wantToVisitData,
					dataLength: wantToVisitData?.length || 0
				});
				if (wantToVisitData) {
					console.log(
						'[ExportWorker] Want-to-visit data exported successfully, length:',
						wantToVisitData.length
					);
					zip.file('want-to-visit.json', wantToVisitData);
					totalFiles++;
					console.log('[ExportWorker] Added want-to-visit.json to ZIP file');
				} else {
					console.log(`[ExportWorker] No want-to-visit data found for user ${userId}`);
				}
			} else {
				console.log('[ExportWorker] Want-to-visit export skipped (not requested)');
			}

			// Export trips data if requested
			if (jobData.includeTrips) {
				// Check for cancellation before trips export
				await checkJobCancellation(job.id);

				console.log(`[ExportWorker] Starting trips export for job ${job.id}...`);
				await ExportService.updateExportJobProgress(job.id, 75, {
					message: 'Exporting trips data...'
				});
				// Add a small delay to make progress updates visible
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const tripsData = await this.exportTrips(userId, jobData.startDate, jobData.endDate);
				console.log(
					`[ExportWorker] Trips export completed for job ${job.id}, data length: ${tripsData?.length || 0}`
				);
				if (tripsData) {
					console.log('[ExportWorker] Trips data exported successfully, length:', tripsData.length);
					zip.file('trips.json', tripsData);
					totalFiles++;
					console.log('[ExportWorker] Added trips.json to ZIP file');
				} else {
					console.log(`[ExportWorker] No trips data found for user ${userId}`);
				}
			} else {
				console.log('[ExportWorker] Trips export skipped (not requested)');
			}

			// Generate zip file
			console.log(`[ExportWorker] Generating zip file for job ${job.id} with ${totalFiles} files`);
			const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
			console.log(`[ExportWorker] Zip file generated, size: ${zipBuffer.length} bytes`);

			// Upload to storage
			const fileName = `export_${userId}_${Date.now()}.zip`;
			const filePath = `${userId}/${fileName}`;
			console.log(`[ExportWorker] Uploading zip file to storage: ${filePath}`);

			// Before uploading, delete old export files (keep only 5 most recent)
			const exportJobs = await ExportService.getUserExportJobs(userId);
			const oldJobs = exportJobs.filter((job, idx) => idx >= 5 && job.file_path);
			if (oldJobs.length > 0) {
				const oldPaths = oldJobs
					.map((job) => job.file_path)
					.filter((p): p is string => typeof p === 'string');
				if (oldPaths.length > 0) {
					console.log(`[ExportWorker] Deleting old export files:`, oldPaths);
					await this.fluxbase.storage.from('exports').remove(oldPaths);
				}
			}

			const { error: uploadError } = await this.fluxbase.storage
				.from('exports')
				.upload(filePath, zipBuffer, {
					contentType: 'application/zip',
					upsert: false
				});

			if (uploadError) {
				console.error(`[ExportWorker] Failed to upload export file: ${uploadError.message}`);
				throw new Error(`Failed to upload export file: ${uploadError.message}`);
			}

			// Update progress to 100% before completing
			await ExportService.updateExportJobProgress(job.id, 100, {
				message: 'Finalizing export...'
			});

			// Complete the export job
			console.log(`[ExportWorker] Completing export job ${job.id} with ${totalFiles} files`);
			await ExportService.completeExportJob(job.id, filePath, zipBuffer.length, {
				totalFiles,
				format: jobData.format,
				exportedAt: new Date().toISOString(),
				file_path: filePath,
				file_size: zipBuffer.length
			});
			console.log(`[ExportWorker] Export job ${job.id} completed successfully.`);
		} catch (error) {
			// Check if the error is due to cancellation
			if (error instanceof Error && error.message === 'Job was cancelled') {
				console.log(`🛑 Export job ${job.id} was cancelled`);
				return;
			}
			console.error(`[ExportWorker] Export processing failed for job ${job.id}:`, error);
			await ExportService.failExportJob(
				job.id,
				error instanceof Error ? error.message : 'Unknown error'
			);
		}
	}

	private static async exportLocationData(
		userId: string,
		startDate?: string | null,
		endDate?: string | null
	): Promise<string | null> {
		console.log('[ExportWorker] exportLocationData', { userId, startDate, endDate });
		const batchSize = 1000;
		let offset = 0;
		let totalFetched = 0;
		let batchNum = 0;
		let firstFeature = true;
		let geojson = '{"type":"FeatureCollection","features":[';

		while (true) {
			let query = this.fluxbase.from('tracker_data').select('*').eq('user_id', userId);
			if (startDate) query = query.gte('recorded_at', startDate);
			if (endDate) query = query.lte('recorded_at', endDate);
			query = query.order('recorded_at', { ascending: true }).range(offset, offset + batchSize - 1);
			const { data: locations, error } = await query;
			batchNum++;
			console.log(`[ExportWorker] exportLocationData batch ${batchNum}`, {
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
		console.log('[ExportWorker] exportLocationData done', { totalFetched, batches: batchNum });
		return geojson;
	}

	private static async exportWantToVisit(
		userId: string,
		startDate?: string | null,
		endDate?: string | null
	): Promise<string | null> {
		console.log('[ExportWorker] exportWantToVisit starting', { userId, startDate, endDate });
		let query = this.fluxbase.from('want_to_visit_places').select('*').eq('user_id', userId);
		if (startDate) query = query.gte('created_at', startDate);
		if (endDate) query = query.lte('created_at', endDate);
		query = query.order('created_at', { ascending: true });
		const { data: wantToVisit, error } = await query;
		console.log('[ExportWorker] exportWantToVisit query result', {
			count: wantToVisit?.length || 0,
			error: error?.message
		});
		if (error || !wantToVisit || wantToVisit.length === 0) {
			console.log('[ExportWorker] exportWantToVisit returning null');
			return null;
		}
		const result = JSON.stringify(wantToVisit, null, 2);
		console.log('[ExportWorker] exportWantToVisit completed', {
			resultLength: result.length
		});
		return result;
	}

	private static async exportTrips(
		userId: string,
		startDate?: string | null,
		endDate?: string | null
	): Promise<string | null> {
		console.log('[ExportWorker] exportTrips starting', { userId, startDate, endDate });
		let query = this.fluxbase.from('trips').select('*').eq('user_id', userId);
		if (startDate) query = query.gte('start_date', startDate);
		if (endDate) query = query.lte('end_date', endDate);
		query = query.order('start_date', { ascending: true });
		const { data: trips, error } = await query;
		console.log('[ExportWorker] exportTrips query result', {
			count: trips?.length || 0,
			error: error?.message
		});
		if (error || !trips || trips.length === 0) {
			console.log('[ExportWorker] exportTrips returning null');
			return null;
		}
		const result = JSON.stringify(trips, null, 2);
		console.log('[ExportWorker] exportTrips completed', {
			resultLength: result.length
		});
		return result;
	}
}
