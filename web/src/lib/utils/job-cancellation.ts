// web/src/shared/utils/job-cancellation.ts
import { fluxbase } from '../../worker/fluxbase';

/**
 * Check if a job has been cancelled
 * @param jobId - The job ID to check
 * @throws Error if the job has been cancelled
 */
export async function checkJobCancellation(jobId?: string): Promise<void> {
	if (!jobId) return;
	const { data: job, error } = await fluxbase
		.from('jobs')
		.select('status')
		.eq('id', jobId)
		.single();

	if (error || !job) {
		console.error('🔍 Error checking job status:', error);
		return;
	}

	if (job.status === 'cancelled') {
		console.log(`🛑 Job ${jobId} was cancelled`);
		throw new Error('Job was cancelled');
	}
}
