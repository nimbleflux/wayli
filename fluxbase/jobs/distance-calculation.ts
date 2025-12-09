/**
 * Calculate distances between consecutive GPS points
 *
 * Processes user's GPS data in chronological batches, calculating the distance
 * between consecutive points using the Haversine formula.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 600
 */

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

interface DistanceCalculationPayload {
	/** @deprecated Use onBehalfOf option in job submission instead */
	target_user_id?: string;
}

export async function handler(
	req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = context.payload as DistanceCalculationPayload;
	const jobId = context.job_id;

	try {
		console.log(`🧮 Processing distance calculation job ${jobId}`);

		safeReportProgress(job, 0, '🧮 Starting distance calculation...');

		// Use user context from onBehalfOf (preferred) or fall back to target_user_id in payload (deprecated)
		const targetUserId = context.user?.id || payload?.target_user_id;

		if (!targetUserId) {
			return {
				success: false,
				error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
			};
		}
		const BATCH_SIZE = 1000; // Process 1000 records per batch

		// Count total records for accurate progress tracking
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
			console.log('⏭️ No records to process');
			safeReportProgress(job, 100, '⏭️ No records to process');
			return {
				success: true,
				result: {
					totalRecords: 0,
					recordsProcessed: 0
				}
			};
		}

		let offset = 0;
		let totalProcessed = 0;

		// Process in chronological batches using offset
		while (offset < totalRecords) {
			// Check for cancellation before each batch
			if (await job.isCancelled()) {
				console.log(`🛑 Distance calculation job ${jobId} was cancelled`);
				return {
					success: false,
					error: 'Job was cancelled'
				};
			}

			const startTime = Date.now();
			console.log(`🧮 Processing batch at offset ${offset}/${totalRecords}...`);

			// Call V2 function which uses chronological offset-based processing
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
			safeReportProgress(
				job,
				progressPercent,
				`🧮 Processing distances... ${offset.toLocaleString()}/${totalRecords.toLocaleString()} records`
			);

			// Small delay between batches to avoid overwhelming the database
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		console.log(`✅ Distance calculation completed: ${totalProcessed.toLocaleString()} records processed`);

		safeReportProgress(job, 100, `✅ Successfully processed ${totalProcessed.toLocaleString()} records`);

		return {
			success: true,
			result: {
				totalRecords,
				recordsProcessed: totalProcessed
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in distance calculation job:`, error);
		throw error;
	}
}
