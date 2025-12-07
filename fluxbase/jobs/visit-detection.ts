/**
 * Detect place visits (restaurants, cafes, museums, etc.)
 *
 * Analyzes GPS tracker data to detect when a user visited a venue.
 * Uses adaptive thresholds based on GPS point density to handle variable
 * recording frequency (e.g., OwnTracks battery-save mode).
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 900
 */

import { VisitDetectionService } from '../../web/src/lib/services/visit-detection.service';
import type { TrackerPointForVisit, PlaceVisit } from '../../web/src/lib/types/visit.types';

import type { FluxbaseClient, JobUtils } from './types';

// Safe wrapper for reportProgress
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

// Batch size for fetching tracker data
const BATCH_SIZE = 5000;

export async function handler(
	req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = context.payload || {};
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		console.log(`🏪 Processing visit detection job ${jobId}`);
		console.log(`👤 Job created by user: ${userId}`);

		const startTime = Date.now();

		safeReportProgress(job, 5, '🏪 Starting visit detection...');

		// Get date range from payload or use defaults
		const startDate = payload.startDate || null;
		const endDate = payload.endDate || null;

		// Initialize visit detection service
		const visitDetectionService = new VisitDetectionService();

		safeReportProgress(job, 10, '📊 Counting tracker data points...');

		// Build query for counting
		let countQuery = fluxbase
			.from('tracker_data')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', userId)
			.not('geocode', 'is', null);

		if (startDate) {
			countQuery = countQuery.gte('recorded_at', startDate);
		}
		if (endDate) {
			countQuery = countQuery.lte('recorded_at', endDate);
		}

		const { count: totalPoints, error: countError } = await countQuery;

		if (countError) {
			throw new Error(`Failed to count tracker data: ${countError.message}`);
		}

		console.log(`📊 Found ${totalPoints || 0} tracker data points to process`);

		if (!totalPoints || totalPoints === 0) {
			safeReportProgress(job, 100, '✅ No tracker data to process');
			return {
				success: true,
				result: {
					message: 'No tracker data available for visit detection',
					visitsDetected: 0
				}
			};
		}

		// Fetch and process data in batches
		const allPoints: TrackerPointForVisit[] = [];
		const totalBatches = Math.ceil(totalPoints / BATCH_SIZE);
		let processedBatches = 0;

		safeReportProgress(job, 15, `📥 Fetching tracker data (${totalBatches} batches)...`);

		for (let offset = 0; offset < totalPoints; offset += BATCH_SIZE) {
			let dataQuery = fluxbase
				.from('tracker_data')
				.select('recorded_at, location, accuracy, geocode')
				.eq('user_id', userId)
				.not('geocode', 'is', null)
				.order('recorded_at', { ascending: true })
				.range(offset, offset + BATCH_SIZE - 1);

			if (startDate) {
				dataQuery = dataQuery.gte('recorded_at', startDate);
			}
			if (endDate) {
				dataQuery = dataQuery.lte('recorded_at', endDate);
			}

			const { data: batch, error: batchError } = await dataQuery;

			if (batchError) {
				console.error(`❌ Error fetching batch at offset ${offset}:`, batchError);
				continue;
			}

			if (batch && batch.length > 0) {
				// Convert to TrackerPointForVisit format
				for (const row of batch) {
					// Parse location from PostGIS format
					let coordinates: [number, number] | null = null;

					if (row.location) {
						if (typeof row.location === 'object' && 'coordinates' in row.location) {
							coordinates = row.location.coordinates as [number, number];
						} else if (typeof row.location === 'string') {
							// Handle WKT format: POINT(lon lat)
							const match = row.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
							if (match) {
								coordinates = [parseFloat(match[1]), parseFloat(match[2])];
							}
						}
					}

					if (coordinates) {
						allPoints.push({
							recorded_at: new Date(row.recorded_at),
							location: {
								type: 'Point',
								coordinates
							},
							accuracy: row.accuracy,
							geocode: row.geocode
						});
					}
				}
			}

			processedBatches++;
			const fetchProgress = Math.round(15 + (processedBatches / totalBatches) * 35);
			safeReportProgress(
				job,
				fetchProgress,
				`📥 Fetched ${allPoints.length.toLocaleString()} points (batch ${processedBatches}/${totalBatches})`
			);
		}

		console.log(`📊 Fetched ${allPoints.length} valid tracker points`);

		if (allPoints.length < 3) {
			safeReportProgress(job, 100, '✅ Not enough data points for visit detection');
			return {
				success: true,
				result: {
					message: 'Not enough tracker data for visit detection (minimum 3 points required)',
					visitsDetected: 0
				}
			};
		}

		safeReportProgress(job, 55, '🔍 Analyzing GPS clusters for visits...');

		// Detect visits
		const detectedVisits = visitDetectionService.detectVisits(allPoints, userId);

		console.log(`🏪 Detected ${detectedVisits.length} place visits`);

		safeReportProgress(
			job,
			75,
			`🏪 Found ${detectedVisits.length} visits, saving to database...`
		);

		// Save visits to database
		let savedCount = 0;
		if (detectedVisits.length > 0) {
			// Convert visits to database format
			const visitsToInsert = detectedVisits.map((visit) => ({
				user_id: visit.user_id,
				started_at: visit.started_at.toISOString(),
				ended_at: visit.ended_at.toISOString(),
				location: `POINT(${visit.location.coordinates[0]} ${visit.location.coordinates[1]})`,
				poi_name: visit.poi_name,
				poi_layer: visit.poi_layer,
				poi_amenity: visit.poi_amenity,
				poi_cuisine: visit.poi_cuisine,
				poi_category: visit.poi_category,
				poi_tags: visit.poi_tags || {},
				city: visit.city,
				country: visit.country,
				country_code: visit.country_code,
				confidence_score: visit.confidence_score,
				gps_points_count: visit.gps_points_count,
				avg_accuracy_meters: visit.avg_accuracy_meters,
				detection_method: visit.detection_method,
				candidates: visit.candidates
			}));

			// Insert in batches to avoid timeout
			const insertBatchSize = 100;
			for (let i = 0; i < visitsToInsert.length; i += insertBatchSize) {
				const batch = visitsToInsert.slice(i, i + insertBatchSize);

				const { data: insertedBatch, error: insertError } = await fluxbase
					.from('place_visits')
					.insert(batch)
					.select('id');

				if (insertError) {
					console.error(`❌ Error inserting visits batch:`, insertError);
					// Continue with remaining batches
				} else {
					savedCount += insertedBatch?.length || 0;
				}

				const saveProgress = Math.round(75 + ((i + batch.length) / visitsToInsert.length) * 20);
				safeReportProgress(
					job,
					saveProgress,
					`💾 Saved ${savedCount}/${detectedVisits.length} visits`
				);
			}

			console.log(`✅ Successfully saved ${savedCount} visits to database`);
		}

		const totalTime = Date.now() - startTime;
		console.log(`✅ Visit detection completed in ${totalTime}ms`);

		safeReportProgress(job, 100, `✅ Detected ${savedCount} place visits`);

		return {
			success: true,
			result: {
				message: `Successfully detected ${detectedVisits.length} place visits`,
				visitsDetected: detectedVisits.length,
				visitsSaved: savedCount,
				totalPointsProcessed: allPoints.length,
				totalTime: `${Math.round(totalTime / 1000)}s`
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in visit detection job:`, error);
		throw error;
	}
}
