# Fluxbase Jobs

This directory contains job handler functions for Wayli's background job processing system.

## Overview

Job handlers follow the Fluxbase Jobs pattern and run on the Fluxbase platform. They are deployed with `bun run sync:jobs` (from `web/`), which runs `fluxbase jobs sync --namespace wayli --dir ../fluxbase/jobs/`.

> **Note**: Type definitions for the injected handler parameters are provided in [types.d.ts](types.d.ts). The platform injects these arguments at runtime; if your editor can't resolve `FluxbaseClient` / `JobUtils` in these files, that is a tooling limitation only.

## Job Handler Pattern

Each job is a single TypeScript file that exports a `handler` function. The platform injects four parameters (same shape as edge functions):

```typescript
/**
 * Job description
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 600
 * @fluxbase:allow-net true
 */
export async function handler(
  req: Request, // raw request (payload comes from job context)
  fluxbase: FluxbaseClient, // caller-scoped client (RLS applies)
  fluxbaseService: FluxbaseClient, // service-role client for privileged work
  job: JobUtils // job context, progress, cancellation
) {
  // Get job context
  const context = job.getJobContext();
  const { payload, user } = context;

  // Report progress
  job.reportProgress(25, 'Processing data...');

  // Perform job logic
  const result = await processData(payload);

  job.reportProgress(100, 'Complete');

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

## Job API (injected `job` parameter)

Every handler receives a `JobUtils` instance as its fourth parameter:

### `job.getJobContext()`

Returns job execution context:

```typescript
interface JobContext {
  job_id: string; // UUID of the job
  job_name: string; // Name of the job (matches filename)
  namespace: string; // Job namespace
  retry_count: number; // Current retry attempt
  payload: any; // Job input data
  user?: {
    // User context (null for scheduled jobs)
    id: string; // User UUID
    email: string; // User email
    role: string; // User role
  };
}
```

### `job.reportProgress(percent: number, message: string)`

Report job progress to the platform. Progress updates are sent to the frontend in real-time via Realtime WebSocket connections.

```typescript
job.reportProgress(0, 'Starting import');
job.reportProgress(50, 'Processed 5000/10000 points');
job.reportProgress(100, 'Import complete');
```

### `job.isCancelled()`

Async check whether the job was cancelled; jobs should poll it during long work and exit gracefully.

## Submitting Jobs on Behalf of Another User

When a job needs to submit child jobs (e.g., after data import), or when scheduled/cron jobs need to run tasks for specific users, use the `onBehalfOf` option.

### The `onBehalfOf` Option

Jobs submitted with `onBehalfOf` will have their user context set to the specified user, making it available via `job.getJobContext().user`.

```typescript
// Example: Submit a job on behalf of another user
await fluxbaseService.jobs.submit(
  'reverse-geocoding',
  {},
  {
    namespace: 'wayli',
    priority: 3,
    onBehalfOf: {
      user_id: 'target-user-uuid',
      user_email: 'user@example.com',
      user_role: 'authenticated'
    }
  }
);
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
    await fluxbaseService.jobs.submit(
      'follow-up-job',
      {},
      {
        namespace: 'wayli',
        onBehalfOf: {
          user_id: context.user.id,
          user_email: context.user.email,
          user_role: context.user.role
        }
      }
    );
  }
}
```

### Migration from `target_user_id`

The `target_user_id` payload field is deprecated. Use `onBehalfOf` instead:

```typescript
// ❌ Old approach (deprecated)
await fluxbaseService.jobs.submit(
  'distance-calculation',
  { target_user_id: userId },
  { namespace: 'wayli' }
);

// ✅ New approach (recommended)
await fluxbaseService.jobs.submit(
  'distance-calculation',
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

| File                                         | Description                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| [data-import.ts](data-import.ts)             | Unified data import supporting GeoJSON, GPX, KML, OwnTracks, and FIT formats           |
| [data-export.ts](data-export.ts)             | Export user data in GeoJSON or JSON format (downloadable file in storage)              |
| [polarsteps-import.ts](polarsteps-import.ts) | Import a Polarsteps export (`user_data.zip`): trips, journal entries, GPS data, photos |

### Geocoding

| File                                         | Description                                        |
| -------------------------------------------- | -------------------------------------------------- |
| [reverse-geocoding.ts](reverse-geocoding.ts) | Batch reverse geocode location points using Pelias |

#### Why Pelias?

We use [Pelias](https://pelias.io/) for geocoding. Pelias is an open-source geocoder with significant advantages:

- **Lightweight** - Uses ~20x less storage thanks to its Elasticsearch-based architecture
- **Fast** - Superior search performance from Elasticsearch full-text search
- **Flexible** - Handles varied address formats well

For a deeper technical comparison of geocoding options, see [this article](https://wcedmisten.fyi/post/upgrading-with-headway-maps/).

### Trip Processing

| File                                                                   | Description                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [trip-generation.ts](trip-generation.ts)                               | Detect trips from GPS data using sleep-based algorithm                                                  |
| [trip-detection.ts](trip-detection.ts)                                 | Alternative trip detection method with different heuristics                                             |
| [scheduled-trip-generation.ts](scheduled-trip-generation.ts)           | Daily trip-suggestion generation for all users (also detects in-progress trips)                         |
| [generate-trip-route.ts](generate-trip-route.ts)                       | Valhalla-snapped route shape for a single trip (privacy-clipped, stored in `trips.metadata.routeShape`) |
| [scheduled-generate-trip-routes.ts](scheduled-generate-trip-routes.ts) | Backfill + keep-fresh route snapping for opted-in users' trips                                          |

### Transport-Mode Detection

| File                                                                     | Description                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [detect-transport-mode.ts](detect-transport-mode.ts)                     | Per-user HMM-based transport-mode decoding of `tracker_data` |
| [scheduled-detect-transport-mode.ts](scheduled-detect-transport-mode.ts) | Daily incremental transport-mode detection for all users     |

### Place Visits & POI Detection

| File                                                                   | Description                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [detect-place-visits.ts](detect-place-visits.ts)                       | Detect POI visits from user location data                           |
| [scheduled-detect-place-visits.ts](scheduled-detect-place-visits.ts)   | Daily incremental place-visit detection for all users (03:00 UTC)   |
| [clear-and-rebuild-place-visits.ts](clear-and-rebuild-place-visits.ts) | Clear and rebuild place-visit data for all users or a specific user |

### Daily Activity Aggregation

| File                                                                       | Description                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [refresh-daily-activity.ts](refresh-daily-activity.ts)                     | Per-user refresh of the `tracker_daily_activity` cache via the `refresh-daily-activity-sql` RPC |
| [scheduled-refresh-daily-activity.ts](scheduled-refresh-daily-activity.ts) | Daily incremental refresh for all users (05:00 UTC), watermark-driven via `dayWindowSince`      |

> Aggregation windows are computed by `_shared/day-window.ts`: `dayWindowSince`
> floors the lookback start to UTC midnight so every affected day is
> re-aggregated in full (upserts overwrite whole-day totals; a mid-day start
> would clobber the earlier part of the day).

### Data Sampling

| File                                             | Description                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [sample-tracker-data.ts](sample-tracker-data.ts) | Nightly opt-in hybrid sampling of tracker data (distance + time thresholds) |

### Vector Embeddings (Semantic Search)

Embeddings populate the `wayli-pois` knowledge base so the assistant's
`vector_search` / RAG returns behavioral context (e.g. "where do I usually get
morning coffee?") and can personalize trip-plan recommendations. KB documents
are per-user (`metadata.user_id`) — retrieval filters by caller.

| File                                             | Description                                                                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [sync-poi-embeddings.ts](sync-poi-embeddings.ts) | Aggregate a user's place visits per POI into behavioral docs and upsert them into the `wayli-pois` KB. Idempotent (deletes then re-adds the user's docs). Fails open with a clear message if no embedding provider is configured. |

> **Prerequisite:** an AI provider with `use_for_embeddings = true` must be
> configured in Fluxbase admin (`ai.providers`). Without it, KB `addDocument`
> calls fail and the job exits with a clear message instead of corrupting state.
> The job is triggered after place-visit detection; a scheduled variant for all
> users is still TODO (see below).

#### TODO (not yet implemented)

- `scheduled-sync-poi-embeddings.ts` — iterate all users and submit per-user
  `sync-poi-embeddings` jobs on a schedule (model: `scheduled-refresh-daily-activity.ts`).
- `sync-trip-embeddings.ts` / `scheduled-sync-trip-embeddings.ts` — trip-level
  semantic search. Note: the `wayli-trips` KB referenced in the deprecated
  `trip_embeddings` comment (`schema/public.sql`) does **not** exist yet and
  must be created before these can run.

## Testing Jobs

Jobs run on the Fluxbase platform. To pick up handler changes, sync them:

```bash
# from web/
bun run sync:jobs    # fluxbase jobs sync --namespace wayli --dir ../fluxbase/jobs/

# Submit a test job via the Fluxbase client (fluxbaseService.jobs.submit) or the dashboard
```

## Development Guidelines

1. **Keep handlers self-contained** - Each job should be independent
2. **Use progress reporting** - Update progress frequently for long-running jobs
3. **Handle errors gracefully** - Return `{ success: false, error: "message" }`
4. **Check cancellation** - Poll `job.isCancelled()` during long work
5. **Test thoroughly** - Verify handlers against a running Fluxbase instance
6. **Document annotations** - Always specify required permissions

## File Naming Convention

The job name must match the filename (kebab-case):

- Job `reverse-geocoding` → File: `reverse-geocoding.ts`
- Job `data-import` → File: `data-import.ts` (all formats handled by one unified job)
- Scheduled variants are prefixed `scheduled-` and carry a `@fluxbase:schedule` cron annotation

## See Also

- [Fluxbase Jobs Documentation](https://docs.fluxbase.sh/jobs)
- [Edge Functions Architecture](../functions/ARCHITECTURE.md)
