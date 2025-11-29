# Edge Functions Architecture

## Overview

This document describes the architecture of our Fluxbase Edge Functions. We have significantly reduced our edge function footprint by migrating most functionality to direct Fluxbase SDK client-side queries with Row-Level Security (RLS) policies.

**Current Status:** 3 edge functions (down from 18+ originally - 83% reduction)

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

### After: Minimal Edge Functions + Client-Side SDK (Current)

```
/functions/
├── health.ts             # System health checks
├── owntracks-points.ts   # External device integration (API key auth)
└── trips-suggest-image.ts # Image suggestion (server API keys)

All other functionality moved to client-side using Fluxbase SDK:
- Authentication (signup, signin, 2FA, password management)
- Profile & Preferences management
- Trips CRUD operations
- Jobs management
- Trip exclusions
- And more...
```

**Benefits of minimal edge functions + client-side SDK:**

- ✅ 83% reduction in edge functions (3 instead of 18+)
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
await fluxbase.auth.signInWithPassword({ email, password })
await fluxbase.auth.signOut()

// 2FA
await fluxbase.auth.setup2FA()
await fluxbase.auth.enable2FA(code)
await fluxbase.auth.verify2FA({ user_id, code })
await fluxbase.auth.disable2FA(password)
await fluxbase.auth.get2FAStatus()

// Password management
await fluxbase.auth.updateUser({ password })
```

**Database Operations (with RLS):**
```typescript
// Profiles
await fluxbase.from('user_profiles').select('*').eq('id', userId).single()
await fluxbase.from('user_profiles').update(data).eq('id', userId)

// Preferences
await fluxbase.from('user_preferences').select('*').eq('id', userId).single()
await fluxbase.from('user_preferences').upsert({ id: userId, ...prefs })

// Trips
await fluxbase.from('trips').select('*').eq('user_id', userId)
await fluxbase.from('trips').insert(tripData)
await fluxbase.from('trips').update(tripData).eq('id', tripId)

// Jobs
await fluxbase.from('jobs').select('*').eq('user_id', userId)
await fluxbase.from('jobs').insert(jobData)
```

### 2. Remaining Edge Functions (3 total)

Only operations requiring server-side logic remain as edge functions:

**health** - System health checks
- Requires service role to check system status
- Used for monitoring and uptime checks
- Unauthenticated endpoint

**owntracks-points** - External device integration
- Uses API key authentication (not JWT)
- Requires service role to validate API keys and insert data on behalf of users
- Integration endpoint for OwnTracks GPS tracking devices
- Unauthenticated (validates via API key)

**trips-suggest-image** - Image suggestion
- Uses server-side Pexels API key (must remain secret)
- Complex business logic for analyzing travel data
- Calls external Pexels API
- Requires user authentication

### 3. Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Client-Side (95% of operations)                            │
│                                                              │
│  Client → Fluxbase SDK → Database (with RLS) → Response     │
│                                                              │
│  - All CRUD operations                                      │
│  - Authentication flows                                     │
│  - Profile/preferences management                           │
│  - Trips, jobs, tracker data queries                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Server-Side Edge Functions (5% of operations)              │
│                                                              │
│  Client → Edge Function → External API/Service Role → DB    │
│                                                              │
│  - OwnTracks device integration (API key auth)              │
│  - Image suggestions (server API keys)                      │
│  - System health checks (service role)                      │
└─────────────────────────────────────────────────────────────┘
```

## Edge Function Endpoints

### health
```
GET /functions/health
Returns: System status, database connectivity, worker status
Authentication: None (unauthenticated)
```

### owntracks-points
```
POST /functions/owntracks-points
Headers: Authorization: Bearer {owntracks_api_key}
Body: OwnTracks location data (single point or array)
Authentication: API key validation
```

### trips-suggest-image
```
POST /functions/trips-suggest-image
Body: { trip_id } or { start_date, end_date }
Returns: Suggested image URL + attribution from Pexels
Authentication: Required (JWT token)
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

Each handler follows this pattern:

```typescript
export async function handleEndpoint(req: Request, params: URLSearchParams): Promise<Response> {
	const action = params.get('action');

	if (!action) {
		return errorResponse('Missing action parameter', availableActions);
	}

	switch (action) {
		case 'action1':
			return await handleAction1(req, params);
		case 'action2':
			return await handleAction2(req, params);
		default:
			return errorResponse('Invalid action', availableActions);
	}
}
```

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

1. **Massive Reduction**: 83% fewer edge functions (3 vs 18+)
2. **Performance**: No cold starts for 95% of operations
3. **Simplicity**: Direct SDK usage instead of edge function abstraction
4. **Security**: RLS policies protect all client-side queries
5. **Scalability**: No 1000-record limit (Fluxbase advantage)
6. **Maintainability**: Less code to maintain and deploy, platform-level CORS
7. **Cost**: Fewer function invocations = lower costs
8. **Developer Experience**: Simpler API, fewer moving parts, no CORS boilerplate

## Conclusion

The migration to client-side SDK queries with RLS has dramatically simplified our architecture while improving performance and reducing costs. By keeping only the 3 edge functions that truly require server-side logic, we've achieved:

- **83% reduction in edge functions** (3 vs 18+)
- **Zero cold starts** for most operations
- **Better performance** through direct database access
- **Simpler codebase** with no CORS boilerplate (platform-level handling)
- **Improved security** through Fluxbase's RLS policies
- **Lower costs** with fewer function invocations

This architecture leverages Fluxbase's strengths (no record limits, built-in RLS, comprehensive SDK, platform-level CORS) while only using edge functions where they provide genuine value (external integrations, API key protection, health monitoring).
