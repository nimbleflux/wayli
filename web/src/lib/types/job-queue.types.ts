/**
 * Job Types
 * Updated to match Fluxbase Jobs SDK interface
 */

export interface Job {
	id: string;
	namespace: string;
	job_function_id?: string;
	job_name: string; // Changed from 'type' to match SDK
	status: JobStatus;
	payload?: any; // Changed from 'data' to match SDK
	result?: any;
	error?: string;
	logs?: string;
	priority: number; // Changed to number to match SDK
	max_duration_seconds?: number;
	progress_timeout_seconds?: number;
	progress_percent?: number; // Changed from 'progress' to match SDK
	progress_message?: string;
	progress_data?: any;
	max_retries: number;
	retry_count: number;
	created_at: string;
	updated_at?: string;
	started_at?: string;
	completed_at?: string;
	created_by: string;
}

export type JobType =
	| 'reverse-geocoding'
	| 'data-import-geojson'
	| 'data-import-gpx'
	| 'data-import-owntracks'
	| 'trip-generation'
	| 'data-export'
	| 'trip-detection'
	| 'distance-calculation'
	| 'visit-detection';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Note: Fluxbase Jobs platform manages job infrastructure
 * - Jobs are submitted via fluxbase.jobs.submit()
 * - Job handlers in /fluxbase/jobs/ are executed by Fluxbase
 * - Progress is reported via Fluxbase.reportProgress() in handlers
 * - Results are returned by handler functions
 */
