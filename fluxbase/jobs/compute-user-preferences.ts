/**
 * Compute user preference vectors from visit history
 *
 * Aggregates user visit patterns and generates preference vectors
 * for personalized recommendations. Computes preferences for:
 * - cuisine: Food preferences based on restaurant visits
 * - poi_category: Activity preferences (food, sports, culture, etc.)
 * - time_of_day: Time preferences (morning/afternoon/evening/night person)
 * - overall: General preference embedding combining all factors
 *
 * Uses RLS-protected views (my_*) with user's client for security.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 3 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';

interface ComputePreferencesPayload {
  /** Specific preference types to compute (default: all) */
  preference_types?: Array<'cuisine' | 'poi_category' | 'time_of_day' | 'overall'>;
}

interface VisitAggregate {
  category_or_value: string;
  visit_count: number;
  total_duration: number;
}

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage: { prompt_tokens: number; total_tokens: number };
}

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
 * Compute weighted average of embeddings based on visit counts
 */
function computeWeightedAverage(
  embeddings: number[][],
  weights: number[]
): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0 || embeddings.length === 0) {
    return [];
  }

  const dimensions = embeddings[0].length;
  const result = new Array(dimensions).fill(0);

  for (let i = 0; i < embeddings.length; i++) {
    const weight = weights[i] / totalWeight;
    for (let j = 0; j < dimensions; j++) {
      result[j] += embeddings[i][j] * weight;
    }
  }

  // Normalize the result vector
  const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let j = 0; j < dimensions; j++) {
      result[j] /= magnitude;
    }
  }

  return result;
}

export async function handler(
  _req: Request,
  fluxbase: FluxbaseClient,
  _fluxbaseService: FluxbaseClient,
  job: JobUtils
) {
  const context = job.getJobContext();
  const payload = context.payload as ComputePreferencesPayload;
  const userId = context.user?.id;

  if (!userId) {
    return {
      success: false,
      error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
    };
  }

  const preferenceTypes = payload?.preference_types || [
    'cuisine',
    'poi_category',
    'time_of_day',
    'overall'
  ];

  safeReportProgress(job, 5, 'Fetching visit data for preference computation...');

  const results: Record<string, { success: boolean; sample_count: number }> = {};

  // Fetch user's visit aggregates
  const { data: visits, error: visitError } = await fluxbase
    .from('my_place_visits')
    .select('poi_category, poi_cuisine, poi_amenity, visit_time_of_day, duration_minutes');

  if (visitError) {
    console.error('Failed to fetch visits:', visitError);
    return { success: false, error: `Failed to fetch visits: ${visitError.message}` };
  }

  if (!visits || visits.length === 0) {
    safeReportProgress(job, 100, 'No visits found to compute preferences');
    return { success: true, result: { preferences_computed: 0 } };
  }

  safeReportProgress(job, 15, `Found ${visits.length} visits. Computing preferences...`);

  const progressPerType = 80 / preferenceTypes.length;

  // Compute each preference type
  for (let typeIndex = 0; typeIndex < preferenceTypes.length; typeIndex++) {
    const prefType = preferenceTypes[typeIndex];
    const progressStart = 15 + Math.round(typeIndex * progressPerType);

    const cancelled = await job.isCancelled();
    if (cancelled) {
      return { success: false, error: 'Job cancelled', result: results };
    }

    safeReportProgress(job, progressStart, `Computing ${prefType} preferences...`);

    try {
      let aggregates: Map<string, { count: number; duration: number }>;
      let topItems: Record<string, number>;
      let preferenceText: string;

      switch (prefType) {
        case 'cuisine':
          // Aggregate by cuisine type
          aggregates = new Map();
          for (const visit of visits) {
            if (visit.poi_cuisine) {
              const cuisines = String(visit.poi_cuisine).split(/[,;]/).map(c => c.trim().toLowerCase());
              for (const cuisine of cuisines) {
                if (cuisine) {
                  const existing = aggregates.get(cuisine) || { count: 0, duration: 0 };
                  existing.count++;
                  existing.duration += visit.duration_minutes || 0;
                  aggregates.set(cuisine, existing);
                }
              }
            }
          }
          break;

        case 'poi_category':
          // Aggregate by POI category
          aggregates = new Map();
          for (const visit of visits) {
            if (visit.poi_category) {
              const cat = String(visit.poi_category).toLowerCase();
              const existing = aggregates.get(cat) || { count: 0, duration: 0 };
              existing.count++;
              existing.duration += visit.duration_minutes || 0;
              aggregates.set(cat, existing);
            }
          }
          break;

        case 'time_of_day':
          // Aggregate by time of day
          aggregates = new Map();
          for (const visit of visits) {
            if (visit.visit_time_of_day) {
              const tod = String(visit.visit_time_of_day).toLowerCase();
              const existing = aggregates.get(tod) || { count: 0, duration: 0 };
              existing.count++;
              existing.duration += visit.duration_minutes || 0;
              aggregates.set(tod, existing);
            }
          }
          break;

        case 'overall':
          // Combined all factors
          aggregates = new Map();
          for (const visit of visits) {
            // Combine category and cuisine into a single key
            const parts: string[] = [];
            if (visit.poi_category) parts.push(String(visit.poi_category).toLowerCase());
            if (visit.poi_cuisine) parts.push(String(visit.poi_cuisine).split(/[,;]/)[0].trim().toLowerCase());
            if (visit.visit_time_of_day) parts.push(String(visit.visit_time_of_day).toLowerCase());

            const key = parts.join(' ') || 'general';
            const existing = aggregates.get(key) || { count: 0, duration: 0 };
            existing.count++;
            existing.duration += visit.duration_minutes || 0;
            aggregates.set(key, existing);
          }
          break;

        default:
          continue;
      }

      if (aggregates.size === 0) {
        results[prefType] = { success: false, sample_count: 0 };
        continue;
      }

      // Get top items sorted by count
      const sortedItems = Array.from(aggregates.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);

      topItems = {};
      for (const [key, value] of sortedItems) {
        topItems[key] = value.count;
      }

      // Build rich semantic preference text for embedding
      const topItems5 = sortedItems.slice(0, 5);
      const topItem = topItems5[0];

      // Create natural language description based on preference type
      switch (prefType) {
        case 'cuisine':
          preferenceText = `This user enjoys ${topItems5.map(([k]) => k).join(', ')} cuisine. `;
          if (topItem && topItem[1].count >= 10) {
            preferenceText += `They have a strong preference for ${topItem[0]} food. `;
          }
          preferenceText += `Based on dining experiences at ${visits.length} food venues.`;
          break;

        case 'poi_category':
          const categoryDescriptions: Record<string, string> = {
            food: 'dining and restaurants',
            sports: 'sports and fitness activities',
            culture: 'cultural venues like museums and galleries',
            education: 'educational institutions',
            entertainment: 'entertainment venues',
            shopping: 'shopping',
            outdoors: 'outdoor activities and parks'
          };
          const topCategories = topItems5.map(([k]) => categoryDescriptions[k] || k);
          preferenceText = `This user frequently visits places for ${topCategories.join(', ')}. `;
          if (topItem) {
            preferenceText += `Their primary interest is ${categoryDescriptions[topItem[0]] || topItem[0]}. `;
          }
          preferenceText += `Based on ${visits.length} place visits.`;
          break;

        case 'time_of_day':
          const timeDescriptions: Record<string, string> = {
            morning: 'a morning person who visits places early in the day',
            afternoon: 'active during afternoon hours',
            evening: 'an evening person who prefers going out later',
            night: 'a night owl who enjoys late-night venues'
          };
          preferenceText = `This user is ${timeDescriptions[topItem?.[0] || 'afternoon'] || 'active throughout the day'}. `;
          preferenceText += `Typical visit times: ${topItems5.map(([k]) => k).join(', ')}. `;
          preferenceText += `Based on ${visits.length} place visits.`;
          break;

        case 'overall':
        default:
          preferenceText = `User's overall travel preferences based on ${visits.length} place visits. `;
          preferenceText += `Most enjoyed: ${topItems5.map(([k]) => k).join(', ')}. `;
          if (topItem && topItem[1].count >= 10) {
            preferenceText += `Strong preference for ${topItem[0]}. `;
          }
          break;
      }

      // Generate embedding for preference using Fluxbase SDK
      const { data: embedResult, error: embedError } = await fluxbase.vector.embed({
        texts: [preferenceText],
        model: 'text-embedding-3-small'
      });

      if (embedError || !embedResult) {
        throw new Error(`Embedding API error: ${embedError?.message || 'No result returned'}`);
      }

      const embedding = embedResult.embeddings[0];

      if (!embedding || embedding.length === 0) {
        throw new Error('No embedding returned from API');
      }

      // Calculate confidence score based on sample size
      const sampleCount = aggregates.size;
      const confidenceScore = Math.min(1.0, Math.sqrt(sampleCount / 100));

      const { error: upsertError } = await fluxbase.from('user_preference_vectors').upsert(
        {
          user_id: userId,
          preference_type: prefType,
          preference_embedding: `[${embedding.join(',')}]`,
          top_items: topItems,
          confidence_score: Math.round(confidenceScore * 1000) / 1000,
          sample_count: visits.length,
          computed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id,preference_type' }
      );

      if (upsertError) {
        console.error(`Failed to upsert ${prefType} preference:`, upsertError);
        results[prefType] = { success: false, sample_count: visits.length };
      } else {
        results[prefType] = { success: true, sample_count: visits.length };
      }
    } catch (error) {
      console.error(`Error computing ${prefType} preference:`, error);
      results[prefType] = { success: false, sample_count: 0 };
    }

    // Report progress after completing each preference type
    const progressEnd = 15 + Math.round((typeIndex + 1) * progressPerType);
    safeReportProgress(job, progressEnd, `Completed ${prefType} preferences`);
  }

  const successCount = Object.values(results).filter(r => r.success).length;
  safeReportProgress(
    job,
    100,
    `Completed: ${successCount}/${preferenceTypes.length} preference types computed`
  );

  return {
    success: successCount > 0,
    result: {
      preferences_computed: successCount,
      details: results
    }
  };
}
