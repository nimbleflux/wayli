# Immich Photo Integration — Implementation Plan (issue #13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a user's self-hosted Immich instance so geotagged photos appear as a toggleable clustered layer on the location-data map and as "photos from this day" strips in the travel/journal timeline — metadata synced into Wayli, thumbnails streamed via a server-side proxy, toggleable at admin / user / layer level.

**Architecture:** Background sync job (`immich-sync`) pulls photo *metadata* from Immich `POST /api/search/metadata` (`withExif:true`, `takenAfter` watermark, paginated) into a new RLS-scoped `immich_assets` table. Thumbnails never touch Wayli storage: an `immich-thumb` edge function proxies Immich thumbnails with the server-side API key, only for assets the requesting user has synced. Server-admin toggle gates everything; per-user connection (URL override + API key + enable + disconnect-wipes-data) lives in Connections; the map layer has a per-view toggle.

**New in rev 2:** the connection flow on the **Connections page** explicitly shows **which Immich API-key permissions are required and what each is for** (`user.read`, `asset.read`, `asset.view`), the connection test detects and reports missing permissions, and sync permission failures surface the same guidance in the UI.

**Research base (verified):**
- Issue #13 is a bare stub — scope defined by the decisions below.
- Immich API (`x-api-key` auth): `POST /api/search/metadata` with `withExif:true` + `takenAfter` + pagination returns assets with `exifInfo.dateTimeOriginal/latitude/longitude/city/state/country` (the sync source — `/map/markers` lacks timestamps); `GET /api/assets/{id}/thumbnail?size=thumbnail|preview` needs auth and has no signed-URL mechanism → proxy required.
- Immich API-key permissions are granular `resource.action` scopes ticked at key creation (Account Settings → API Keys).
- Dawarich does two things (display photos on map/timeline; import photo GPS as points) — Wayli takes **display only** by decision.
- Wayli reuse map: secrets via `setSecret/listSecrets/getUser` (Pexels precedent), jsonb toggles (`valhalla-beta.svelte.ts` shape), admin `wayli.*` settings, heatmap-layer + toggle-button precedent on the location map, markercluster config (want-to-visit), jobs flow (`jobs.submit` + job-store names), travel-page day grouping.

## Scope decisions (confirmed with product owner, 2026-09-28)
1. **Metadata sync + thumbnail proxy** (no thumbnail storage, key never client-side).
2. **Phase 1 surfaces: map layer + timeline day strips** (trip pages/stats deferred).
3. **Display only** — photo GPS never becomes tracker points or affects detection.
4. **Three toggle levels**: server-admin enable + default URL; per-user connection; per-view layer toggle.

## Global constraints
- Package manager `bun`; all web commands from `web/`. Every task ends with `bun run check` + `lint` + targeted `test` green before commit.
- Privacy-first: API key only in server-side encrypted secrets, never in responses/logs/UI; proxy verifies user owns the synced asset; everything defaults OFF; inert unless admin ∧ user ∧ layer all enabled.
- Immich unreachable → sync completes with `synced: 0` (never a failed job).
- Server code is Deno (jobs/functions in `fluxbase/`); frontend TS strict; Svelte 5 runes; i18n keys in `en.json` + translate pipeline.

## Review Focus (tests must pin these)
1. The API key never appears in any response/log/error/UI (tests assert against mocked 401 bodies containing the key).
2. Proxy denial paths: 403 admin-off / 403 user-off / 404 asset-not-synced-by-user.
3. Toggle independence: admin off → sync, proxy, UI card all no-op despite user prefs.
4. Watermark: `takenAfter = lastSync − 24h` overlap, idempotent upserts; full resync replaces user rows.
5. Map perf: lightweight circle markers; thumbnails only on popup open.

---

### Task A1: Server admin settings
`web/src/lib/stores/settings.svelte.ts` PUBLIC_KEYS += `wayli.immich_enabled`, `wayli.immich_endpoint`; admin card (Switch + URL input) in `server-admin-settings/+page.svelte` next to Pelias/Valhalla; i18n `adminSettings.immich.*`. Test-first: store resolves defaults when keys absent. Commit: `feat(web): server-admin Immich toggle and default endpoint (#13)`.

### Task A2: Connections page — Immich card WITH permissions explainer
- `web/src/lib/types/immich.types.ts` (`ImmichSettings { enabled, server_url?, last_sync_at? }`, `IMMICH_API_KEY`), `web/src/lib/stores/immich.svelte.ts` (jsonb read-modify-write of `preferences.immich`, valhalla-beta shape, race handling).
- Immich card on `connections/+page.svelte` (below OwnTracks), admin-gated ("disabled by administrator" when off), containing **before the API-key input a "Required Immich permissions" info box**:
  - `user.read` — verify the connection ("Test connection" reads your user profile)
  - `asset.read` — sync photo metadata (GPS coordinates, capture date, city/country)
  - `asset.view` — display photo thumbnails (streamed live through Wayli's proxy; nothing is stored)
  plus "In Immich: Account Settings → API Keys → New API Key, tick exactly these three permissions" and a note that thumbnails may additionally need `asset.download` on instances with stricter download policies.
- Card: URL input (prefilled from server default), API-key input → `setSecret('immich_api_key')`, status via `listSecrets()`, enable Switch, "Test connection" (→ C1), "Sync now" (`fluxbase.jobs.submit('immich_sync')`, last-sync display), "Disconnect & delete data".
- `job-store.ts` display name `immich_sync: 'Immich photo sync'`; i18n `connections.immich.*`.
- Test: store merge doesn't clobber sibling jsonb keys (RED→GREEN). Commit: `feat(web): Immich connection card with permission guidance (#13)`.

### Task A3: i18n translate pipeline for the 10 locales. Commit: `chore(i18n): Immich strings (#13)`.

### Task B1: `immich_assets` table (schema)
`(user_id, asset_id) PK`, latitude/longitude, taken_at, city/state/country, synced_at; index `(user_id, taken_at)`; RLS own-row SELECT/INSERT/UPDATE/DELETE policies (mirror want_to_visit_places); table comment: display-only, thumbnails proxied. Commit: `feat(schema): immich_assets table (#13)`.

### Task B2: Immich client service (Deno)
`fluxbase/jobs/_shared/services/external/immich.service.ts` + tests: `resolveImmichBase`, `fetchGeotaggedAssets` (pagination, GPS/takenAt filtering), `fetchThumbnail`, `testConnection`; 10s timeouts; **401/403 mapped to `{ ok:false, errorKind: 'auth' | 'permission' | 'other' }`**, never echoing the key. RED→GREEN (`deno test --no-lock --no-check --sloppy-imports`). Commit: `feat(jobs): Immich API client (#13)`.

### Task B3: `immich-sync` job + scheduled variant
Incremental `takenAfter = lastSync − 24h` → paged upserts → watermark; `fullResync` replaces; `wipe` = disconnect (rows + secret + disabled); Immich down → succeeds with 0. **Permission-kind errors carry `permissionError: true`** for UI guidance. `jobs/scheduled-immich-sync.ts` cron `15 5 * * *` over enabled users; `JobType` += `immich_sync`. Pure logic Deno-tested RED→GREEN. Commit: `feat(jobs): immich-sync (#13)`.

### Task C1: `immich-test` function
`{serverUrl?}` → base resolution + `testConnection`; maps auth/permission errors to `{ ok:false, errorKind, hint }` where hint names the three required scopes. Commit: `feat(functions): immich-test (#13)`.

### Task C2: `immich-thumb` proxy function
GET `?assetId&size=thumbnail|preview`: 403 admin-off / 403 user-off / 404 asset-not-synced-by-user (no generic gateway) → stream upstream thumbnail with `Cache-Control: private, max-age=604800, immutable`; 502 upstream failure without key material. Pure validators in `functions/_shared/immich.ts` Deno-tested RED→GREEN. Commit: `feat(functions): immich-thumb authorized proxy (#13)`.

### Task D1: Frontend photo service
`web/src/lib/services/immich.service.ts`: `loadPhotosForRange(start,end)` (RLS select), `thumbUrl` via **fetch-with-auth-header → objectURL** (never token-in-URL), object-URL cache + `clearThumbCache()`. Tests: range filter, cache reuse. Commit: `feat(web): Immich photo query service (#13)`.

### Task D2: Map layer (location-data)
`photoLayer` + `showPhotos` next to `heatLayer` precedent; toggle button (Camera icon) beside Heatmap, visible only when Immich enabled; markercluster (count `divIcon`s, `disableClusteringAtZoom:16`); per-photo lightweight `circleMarker` (purple) with popup: lazy thumbnail (on popup open), taken_at, city/country, "Open in Immich" link; re-renders on date-range change; cleared by `clearMapMarkers`. Commit: `feat(web): clustered Immich photo layer (#13)`.

### Task E1: Timeline day strips
`ImmichPhotoStrip.svelte` (`{date}` prop; horizontal lazy thumbnail row; empty → nothing; click → enlarged preview); under each journal day header in `travel/+page.svelte`, gated on the store; component test RED→GREEN. Commit: `feat(web): Immich photo strips in the travel timeline (#13)`.

---

## Phase 2 ideas (documented, NOT built)
Trip/public pages (privacy decision needed); photos-per-trip stats; auto-attach to journal entries by date+proximity; thumbnail-marker mode with zoom gating; "memories on this day"; album/date sync filters; Photoprism parity; GPS-as-points import (**rejected** — display-only).

## Deployment notes
1. `bun run sync:schema` + `sync:functions` + `sync:jobs` from the deploy environment (CLI not on the dev machine).
2. Admin: set `wayli.immich_enabled` + `wayli.immich_endpoint`; users connect under Dashboard → Connections (three-permission checklist shown there).
3. fluxbase server must reach the Immich instance (LAN/docker network).
4. i18n translate pipeline for the 10 locales.

## Verification matrix
- `cd web && bun run test && bun run check && bun run lint`
- `deno test --no-lock --no-check --sloppy-imports` over the new Deno modules
- Secret-leak, proxy-denial, and toggle-independence assertions green
- Manual E2E with real Immich: create scoped key (3 permissions) → connect (permissions box → test → sync) → photos on map within date filter → popup thumbnails → timeline strips → toggle off at each level → disconnect wipes data
