/**
 * Sync POI embeddings from user's visit history
 *
 * Generates vector embeddings for POIs from my_poi_summary view.
 * Uses Fluxbase's built-in embedding API for vector generation.
 * Handles deletion of orphaned embeddings when POIs are removed from history.
 *
 * Uses RLS-protected views (my_*) with user's client for security.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type { FluxbaseClient, JobUtils } from './types';

interface SyncPoiEmbeddingsPayload {
  /** Force regeneration of all embeddings, even existing ones */
  force_regenerate?: boolean;
  /** Maximum number of POIs to process (for testing) */
  limit?: number;
}

interface PoiSummary {
  poi_name: string;
  poi_amenity: string | null;
  poi_category: string | null;
  poi_cuisine?: string | null;
  poi_sport?: string | null;
  city: string | null;
  country_code: string | null;
  visit_count: number;
  avg_duration_minutes: number | null;
}

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage: { prompt_tokens: number; total_tokens: number };
}

const BATCH_SIZE = 50;

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
 * Build rich semantic embedding text from POI data
 * Uses natural language for better vector similarity matching
 */
function buildPoiEmbeddingText(poi: PoiSummary): string {
  const parts: string[] = [];

  // Natural language name + type
  if (poi.poi_name && poi.poi_amenity) {
    parts.push(`${poi.poi_name} is a ${poi.poi_amenity}`);
  } else if (poi.poi_name) {
    parts.push(poi.poi_name);
  }

  // Location context
  if (poi.city && poi.country_code) {
    parts.push(`located in ${poi.city}, ${poi.country_code}`);
  } else if (poi.city) {
    parts.push(`in ${poi.city}`);
  } else if (poi.country_code) {
    parts.push(`in ${poi.country_code}`);
  }

  // Category and cuisine as descriptive text
  if (poi.poi_cuisine) {
    parts.push(`specializing in ${poi.poi_cuisine} cuisine`);
  }
  if (poi.poi_sport) {
    parts.push(`for ${poi.poi_sport}`);
  }

  // Visit frequency context (semantic signal for recommendations)
  if (poi.visit_count >= 10) {
    parts.push('This is a frequently visited favorite location');
  } else if (poi.visit_count >= 5) {
    parts.push('This is a regular spot');
  } else if (poi.visit_count >= 2) {
    parts.push('Visited occasionally');
  } else {
    parts.push('Visited once');
  }

  // Duration context (semantic signal for place type)
  if (poi.avg_duration_minutes) {
    if (poi.avg_duration_minutes > 90) {
      parts.push('with leisurely extended visits');
    } else if (poi.avg_duration_minutes > 45) {
      parts.push('with moderate length visits');
    } else {
      parts.push('for quick stops');
    }
  }

  return parts.join(' ') + '.';
}

export async function handler(
  _req: Request,
  fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient,
  job: JobUtils
) {
  const context = job.getJobContext();
  const payload = context.payload as SyncPoiEmbeddingsPayload;
  const userId = context.user?.id;

  if (!userId) {
    return {
      success: false,
      error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
    };
  }

  const forceRegenerate = payload?.force_regenerate || false;
  const maxLimit = payload?.limit;

  safeReportProgress(job, 5, 'Fetching POI summary...');

  // Fetch user's POI summary using RLS-protected view
  let query = fluxbase.from('my_poi_summary').select('*');
  if (maxLimit) {
    query = query.limit(maxLimit);
  }

  const { data: pois, error: poiError } = await query;

  if (poiError) {
    console.error('Failed to fetch POI summary:', poiError);
    return { success: false, error: `Failed to fetch POI summary: ${poiError.message}` };
  }

  if (!pois || pois.length === 0) {
    safeReportProgress(job, 100, 'No POIs found to process');
    return { success: true, result: { processed: 0, skipped: 0, errors: 0, deleted: 0 } };
  }

  safeReportProgress(job, 10, `Found ${pois.length} POIs. Checking for existing embeddings...`);

  // Get existing embeddings using RLS-protected view
  // Note: my_poi_embeddings view filters by auth.uid() automatically
  const { data: existingEmbeddings, error: embError } = await fluxbase
    .from('my_poi_embeddings')
    .select('id, poi_name, city, country_code, has_embedding');

  if (embError) {
    console.error('Failed to fetch existing embeddings:', embError);
  }

  // Create a set of current POI keys for deletion detection
  const currentPoiKeys = new Set<string>();
  for (const poi of pois as PoiSummary[]) {
    const key = `${poi.poi_name}|${poi.city || ''}|${poi.country_code || ''}`;
    currentPoiKeys.add(key);
  }

  // Create a map of existing embeddings for quick lookup
  const existingMap = new Map<string, { hasEmbedding: boolean; id: string }>();
  const orphanedEmbeddingIds: string[] = [];

  if (existingEmbeddings) {
    for (const emb of existingEmbeddings) {
      const key = `${emb.poi_name}|${emb.city || ''}|${emb.country_code || ''}`;
      existingMap.set(key, { hasEmbedding: emb.has_embedding === true, id: emb.id });

      // Check if this embedding is orphaned (POI no longer exists in visits)
      if (!currentPoiKeys.has(key)) {
        orphanedEmbeddingIds.push(emb.id);
      }
    }
  }

  // Delete orphaned embeddings
  let deleted = 0;
  if (orphanedEmbeddingIds.length > 0) {
    safeReportProgress(job, 12, `Removing ${orphanedEmbeddingIds.length} orphaned embeddings...`);

    const { error: deleteError } = await fluxbase
      .from('poi_embeddings')
      .delete()
      .in('id', orphanedEmbeddingIds);

    if (deleteError) {
      console.error('Failed to delete orphaned embeddings:', deleteError);
    } else {
      deleted = orphanedEmbeddingIds.length;
      console.log(`Deleted ${deleted} orphaned POI embeddings`);
    }
  }

  // Filter POIs that need embedding
  const poisToEmbed: PoiSummary[] = [];
  let skipped = 0;

  for (const poi of pois as PoiSummary[]) {
    const key = `${poi.poi_name}|${poi.city || ''}|${poi.country_code || ''}`;
    const existing = existingMap.get(key);

    if (forceRegenerate || !existing?.hasEmbedding) {
      poisToEmbed.push(poi);
    } else {
      skipped++;
    }
  }

  if (poisToEmbed.length === 0) {
    safeReportProgress(job, 100, `All ${skipped} POIs already have embeddings${deleted > 0 ? `, ${deleted} orphaned removed` : ''}`);
    return { success: true, result: { processed: 0, skipped, errors: 0, deleted } };
  }

  safeReportProgress(job, 15, `Processing ${poisToEmbed.length} POIs (${skipped} already embedded)...`);

  let processed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < poisToEmbed.length; i += BATCH_SIZE) {
    const cancelled = await job.isCancelled();
    if (cancelled) {
      safeReportProgress(job, 0, 'Job cancelled');
      return { success: false, error: 'Job cancelled', result: { processed, skipped, errors, deleted } };
    }

    const batch = poisToEmbed.slice(i, i + BATCH_SIZE);
    const texts = batch.map(poi => buildPoiEmbeddingText(poi));

    try {
      // Generate embeddings using Fluxbase SDK
      const { data: embedResult, error: embedError } = await fluxbase.vector.embed({
        texts,
        model: 'text-embedding-3-small'
      });

      if (embedError || !embedResult) {
        throw new Error(`Embedding API error: ${embedError?.message || 'No result returned'}`);
      }

      const embeddings = embedResult.embeddings;

      // Upsert embeddings to database
      for (let j = 0; j < batch.length; j++) {
        const poi = batch[j];
        const embedding = embeddings[j];

        try {
          const { error: upsertError } = await fluxbase.from('poi_embeddings').upsert(
            {
              user_id: userId,
              poi_name: poi.poi_name,
              poi_amenity: poi.poi_amenity,
              poi_category: poi.poi_category,
              poi_cuisine: poi.poi_cuisine || null,
              poi_sport: poi.poi_sport || null,
              city: poi.city,
              country_code: poi.country_code,
              embedding: `[${embedding.join(',')}]`, // pgvector format
              source_text: texts[j],
              visit_count: poi.visit_count,
              avg_duration_minutes: poi.avg_duration_minutes || 0,
              embedded_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id,poi_name,city,country_code' }
          );

          if (upsertError) {
            console.error(`Failed to upsert embedding for ${poi.poi_name}:`, upsertError);
            errors++;
          } else {
            processed++;
          }
        } catch (upsertErr) {
          console.error(`Exception upserting embedding for ${poi.poi_name}:`, upsertErr);
          errors++;
        }
      }
    } catch (batchError) {
      console.error(`Failed to process batch starting at ${i}:`, batchError);
      errors += batch.length;
    }

    // Report progress
    const progress = 15 + Math.round(((i + batch.length) / poisToEmbed.length) * 80);
    safeReportProgress(
      job,
      progress,
      `Processed ${Math.min(i + batch.length, poisToEmbed.length)}/${poisToEmbed.length} POIs`
    );
  }

  safeReportProgress(
    job,
    100,
    `Completed: ${processed} embeddings generated, ${skipped} skipped, ${errors} errors${deleted > 0 ? `, ${deleted} orphaned removed` : ''}`
  );

  // Chain: Update user preferences after POI embeddings are synced
  if (processed > 0) {
    console.log(`🔗 Queueing compute-user-preferences job...`);
    try {
      const onBehalfOf = context.user ? {
        user_id: context.user.id,
        user_email: context.user.email,
        user_role: context.user.role
      } : undefined;

      const { data: prefJob, error: prefError } = await fluxbaseService.jobs.submit(
        'compute-user-preferences',
        {},
        {
          namespace: 'wayli',
          priority: 6,
          onBehalfOf
        }
      );

      if (prefError) {
        console.warn(`⚠️ Failed to queue compute-user-preferences job: ${prefError.message}`);
      } else {
        console.log(`✅ compute-user-preferences job queued: ${(prefJob as any)?.job_id || 'unknown'}`);
      }
    } catch (prefQueueError) {
      console.warn(`⚠️ Error queueing compute-user-preferences job:`, prefQueueError);
    }
  }

  return {
    success: errors === 0,
    result: {
      processed,
      skipped,
      errors,
      deleted
    }
  };
}
