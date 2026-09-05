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
 * Returns the owning user id, or null when the token is unknown, revoked, or
 * expired.
 */
async function authenticateDeviceToken(
  req: Request,
  fluxbaseService: FluxbaseClient | null
): Promise<string | null> {
  const service = requireServiceClient(fluxbaseService, 'WAYLI_POINTS');
  if (!service) return null;

  const authHeader = req.headers.get('x-device-token') ?? '';
  const match = /^(wayli_dt_[0-9a-f]{64})$/i.exec(authHeader.trim());
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1].toLowerCase());
  const { data, error } = await service
    .from('device_tokens')
    .select('id, user_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) {
    logError('Device token lookup failed', 'WAYLI_POINTS', { error });
    return null;
  }
  if (data.revoked_at) {
    logError('Revoked device token used', 'WAYLI_POINTS', { tokenId: data.id });
    return null;
  }
  if (data.expires_at && new Date(data.expires_at) <= new Date()) {
    logError('Expired device token used', 'WAYLI_POINTS', { tokenId: data.id });
    return null;
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
  return data.user_id as string;
}

async function handler(
  req: Request,
  _fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient | null
): Promise<Response> {
  try {
    const userId = await authenticateDeviceToken(req, fluxbaseService);
    if (!userId) {
      logError('Missing or invalid X-Device-Token header', 'WAYLI_POINTS');
      return errorResponse(401);
    }

    // Only allow POST requests (points are submitted in the POST body)
    if (req.method !== 'POST') {
      return errorResponse(405);
    }

    const body = await req.json();
    return ingestPoints(fluxbaseService, userId, 'device_token', body, 'WAYLI_POINTS');
  } catch (error) {
    logError(error, 'WAYLI_POINTS');
    return errorResponse(500);
  }
}

export default handler;
