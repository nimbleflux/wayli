/**
 * Job Creation Service
 *
 * Provides a convenient API for creating and managing Fluxbase Jobs
 */

import { fluxbase } from '$lib/fluxbase';
import {
	startUpload,
	updateUploadProgress,
	markUploadProcessing,
	completeUpload,
	failUpload
} from '$lib/stores/upload-store';

type JobType =
	| 'data-import-geojson'
	| 'data-import-gpx'
	| 'data-import-owntracks'
	| 'data-export'
	| 'trip-generation'
	| 'trip-detection'
	| 'reverse-geocoding'
	| 'distance-calculation';

const IMPORT_FORMAT_TO_JOB_TYPE: Record<string, JobType> = {
	GeoJSON: 'data-import-geojson',
	GPX: 'data-import-gpx',
	OwnTracks: 'data-import-owntracks'
};

type JobPriority = number; // 1-10, where 10 is highest priority

interface CreateJobOptions {
	type: JobType;
	data: Record<string, unknown>;
	priority?: JobPriority;
}

interface JobResult {
	id: string;
	type: JobType;
	status: string;
	created_at: string;
}

interface ImportOptions {
	format: string;
	includeLocationData?: boolean;
	includeWantToVisit?: boolean;
	includeTrips?: boolean;
}

interface ExportOptions {
	format: string;
	includeLocationData?: boolean;
	includeWantToVisit?: boolean;
	includeTrips?: boolean;
	startDate?: Date;
	endDate?: Date;
}

class JobCreationService {
	/**
	 * Create a new job using Fluxbase Jobs API
	 */
	async createJob(options: CreateJobOptions): Promise<JobResult> {
		const { data, error } = await fluxbase.jobs.submit(
			options.type,
			options.data,
			{
				namespace: 'wayli',
				priority: options.priority || 5 // Default to medium priority
			}
		);

		if (error) {
			throw new Error(`Failed to create job: ${error.message}`);
		}

		if (!data) {
			throw new Error('Failed to create job: No data returned');
		}

		// Extract job_id from data (SDK returns { job_id, status, ... } or { id, status, ... })
		const jobId = (data as any).job_id || (data as any).id;

		return {
			id: jobId,
			type: options.type,
			status: (data as any).status || 'queued',
			created_at: (data as any).created_at || new Date().toISOString()
		};
	}

	/**
	 * Create an import job - uploads file to storage and creates job
	 */
	async createImportJob(file: File, options: ImportOptions): Promise<JobResult> {
		// Get session for user ID
		const { data: sessionData } = await fluxbase.auth.getSession();
		const session = sessionData?.session;

		if (!session?.user?.id) {
			throw new Error('User not authenticated');
		}

		// Generate unique upload ID for tracking
		const uploadId = `upload-${Date.now()}`;

		// Determine the job type based on format
		const jobType = IMPORT_FORMAT_TO_JOB_TYPE[options.format];
		if (!jobType) {
			throw new Error(`Unsupported import format: ${options.format}`);
		}

		// Start tracking upload progress in the store
		startUpload(uploadId, file.name, file.size);

		try {
			// Generate unique filename
			const timestamp = Date.now();
			const fileName = `${session.user.id}/${timestamp}-${file.name}`;

			// Upload file using SDK storage with onUploadProgress to use XHR path
			// (The SDK's regular fetch path has a bug with FormData serialization)
			const { error: uploadError } = await fluxbase.storage
				.from('temp-files')
				.upload(fileName, file, {
					contentType: file.type,
					upsert: false,
					onUploadProgress: (progress) => {
						// Update the upload store with progress
						updateUploadProgress(uploadId, progress.loaded, progress.total, progress.percentage);
					}
				});

			if (uploadError) {
				failUpload(uploadId, uploadError.message);
				throw new Error(`File upload failed: ${uploadError.message}`);
			}

			// Mark as processing (creating job)
			markUploadProcessing(uploadId);

			// Create import job using Fluxbase Jobs with format-specific job type
			// Note: Job handlers expect camelCase property names in payload
			const jobResult = await this.createJob({
				type: jobType,
				data: {
					storagePath: fileName,
					fileName: file.name,
					fileSize: file.size,
					includeLocationData: options.includeLocationData,
					includeWantToVisit: options.includeWantToVisit,
					includeTrips: options.includeTrips
				}
			});

			// Upload complete, job created - remove from upload tracking
			completeUpload(uploadId);

			return jobResult;
		} catch (error) {
			// Make sure we clean up the upload tracking on error
			failUpload(uploadId, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}

	/**
	 * Create an export job
	 */
	async createExportJob(options: ExportOptions): Promise<JobResult> {
		return this.createJob({
			type: 'data-export',
			data: {
				format: options.format,
				includeLocationData: options.includeLocationData,
				includeWantToVisit: options.includeWantToVisit,
				includeTrips: options.includeTrips,
				startDate: options.startDate?.toISOString(),
				endDate: options.endDate?.toISOString()
			}
		});
	}

	/**
	 * Create a distance calculation job for a user
	 * Recalculates distances between consecutive GPS points
	 *
	 * Note: Distances are normally calculated automatically via database trigger.
	 * This job is for bulk recalculation (e.g., after algorithm changes or if trigger was disabled).
	 */
	async createDistanceCalculationJob(targetUserId?: string): Promise<JobResult> {
		// Get session for user ID if not provided
		if (!targetUserId) {
			const { data: sessionData } = await fluxbase.auth.getSession();
			const session = sessionData?.session;

			if (!session?.user?.id) {
				throw new Error('User not authenticated');
			}
			targetUserId = session.user.id;
		}

		return this.createJob({
			type: 'distance-calculation',
			data: {
				target_user_id: targetUserId
			},
			priority: 3 // Lower priority since it's a background recalculation
		});
	}

	/**
	 * Cancel a running job
	 */
	async cancelJob(jobId: string): Promise<void> {
		const { error } = await fluxbase.jobs.cancel(jobId);

		if (error) {
			throw new Error(`Failed to cancel job: ${error.message}`);
		}
	}
}

export const jobCreationService = new JobCreationService();
