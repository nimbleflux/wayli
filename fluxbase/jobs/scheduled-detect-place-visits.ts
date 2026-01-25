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
 * @fluxbase:progress-timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 3 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handler(
  _req: Request,
  _fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient,
  job: JobUtils
) {
  try {
    job.reportProgress(0, 'Running incremental place visit detection query for all users...');

    // Start the RPC asynchronously
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

    const executionId = data?.execution_id;
    if (!executionId) {
      console.warn('No execution ID returned from RPC');
      return {
        success: true,
        result: { message: 'RPC started but no execution ID returned' }
      };
    }

    console.log(`RPC started with execution ID: ${executionId}`);

    // Poll for RPC completion while keeping job alive
    let execution: any;
    do {
      await sleep(5000); // Wait 5 seconds between polls

      try {
        const { data: status, error: statusError } = await (fluxbaseService.rpc as any).getStatus(
          executionId
        );

        if (statusError) {
          console.warn(`Error getting RPC status: ${statusError.message}`);
          // Keep job alive even on error
          (job.reportProgress as (percent: number | null, message: string) => void)(
            null,
            `Polling error: ${statusError.message}`
          );
          continue;
        }

        execution = status;
        console.log(`RPC status: ${JSON.stringify(execution)}`);

        // This resets the job's progress timeout (null = don't update percentage)
        (job.reportProgress as (percent: number | null, message: string) => void)(
          null,
          `Waiting for RPC: ${execution?.status || 'unknown'}`
        );
      } catch (err: any) {
        console.error(`Exception polling RPC status: ${err.message}`);
        (job.reportProgress as (percent: number | null, message: string) => void)(
          null,
          `Polling exception: ${err.message}`
        );
      }
    } while (!execution || execution.status === 'pending' || execution.status === 'running');

    if (execution.status === 'failed') {
      return {
        success: false,
        error: `Place visit detection failed: ${execution.error}`
      };
    }

    const result = execution.result?.[0] || execution.result || {};
    const insertedCount = result.inserted_count || 0;
    const usersProcessed = result.users_processed || 0;
    const deletedCount = result.deleted_count || 0;

    job.reportProgress(
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
  } catch (error: unknown) {
    console.error('❌ Error in scheduled-detect-place-visits job:', error);
    throw error;
  }
}
