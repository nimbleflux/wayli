# Fluxbase Jobs

This directory contains job handler functions for Wayli's background job processing system.

## Overview

Job handlers follow the Fluxbase Jobs pattern, which will eventually run on the Fluxbase platform. Currently, these handlers are executed by Wayli's worker infrastructure via an adapter layer.

> **Note**: Type definitions for the `Fluxbase` global API are provided in [types.d.ts](types.d.ts). TypeScript may show errors about `Fluxbase` not being found when type-checking these files, which is expected since the Fluxbase Jobs runtime isn't available yet. These handlers are designed to run on the Fluxbase platform when it's released.

## Job Handler Pattern

Each job is a single TypeScript file that exports a `handler` function:

```typescript
/**
 * Job description
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 600
 * @fluxbase:allow-net true
 * @fluxbase:allow-read true
 */
export async function handler(request: Request) {
  // Get job context
  const context = Fluxbase.getJobContext();
  const { payload, user } = context;

  // Report progress
  Fluxbase.reportProgress(25, "Processing data...");

  // Perform job logic
  const result = await processData(payload);

  Fluxbase.reportProgress(100, "Complete");

  // Return result
  return {
    success: true,
    result: { processed: result.count }
  };
}
```

## Available Annotations

### `@fluxbase:require-role <role>`

Restrict job submission to specific user roles:

- `admin` - Only admin users
- `dashboard_admin` - Dashboard admins
- `authenticated` - Any authenticated user (most common)
- `anon` - Anonymous users
- `null` (default) - Any role

### `@fluxbase:timeout <seconds>`

Maximum execution time in seconds. Default varies by platform (typically 300s).

Examples:
- `@fluxbase:timeout 600` - 10 minutes
- `@fluxbase:timeout 1800` - 30 minutes

### `@fluxbase:allow-net <boolean>`

Allow network access for external API calls. Required for:
- Geocoding APIs (Pelias)
- External data sources
- Webhooks

### `@fluxbase:allow-read <boolean>`

Allow file system read access. Required for:
- Reading uploaded files
- Processing local data
- Export generation

### `@fluxbase:allow-env <boolean>`

Allow access to environment variables.

## Fluxbase Global API

Job handlers have access to the `Fluxbase` global object:

### `Fluxbase.getJobContext()`

Returns job execution context:

```typescript
interface JobContext {
  job_id: string;        // UUID of the job
  job_name: string;      // Name of the job function
  namespace: string;     // Job namespace
  retry_count: number;   // Current retry attempt
  payload: any;          // Job input data
  user?: {              // User context (null for scheduled jobs)
    id: string;         // User UUID
    email: string;      // User email
    role: string;       // User role
  };
}
```

### `Fluxbase.reportProgress(percent: number, message: string)`

Report job progress to the platform. Progress updates are sent to the frontend in real-time via WebSocket.

```typescript
Fluxbase.reportProgress(0, "Starting import");
Fluxbase.reportProgress(50, "Processed 5000/10000 points");
Fluxbase.reportProgress(100, "Import complete");
```

## Submitting Jobs on Behalf of Another User

When a job needs to submit child jobs (e.g., after data import), or when scheduled/cron jobs need to run tasks for specific users, use the `onBehalfOf` option.

### The `onBehalfOf` Option

Jobs submitted with `onBehalfOf` will have their user context set to the specified user, making it available via `job.getJobContext().user`.

```typescript
// Example: Submit a job on behalf of another user
await fluxbaseService.jobs.submit('reverse-geocoding', {}, {
  namespace: 'wayli',
  priority: 3,
  onBehalfOf: {
    user_id: 'target-user-uuid',
    user_email: 'user@example.com',
    user_role: 'authenticated'
  }
});
```

### Use Cases

1. **Job chaining** - When a user-initiated job needs to trigger follow-up jobs
2. **Scheduled jobs** - Cron-triggered jobs that need to process data for specific users
3. **Admin operations** - Admin-triggered batch operations for multiple users

### Example: Job Chaining

```typescript
export async function handler(req, fluxbase, fluxbaseService, job) {
  const context = job.getJobContext();
  const userId = context.user?.id;

  // ... perform main job logic ...

  // Submit follow-up job on behalf of the same user
  if (context.user) {
    await fluxbaseService.jobs.submit('follow-up-job', {}, {
      namespace: 'wayli',
      onBehalfOf: {
        user_id: context.user.id,
        user_email: context.user.email,
        user_role: context.user.role
      }
    });
  }
}
```

### Migration from `target_user_id`

The `target_user_id` payload field is deprecated. Use `onBehalfOf` instead:

```typescript
// ❌ Old approach (deprecated)
await fluxbaseService.jobs.submit('distance-calculation',
  { target_user_id: userId },
  { namespace: 'wayli' }
);

// ✅ New approach (recommended)
await fluxbaseService.jobs.submit('distance-calculation',
  {},
  {
    namespace: 'wayli',
    onBehalfOf: {
      user_id: userId,
      user_email: userEmail,
      user_role: userRole
    }
  }
);
```

## Available Jobs

### Data Import & Export

| File | Description |
|------|-------------|
| [data-import.ts](data-import.ts) | Unified data import supporting GeoJSON, GPX, and OwnTracks JSON formats |
| [data-export.ts](data-export.ts) | Export user data in GeoJSON, JSON, or CSV format |

### Geocoding

| File | Description |
|------|-------------|
| [reverse-geocoding.ts](reverse-geocoding.ts) | Batch reverse geocode location points using Pelias |

#### Why Pelias?

We use [Pelias](https://pelias.io/) for geocoding. Pelias is an open-source geocoder with significant advantages:

- **Lightweight** - Uses ~20x less storage thanks to its Elasticsearch-based architecture
- **Fast** - Superior search performance from Elasticsearch full-text search
- **Flexible** - Handles varied address formats well

For a deeper technical comparison of geocoding options, see [this article](https://wcedmisten.fyi/post/upgrading-with-headway-maps/).

### Trip Processing

| File | Description |
|------|-------------|
| [trip-generation.ts](trip-generation.ts) | Detect trips from GPS data using sleep-based algorithm |
| [trip-detection.ts](trip-detection.ts) | Alternative trip detection method |

### Place Visits & POI Detection

| File | Description |
|------|-------------|
| [detect-place-visits.ts](detect-place-visits.ts) | Detect POI visits from user location data |
| [scheduled-detect-place-visits.ts](scheduled-detect-place-visits.ts) | Scheduled job to detect place visits for all users |
| [clear-and-rebuild-place-visits.ts](clear-and-rebuild-place-visits.ts) | Clear and rebuild place visits data |

### Vector Embeddings (Semantic Search)

| File | Description |
|------|-------------|
| [sync-trip-embeddings.ts](sync-trip-embeddings.ts) | Generate/sync vector embeddings for user trips |
| [sync-poi-embeddings.ts](sync-poi-embeddings.ts) | Generate/sync vector embeddings for user POIs |
| [scheduled-sync-trip-embeddings.ts](scheduled-sync-trip-embeddings.ts) | Scheduled job to sync trip embeddings for all users |
| [scheduled-sync-poi-embeddings.ts](scheduled-sync-poi-embeddings.ts) | Scheduled job to sync POI embeddings for all users |

### User Preferences

| File | Description |
|------|-------------|
| [compute-user-preferences.ts](compute-user-preferences.ts) | Compute and update user preferences based on activity |

## Testing Jobs Locally

Jobs can be tested locally using the worker infrastructure:

```bash
# Start worker in development mode
npm run dev:worker

# Submit a test job via the API or database
```

## Migration Status

**Current State (Hybrid Mode):**
- Job handlers in `fluxbase/jobs/` (this directory)
- Worker infrastructure in `src/worker/` (orchestration)
- Worker imports and executes handlers via adapter layer

**Future State (Fluxbase-Managed):**
- Job handlers remain in `fluxbase/jobs/`
- Worker infrastructure deleted
- Jobs submitted via `POST /api/v1/jobs/submit`
- Fluxbase platform handles orchestration, queuing, and execution

## Development Guidelines

1. **Keep handlers self-contained** - Each job should be independent
2. **Use progress reporting** - Update progress frequently for long-running jobs
3. **Handle errors gracefully** - Return `{ success: false, error: "message" }`
4. **Check cancellation** - Jobs may be cancelled by users
5. **Test thoroughly** - Ensure handlers work both locally and when deployed
6. **Document annotations** - Always specify required permissions

## File Naming Convention

Job files should match the job type name with hyphens:

- Job type: `reverse_geocoding_missing` → File: `reverse-geocoding.ts`
- Job type: `data_import` → Files: `data-import-geojson.ts`, `data-import-gpx.ts`, etc.
- Job type: `trip_generation` → File: `trip-generation.ts`

## See Also

- [Fluxbase Jobs Documentation](https://docs.fluxbase.sh/jobs)
- [Edge Functions Architecture](../functions/ARCHITECTURE.md)
