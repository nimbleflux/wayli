/**
 * Wayli App Points Edge Function
 * Receives GPS points from the Wayli Android app's built-in tracker (and its
 * manual "Submit current location" action). Authentication is exclusively by
 * device token — the X-Device-Token header carrying wayli_dt_…, whose
 * SHA-256 hash is stored server-side. No URL-based credentials of any kind.
 *
 * The payload is the OwnTracks location wire format (the app's tracker
 * deliberately speaks it), so validation, geocoding, and storage are shared
 * with the owntracks-points function via _shared/points-core.
 * @fluxbase:allow-unauthenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

import type { FluxbaseClient } from '../jobs/types';
import {
  ingestPoints,
  sha256Hex,
  logError,
  logInfo,
  errorResponse,
  requireServiceClient,
} from '_shared/points-core';

/**
 * Device-token authentication.
 *
 * The app registers the token via the create-device-token RPC: the plaintext
 * (wayli_dt_ + 32 random bytes hex) stays on the device; only its SHA-256
 * hash is stored. The plaintext rides in the X-Device-Token header — never in
 * the URL (log leak) and not in Authorization (the API auth middleware
 * validates Bearer values as JWTs and would reject the request before this
 * function runs).
 *
 * Tokens are scoped (create-device-token.sql grants 'gps:write'); a token
 * without gps:write is reported via scopeDenied so the caller can answer 403
 * instead of 401.
 *
 * Returns the owning user id (null when the token is unknown, revoked, or
 * expired) plus whether the request was denied for a missing scope.
 */
async function authenticateDeviceToken(
  req: Request,
  fluxbaseService: FluxbaseClient | null
): Promise<{ userId: string | null; scopeDenied: boolean }> {
  const service = requireServiceClient(fluxbaseService, 'WAYLI_POINTS');
  if (!service) return { userId: null, scopeDenied: false };

  const authHeader = req.headers.get('x-device-token') ?? '';
  const match = /^(wayli_dt_[0-9a-f]{64})$/i.exec(authHeader.trim());
  if (!match) return { userId: null, scopeDenied: false };

  const tokenHash = await sha256Hex(match[1].toLowerCase());
  const { data, error } = await service
    .from('device_tokens')
    .select('id, user_id, expires_at, revoked_at, scopes')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) {
    logError('Device token lookup failed', 'WAYLI_POINTS', { error });
    return { userId: null, scopeDenied: false };
  }
  if (data.revoked_at) {
    logError('Revoked device token used', 'WAYLI_POINTS', { tokenId: data.id });
    return { userId: null, scopeDenied: false };
  }
  if (data.expires_at && new Date(data.expires_at) <= new Date()) {
    logError('Expired device token used', 'WAYLI_POINTS', { tokenId: data.id });
    return { userId: null, scopeDenied: false };
  }

  // Scope enforcement: this endpoint writes GPS points, so the token must
  // carry 'gps:write' (the only scope ever granted today — forward-proofing
  // for future read-only or admin-scoped tokens).
  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  if (!scopes.includes('gps:write')) {
    logError('Device token lacks gps:write scope', 'WAYLI_POINTS', {
      tokenId: data.id,
      scopes,
    });
    return { userId: null, scopeDenied: true };
  }

  // Fire-and-forget last_used_at bump — a failure here must not fail ingestion.
  service
    .from('device_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  logInfo('Device token authentication successful', 'WAYLI_POINTS', {
    tokenId: data.id,
    userId: data.user_id,
  });
  return { userId: data.user_id as string, scopeDenied: false };
}

async function handler(
  req: Request,
  _fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient | null
): Promise<Response> {
  try {
    const auth = await authenticateDeviceToken(req, fluxbaseService);
    if (auth.scopeDenied) {
      return errorResponse(403);
    }
    if (!auth.userId) {
      logError('Missing or invalid X-Device-Token header', 'WAYLI_POINTS');
      return errorResponse(401);
    }
    const userId = auth.userId;

    // Only allow POST requests (points are submitted in the POST body)
    if (req.method !== 'POST') {
      return errorResponse(405);
    }

    const body = await req.json();
    // includeAddress: the response carries the newest point's reverse-geocoded
    // address so the app can show it in its tracking notification (OwnTracks
    // parity). The legacy owntracks-points endpoint keeps its `[]` body.
    return ingestPoints(fluxbaseService, userId, 'device_token', body, 'WAYLI_POINTS', {
      includeAddress: true,
    });
  } catch (error) {
    logError(error, 'WAYLI_POINTS');
    return errorResponse(500);
  }
}

export default handler;
