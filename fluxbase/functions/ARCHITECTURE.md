# Edge Functions Architecture

## Overview

This document describes the architecture of our Fluxbase Edge Functions. We have significantly reduced our edge function footprint by migrating most functionality to direct Fluxbase SDK client-side queries with Row-Level Security (RLS) policies.

**Current Status:** 8 edge functions (down from 18+ originally). The remaining functions cover health monitoring, GPS ingest (Wayli app + OwnTracks devices), AI/chatbot support, and view-layer helpers that need server-side secrets or network access.

## Architecture Evolution

### Before: Individual Functions (Legacy)

```
/functions/
├── health/
│   └── index.ts
├── trips/
│   └── index.ts
├── jobs/
│   └── index.ts
└── ... (individual functions)

Note: Auth functions (auth-*, including auth-2fa-*, auth-password, auth-profile,
auth-preferences) have been eliminated - authentication is now handled directly
by the Fluxbase SDK client-side.
```

**Problems with the old approach:**

- ❌ 30+ separate functions to deploy and manage
- ❌ Manual CORS handling in every function
- ❌ Duplicate error handling code
- ❌ Difficult to maintain and debug
- ❌ No centralized logging or monitoring
- ❌ Complex deployment process

### After: Client-Side SDK + Focused Edge Functions (Current)

```
/functions/
├── health.ts              # System health checks (unauthenticated)
├── wayli-points.ts        # GPS ingest from the Wayli Android app (device token)
├── owntracks-points.ts    # GPS ingest from OwnTracks devices (device token / legacy api_key)
├── discover-places.ts     # Pelias place search for the AI supervisor (authenticated)
├── export-kb-tables.ts    # KB export (legacy — boot-time trigger removed, retained but unused)
├── link-preview.ts        # Open Graph metadata fetching (authenticated)
├── snap-track.ts          # Valhalla road-matching for the map view (authenticated)
└── trips-suggest-image.ts # Trip image suggestion via Pexels (authenticated)

All other functionality moved to client-side using Fluxbase SDK:
- Authentication (signup, signin, 2FA, password management)
- Profile & Preferences management
- Trips CRUD operations
- Jobs management
- Trip exclusions
- And more...
```

**Benefits of focused edge functions + client-side SDK:**

- ✅ Major reduction in edge functions (8 instead of 18+)
- ✅ No cold starts for most operations
- ✅ Better performance (direct database queries)
- ✅ Simpler architecture (SDK handles auth, CRUD, RLS)
- ✅ Reduced deployment and maintenance overhead
- ✅ No 1000-record limit (Fluxbase advantage over Supabase)
- ✅ Client-side queries protected by Row-Level Security (RLS)
- ✅ Platform-level CORS handling (no function code required)
- ✅ Only server-side logic that truly needs it remains as edge functions

## Current Architecture

### 1. Client-Side Operations (via Fluxbase SDK)

Most operations are now handled client-side with direct SDK calls:

**Authentication:**

```typescript
// Sign in/out
await fluxbase.auth.signInWithPassword({ email, password });
await fluxbase.auth.signOut();

// 2FA
await fluxbase.auth.setup2FA();
await fluxbase.auth.enable2FA(code);
await fluxbase.auth.verify2FA({ user_id, code });
await fluxbase.auth.disable2FA(password);
await fluxbase.auth.get2FAStatus();

// Password management
await fluxbase.auth.updateUser({ password });
```

**Database Operations (with RLS):**

```typescript
// Profiles
await fluxbase.from('user_profiles').select('*').eq('id', userId).single();
await fluxbase.from('user_profiles').update(data).eq('id', userId);

// Preferences
await fluxbase.from('user_preferences').select('*').eq('id', userId).single();
await fluxbase.from('user_preferences').upsert({ id: userId, ...prefs });

// Trips
await fluxbase.from('trips').select('*').eq('user_id', userId);
await fluxbase.from('trips').insert(tripData);
await fluxbase.from('trips').update(tripData).eq('id', tripId);

// Jobs
await fluxbase.from('jobs').select('*').eq('user_id', userId);
await fluxbase.from('jobs').insert(jobData);
```

### 2. Remaining Edge Functions (8 total)

Only operations requiring server-side logic remain as edge functions:

**health** - System health checks

- `@fluxbase:allow-unauthenticated` — no JWT required
- Used for monitoring and uptime checks
- Reports database connectivity and related checks

**wayli-points** - GPS ingest from the Wayli Android app

- `@fluxbase:allow-unauthenticated` at the platform level; every request must authenticate with a device token
- Device token: `X-Device-Token: wayli_dt_…` (plaintext token registered via the `create-device-token` RPC; only its SHA-256 hash is stored)
- Payload is the OwnTracks location wire format; validation, geocoding, and storage are shared with owntracks-points via `_shared/points-core`
- Validates points per-item (`_shared/point-validation.ts`), caps batches at 1000 points (HTTP 413 above that), and returns `{ accepted, rejected, errors[, address] }`

**owntracks-points** - GPS ingest from external OwnTracks devices

- Same shared ingest core and response shape as wayli-points
- Auth: device token via `X-Device-Token` (or `Authorization: Bearer wayli_dt_…`), or the legacy `?api_key=…&user_id=…` query path kept for existing OwnTracks apps
- Non-location OwnTracks messages (beat, lwt, waypoints, transition, cmd) are acknowledged with 200 without storage

**discover-places** - Pelias place search for the AI supervisor

- Wraps the Pelias search/nearby endpoints (the supervisor's SQL agent can't make HTTP calls)
- Requires the `authenticated` role

**export-kb-tables** - Knowledge base export (legacy)

- Boot-time trigger in `startup.sh` was removed; no caller remains in the codebase
- Retained for manual/on-demand use; boot-time table exports were dropped because instance-global KB documents leaked data across users

**link-preview** - Open Graph / Twitter Card metadata

- Fetches and returns `{ title, description, image, site_name, url }`
- Requires the `authenticated` role; has its own 10s timeout

**snap-track** - Road snapping via Valhalla

- Road-matches the GPS points currently in view (per transport mode) for the Location Data page; nothing is persisted
- Requires the `authenticated` role; gated per-user by the road-snapping beta opt-in

**trips-suggest-image** - Trip image suggestion

- Uses server-side Pexels API key (must remain secret)
- Requires the `authenticated` role; 30s timeout

### 3. Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Client-Side (most operations)                              │
│                                                              │
│  Client → Fluxbase SDK → Database (with RLS) → Response     │
│                                                              │
│  - All CRUD operations                                      │
│  - Authentication flows                                     │
│  - Profile/preferences management                           │
│  - Trips, jobs, tracker data queries                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Edge Functions (operations needing server-side secrets,    │
│  network access, or non-JWT auth)                           │
│                                                              │
│  Client/Device → Edge Function → External API / Service     │
│                 → Service Role → DB                          │
│                                                              │
│  - GPS ingest (wayli-points, owntracks-points)              │
│  - Image suggestions (Pexels), road snapping (Valhalla)     │
│  - Place discovery (Pelias), link previews                  │
│  - System health checks                                     │
└─────────────────────────────────────────────────────────────┘
```

## Edge Function Endpoints

### health

```
/functions/health
Returns: System status, database connectivity
Authentication: None (@fluxbase:allow-unauthenticated)
```

### wayli-points

```
POST /functions/wayli-points
Headers: X-Device-Token: wayli_dt_…
Body: OwnTracks-format location data (single point or array, max 1000)
Returns: { accepted, rejected, errors[, address] }
Authentication: Device token (SHA-256 hash lookup)
```

### owntracks-points

```
POST /functions/owntracks-points
Headers: X-Device-Token: wayli_dt_…  (or Authorization: Bearer wayli_dt_…)
Query (legacy): ?api_key={owntracks_api_key}&user_id={user_id}
Body: OwnTracks location data (single point or array, max 1000)
Returns: { accepted, rejected, errors[, address] }
Authentication: Device token or legacy API key
```

### discover-places

```
POST /functions/discover-places
Body: search or lat/lon/radius parameters
Returns: Pelias features as JSON
Authentication: Required (authenticated role)
```

### link-preview

```
POST /functions/link-preview
Body: { url }
Returns: { title, description, image, site_name, url }
Authentication: Required (authenticated role)
```

### snap-track

```
POST /functions/snap-track
Body: Points in view with transport modes
Returns: Road-matched segments per transport mode
Authentication: Required (authenticated role + road-snapping opt-in)
```

### trips-suggest-image

```
POST /functions/trips-suggest-image
Body: { trip_id } or { start_date, end_date }
Returns: Suggested image URL + attribution from Pexels
Authentication: Required (authenticated role)
```

## Migration History

### Phase 1: Supabase to Fluxbase ✅

- [x] Migrated from Supabase to Fluxbase SDK
- [x] Removed 1000-record limit constraint
- [x] Updated all database clients

### Phase 2: Auth Edge Function Elimination ✅

- [x] Eliminated all 9 auth-* edge functions
- [x] Replaced with Fluxbase SDK auth methods
- [x] Updated client-side auth flows
- [x] Migrated custom 2FA to SDK MFA

### Phase 3: CRUD Edge Function Elimination ✅

- [x] Eliminated trips, jobs, trip-exclusions, import edge functions
- [x] Eliminated check-user-role, admin-workers edge functions
- [x] Moved to client-side queries with RLS
- [x] Simplified ServiceAdapter

### Phase 4: Integration Edge Function Elimination ✅

- [x] Eliminated geocode-search (now direct Pelias calls)
- [x] Eliminated tracker-data-smart (no longer needed without 1000 limit)
- [x] Eliminated export-download, connections-api-key
- [x] Kept only server-critical functions

### Remaining: RLS Policy Setup 🚧

- [ ] Verify all RLS policies are in place
- [ ] Test client-side query security
- [ ] Document policy requirements

## Implementation Details

### Handler Pattern

Each function exports a default `handler` whose dependencies are injected by the
Fluxbase platform (same shape as background jobs):

```typescript
import type { FluxbaseClient } from '../jobs/types';

async function handler(
  req: FluxbaseRequest, // { method, url, headers, body, params }
  fluxbase: FluxbaseClient, // caller-scoped client (RLS applies)
  fluxbaseService: FluxbaseClient // service-role client for privileged work
): Promise<Response> {
  // ...
}

export default handler;
```

Behavior/feature flags are declared as header annotations at the top of the file
(e.g. `@fluxbase:allow-unauthenticated`, `@fluxbase:require-role authenticated`,
`@fluxbase:allow-net`, `@fluxbase:allow-env`, `@fluxbase:timeout`).

### Error Handling

All errors are handled consistently:

- 400: Bad Request (missing/invalid parameters)
- 404: Not Found (invalid endpoint)
- 500: Internal Server Error (unexpected errors)

### CORS

**Implementation:** Platform-level (handled by Fluxbase)

CORS is **handled automatically at the Fluxbase platform level**. Edge functions don't need to include any CORS code - the platform automatically:

- Handles OPTIONS preflight requests
- Adds appropriate CORS headers to all responses
- Reads configuration from environment variables

**Configuration:** Environment variables control CORS behavior for all functions:

- `FLUXBASE_CORS_ALLOW_ORIGIN` - Allowed origins (e.g., `https://wayli.app,https://www.wayli.app`)
- `FLUXBASE_CORS_ALLOW_HEADERS` - Allowed headers
- `FLUXBASE_CORS_ALLOW_METHODS` - Allowed HTTP methods
- `FLUXBASE_CORS_MAX_AGE` - Preflight cache duration

**Edge function code:** No CORS handling needed

```typescript
async function handler(req) {
  // Platform handles CORS automatically
  // Just return your response
  return new Response(JSON.stringify({ data: 'example' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Security Note:** Always configure specific domains for production deployments instead of using wildcard (`*`).

## Future Enhancements

### 1. Middleware System

```typescript
// Authentication middleware
const authMiddleware = async (req: Request, next: NextFunction) => {
  // Check authentication
  // Call next() if authenticated
  // Return error if not authenticated
};
```

### 2. Rate Limiting

```typescript
// Rate limiting middleware
const rateLimitMiddleware = async (req: Request, next: NextFunction) => {
  // Check rate limits
  // Call next() if within limits
  // Return 429 if rate limited
};
```

### 3. Request Validation

```typescript
// Validation middleware
const validationMiddleware = async (req: Request, next: NextFunction) => {
  // Validate request body/params
  // Call next() if valid
  // Return 400 if invalid
};
```

### 4. Metrics Collection

```typescript
// Metrics middleware
const metricsMiddleware = async (req: Request, next: NextFunction) => {
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;

  // Log metrics
  logMetrics(req.url, response.status, duration);

  return response;
};
```

## Benefits Summary

1. **Reduction**: 8 edge functions instead of 18+
2. **Performance**: No cold starts for the majority of operations
3. **Simplicity**: Direct SDK usage instead of edge function abstraction
4. **Security**: RLS policies protect all client-side queries; role assignment and first-user bootstrap are decided server-side (schema clamps + `ensure_user_profile` RPC), never by client input
5. **Scalability**: No 1000-record limit (Fluxbase advantage)
6. **Maintainability**: Less code to maintain and deploy, platform-level CORS
7. **Cost**: Fewer function invocations = lower costs
8. **Developer Experience**: Simpler API, fewer moving parts, no CORS boilerplate

## Conclusion

The migration to client-side SDK queries with RLS has dramatically simplified our architecture while improving performance and reducing costs. By keeping only the 8 edge functions that truly require server-side logic, we've achieved:

- **Large reduction in edge functions** (8 vs 18+)
- **Zero cold starts** for most operations
- **Better performance** through direct database access
- **Simpler codebase** with no CORS boilerplate (platform-level handling)
- **Improved security** through Fluxbase's RLS policies
- **Lower costs** with fewer function invocations

This architecture leverages Fluxbase's strengths (no record limits, built-in RLS, comprehensive SDK, platform-level CORS) while only using edge functions where they provide genuine value (external integrations, API key protection, health monitoring).
