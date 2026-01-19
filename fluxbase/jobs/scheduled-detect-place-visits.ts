/**
 * Scheduled place visit detection for all users
 *
 * Runs daily at 03:00 UTC to detect place visits incrementally for all users.
 * Each user's data is processed from their respective watermark timestamp.
 *
 * Can be triggered manually by admins or runs automatically via schedule.
 *
 * @fluxbase:require-role admin, service_role
 * @fluxbase:timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 3 * * *
 */

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

/**
 * Wait for an RPC job to complete by polling its status.
 */
async function waitForRpcCompletion(
  fluxbase: FluxbaseClient,
  executionId: string,
  job: JobUtils,
  maxWaitMs: number = 1800000, // 30 minutes max (matches RPC timeout)
  pollIntervalMs: number = 5000 // Poll every 5 seconds
): Promise<{ success: boolean; result?: any; error?: string }> {
  const startTime = Date.now();
  console.log(`Waiting for RPC execution ${executionId} to complete...`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data: status } = await (fluxbase.rpc as any).getStatus(executionId);
      console.log(`RPC status for ${executionId}:`, JSON.stringify(status));

      if (status?.status === 'completed' || status?.status === 'success') {
        console.log(`RPC execution ${executionId} completed successfully`);
        return { success: true, result: status?.result };
      }

      if (status?.status === 'failed' || status?.status === 'error') {
        const errorMsg = status?.error_message || status?.error || status?.message || 'unknown error';
        console.warn(`RPC execution ${executionId} failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      if (status?.progress !== undefined) {
        safeReportProgress(job, Math.min(5 + status.progress * 0.9, 95), `Processing: ${status.progress}%`);
      }
    } catch (err) {
      console.warn(`Error checking RPC status:`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.warn(`RPC execution ${executionId} timed out after ${maxWaitMs / 1000}s`);
  return { success: false, error: `Timed out after ${maxWaitMs / 1000}s` };
}

export async function handler(
  _req: Request,
  _fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient,
  job: JobUtils
) {
  try {
    safeReportProgress(job, 5, 'Starting incremental place visit detection for all users...');

    // Invoke global incremental detection asynchronously to avoid request timeout
    const { data, error } = await (fluxbaseService.rpc as any).invoke(
      'detect-place-visits-incremental',
      { user_id: null },
      { namespace: 'wayli', async: true }
    );

    if (error) {
      console.error('❌ Failed to start place visit detection:', error);
      return {
        success: false,
        error: `Failed to start place visit detection: ${error.message}`
      };
    }

    // Get execution ID and wait for completion
    const executionId = data?.execution_id || data;
    if (executionId) {
      console.log(`RPC started with execution ID: ${executionId}`);
      const completion = await waitForRpcCompletion(fluxbaseService, executionId, job);

      if (!completion.success) {
        return {
          success: false,
          error: `Place visit detection failed: ${completion.error}`
        };
      }

      const result = completion.result?.[0] || completion.result || {};
      const insertedCount = result.inserted_count || 0;
      const usersProcessed = result.users_processed || 0;
      const deletedCount = result.deleted_count || 0;

      safeReportProgress(
        job,
        100,
        `Completed: ${insertedCount} visits detected for ${usersProcessed} users (${deletedCount} old visits updated)`
      );

      console.log(
        `✅ Scheduled place visit detection complete: ${insertedCount} visits for ${usersProcessed} users`
      );

      return {
        success: true,
        result: {
          inserted_count: insertedCount,
          users_processed: usersProcessed,
          deleted_count: deletedCount
        }
      };
    }

    // Fallback if no execution ID returned (shouldn't happen with async: true)
    console.warn('No execution ID returned from RPC');
    return {
      success: true,
      result: { message: 'RPC started but no execution ID returned' }
    };
  } catch (error: unknown) {
    console.error('❌ Error in scheduled-detect-place-visits job:', error);
    throw error;
  }
}
