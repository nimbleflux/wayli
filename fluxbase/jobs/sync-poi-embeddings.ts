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

interface OsmAmenities {
  outdoor_seating: boolean;
  wifi: boolean;
  wheelchair: boolean;
  takeaway: boolean;
  delivery: boolean;
  smoking: boolean;
  air_conditioning: boolean;
}

interface TimePattern {
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
}

interface DayPattern {
  weekend_visits: number;
  weekday_visits: number;
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
  // New enrichment columns from migration 020
  osm_amenities?: OsmAmenities | null;
  time_pattern?: TimePattern | null;
  day_pattern?: DayPattern | null;
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
 *
 * Enriched with OSM amenities, time patterns, and behavioral signals
 * to enable semantic queries like "cozy cafes", "work spots", "late night food"
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

  // OSM amenity descriptors (enables "wifi cafe", "outdoor seating" queries)
  if (poi.osm_amenities) {
    const amenities: string[] = [];
    if (poi.osm_amenities.outdoor_seating) amenities.push('outdoor seating');
    if (poi.osm_amenities.wifi) amenities.push('free wifi');
    if (poi.osm_amenities.wheelchair) amenities.push('wheelchair accessible');
    if (poi.osm_amenities.takeaway) amenities.push('takeaway available');
    if (poi.osm_amenities.delivery) amenities.push('delivery service');
    if (poi.osm_amenities.air_conditioning) amenities.push('air conditioned');
    if (amenities.length > 0) {
      parts.push(`with ${amenities.join(', ')}`);
    }
  }

  // Time-of-day pattern (enables "morning cafe", "late night spot" queries)
  if (poi.time_pattern) {
    const { morning, afternoon, evening, night } = poi.time_pattern;
    const total = morning + afternoon + evening + night;
    if (total > 0) {
      const morningPct = morning / total;
      const eveningPct = evening / total;
      const nightPct = night / total;

      if (morningPct > 0.5) {
        parts.push('popular for morning visits');
      } else if (eveningPct > 0.5) {
        parts.push('popular in the evening');
      } else if (nightPct > 0.3) {
        parts.push('late night spot');
      } else if (morningPct > 0.3 && afternoonPct(afternoon, total) > 0.3) {
        parts.push('daytime favorite');
      }
    }
  }

  // Weekend preference (enables "weekend brunch", "weekday lunch" queries)
  if (poi.day_pattern) {
    const { weekend_visits, weekday_visits } = poi.day_pattern;
    const total = weekend_visits + weekday_visits;
    if (total >= 3) {
      const weekendPct = weekend_visits / total;
      if (weekendPct > 0.7) {
        parts.push('weekend favorite');
      } else if (weekendPct < 0.3) {
        parts.push('weekday spot');
      }
    }
  }

  // Infer vibe from visit duration + category (enables "cozy", "quick bite" queries)
  if (poi.avg_duration_minutes && poi.poi_category === 'food') {
    if (poi.avg_duration_minutes > 90) {
      parts.push('great for leisurely dining');
    } else if (poi.avg_duration_minutes > 60) {
      parts.push('relaxed atmosphere');
    } else if (poi.avg_duration_minutes < 20) {
      parts.push('quick service');
    }
  } else if (poi.avg_duration_minutes) {
    // Non-food categories
    if (poi.avg_duration_minutes > 90) {
      parts.push('with leisurely extended visits');
    } else if (poi.avg_duration_minutes > 45) {
      parts.push('with moderate length visits');
    } else {
      parts.push('for quick stops');
    }
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

  return parts.join(' ') + '.';
}

// Helper function for afternoon percentage calculation
function afternoonPct(afternoon: number, total: number): number {
  return total > 0 ? afternoon / total : 0;
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

  safeReportProgress(job, 5, 'Counting POIs to process...');

  // First, count total POIs (excluding null names at database level)
  const { count: totalPoisCount, error: countError } = await fluxbase
    .from('my_poi_summary')
    .select('*', { count: 'exact', head: true })
    .not('poi_name', 'is', null); // Filter out null names in SQL

  if (countError) {
    console.error('Failed to count POIs:', countError);
    return { success: false, error: `Failed to count POIs: ${countError.message}` };
  }

  const totalPois = maxLimit ? Math.min(totalPoisCount || 0, maxLimit) : (totalPoisCount || 0);

  if (totalPois === 0) {
    safeReportProgress(job, 100, 'No POIs found to process');
    return { success: true, result: { processed: 0, skipped: 0, errors: 0, deleted: 0 } };
  }

  console.log(`📊 Found ${totalPois.toLocaleString()} total POIs to process`);
  safeReportProgress(job, 8, `Found ${totalPois.toLocaleString()} POIs. Fetching in batches...`);

  safeReportProgress(job, 10, 'Fetching existing embeddings...');

  // Get existing embeddings using RLS-protected view
  // Note: my_poi_embeddings view filters by auth.uid() automatically
  const { data: existingEmbeddings, error: embError } = await fluxbase
    .from('my_poi_embeddings')
    .select('id, poi_name, city, country_code, has_embedding');

  if (embError) {
    console.error('Failed to fetch existing embeddings:', embError);
  }

  // Create a map of existing embeddings for quick lookup
  const existingMap = new Map<string, { hasEmbedding: boolean; id: string }>();
  if (existingEmbeddings) {
    for (const emb of existingEmbeddings) {
      const key = `${emb.poi_name}|${emb.city || ''}|${emb.country_code || ''}`;
      existingMap.set(key, { hasEmbedding: emb.has_embedding === true, id: emb.id });
    }
  }

  // Process POIs in batches to handle large datasets
  const FETCH_BATCH_SIZE = 1000; // Fetch POIs in chunks of 1000
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let offset = 0;

  // Track current POI keys across all batches for orphan detection
  const allCurrentPoiKeys = new Set<string>();

  safeReportProgress(job, 12, 'Starting to process POIs in batches...');

  while (totalProcessed + totalSkipped < totalPois) {
    // Check for cancellation
    const cancelled = await job.isCancelled();
    if (cancelled) {
      safeReportProgress(job, 0, 'Job cancelled');
      return { success: false, error: 'Job cancelled', result: { processed: totalProcessed, skipped: totalSkipped, errors: totalErrors, deleted: 0 } };
    }

    // Fetch next batch of POIs (filter null names at database level)
    let poiBatchQuery = fluxbase
      .from('my_poi_summary')
      .select('*')
      .not('poi_name', 'is', null) // Filter out null names in SQL
      .range(offset, offset + FETCH_BATCH_SIZE - 1);

    const { data: poiBatch, error: poiError } = await poiBatchQuery;

    if (poiError) {
      console.error('Failed to fetch POI batch:', poiError);
      return { success: false, error: `Failed to fetch POI batch: ${poiError.message}` };
    }

    // No more POIs to process
    if (!poiBatch || poiBatch.length === 0) {
      console.log(`📊 No more POIs found after ${totalProcessed + totalSkipped} processed`);
      break;
    }

    // Filter POIs that need embedding in this batch
    const poisToEmbed: PoiSummary[] = [];
    let batchSkipped = 0;

    for (const poi of poiBatch as PoiSummary[]) {
      // Note: null names already filtered at database level
      const key = `${poi.poi_name}|${poi.city || ''}|${poi.country_code || ''}`;
      allCurrentPoiKeys.add(key); // Track for orphan detection

      const existing = existingMap.get(key);

      if (forceRegenerate || !existing?.hasEmbedding) {
        poisToEmbed.push(poi);
      } else {
        batchSkipped++;
        totalSkipped++;
      }
    }

    // Process embeddings for this batch
    const batchResult = await processPoisBatch(fluxbase, userId, poisToEmbed, job, totalProcessed, totalPois);
    totalProcessed += batchResult.processed;
    totalErrors += batchResult.errors;

    offset += poiBatch.length;

    // Update progress
    const progress = Math.min(95, 12 + Math.round(((totalProcessed + totalSkipped) / totalPois) * 83));
    safeReportProgress(
      job,
      progress,
      `Processed ${(totalProcessed + totalSkipped).toLocaleString()}/${totalPois.toLocaleString()} POIs (${totalProcessed} embedded, ${totalSkipped} skipped, ${totalErrors} errors)`
    );

    // Respect maxLimit if set
    if (maxLimit && (totalProcessed + totalSkipped) >= maxLimit) {
      break;
    }
  }

  // Clean up orphaned embeddings (POIs that no longer exist in visits)
  safeReportProgress(job, 96, 'Checking for orphaned embeddings...');
  let deleted = 0;

  if (existingEmbeddings) {
    const orphanedEmbeddingIds: string[] = [];
    for (const emb of existingEmbeddings) {
      const key = `${emb.poi_name}|${emb.city || ''}|${emb.country_code || ''}`;
      if (!allCurrentPoiKeys.has(key)) {
        orphanedEmbeddingIds.push(emb.id);
      }
    }

    if (orphanedEmbeddingIds.length > 0) {
      console.log(`🗑️ Removing ${orphanedEmbeddingIds.length} orphaned embeddings...`);

      // Delete in batches to avoid "Request Header Fields Too Large" error
      // UUIDs are 36 chars each, so keep batches small
      const DELETE_BATCH_SIZE = 20;
      for (let i = 0; i < orphanedEmbeddingIds.length; i += DELETE_BATCH_SIZE) {
        const batch = orphanedEmbeddingIds.slice(i, i + DELETE_BATCH_SIZE);
        const { error: deleteError } = await fluxbase
          .from('poi_embeddings')
          .delete()
          .in('id', batch);

        if (deleteError) {
          console.error(`Failed to delete orphaned embeddings batch ${i / DELETE_BATCH_SIZE + 1}:`, deleteError);
        } else {
          deleted += batch.length;
        }
      }

      if (deleted > 0) {
        console.log(`✅ Deleted ${deleted} orphaned POI embeddings`);
      }
    }
  }

  safeReportProgress(
    job,
    100,
    `Completed: ${totalProcessed} embeddings generated, ${totalSkipped} skipped, ${totalErrors} errors${deleted > 0 ? `, ${deleted} orphaned removed` : ''}`
  );

  // Chain: Update user preferences after POI embeddings are synced
  if (totalProcessed > 0) {
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
    success: totalErrors === 0,
    result: {
      processed: totalProcessed,
      skipped: totalSkipped,
      errors: totalErrors,
      deleted
    }
  };
}

/**
 * Process a batch of POIs for embedding generation
 */
async function processPoisBatch(
  fluxbase: FluxbaseClient,
  userId: string,
  pois: PoiSummary[],
  job: JobUtils,
  totalProcessed: number,
  totalPois: number
): Promise<{ processed: number; errors: number }> {
  if (pois.length === 0) {
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  // Process in embedding batches (50 at a time for the embedding API)
  for (let i = 0; i < pois.length; i += BATCH_SIZE) {
    // Check for cancellation
    const cancelled = await job.isCancelled();
    if (cancelled) {
      return { processed, errors };
    }

    const batch = pois.slice(i, i + BATCH_SIZE);
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
      console.error(`Failed to process embedding batch:`, batchError);
      errors += batch.length;
    }
  }

  return { processed, errors };
}
