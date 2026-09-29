/**
 * Immich photo search — live query proxy (#13).
 *
 * The picker uses this to query the user's Immich library directly for a
 * date range, without needing the local immich_assets sync to have run.
 * The API key stays server-side (same pattern as immich-thumb).
 *
 * GET ?date=YYYY-MM-DD&rangeDays=7   → { ok, assets: [...] }
 * or POST { takenAfter, takenBefore } for exact ranges.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:timeout 30
 */

import type { FluxbaseClient } from '../jobs/types';
import { fetchGeotaggedAssets, resolveImmichBase } from './_shared/immich.service.ts';
import { getAdminSetting } from './_shared/immich.ts';

const IMMICH_API_KEY = 'immich_api_key';

export async function handler(
  req: Request,
  fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient
): Promise<Response> {
  let userId: string | undefined;
  try {
    const { data } = await fluxbase.auth.getUser();
    userId = data?.user?.id;
  } catch {
    userId = undefined;
  }
  if (!userId) {
    return Response.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  const adminSetting = await getAdminSetting<boolean>(fluxbaseService, 'wayli.immich_enabled');
  if (adminSetting.error || adminSetting.value !== true) {
    return Response.json(
      {
        ok: false,
        errorKind: 'disabled',
        error: 'The Immich integration is disabled on this server.'
      },
      { status: 403 }
    );
  }

  // Resolve the date range: either explicit ISO bounds (POST body) or
  // date ± rangeDays (GET query params). The function receives a standard
  // Web Request — use req.json() / URLSearchParams, NOT JSON.parse(req.body)
  // (req.body is a ReadableStream on the native Request, so string parsing
  // silently fails and the date params are never extracted → the 400 the
  // production logs showed).
  let takenAfter: string | undefined;
  let takenBefore: string | undefined;
  if (req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => null)) as {
        takenAfter?: string;
        takenBefore?: string;
      } | null;
      if (body && typeof body.takenAfter === 'string' && typeof body.takenBefore === 'string') {
        takenAfter = body.takenAfter;
        takenBefore = body.takenBefore;
      }
    } catch {
      /* fall through to query params */
    }
  }
  if (!takenAfter || !takenBefore) {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') ?? '';
    const rangeDays = Math.min(Math.max(Number(url.searchParams.get('rangeDays') ?? 7), 0), 365);
    const base = new Date(`${(date ?? '').slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) {
      return Response.json(
        { ok: false, error: 'Invalid or missing date parameter' },
        { status: 400 }
      );
    }
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() - rangeDays);
    const end = new Date(base);
    end.setUTCDate(end.getUTCDate() + rangeDays + 1);
    takenAfter = start.toISOString();
    takenBefore = end.toISOString();
  }

  // Read the user's prefs for the server URL (enabled check included).
  const { data: prefRow } = await fluxbaseService
    .from('user_preferences')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle();
  const immichPrefs = ((prefRow?.preferences as any)?.immich ?? {}) as Record<string, any>;
  if (immichPrefs.enabled !== true) {
    return Response.json(
      { ok: false, errorKind: 'disabled', error: 'Immich is not enabled for this account.' },
      { status: 403 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await fluxbaseService.admin.settings.app.getUserSecretValue(userId, IMMICH_API_KEY);
  } catch {
    return Response.json(
      { ok: false, errorKind: 'auth', error: 'No Immich API key saved yet.' },
      { status: 400 }
    );
  }
  if (!apiKey) {
    return Response.json(
      { ok: false, errorKind: 'auth', error: 'No Immich API key saved yet.' },
      { status: 400 }
    );
  }

  const endpointSetting = await getAdminSetting<string>(fluxbaseService, 'wayli.immich_endpoint');
  const base = resolveImmichBase(
    typeof immichPrefs.server_url === 'string' ? immichPrefs.server_url : undefined,
    endpointSetting.value
  );
  if (!base) {
    return Response.json({ ok: false, error: 'No Immich server URL configured.' }, { status: 400 });
  }

  const result = await fetchGeotaggedAssets(base, apiKey, { takenAfter });
  if (!result.ok) {
    return Response.json(
      { ok: false, errorKind: result.errorKind, error: result.error },
      { status: 200 }
    );
  }

  // Return the same row shape the picker consumes from immich_assets.
  const assets = result.assets.map((a) => ({
    asset_id: a.id,
    latitude: a.lat,
    longitude: a.lon,
    taken_at: a.takenAt,
    city: a.city ?? null,
    state: a.state ?? null,
    country: a.country ?? null
  }));
  return Response.json({ ok: true, assets });
}
