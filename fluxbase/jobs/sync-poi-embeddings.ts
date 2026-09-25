/**
 * Sync POI behavioral embeddings into the "wayli-pois" knowledge base.
 *
 * Aggregates a user's place_visits per POI (name + city) into behavioral docs
 * (visit counts, time-of-day/weekday patterns, avg duration) and adds them to
 * the KB so the assistant can answer "where do I usually get morning coffee?"
 * or rank recommendations by the user's taste. This is the missing piece that
 * makes the chatbot's RAG/vector_search actually return useful results.
 *
 * Triggered after place-visit detection completes (per-user context). The
 * scheduled variant (scheduled-sync-poi-embeddings.ts) iterates all users.
 *
 * PREREQUISITE: an embedding provider must be configured in Fluxbase admin
 * (ai.providers with use_for_embeddings = true). If none is configured, the KB
 * addDocument calls will fail and this job exits with a clear message — it does
 * NOT silently corrupt state. Run `bun run sync:kb` to ensure the KB exists.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:allow-read true
 */

import type { FluxbaseClient, JobUtils } from './types';

const NAMESPACE = 'wayli';
const KB_NAME = 'wayli-pois';
const KB_TAG = 'poi_behavioral';

/**
 * Build a behavioral source-text doc for a POI, in the format the schema
 * documents (public.sql:226): "POI Name. Type: X. Category: Y. Cuisine: Z.
 * City: C, Country: CC" — extended with visit-count, time-of-day, and
 * weekday/weekend patterns so RAG captures behavioral context, not just facts.
 */
function buildPoiDoc(row: PoiAggregate): string {
  const parts: string[] = [row.poi_name];
  if (row.poi_amenity) parts.push(`Type: ${row.poi_amenity}`);
  if (row.poi_category) parts.push(`Category: ${row.poi_category}`);
  if (row.poi_cuisine) parts.push(`Cuisine: ${row.poi_cuisine}`);
  const loc = [row.city, row.country_code].filter(Boolean).join(', ');
  if (loc) parts.push(`Location: ${loc}`);
  parts.push(`Visits: ${row.visit_count}`);
  if (row.avg_duration_minutes) {
    parts.push(`Avg duration: ${Math.round(row.avg_duration_minutes)} min`);
  }
  if (row.morning_pct != null) {
    parts.push(`Mornings ${row.morning_pct}% / Weekends ${row.weekend_pct ?? 0}%`);
  }
  return parts.join('. ');
}

interface PoiAggregate {
  poi_name: string;
  poi_amenity: string | null;
  poi_category: string | null;
  poi_cuisine: string | null;
  city: string | null;
  country_code: string | null;
  visit_count: number;
  avg_duration_minutes: number | null;
  // Share of visits before noon (0-100), proxy for "morning coffee" habits.
  morning_pct: number | null;
  // Share of visits on weekends (0-100).
  weekend_pct: number | null;
}

/**
 * Upsert the user's POI behavioral docs into the KB. Idempotent: it first
 * deletes the user's existing behavioral docs (tagged by user_id) then re-adds
 * the current set, so re-running after new visits refreshes the index.
 */
export default async function syncPoiEmbeddings(
  fluxbase: FluxbaseClient,
  utils: JobUtils
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = utils.getJobContext();
  const userId = ctx.user?.id;
  if (!userId) {
    return { success: false, error: 'No user context — cannot scope POI embeddings.' };
  }

  // 1. Resolve the wayli-pois KB id.
  const kbRes = await fluxbase.admin.ai.listKnowledgeBases(NAMESPACE);
  const kb = kbRes.data?.find((k) => k.name === KB_NAME);
  if (!kb) {
    return {
      success: false,
      error: `Knowledge base "${KB_NAME}" not found. Run \`bun run sync:kb\` first.`
    };
  }

  // 1b. Ensure the chatbot→KB link uses `filtered` access (per-user scoping).
  // Fluxbase ≥ 2026.9.3 defaults NEW links to filtered, but links created
  // before an instance upgrades keep `full` — where any document without a
  // user_id would be retrievable by every user. Idempotent and best-effort:
  // a failure here only means retrieval keeps the old scoping.
  try {
    const bots = await fluxbase.admin.ai.listChatbots(NAMESPACE);
    const bot = (bots.data ?? []).find((b) => b.name === 'wayli-assistant');
    if (!bot) {
      console.warn('sync-poi-embeddings: wayli-assistant chatbot not found — skipping link scoping');
    } else {
      const links = await fluxbase.admin.ai.listChatbotKnowledgeBases(bot.id);
      const existing = (links.data ?? []).find((l) => l.knowledge_base_id === kb.id);
      if (existing && existing.access_level === 'filtered') {
        console.log('sync-poi-embeddings: chatbot KB link already filtered');
      } else {
        // The PUT route cannot change access_level, so migrate via
        // unlink + link-with-filtered (both are atomic single-link ops).
        if (existing) {
          const { error: unlinkErr } = await fluxbase.admin.ai.unlinkKnowledgeBase(bot.id, kb.id);
          if (unlinkErr) throw new Error(`unlink: ${unlinkErr.message}`);
        }
        const { error: linkErr } = await fluxbase.admin.ai.linkKnowledgeBase(bot.id, {
          knowledge_base_id: kb.id,
          access_level: 'filtered'
        });
        if (linkErr) throw new Error(linkErr.message);
        console.log('sync-poi-embeddings: chatbot KB link set to filtered access');
      }
    }
  } catch (linkErr) {
    console.warn(
      `sync-poi-embeddings: could not scope the chatbot KB link (${
        linkErr instanceof Error ? linkErr.message : String(linkErr)
      }) — retrieval keeps the previous access level`
    );
  }

  // 2. Aggregate the user's POI visits into behavioral summaries.
  const { data: pois, error: aggError } = await fluxbase.rpc<PoiAggregate[]>(
    'aggregate_poi_behavior',
    { p_user_id: userId }
  );
  if (aggError) {
    // Fall back to a direct query if the aggregate RPC isn't deployed.
    const { data: fallback, error: qErr } = await fluxbase
      .from('place_visits')
      .select(
        'poi_name, poi_amenity, poi_category, poi_cuisine, city, country_code, duration_minutes, visit_hour, is_weekend'
      )
      .eq('user_id', userId);
    if (qErr) {
      return { success: false, error: `Failed to read place_visits: ${qErr.message}` };
    }
    const aggregated = aggregateLocally(fallback ?? []);
    if (aggregated.length === 0) {
      return { success: true, result: { message: 'No POI visits to embed.', embedded: 0 } };
    }
    return await upsertDocs(fluxbase, utils, kb.id, userId, aggregated);
  }
  if (!pois || pois.length === 0) {
    return { success: true, result: { message: 'No POI visits to embed.', embedded: 0 } };
  }
  return await upsertDocs(fluxbase, utils, kb.id, userId, pois);
}

/** In-process aggregation fallback when the aggregate RPC is unavailable. */
function aggregateLocally(rows: any[]): PoiAggregate[] {
  const map = new Map<string, any>();
  for (const r of rows) {
    const key = `${r.poi_name}|${r.city ?? ''}`;
    const acc = map.get(key) ?? {
      poi_name: r.poi_name,
      poi_amenity: r.poi_amenity,
      poi_category: r.poi_category,
      poi_cuisine: r.poi_cuisine,
      city: r.city,
      country_code: r.country_code,
      visit_count: 0,
      total_duration: 0,
      duration_samples: 0,
      morning_count: 0,
      weekend_count: 0
    };
    acc.visit_count++;
    if (r.duration_minutes != null) {
      acc.total_duration += r.duration_minutes;
      acc.duration_samples++;
    }
    if (r.visit_hour != null && r.visit_hour < 12) acc.morning_count++;
    if (r.is_weekend) acc.weekend_count++;
    map.set(key, acc);
  }
  return Array.from(map.values()).map((a) => ({
    poi_name: a.poi_name,
    poi_amenity: a.poi_amenity,
    poi_category: a.poi_category,
    poi_cuisine: a.poi_cuisine,
    city: a.city,
    country_code: a.country_code,
    visit_count: a.visit_count,
    avg_duration_minutes: a.duration_samples ? a.total_duration / a.duration_samples : null,
    morning_pct: a.visit_count ? Math.round((a.morning_count / a.visit_count) * 100) : null,
    weekend_pct: a.visit_count ? Math.round((a.weekend_count / a.visit_count) * 100) : null
  }));
}

/** Delete the user's prior behavioral docs, then add the fresh set. */
async function upsertDocs(
  fluxbase: FluxbaseClient,
  utils: JobUtils,
  kbId: string,
  userId: string,
  pois: PoiAggregate[]
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  // Idempotency: clear this user's existing behavioral docs first.
  await fluxbase.admin.ai.deleteDocumentsByFilter(kbId, {
    tags: [KB_TAG, `user:${userId}`]
  });

  const BATCH = 25;
  let embedded = 0;
  for (let i = 0; i < pois.length; i += BATCH) {
    if (await utils.isCancelled()) {
      return { success: false, error: 'Cancelled by user.' };
    }
    const batch = pois.slice(i, i + BATCH);
    for (const poi of batch) {
      const { error } = await fluxbase.admin.ai.addDocument(kbId, {
        title: poi.poi_name,
        content: buildPoiDoc(poi),
        tags: [KB_TAG, `user:${userId}`],
        metadata: {
          poi_name: poi.poi_name,
          city: poi.city ?? '',
          country_code: poi.country_code ?? '',
          user_id: userId
        }
      });
      if (error) {
        // The most common failure: no embedding provider configured.
        const msg = error.message || String(error);
        if (/embedding|model|provider/i.test(msg)) {
          return {
            success: false,
            error:
              `Embedding provider not configured (KB addDocument failed: ${msg}). ` +
              'Configure an AI provider with use_for_embeddings in Fluxbase admin, then re-run.'
          };
        }
        console.warn(`⚠️ Failed to embed POI "${poi.poi_name}": ${msg}`);
        continue;
      }
      embedded++;
    }
    utils.reportProgress(
      Math.min(100, Math.round(((i + batch.length) / pois.length) * 100)),
      `Embedded ${embedded}/${pois.length} POIs`
    );
  }
  return {
    success: true,
    result: { message: `Synced ${embedded}/${pois.length} POI behavioral docs.`, embedded }
  };
}
