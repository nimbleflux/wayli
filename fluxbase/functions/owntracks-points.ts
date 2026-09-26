/**
 * OwnTracks Points Edge Function
 * Receives and processes GPS tracking data from external OwnTracks apps
 * (legacy api_key/user_id query auth) and from Wayli app builds rc.8/rc.9
 * (device token in the X-Device-Token header). Newer app builds post to the
 * dedicated wayli-points function instead.
 *
 * Point validation, geocoding, and storage live in _shared/points-core.
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
 * Device-token authentication (Wayli app builds rc.8+).
 *
 * The Wayli Android app registers a device token via the create-device-token
 * RPC: the plaintext (wayli_dt_ + 32 random bytes hex) stays on the device and
 * only its SHA-256 hash is stored. Submissions carry the plaintext in the
 * X-Device-Token header — never in the URL, where it would leak into logs,
 * and not in Authorization, which the API auth middleware validates as a JWT
 * and rejects before the function runs. Lookup by hash via index is
 * inherently timing-safe (no plaintext comparison happens at all).
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
  const service = requireServiceClient(fluxbaseService, 'OWNTRACKS_POINTS');
  if (!service) return { userId: null, scopeDenied: false };

  const authHeader = req.headers.get('x-device-token') ?? req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(wayli_dt_[0-9a-f]{64})$/i.exec(authHeader.trim()) ??
    /^(wayli_dt_[0-9a-f]{64})$/i.exec(authHeader.trim());
  if (!match) return { userId: null, scopeDenied: false };

  const tokenHash = await sha256Hex(match[1].toLowerCase());
  const { data, error } = await service
    .from('device_tokens')
    .select('id, user_id, expires_at, revoked_at, scopes')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) {
    logError('Device token lookup failed', 'OWNTRACKS_POINTS', { error });
    return { userId: null, scopeDenied: false };
  }
  if (data.revoked_at) {
    logError('Revoked device token used', 'OWNTRACKS_POINTS', { tokenId: data.id });
    return { userId: null, scopeDenied: false };
  }
  if (data.expires_at && new Date(data.expires_at) <= new Date()) {
    logError('Expired device token used', 'OWNTRACKS_POINTS', { tokenId: data.id });
    return { userId: null, scopeDenied: false };
  }

  // Scope enforcement: this endpoint writes GPS points, so the token must
  // carry 'gps:write' (the only scope ever granted today — forward-proofing
  // for future read-only or admin-scoped tokens). Must match the check in
  // wayli-points.ts.
  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  if (!scopes.includes('gps:write')) {
    logError('Device token lacks gps:write scope', 'OWNTRACKS_POINTS', {
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

  logInfo('Device token authentication successful', 'OWNTRACKS_POINTS', {
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
    // Two authentication paths:
    //   1. X-Device-Token: wayli_dt_… (device token — Wayli app builds
    //      rc.8/rc.9; the token never appears in the URL).
    //   2. ?api_key=…&user_id=… (legacy — kept so existing OwnTracks apps and
    //      previously configured devices keep working).
    let userId: string | null = null;
    let authMethod: 'device_token' | 'api_key' = 'api_key';

    const deviceAuth = await authenticateDeviceToken(req, fluxbaseService);
    if (deviceAuth.scopeDenied) {
      return errorResponse(403);
    }
    if (deviceAuth.userId) {
      userId = deviceAuth.userId;
      authMethod = 'device_token';
    } else {
      // Legacy api_key auth also needs the service client (secret decryption
      // via the admin API) — guard the tenant-less null case.
      if (!fluxbaseService) {
        logError('Service client unavailable (no tenant context)', 'OWNTRACKS_POINTS');
        return errorResponse(503);
      }
      // Parse query parameters from the URL since req.params may not include them
      const url = new URL(req.url);
      const apiKey = url.searchParams.get('api_key');
      userId = url.searchParams.get('user_id');

      if (!userId || !apiKey) {
        logError('Missing Bearer device token or api_key/user_id query parameters', 'OWNTRACKS_POINTS');
        return errorResponse(400);
      }

      // Validate UUID format for user ID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        logError('Invalid user ID format', 'OWNTRACKS_POINTS');
        return errorResponse(400);
      }

      // Verify API key by retrieving and decrypting the user's stored secret
      // This uses the service role client to access the admin API
      let storedApiKey: string | null = null;
      try {
        storedApiKey = await fluxbaseService.admin.settings.app.getUserSecretValue(
          userId,
          'owntracks_api_key'
        );
      } catch (error) {
        // Secret not found or decryption failed
        logError('Failed to retrieve API key', 'OWNTRACKS_POINTS', { userId, error });
      }

      if (!storedApiKey || storedApiKey !== apiKey) {
        logError('Invalid API key', 'OWNTRACKS_POINTS', { userId });
        return errorResponse(401);
      }

      logInfo('API key authentication successful', 'OWNTRACKS_POINTS', { userId });
    }

    // Only allow POST requests (OwnTracks sends location data in POST body)
    if (req.method !== 'POST') {
      return errorResponse(405);
    }

    // Parse request body for location data using standard Web API
    const body = await req.json();
    const result = await ingestPoints(fluxbaseService, userId, authMethod, body, 'OWNTRACKS_POINTS');

    // OwnTracks Android parses the response body as an OwnTracks message
    // (kotlinx polymorphic on _type). The ingest summary object
    // {"accepted":..} has no _type, so the app's parser throws
    // "Failed to parse JSON" and the publish is treated as FAILED and
    // re-queued forever — even though the points were stored. Respond with
    // the ot-recorder-style empty message array on success instead; the
    // ingest summary stays visible in the function logs.
    if (result.status === 200) {
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return result;
  } catch (error) {
    logError(error, 'OWNTRACKS_POINTS');
    return errorResponse(500);
  }
}

export default handler;
