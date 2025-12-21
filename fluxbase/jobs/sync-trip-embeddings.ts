/**
 * Sync trip embeddings from user's trips
 *
 * Generates vector embeddings for trips from my_trips view.
 * Uses Fluxbase's built-in embedding API for vector generation.
 * Deletions are handled automatically via FK CASCADE.
 *
 * Uses RLS-protected views (my_*) with user's client for security.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type { FluxbaseClient, JobUtils } from './types';

interface SyncTripEmbeddingsPayload {
  /** Force regeneration of all embeddings, even existing ones */
  force_regenerate?: boolean;
  /** Specific trip ID to update (for incremental updates) */
  trip_id?: string;
}

interface Trip {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
  image_url: string | null;
  labels: string[] | null;
  visited_cities: string | null;
  visited_countries: string | null;
}

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage: { prompt_tokens: number; total_tokens: number };
}

const BATCH_SIZE = 20;

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
 * Build rich semantic embedding text from trip data
 * Uses natural language for better vector similarity matching
 */
function buildTripEmbeddingText(trip: Trip): string {
  const parts: string[] = [];

  // Title as natural opener
  if (trip.title) {
    parts.push(trip.title);
  }

  // Description if present
  if (trip.description) {
    parts.push(trip.description);
  }

  // Destination context in natural language
  if (trip.visited_cities && trip.visited_countries) {
    parts.push(`A trip visiting ${trip.visited_cities} in ${trip.visited_countries}`);
  } else if (trip.visited_cities) {
    parts.push(`Visiting ${trip.visited_cities}`);
  } else if (trip.visited_countries) {
    parts.push(`A trip to ${trip.visited_countries}`);
  }

  // Duration context with semantic descriptions
  if (trip.start_date && trip.end_date) {
    const start = new Date(trip.start_date);
    const end = new Date(trip.end_date);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 3) {
      parts.push(`A short ${days}-day getaway`);
    } else if (days <= 7) {
      parts.push(`A week-long trip of ${days} days`);
    } else if (days <= 14) {
      parts.push(`An extended ${days}-day journey`);
    } else {
      parts.push(`A long ${days}-day adventure`);
    }

    // Add seasonal context
    const month = start.getMonth();
    if (month >= 2 && month <= 4) {
      parts.push('during spring');
    } else if (month >= 5 && month <= 7) {
      parts.push('during summer');
    } else if (month >= 8 && month <= 10) {
      parts.push('during autumn');
    } else {
      parts.push('during winter');
    }
  }

  // Labels as context
  if (trip.labels && trip.labels.length > 0) {
    const labelDescriptions = trip.labels.map(label => {
      // Convert common labels to more descriptive text
      switch (label.toLowerCase()) {
        case 'business': return 'business travel';
        case 'vacation': return 'vacation trip';
        case 'family': return 'family trip';
        case 'solo': return 'solo adventure';
        case 'romantic': return 'romantic getaway';
        case 'adventure': return 'adventure trip';
        default: return label;
      }
    });
    parts.push(`Tagged as: ${labelDescriptions.join(', ')}`);
  }

  return parts.join('. ') + '.';
}

export async function handler(
  _req: Request,
  fluxbase: FluxbaseClient,
  _fluxbaseService: FluxbaseClient,
  job: JobUtils
) {
  const context = job.getJobContext();
  const payload = context.payload as SyncTripEmbeddingsPayload;
  const userId = context.user?.id;

  if (!userId) {
    return {
      success: false,
      error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
    };
  }

  const forceRegenerate = payload?.force_regenerate || false;
  const specificTripId = payload?.trip_id;

  safeReportProgress(job, 5, 'Fetching trips...');

  // Fetch user's trips using RLS-protected view (only active, completed, planned)
  let query = fluxbase
    .from('my_trips')
    .select('id, title, description, start_date, end_date, status, image_url, labels, visited_cities, visited_countries')
    .in('status', ['active', 'completed', 'planned']);

  if (specificTripId) {
    query = query.eq('id', specificTripId);
  }

  const { data: trips, error: tripError } = await query;

  if (tripError) {
    console.error('Failed to fetch trips:', tripError);
    return { success: false, error: `Failed to fetch trips: ${tripError.message}` };
  }

  if (!trips || trips.length === 0) {
    safeReportProgress(job, 100, specificTripId ? 'Trip not found' : 'No trips found to process');
    return { success: true, result: { processed: 0, skipped: 0, errors: 0 } };
  }

  safeReportProgress(job, 10, `Found ${trips.length} trips. Checking for existing embeddings...`);

  // Get existing embeddings using RLS-protected view
  const { data: existingEmbeddings, error: embError } = await fluxbase
    .from('my_trip_embeddings')
    .select('trip_id, has_embedding');

  if (embError) {
    console.error('Failed to fetch existing embeddings:', embError);
  }

  // Create a map of existing embeddings for quick lookup
  const existingMap = new Map<string, boolean>();
  if (existingEmbeddings) {
    for (const emb of existingEmbeddings) {
      existingMap.set(emb.trip_id, emb.has_embedding === true);
    }
  }

  // Filter trips that need embedding
  const tripsToEmbed: Trip[] = [];
  let skipped = 0;

  for (const trip of trips as Trip[]) {
    const hasEmbedding = existingMap.get(trip.id);

    if (forceRegenerate || !hasEmbedding) {
      tripsToEmbed.push(trip);
    } else {
      skipped++;
    }
  }

  if (tripsToEmbed.length === 0) {
    safeReportProgress(job, 100, `All ${skipped} trips already have embeddings`);
    return { success: true, result: { processed: 0, skipped, errors: 0 } };
  }

  safeReportProgress(job, 15, `Processing ${tripsToEmbed.length} trips (${skipped} already embedded)...`);

  let processed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < tripsToEmbed.length; i += BATCH_SIZE) {
    const cancelled = await job.isCancelled();
    if (cancelled) {
      safeReportProgress(job, 0, 'Job cancelled');
      return { success: false, error: 'Job cancelled', result: { processed, skipped, errors } };
    }

    const batch = tripsToEmbed.slice(i, i + BATCH_SIZE);
    const texts = batch.map(trip => buildTripEmbeddingText(trip));

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
        const trip = batch[j];
        const embedding = embeddings[j];

        try {
          const { error: upsertError } = await fluxbase.from('trip_embeddings').upsert(
            {
              user_id: userId,
              trip_id: trip.id,
              embedding: `[${embedding.join(',')}]`, // pgvector format
              source_text: texts[j],
              embedded_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            { onConflict: 'trip_id' }
          );

          if (upsertError) {
            console.error(`Failed to upsert embedding for trip ${trip.title}:`, upsertError);
            errors++;
          } else {
            processed++;
          }
        } catch (upsertErr) {
          console.error(`Exception upserting embedding for trip ${trip.title}:`, upsertErr);
          errors++;
        }
      }
    } catch (batchError) {
      console.error(`Failed to process batch starting at ${i}:`, batchError);
      errors += batch.length;
    }

    // Report progress
    const progress = 15 + Math.round(((i + batch.length) / tripsToEmbed.length) * 80);
    safeReportProgress(
      job,
      progress,
      `Processed ${Math.min(i + batch.length, tripsToEmbed.length)}/${tripsToEmbed.length} trips`
    );
  }

  safeReportProgress(
    job,
    100,
    `Completed: ${processed} embeddings generated, ${skipped} skipped, ${errors} errors`
  );

  return {
    success: errors === 0,
    result: {
      processed,
      skipped,
      errors
    }
  };
}
