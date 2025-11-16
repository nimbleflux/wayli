import { fluxbase } from './fluxbase';

import { checkJobCancellation } from '../lib/utils/job-cancellation';
import { ExportProcessorService } from '../lib/services/export-processor.service';
import { forwardGeocode } from '../lib/services/external/nominatim.service';
import { TripDetectionService } from '../lib/services/trip-detection.service';
import { UserProfileService } from '../lib/services/user-profile.service';

import { findAvailableDateRanges as findAvailableDateRangesHelper } from './helpers/date-ranges';
import { JobQueueService } from './job-queue.service.worker';

import type { Job, JobType } from '../lib/types/job-queue.types';
import type { TripGenerationData, HomeAddress } from '../lib/types/trip-generation.types';

export class JobProcessorService {
	static async processJob(job: Job, abortSignal?: AbortSignal): Promise<void> {
		const processor = this.getJobProcessor(job.type);
		if (!processor) {
			throw new Error(`No processor found for job type: ${job.type}`);
		}

		await processor(job, abortSignal);
	}

	private static getJobProcessor(jobType: JobType) {
		const processors: Record<JobType, (job: Job, abortSignal?: AbortSignal) => Promise<void>> = {
			reverse_geocoding_missing: this.processReverseGeocodingMissing.bind(this),
			data_import: this.processDataImport.bind(this),
			trip_generation: this.processTripGeneration.bind(this),
			data_export: this.processDataExport.bind(this),
			geocoding: this.processGeocoding.bind(this),
			image_generation: this.processImageGeneration.bind(this),
			poi_detection: this.processPOIDetection.bind(this),
			trip_detection: this.processTripDetection.bind(this),
			distance_calculation: this.processDistanceCalculation.bind(this)
		};

		return processors[jobType];
	}

	private static async processReverseGeocodingMissing(
		job: Job,
		abortSignal?: AbortSignal
	): Promise<void> {
		const { processReverseGeocodingMissing } = await import(
			'./processors/reverse-geocoding-processor.service'
		);
		return processReverseGeocodingMissing(job, abortSignal);
	}

	private static async processTripGeneration(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`🗺️ Processing sleep-based trip generation job ${job.id}`);
		console.log(`👤 Job created by user: ${job.created_by}`);
		console.log(`📋 Job data:`, JSON.stringify(job.data, null, 2));

		const startTime = Date.now();
		// Moving average ETA over the last 15 seconds
		const PROGRESS_WINDOW_MS = 15_000;
		const progressSamples: Array<{ time: number; progress: number }> = [];

		const calculateEta = (currentProgress: number): number | null => {
			const now = Date.now();

			// Only start tracking ETA after we've made some progress in actual processing
			// Reduced from 20% to 5% to show ETA sooner
			if (currentProgress < 5) {
				return null;
			}

			// Add current sample
			progressSamples.push({ time: now, progress: currentProgress });

			// Remove samples older than PROGRESS_WINDOW_MS
			while (progressSamples.length > 0 && now - progressSamples[0].time > PROGRESS_WINDOW_MS) {
				progressSamples.shift();
			}

			// Need at least 2 samples to calculate ETA
			if (progressSamples.length < 2 || currentProgress <= 0) {
				return null;
			}

			// Calculate progress rate (progress per millisecond) using linear regression
			const oldestSample = progressSamples[0];
			const progressDelta = currentProgress - oldestSample.progress;
			const timeDelta = now - oldestSample.time;

			if (progressDelta <= 0 || timeDelta <= 0) {
				return null;
			}

			const progressRate = progressDelta / timeDelta; // progress per ms
			const remainingProgress = 100 - currentProgress;
			const etaMs = remainingProgress / progressRate;

			return Math.round(etaMs / 1000); // Convert to seconds
		};

		const formatEta = (seconds: number | null): string => {
			if (!seconds || seconds <= 0) return 'Calculating...';
			// Cap ETA at 24 hours for display
			const cappedSeconds = Math.min(seconds, 86400);
			const s = Math.floor(cappedSeconds % 60);
			const m = Math.floor((cappedSeconds / 60) % 60);
			const h = Math.floor(cappedSeconds / 3600);
			if (h > 0) return `${h}h ${m}m ${s}s`;
			if (m > 0) return `${m}m ${s}s`;
			return `${s}s`;
		};

		const userId = job.created_by;
		const {
			startDate,
			endDate,
			useCustomHomeAddress,
			customHomeAddress,
			minTripDurationHours,
			minDataPointsPerDay
		} = job.data as unknown as TripGenerationData;

		console.log(`📅 Job parameters:`);
		console.log(`  - startDate: ${startDate || 'not specified'}`);
		console.log(`  - endDate: ${endDate || 'not specified'}`);
		console.log(`  - useCustomHomeAddress: ${useCustomHomeAddress}`);
		console.log(`  - customHomeAddress: ${customHomeAddress || 'not specified'}`);

		try {
			// Check for cancellation or abort before starting
			if (abortSignal?.aborted) {
				throw new Error('Job was aborted');
			}
			await checkJobCancellation(job.id);

			// Determine date ranges - if not provided, find available ranges automatically
			let dateRanges: Array<{ startDate: string; endDate: string }> = [];

			if (!startDate || !endDate) {
				console.log(
					`🔍 No start/end dates provided, finding available date ranges automatically...`
				);
				await JobQueueService.updateJobProgress(job.id, 5, {
					message: 'Determining available date ranges for sleep-based trip generation...'
				});

				dateRanges = await findAvailableDateRangesHelper(userId, startDate, endDate);
				console.log(`📊 findAvailableDateRanges returned ${dateRanges.length} date ranges`);

				if (dateRanges.length === 0) {
					console.log(`❌ No available date ranges found, completing job with error`);
					await JobQueueService.updateJobProgress(job.id, 100, {
						message: 'No available date ranges found for sleep-based trip generation',
						tripsGenerated: 0
					});
					return;
				}

				const dateRangeMessage =
					startDate || endDate
						? `Found ${dateRanges.length} available date ranges for sleep-based trip generation${startDate ? ` (from ${startDate})` : ''}${endDate ? ` (until ${endDate})` : ''}`
						: `Found ${dateRanges.length} available date ranges for sleep-based trip generation`;

				await JobQueueService.updateJobProgress(job.id, 10, {
					message: dateRangeMessage,
					dateRangesCount: dateRanges.length,
					dateRanges: dateRanges.map((range) => `${range.startDate} to ${range.endDate}`),
					userStartDate: startDate,
					userEndDate: endDate
				});
			} else {
				console.log(`📅 Using provided date range: ${startDate} to ${endDate}`);
				// Use provided date range, but exclude existing trip dates to find available ranges
				await JobQueueService.updateJobProgress(job.id, 8, {
					message: 'Finding available date ranges within the provided date range...',
					startDate,
					endDate
				});

				// Instead of checking for overlap, use the same logic as automatic detection
				// but constrained to the provided date range
				dateRanges = await findAvailableDateRangesHelper(userId, startDate, endDate);
				console.log(
					`📊 findAvailableDateRanges returned ${dateRanges.length} date ranges within provided range`
				);

				if (dateRanges.length === 0) {
					console.log(
						`❌ No available date ranges found within the provided range, completing job with error`
					);
					await JobQueueService.updateJobProgress(job.id, 100, {
						message:
							'No available date ranges found within the provided date range. All dates are already covered by existing trips.',
						tripsGenerated: 0,
						providedStartDate: startDate,
						providedEndDate: endDate
					});
					return;
				}

				const dateRangeMessage = `Found ${dateRanges.length} available date ranges within the provided range (${startDate} to ${endDate})`;
				await JobQueueService.updateJobProgress(job.id, 10, {
					message: dateRangeMessage,
					dateRangesCount: dateRanges.length,
					dateRanges: dateRanges.map((range) => `${range.startDate} to ${range.endDate}`),
					userStartDate: startDate,
					userEndDate: endDate
				});
			}

			console.log(`✅ Date ranges determined: ${dateRanges.length} ranges to process`);
			dateRanges.forEach((range, index) => {
				console.log(`  Range ${index + 1}: ${range.startDate} to ${range.endDate}`);
			});

			// Get user's home address
			let homeAddress: HomeAddress | null = null;
			if (useCustomHomeAddress && customHomeAddress) {
				// Geocode the custom home address to get coordinates
				console.log(`🏠 Geocoding custom home address: ${customHomeAddress}`);

				// Update progress to show geocoding is in progress
				await JobQueueService.updateJobProgress(job.id, 8, {
					message: `Geocoding custom home address: ${customHomeAddress}...`,
					homeAddress: 'geocoding in progress'
				});

				try {
					const geocodeResult = await forwardGeocode(customHomeAddress);
					if (geocodeResult) {
						homeAddress = {
							display_name: geocodeResult.display_name,
							coordinates: {
								lat: parseFloat(geocodeResult.lat),
								lng: parseFloat(geocodeResult.lon)
							}
						};
						console.log(
							`✅ Successfully geocoded custom home address: ${geocodeResult.display_name} (${geocodeResult.lat}, ${geocodeResult.lon})`
						);
					} else {
						console.warn(`⚠️ Could not geocode custom home address: ${customHomeAddress}`);
						// Fallback to string-only address
						homeAddress = {
							display_name: customHomeAddress,
							coordinates: undefined
						};
					}
				} catch (error) {
					console.error(`❌ Error geocoding custom home address: ${customHomeAddress}`, error);
					// Fallback to string-only address
					homeAddress = {
						display_name: customHomeAddress,
						coordinates: undefined
					};
				}
			} else {
				// Get user's stored home address from user_profiles table
				const userProfile = await UserProfileService.getUserProfile(userId);
				if (userProfile?.home_address) {
					// Convert GeocodedLocation to HomeAddress format
					if (typeof userProfile.home_address === 'string') {
						// If it's a string, it might be a display name without coordinates
						homeAddress = {
							display_name: userProfile.home_address,
							coordinates: undefined
						};
					} else {
						// If it's a GeocodedLocation object, convert to HomeAddress
						homeAddress = {
							display_name: userProfile.home_address.display_name,
							coordinates: userProfile.home_address.coordinates,
							address: userProfile.home_address.address
						};
					}
				}
			}

			await JobQueueService.updateJobProgress(job.id, 10, {
				message: 'Retrieved home address, fetching GPS data for sleep pattern analysis...',
				homeAddress: homeAddress
					? `configured (${homeAddress.display_name}${homeAddress.coordinates ? ` - ${homeAddress.coordinates.lat.toFixed(4)}, ${homeAddress.coordinates.lng.toFixed(4)}` : ' - no coordinates'})`
					: 'not configured'
			});

			// Configure UserProfileService for worker environment
			UserProfileService.useNodeEnvironmentConfig();

			// Get user's trip exclusions from user preferences
			const { error: userPreferencesError } = await fluxbase
				.from('user_preferences')
				.select('trip_exclusions')
				.eq('id', userId)
				.single();

			if (userPreferencesError) {
				console.error('Error fetching user preferences for trip exclusions:', userPreferencesError);
				// Fallback to empty array if preferences not found
			}

			// Use trip detection service
			const tripDetectionService = new TripDetectionService(
				process.env.FLUXBASE_BASE_URL!,
				process.env.FLUXBASE_SERVICE_ROLE_KEY!
			);

			// Set up progress tracking for trip detection with ETA calculation
			tripDetectionService.setProgressTracking(job.id, async (progress) => {
				const eta = calculateEta(progress.progress);
				await JobQueueService.updateJobProgress(job.id, progress.progress, {
					message: progress.message,
					estimatedTimeRemaining: formatEta(eta),
					...progress.details
				});
			});

			// Use the new trip detection V2 service with the determined date ranges
			const detectedTrips = await tripDetectionService.detectTrips(userId, startDate, endDate);

			console.log(`✅ Trip detection completed: ${detectedTrips.length} trips detected`);

			// Save detected trips to the database
			// Note: Trip detection service already updated progress to 100% when completed
			// We only need to save the trips and avoid overwriting that progress
			if (detectedTrips.length > 0) {
				console.log(`💾 Saving ${detectedTrips.length} detected trips to database...`);

				const { data: savedTrips, error: saveError } = await fluxbase
					.from('trips')
					.insert(detectedTrips)
					.select();

				if (saveError) {
					console.error('❌ Error saving trips to database:', saveError);
					throw new Error(`Failed to save trips to database: ${saveError.message}`);
				}

				console.log(`✅ Successfully saved ${savedTrips?.length || 0} trips to database`);
			}

			const totalTime = Date.now() - startTime;
			console.log(
				`✅ Trip generation completed: ${detectedTrips.length} trips detected in ${totalTime}ms`
			);
		} catch (error: unknown) {
			// Check if the error is due to cancellation
			if (error instanceof Error && error.message === 'Job was cancelled') {
				console.log(`🛑 Sleep-based trip generation job ${job.id} was cancelled`);
				return;
			}
			console.error(`❌ Error in sleep-based trip generation job:`, error);
			throw error;
		}
	}

	private static async processDataImport(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`📥 Processing data import job ${job.id}`);

		const startTime = Date.now();
		const userId = job.created_by;

		try {
			// Check for cancellation or abort before starting
			if (abortSignal?.aborted) {
				throw new Error('Job was aborted');
			}
			await checkJobCancellation(job.id);

			// Extract job data
			const { storagePath, format, fileName } = job.data as {
				storagePath: string;
				format: string;
				fileName: string;
			};

			if (!storagePath || !format) {
				throw new Error('Missing storage path or format in job data');
			}

			// Download file content from Fluxbase Storage
			console.log('📥 Downloading file from storage:', storagePath);

			const { data: fileData, error: downloadError } = await fluxbase.storage
				.from('temp-files')
				.download(storagePath);

			if (downloadError || !fileData) {
				console.error('File download failed:', {
					storagePath,
					downloadError,
					fileData: fileData ? 'exists' : 'null'
				});
				throw new Error(`Failed to download file from storage: ${JSON.stringify(downloadError)}`);
			}

			// Get file size for memory management
			const fileSize = fileData.size;
			console.log(`📁 File size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

			// Convert blob to text
			const fileContent = await fileData.text();

			console.log(
				`📁 Processing import: ${fileName}, format: ${format}, content length: ${fileContent.length}`
			);

			// Update initial progress
			await JobQueueService.updateJobProgress(job.id, 0, {
				message: `Starting ${format} import...`,
				fileName,
				format,
				totalProcessed: 0,
				totalItems: 0
			});

			let importedCount = 0;
			let totalItems = 0;

			// Process based on format
			switch (format) {
				case 'GeoJSON': {
					const { importGeoJSONWithProgress } = await import(
						'./processors/import/geojson-importer'
					);
					importedCount = await importGeoJSONWithProgress(fileContent, userId, job.id, fileName);
					break;
				}
				case 'GPX': {
					const { importGPXWithProgress } = await import('./processors/import/gpx-importer');
					const result = await importGPXWithProgress(fileContent, userId, job.id, fileName);
					importedCount = result.importedCount;
					totalItems = result.totalItems;
					break;
				}
				case 'OwnTracks':
					{
						const { importOwnTracksWithProgress } = await import(
							'./processors/import/owntracks-importer'
						);
						importedCount = await importOwnTracksWithProgress(
							fileContent,
							userId,
							job.id,
							fileName
						);
					}
					break;
				default:
					throw new Error(`Unsupported format: ${format}`);
			}

			// Create background job for distance calculation
			// The trigger is disabled during bulk imports for performance, so we need
			// to calculate distances afterward. This is handled asynchronously to avoid
			// blocking the import completion.
			console.log('🔄 [IMPORT] Creating background distance calculation job...');

			await JobQueueService.updateJobProgress(job.id, 95, {
				message: `Creating background job for distance calculation...`,
				fileName,
				format,
				totalProcessed: importedCount,
				totalItems: totalItems || importedCount,
				importedCount
			});

			try {
				const { data: jobResult, error: backgroundJobError } = await fluxbase.rpc(
					'create_distance_calculation_job',
					{
						target_user_id: userId,
						job_reason: 'post_import'
					}
				);

				if (backgroundJobError) {
					console.warn(
						'⚠️ Failed to create background distance calculation job:',
						backgroundJobError
					);
				} else {
					console.log('✅ Background distance calculation job created successfully');
				}
			} catch (error) {
				console.warn('⚠️ Failed to create background distance calculation job:', error);
				// Don't fail the import, just log the error
			}

			// Remove duplicate tracking points
			console.log('🧹 Removing duplicate tracking points...');
			try {
				const { removeDuplicateTrackingPoints } = await import(
					'./processors/import/geojson-importer'
				);
				const { removed } = await removeDuplicateTrackingPoints(userId);
				console.log(`✅ Removed ${removed} duplicate tracking points`);
			} catch (dedupeError) {
				console.warn('⚠️ Failed to remove duplicates:', dedupeError);
				// Don't fail the import, just log the warning
			}

			// Update final progress
			const elapsedSeconds = (Date.now() - startTime) / 1000;
			await JobQueueService.updateJobProgress(job.id, 100, {
				message: `✅ Import completed successfully!`,
				fileName,
				format,
				totalProcessed: importedCount,
				totalItems: totalItems || importedCount,
				importedCount,
				elapsedSeconds: elapsedSeconds.toFixed(1)
			});

			// Clean up temporary file from storage after successful processing
			await fluxbase.storage.from('temp-files').remove([storagePath]);

			console.log(
				`✅ Data import completed: ${importedCount} items imported in ${elapsedSeconds.toFixed(1)}s`
			);

			// Create auto-reverse geocoding job for newly imported data
			try {
				console.log('🔄 Creating auto-reverse geocoding job for imported data...');
				const { error: reverseGeocodingError } = await fluxbase.from('jobs').insert({
					created_by: userId,
					type: 'reverse_geocoding_missing',
					status: 'queued',
					priority: 'normal',
					data: {
						type: 'reverse_geocoding_missing',
						created_by: userId
					}
				});

				if (reverseGeocodingError) {
					console.warn('⚠️ Failed to create auto-reverse geocoding job:', reverseGeocodingError);
				} else {
					console.log('✅ Auto-reverse geocoding job created successfully');
				}
			} catch (error) {
				console.warn('⚠️ Failed to create auto-reverse geocoding job:', error);
			}
		} catch (error: unknown) {
			// Check if the error is due to cancellation
			if (error instanceof Error && error.message === 'Job was cancelled') {
				console.log(`🛑 Data import job ${job.id} was cancelled`);
				// Clean up temporary file on cancellation
				try {
					const { storagePath } = job.data as { storagePath: string };
					if (storagePath) {
						await fluxbase.storage.from('temp-files').remove([storagePath]);
					}
				} catch (cleanupError) {
					console.error('Failed to cleanup temporary file on cancellation:', cleanupError);
				}
				return;
			}
			console.error(`❌ Error in data import job:`, error);
			// Clean up temporary file on error as well
			try {
				const { storagePath } = job.data as { storagePath: string };
				if (storagePath) {
					await fluxbase.storage.from('temp-files').remove([storagePath]);
				}
			} catch (cleanupError) {
				console.error('Failed to cleanup temporary file:', cleanupError);
			}
			throw error;
		}
	}

	private static async processDataExport(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`📦 Processing data export job ${job.id}`);

		try {
			await ExportProcessorService.processExport(job, abortSignal);
		} catch (error) {
			console.error(`❌ Error in data export job:`, error);
			throw error;
		}
	}

	private static async processGeocoding(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`🌍 Processing geocoding job ${job.id}`);
		// TODO: Implement geocoding processor
		throw new Error('Geocoding processor not yet implemented');
	}

	private static async processImageGeneration(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`🖼️ Processing image generation job ${job.id}`);
		// TODO: Implement image generation processor
		throw new Error('Image generation processor not yet implemented');
	}

	private static async processPOIDetection(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`📍 Processing POI detection job ${job.id}`);
		// TODO: Implement POI detection processor
		throw new Error('POI detection processor not yet implemented');
	}

	private static async processTripDetection(job: Job, abortSignal?: AbortSignal): Promise<void> {
		console.log(`🗺️ Processing trip detection job ${job.id}`);
		console.log(`👤 Job created by user: ${job.created_by}`);

		const startTime = Date.now();
		const userId = job.created_by;

		try {
			// Check for cancellation or abort before starting
			if (abortSignal?.aborted) {
				throw new Error('Job was aborted');
			}
			await checkJobCancellation(job.id);

			// Update initial progress
			await JobQueueService.updateJobProgress(job.id, 10, {
				message: 'Starting trip detection...'
			});

			// Use trip detection service
			const tripDetectionService = new TripDetectionService(
				process.env.FLUXBASE_BASE_URL!,
				process.env.FLUXBASE_SERVICE_ROLE_KEY!
			);

			// Set up progress tracking
			tripDetectionService.setProgressTracking(job.id, async (progress) => {
				await JobQueueService.updateJobProgress(job.id, progress.progress, {
					message: progress.message,
					phase: progress.phase,
					details: progress.details
				});
			});

			// Use the trip detection service (will use default date range)
			const detectedTrips = await tripDetectionService.detectTrips(userId);

			console.log(`✅ Trip detection completed: ${detectedTrips.length} trips detected`);

			// Save detected trips to the database
			if (detectedTrips.length > 0) {
				console.log(`💾 Saving ${detectedTrips.length} detected trips to database...`);

				const { data: savedTrips, error: saveError } = await fluxbase
					.from('trips')
					.insert(detectedTrips)
					.select();

				if (saveError) {
					console.error('❌ Error saving trips to database:', saveError);
					throw new Error(`Failed to save trips to database: ${saveError.message}`);
				}

				console.log(`✅ Successfully saved ${savedTrips?.length || 0} trips to database`);
			}

			const totalTime = Date.now() - startTime;
			console.log(
				`✅ Trip detection completed: ${detectedTrips.length} trips detected in ${totalTime}ms`
			);

			await JobQueueService.updateJobProgress(job.id, 100, {
				message: `Successfully detected ${detectedTrips.length} trips`,
				suggestedTripsCount: detectedTrips.length,
				totalTime: `${Math.round(totalTime / 1000)}s`
			});
		} catch (error: unknown) {
			// Check if the error is due to cancellation
			if (error instanceof Error && error.message === 'Job was cancelled') {
				console.log(`🛑 Trip detection job ${job.id} was cancelled`);
				return;
			}
			console.error(`❌ Error in trip detection job:`, error);
			throw error;
		}
	}

	private static async processDistanceCalculation(
		job: Job,
		abortSignal?: AbortSignal
	): Promise<void> {
		try {
			console.log(`🧮 Processing distance calculation job ${job.id}`);

			await JobQueueService.updateJobProgress(job.id, 0, {
				message: 'Starting distance calculation...'
			});

			const targetUserId = job.data.target_user_id as string;
			const BATCH_SIZE = 1000; // Process 1000 records per batch

			// Count total records for accurate progress tracking
			// We count ALL records with location (not just those needing distance)
			// because we process everything in chronological order
			console.log(`🔍 Counting total records for user ${targetUserId}...`);
			const { count, error: countError } = await fluxbase
				.from('tracker_data')
				.select('*', { count: 'exact', head: true })
				.eq('user_id', targetUserId)
				.not('location', 'is', null);

			if (countError) {
				console.error('❌ Error counting records:', countError);
				throw new Error(`Failed to count records: ${countError.message}`);
			}

			const totalRecords = count || 0;
			console.log(`📊 Total records to process: ${totalRecords}`);

			if (totalRecords === 0) {
				console.log('⏭️  No records to process');
				await JobQueueService.updateJobProgress(job.id, 100, {
					message: 'No records to process',
					totalRecords: 0,
					recordsProcessed: 0
				});
				return;
			}

			let offset = 0;
			let totalProcessed = 0;

			// Process in chronological batches using offset
			while (offset < totalRecords) {
				// Check for cancellation or abort before each batch
				if (abortSignal?.aborted) {
					throw new Error('Job was aborted');
				}
				await checkJobCancellation(job.id);

				const startTime = Date.now();
				console.log(`🧮 Processing batch at offset ${offset}/${totalRecords}...`);

				// Call new V2 function which uses chronological offset-based processing
				const { data: updatedCount, error } = await fluxbase.rpc('calculate_distances_batch_v2', {
					p_user_id: targetUserId,
					p_offset: offset,
					p_limit: BATCH_SIZE
				});

				const elapsed = Date.now() - startTime;

				if (error) {
					console.error(`❌ Error in batch processing:`, error);
					throw new Error(`Batch processing failed: ${error.message}`);
				}

				// Calculate how many records were in this batch
				const recordsInBatch = Math.min(BATCH_SIZE, totalRecords - offset);
				offset += recordsInBatch;
				totalProcessed += recordsInBatch;

				console.log(`⏱️  Batch took ${(elapsed / 1000).toFixed(1)}s`);
				console.log(
					`✅ Batch complete: ${updatedCount || 0} records updated, ${offset}/${totalRecords} total processed`
				);

				// Update progress (cap at 95% until final completion)
				const progressPercent = Math.min(95, Math.round((offset / totalRecords) * 100));
				await JobQueueService.updateJobProgress(job.id, progressPercent, {
					message: `Processing distances... ${offset}/${totalRecords} records`,
					recordsProcessed: offset,
					totalRecords,
					recordsUpdated: updatedCount || 0
				});

				// Small delay between batches to avoid overwhelming the database
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			console.log(`✅ Distance calculation completed: ${totalProcessed} records processed`);

			await JobQueueService.updateJobProgress(job.id, 100, {
				message: `Successfully processed ${totalProcessed} records`,
				totalRecords,
				recordsProcessed: totalProcessed
			});
		} catch (error: unknown) {
			// Check if the error is due to cancellation
			if (error instanceof Error && error.message === 'Job was cancelled') {
				console.log(`🛑 Distance calculation job ${job.id} was cancelled`);
				return;
			}
			console.error(`❌ Error in distance calculation job:`, error);
			throw error;
		}
	}
}
