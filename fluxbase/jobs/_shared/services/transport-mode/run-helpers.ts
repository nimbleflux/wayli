// /Users/bart/Dev/wayli/fluxbase/jobs/_shared/services/transport-mode/run-helpers.ts
//
// Shared decode-and-persist logic for the transport-mode jobs. Both the
// on-demand (detect-transport-mode.ts) and scheduled (all-users) jobs call
// decodeAndPersist so the streaming → HMM → UPDATE logic lives in one place.

import type { FluxbaseClient } from '../../../types.d.ts';
import { detectTransportModes } from './detector.ts';
import { TRANSPORT_MODES, type TransportMode } from './states.ts';
import { LOOKBACK_MS } from './segmentation.ts';
import type { ModeObservation } from './types.ts';

export const BATCH_SIZE = 1000;
export const MAX_FIRST_RUN_HOURS = 24 * 365 * 3;
const UPDATE_BATCH = 500;

/**
 * Bump when detection behavior changes in a way that should re-label history.
 * The stored per-user `detector_version` is compared against this: an older
 * stored version makes the next run re-decode the full MAX_FIRST_RUN_HOURS
 * window (3 years) once, then stamps the new version. Manual overrides
 * (transport_mode_manual = true) are never overwritten.
 */
export const DETECTOR_VERSION = 8;

interface TrackerPointRow {
  recorded_at: string;
  location: string | object;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  geocode: any;
}

/**
 * Decode transport modes for `userId` over the incremental window
 * [since - LOOKBACK, now] and persist results to tracker_data. Returns the
 * number of points decoded.
 *
 * `opts.reprocessAll` forces the full 3-year window regardless of the stored
 * watermark (admin "full re-run" trigger) and also forces a version stamp.
 */
export async function decodeAndPersist(
  db: FluxbaseClient,
  userId: string,
  now: Date,
  _detector = detectTransportModes,
  opts: { reprocessAll?: boolean } = {}
): Promise<number> {
  // Read watermark + detector version.
  const { data: stateRow } = await db
    .from('transport_mode_state')
    .select('last_processed_at, detector_version')
    .eq('user_id', userId)
    .maybeSingle();
  const lastProcessedAt = (stateRow as any)?.last_processed_at ?? null;
  const storedVersion = (stateRow as any)?.detector_version ?? 1;
  const versionStale = storedVersion < DETECTOR_VERSION;
  const reprocessAll = opts.reprocessAll === true || versionStale;
  // Full re-decode when the detector changed or an admin forced it — the
  // old labels were produced by different logic and won't improve on their
  // own (the watermark only ever moves forward).
  const since = reprocessAll
    ? new Date(now.getTime() - MAX_FIRST_RUN_HOURS * 60 * 60 * 1000)
    : lastProcessedAt
      ? new Date(new Date(lastProcessedAt).getTime() - LOOKBACK_MS)
      : new Date(now.getTime() - MAX_FIRST_RUN_HOURS * 60 * 60 * 1000);
  if (versionStale) {
    console.log(
      `[transport-mode] User ${userId}: detector v${DETECTOR_VERSION} > stored v${storedVersion} — re-decoding full window`
    );
  }

  // Stage 2 (Valhalla map-matching): per-user opt-in, default off. Read the
  // user's preference once — when off, Stage-2 is skipped entirely and the
  // behaviour is identical to the pre-Valhalla pipeline.
  let valhallaClient: import('../external/valhalla.service').ValhallaClient | null = null;
  let disabledModes: TransportMode[] = [];
  try {
    const { data: pref } = await db
      .from('user_preferences')
      .select('preferences')
      .eq('id', userId)
      .maybeSingle();
    const useValhalla = (pref as any)?.preferences?.use_valhalla_transport === true;
    // #220: user-disabled modes are a hard exclusion for the detector.
    const disabledList = (pref as any)?.preferences?.transport_detection?.disabled_modes;
    if (Array.isArray(disabledList) && disabledList.length > 0) {
      disabledModes = disabledList.filter((m: unknown): m is TransportMode =>
        typeof m === 'string' && (TRANSPORT_MODES as readonly string[]).includes(m)
      );
      if (disabledModes.length > 0) {
        console.log(`[transport-mode] User ${userId}: disabled modes [${disabledModes.join(', ')}]`);
      }
    }
    if (useValhalla) {
      const { traceAttributes } = await import('../external/valhalla.service');
      valhallaClient = {
        traceAttributes: (points, costing) => traceAttributes(points, costing, db as any)
      };
      console.log(`[valhalla] User ${userId} opted in — Stage-2 map matching enabled`);
    }
  } catch (err) {
    // Preference read failure is non-fatal — Stage-2 stays off.
    console.warn('[valhalla] Could not read user preference, Stage-2 disabled:', err);
  }

  // Stream tracker_data in batches and decode+persist INCREMENTALLY.
  //
  // Why per-batch instead of accumulating all rows? On a first run the window
  // is MAX_FIRST_RUN_HOURS (3 years) — for a user with hundreds of thousands
  // of points, accumulating every row in memory then decoding the whole thing
  // at once exhausts the V8 heap (this is exactly what crashed the job before:
  // "Fatal JavaScript out of memory" at ~256 MB with 315k points). Instead we
  // decode each batch as it arrives, thread the previous batch's tail as
  // Viterbi context (DetectionContext) so journeys spanning a batch boundary
  // stay coherent, and persist immediately. Peak memory is ~2x BATCH_SIZE.
  let updated = 0;
  let lastRecordedAt: string | null = null;
  let prevObs: ModeObservation[] = []; // cross-batch continuity tail
  const TAIL = 6;
  let sawAny = false;

  while (true) {
    let query = db
      .from('tracker_data')
      .select('recorded_at, location, speed, heading, accuracy, geocode')
      .eq('user_id', userId)
      .gte('recorded_at', since.toISOString())
      .order('recorded_at', { ascending: true })
      .limit(BATCH_SIZE);
    if (lastRecordedAt) query = query.gt('recorded_at', lastRecordedAt);
    // A transient fetch failure must not abort the whole user: with a
    // forward-only watermark the pass would silently skip everything
    // between the watermark and the failure point until the next run.
    let batch: TrackerPointRow[] | null = null;
    let fetchError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await query;
      if (!error) {
        batch = data as TrackerPointRow[];
        fetchError = null;
        break;
      }
      fetchError = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    if (fetchError) throw new Error(`Fetch failed: ${(fetchError as any).message}`);
    if (!batch || batch.length === 0) break;
    sawAny = true;
    lastRecordedAt = batch[batch.length - 1].recorded_at;

    // Convert this batch to observations.
    const observations: ModeObservation[] = (batch as TrackerPointRow[]).map((row) => {
      const { lat, lng } = parseLocation(row.location);
      return {
        timestamp: new Date(row.recorded_at).getTime(),
        lat,
        lng,
        speed: row.speed ?? 0,
        heading: row.heading,
        accuracy: row.accuracy,
        geocode: row.geocode ?? null
      };
    });

    // Decode with the previous batch's tail as context, then keep this
    // batch's tail for the next iteration.
    let decisions = _detector(observations, { prevObs, disabledModes });
    prevObs = observations.slice(-TAIL);

    // Stage 2: confirm ambiguous segments via Valhalla map matching (when
    // the user opted in). Failures are swallowed inside — Stage-1 always
    // survives as the fallback.
    if (valhallaClient) {
      try {
        const { confirmWithValhalla } = await import('./valhalla-confirm');
        decisions = await confirmWithValhalla(
          observations,
          decisions,
          valhallaClient,
          new Set(disabledModes)
        );
      } catch (err) {
        console.warn('[valhalla] Stage-2 confirmation failed (keeping Stage-1):', err);
      }
    }

    updated += await persistDecisions(db, userId, decisions);

    if (batch.length < BATCH_SIZE) break;
  }

  if (!sawAny) {
    await advanceWatermark(db, userId, now);
    return 0;
  }

  await advanceWatermark(db, userId, now);
  return updated;
}

/**
 * Persist a slice of decoded decisions to tracker_data, grouped by (mode,
 * reason) to minimise round-trips. Extracted so decodeAndPersist can call it
 * per batch (bounded memory) instead of once over the whole history.
 *
 * Each group's `.in('recorded_at', …)` filter travels in the request URL, so
 * timestamps are further chunked to keep URLs small: a full 3-year re-decode
 * fills UPDATE_BATCH-sized groups and 500 timestamps blow past the server's
 * URL/header limit (431 Request Header Fields Too Large), which silently
 * dropped updates and aborted the whole user with a failed watermark write.
 */
const URL_CHUNK = 80;

async function persistDecisions(
  db: FluxbaseClient,
  userId: string,
  decisions: { mode: string; reason: string; timestamp: number; confidence: number }[]
): Promise<number> {
  if (decisions.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < decisions.length; i += UPDATE_BATCH) {
    const slice = decisions.slice(i, i + UPDATE_BATCH);
    const groups = new Map<
      string,
      { mode: string; reason: string; items: { ts: number; conf: number }[] }
    >();
    for (const d of slice) {
      const key = `${d.mode}|${d.reason}`;
      if (!groups.has(key)) groups.set(key, { mode: d.mode, reason: d.reason, items: [] });
      groups.get(key)!.items.push({ ts: d.timestamp, conf: d.confidence });
    }
    for (const { mode, reason, items } of groups.values()) {
      for (let c = 0; c < items.length; c += URL_CHUNK) {
        const chunk = items.slice(c, c + URL_CHUNK);
        const tsIso = chunk.map((it) => new Date(it.ts).toISOString());
        const meanConf = chunk.reduce((a, b) => a + b.conf, 0) / chunk.length;
        const { error: updErr } = await db
          .from('tracker_data')
          .update({
            transport_mode: mode,
            detection_reason: reason,
            transport_mode_confidence: Number(meanConf.toFixed(3))
          })
          .eq('user_id', userId)
          .in('recorded_at', tsIso)
          // Never overwrite a point the user manually corrected — the
          // override flag is the only thing protecting their edits from
          // being silently erased by a re-decode. (Migration 082.)
          .neq('transport_mode_manual', true);
        if (!updErr) updated += chunk.length;
        else console.error(`⚠️ Update error for mode ${mode}:`, updErr);
      }
    }
  }
  return updated;
}

export async function advanceWatermark(
  db: FluxbaseClient,
  userId: string,
  when: Date,
  detectorVersion: number = DETECTOR_VERSION
): Promise<void> {
  const iso = when.toISOString();
  // The watermark is the resume point — a failed write means the next run
  // re-decodes the whole window again, so retry transient failures.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db
      .from('transport_mode_state')
      .upsert(
        {
          user_id: userId,
          last_processed_at: iso,
          detector_version: detectorVersion,
          updated_at: iso
        },
        { onConflict: 'user_id' }
      );
    if (!error) return;
    console.error(`⚠️ Watermark write failed (attempt ${attempt + 1}):`, error);
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

/** Parse a PostGIS location into lat/lng. Supports WKT "POINT(lng lat)" and GeoJSON. */
export function parseLocation(location: any): { lat: number; lng: number } {
  if (typeof location === 'string') {
    const m = location.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (m) return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }
  if (location && typeof location === 'object' && Array.isArray(location.coordinates)) {
    return { lng: location.coordinates[0], lat: location.coordinates[1] };
  }
  return { lat: 0, lng: 0 };
}
