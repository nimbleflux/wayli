/**
 * Self-service account deletion — phase 1 of 2 (tenant-side preparation).
 *
 * Deletion order matters:
 *   1. Storage objects are removed HERE, while trip_media rows still exist
 *      to enumerate them. The platform's account-deletion endpoint removes
 *      storage.objects metadata rows but NOT the provider-side bytes on
 *      disk/S3 — orphaned bytes for a location-history app's photos would
 *      defeat the point of deletion.
 *   2. Residual rows the auth.users cascade does NOT reach are removed HERE
 *      (content the user contributed to OTHER users' content — comments,
 *      likes — plus connections in both directions, shares received,
 *      notifications, visited_countries). The service client is required:
 *      RLS would not let the leaving user act on another user's trip.
 *
 * Phase 2 happens in the BROWSER after this function returns `ready`: the
 * web app calls `auth.deleteAccount({ password })` (SDK ≥ 2026.9.4 →
 * DELETE /api/v1/auth/account), which deletes the user's KB documents
 * (metadata.user_id), revokes sessions/tokens, and hard-deletes the auth
 * user — the tenant FK cascades (REFERENCES auth.users ON DELETE CASCADE,
 * schema ~5090-5195) then remove tracker_data, trips and all trip children,
 * place_visits, fitness_*, daily activity, profiles, preferences, tokens.
 *
 * This function is idempotent: re-running after a failed phase 2 finds no
 * storage/residual rows and simply reports ready again.
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
    return json({ error: 'No tenant context — cannot prepare account deletion' }, 503);
  }

  const cleaned: Record<string, unknown> = { userId };
  const errors: string[] = [];

  // 1. Storage objects (media rows are the source of truth for paths).
  try {
    const { data: media, error: mediaErr } = await fluxbaseService
      .from('trip_media')
      .select('storage_path, thumbnail_path')
      .eq('user_id', userId);
    if (mediaErr) throw new Error(`trip_media: ${mediaErr.message}`);
    const paths = [
      ...new Set(
        (media ?? []).flatMap((m: any) => [m.storage_path, m.thumbnail_path]).filter(Boolean)
      ),
    ] as string[];
    cleaned.storageObjects = paths.length;
    if (paths.length > 0) {
      const { error } = await fluxbaseService.storage.from(MEDIA_BUCKET).remove(paths);
      if (error) errors.push(`storage.remove: ${error.message}`);
    }
  } catch (e) {
    errors.push(`storage: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Residual rows outside the auth.users cascade.
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
  cleaned.residualTables = residual.length;

  if (errors.length > 0) {
    console.error(`❌ [DELETE_ACCOUNT] preparation errors for ${userId}:`, errors);
  } else {
    console.log(`✅ [DELETE_ACCOUNT] tenant-side preparation complete`, cleaned);
  }

  // The hard delete itself is the browser's next call: auth.deleteAccount()
  // (DELETE /api/v1/auth/account). KB documents are removed by that
  // endpoint (metadata.user_id); tenant FK cascades do the rest.
  return json({ ready: true, cleaned, errors });
}

export default handler;
