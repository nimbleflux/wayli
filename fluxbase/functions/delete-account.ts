/**
 * Self-service account deletion (Play Data Safety requires a working,
 * user-initiated deletion path).
 *
 * Deletion order matters:
 *   1. Storage objects are removed FIRST, while trip_media rows still exist
 *      to enumerate them (object storage does not cascade).
 *   2. Knowledge-base behavioral docs (tagged user:<id> by the
 *      sync-poi-embeddings job) — the shared KB is not covered by any FK.
 *   3. Residual rows the auth.users cascade does NOT reach: rows the user
 *      contributed to OTHER users' content (comments, likes), connections in
 *      both directions, shares received, notifications, visited_countries.
 *   4. The auth user itself — FK constraints
 *      (REFERENCES auth.users ON DELETE CASCADE, schema lines ~5090-5195)
 *      remove tracker_data, trips + all trip children, place_visits,
 *      fitness_*, daily activity, profiles, preferences, device tokens, …
 *
 * The service client is required for steps 2-4: residual deletes target rows
 * whose RLS would not let the leaving user act (e.g. another user's trip
 * sharing), and deleteUser is an admin API call.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 300
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type { FluxbaseClient } from '../jobs/types';

const MEDIA_BUCKET = 'trip-images';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handler(
  req: Request,
  _fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient | null,
  _utils?: { getExecutionContext?: () => { user?: { id: string } } }
): Promise<Response> {
  const ctx = _utils?.getExecutionContext?.();
  const userId = ctx?.user?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!fluxbaseService) {
    return json({ error: 'No tenant context — cannot delete account' }, 503);
  }

  const deleted: Record<string, unknown> = { userId };
  const errors: string[] = [];

  // 1. Storage objects (media rows are the source of truth for paths; the
  // upcoming cascade would erase our ability to enumerate them).
  try {
    const { data: media, error: mediaErr } = await service_select(fluxbaseService, userId);
    if (mediaErr) throw new Error(`trip_media: ${mediaErr.message}`);
    const paths = [
      ...new Set(
        (media ?? []).flatMap((m: any) => [m.storage_path, m.thumbnail_path]).filter(Boolean)
      ),
    ] as string[];
    deleted.storageObjects = paths.length;
    if (paths.length > 0) {
      const { error } = await fluxbaseService.storage.from(MEDIA_BUCKET).remove(paths);
      if (error) errors.push(`storage.remove: ${error.message}`);
    }
  } catch (e) {
    errors.push(`storage: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. KB behavioral docs (best-effort: the KB may not exist on this instance).
  try {
    const kbRes = await fluxbaseService.admin.ai.listKnowledgeBases('wayli');
    const kb = kbRes.data?.find((k) => k.name === 'wayli-pois');
    if (kb) {
      await fluxbaseService.admin.ai.deleteDocumentsByFilter(kb.id, { tags: [`user:${userId}`] });
      deleted.kbDocs = 'removed';
    }
  } catch (e) {
    errors.push(`kb: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Residual rows outside the cascade: content the user added to OTHER
  // users' trips, and user-keyed rows without an auth.users FK.
  const residual: Array<[table: string, column: string]> = [
    ['visited_countries', 'user_id'],
    ['notifications', 'user_id'],
    ['user_connections', 'user_id'],
    ['user_connections', 'friend_id'],
    ['trip_comments', 'user_id'],
    ['trip_likes', 'user_id'],
    ['trip_shares', 'shared_with_user_id'],
  ];
  for (const [table, column] of residual) {
    const { error } = await (fluxbaseService.from(table) as any)
      .delete()
      .eq(column, userId);
    if (error) errors.push(`${table}.${column}: ${error.message}`);
  }
  deleted.residualTables = residual.length;

  // 4. The auth user — DB FK cascades remove everything else (points, trips
  // and their children, visits, fitness, profile, preferences, tokens, …).
  const { error: deleteErr } = await fluxbaseService.admin.deleteUser(userId, 'app');
  if (deleteErr) {
    console.error(`❌ [DELETE_ACCOUNT] auth user delete failed:`, deleteErr, { userId });
    return json(
      { deleted: false, stage: 'auth-user', errors: [...errors, `deleteUser: ${deleteErr.message}`] },
      500
    );
  }

  console.log(`✅ [DELETE_ACCOUNT] account deleted`, { userId, ...deleted });
  return json({ deleted: true, errors });
}

/** trip_media paths owned by the user (via service client — RLS-free). */
async function service_select(client: FluxbaseClient, userId: string) {
  return client
    .from('trip_media')
    .select('storage_path, thumbnail_path')
    .eq('user_id', userId);
}

export default handler;
