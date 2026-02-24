/**
 * User-specific place visit detection
 *
 * Detects place visits incrementally for the authenticated user.
 * Uses the user's watermark timestamp to only process new data.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 3600
 * @fluxbase:progress-timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
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
  const context = job.getJobContext();
  const userId = context.user?.id;

  if (!userId) {
    return {
      success: false,
      error: 'No user context available'
    };
  }

  try {
    job.reportProgress(0, 'Running place visit detection query...');
    console.log(`🏠 Starting place visit detection for user ${userId}`);

    // Start the RPC asynchronously
    const { data, error } = await (fluxbaseService.rpc as any).invoke(
      'detect-place-visits-incremental',
      { user_id: userId },
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
        result: { message: 'RPC started but no execution ID returned', user_id: userId }
      };
    }

    console.log(`RPC started with execution ID: ${executionId}`);

    // Poll for RPC completion while keeping job alive
    let execution;
    do {
      await sleep(5000); // Wait 5 seconds between polls

      const { data: status } = await (fluxbaseService.rpc as any).getStatus(executionId);
      execution = status;

      // This resets the job's progress timeout (null = don't update percentage)
      // Note: runtime accepts null but types don't, so we use type assertion
      (job.reportProgress as (percent: number | null, message: string) => void)(
        null,
        `Waiting for RPC: ${execution.status}`
      );
    } while (execution.status === 'pending' || execution.status === 'running');

    if (execution.status === 'failed') {
      return {
        success: false,
        error: `Place visit detection failed: ${execution.error}`
      };
    }

    const result = execution.result?.[0] || execution.result || {};
    const insertedCount = result.inserted_count || 0;
    const deletedCount = result.deleted_count || 0;

    job.reportProgress(
      100,
      `Completed: ${insertedCount} visits detected (${deletedCount} old visits updated)`
    );

    console.log(`✅ Place visit detection complete: ${insertedCount} visits for user ${userId}`);

    // Chain: Submit sync-poi-to-kb job to update knowledge base with new visits
    if (insertedCount > 0) {
      console.log(`🔗 Submitting sync-poi-to-kb job for user ${userId}...`);
      try {
        const { error: submitError } = await fluxbaseService.jobs.submit(
          'sync-poi-to-kb',
          {},
          {
            namespace: 'wayli',
            priority: 3,
            onBehalfOf: {
              user_id: userId
            }
          }
        );

        if (submitError) {
          console.warn(`⚠️ Failed to submit KB sync job:`, submitError);
          // Don't fail the detection job if sync submission fails
        } else {
          console.log(`✅ KB sync job submitted for user ${userId}`);
        }
      } catch (err) {
        console.warn(`⚠️ Error submitting KB sync job:`, err);
        // Don't fail the detection job if sync submission fails
      }
    }

    return {
      success: true,
      result: {
        inserted_count: insertedCount,
        deleted_count: deletedCount,
        user_id: userId
      }
    };
  } catch (error: unknown) {
    console.error('❌ Error in detect-place-visits job:', error);
    throw error;
  }
}
