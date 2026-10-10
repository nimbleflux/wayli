# Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the 2026-10-10 codebase audit findings as six independent, shippable PRs (one per tracked GitHub issue), ordered so the drift-guard CI lands before the changes that depend on staying in sync.

**Architecture:** Six workstreams, each = one GitHub issue + one PR off `main`: (1) correctness/hardening bug fixes, (2) CI coverage + mirror-drift guard, (3) detection/import reliability, (4) security hardening (discreet public tracking), (5) code-health cleanup, (6) UX quick wins. A seventh issue tracks feature opportunities without committing to build them. All schema changes go through the declarative `fluxbase/schema/public.sql` (applied by `fluxbase schema sync` at container start).

**Tech Stack:** SvelteKit 2 + Svelte 5 (web, vitest + prettier + oxlint), Deno (fluxbase, `deno test --no-lock --sloppy-imports --no-check`), Kotlin/Compose (android, Gradle), Postgres (declarative schema).

**Spec:** The audit findings delivered in-session 2026-10-10 (security / reliability / quality / UX scans). This plan is the spec's task decomposition; each workstream section restates its findings.

## Global Constraints

- Web verification gate: `cd web && bun run test` (all pass) + `bunx prettier --check <touched files>`; type gate `bun run check` for TS-heavy changes.
- Fluxbase verification gate: `deno test --no-lock --sloppy-imports --no-check fluxbase/jobs/_shared/services/transport-mode/states.test.ts …` (per touched test file; `--no-check` required — `deno check` fails on `main` with pre-existing import-map resolution errors).
- Android verification gate: `cd android && ./gradlew :app:compileGplayDebugKotlin :core:test :data:testDebugUnitTest :app:testGplayDebugUnitTest` (flavors exist — task names need the `Gplay`/`Foss` prefix in `:app:`).
- Branch/PR hygiene: one branch per workstream off latest `main`; conventional-commit title; PR body references its issue; CI green before done.
- Security workstream (Issue 4): public issue text and PR body stay generic (no exploit mechanics, no vulnerable-URL examples). Details live only in the in-session audit report.
- Never break stored-data contracts: `tracker_data.transport_mode` is free text (no DB enum); detector changes bump `DETECTOR_VERSION`; manual overrides (`transport_mode_manual = true`) are untouchable.

## Review Focus

1. **Mirror-tree edits must land on BOTH copies** (fluxbase `jobs/_shared/services/transport-mode/` ↔ web `src/lib/services/transport-mode/`) — PR-7 already drifted once. Every detector task below names both files; the Task 3.2 parity test fails CI if they diverge again.
2. **`auth.uid()`-guarded SQL functions**: the guard must allow the legitimate caller set (owner, admin) and must be verified against actual callers (chatbot reads, exports) before tightening.
3. **Watermark semantics**: checkpointing must never advance past unpersisted work; a failed batch write must leave the resume point at-or-before the failed batch (1h lookback makes redo safe, skips are not).
4. **Deleting "dead" code**: re-grep importers immediately before deletion (the audit's grep is a snapshot); if a test file is the only importer, delete both together.
5. **Public tracker discretion** (Issue 4): no request/response examples, no vulnerable endpoint names beyond what the diff itself shows, no "how to exploit" phrasing.

---

## Workstream 1 — Correctness & hardening quick fixes (Issue A → PR)

Four small, verified defects. One PR.

### Task 1.1: web Valhalla costing missing `running` (mirror drift from PR-7)

**Files:**
- Modify: `web/src/lib/services/transport-mode/valhalla-confirm.ts:97-106` (`costingForMode`)
- Test: `web/src/lib/services/transport-mode/valhalla-confirm.test.ts` (existing file)

**Steps:**
- [ ] Export `costingForMode` (add `export` to the function) and add the case, matching fluxbase `valhalla-confirm.ts:97-107`:

```ts
export function costingForMode(mode: TransportMode): ValhallaCosting {
	switch (mode) {
		case 'walking':
		case 'running':
		case 'stationary':
			return 'pedestrian';
		case 'cycling':
			return 'bicycle';
		default:
			// car, train, airplane, unknown — auto is the most permissive road matcher.
			return 'auto';
	}
}
```

- [ ] Add test: `expect(costingForMode('running')).toBe('pedestrian')` plus walking/cycling/car for the matrix.
- [ ] `cd web && bun run test:unit -- --run valhalla-confirm` → PASS.
- [ ] Commit: `fix(web): map running to pedestrian costing in the web Valhalla mirror`

### Task 1.2: web Pelias client must not fail over to the hosted instance

Self-hosted users' coordinates must never reach `pelias.wayli.app`. Mirror the fluxbase `resolveEndpoints` rule (`fluxbase/jobs/_shared/services/external/pelias.service.ts:95-107`).

**Files:**
- Modify: `web/src/lib/services/external/pelias.service.ts:319-320` (and the forward-geocode sibling if it has the same pattern — grep `pelias.wayli.app` in the file)

**Steps:**
- [ ] Replace `const endpoints = [config.endpoint, 'https://pelias.wayli.app'];` with the rule (define `DEFAULT_PELIAS_ENDPOINT` const once, reuse in `config` + `getPeliasEndpoint`):

```ts
const DEFAULT_PELIAS_ENDPOINT = 'https://pelias.wayli.app';

/** Self-hosted endpoints must NOT silently fail over to the hosted instance:
 *  that would send users' coordinates to a third-party server. */
function resolveEndpoints(endpoint: string): string[] {
	if (!endpoint || endpoint === DEFAULT_PELIAS_ENDPOINT) return [DEFAULT_PELIAS_ENDPOINT];
	return [endpoint];
}
```

and at the call site: `const endpoints = resolveEndpoints(config.endpoint);` (the `endpoints.length > 1` fallback branches then become dead-but-harmless; leave them).
- [ ] Grep the file for a second occurrence (forward geocode) and apply the same.
- [ ] `bun run test` (web suite) → PASS; prettier check.
- [ ] Commit: `fix(web): never fail self-hosted Pelias over to the hosted instance`

### Task 1.3: owner-or-admin guard on `get_user_preferences`

**Files:**
- Modify: `fluxbase/schema/public.sql:3156-3177` (function body) — declarative schema, applied by `fluxbase schema sync`.

**Steps:**
- [ ] Read the full function body; add the same guard shape `get_user_tracking_data` uses (`public.sql:3200-3207`), as a WHERE clause on the SELECT:

```sql
    WHERE upv.user_id = p_user_id
       OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role = 'admin'
          )
```

(adapt the left side to whatever column the function filters on today — it selects by `p_user_id`; keep `LANGUAGE sql` intact).
- [ ] Confirm callers: grep web/android/fluxbase for `get_user_preferences` — expected: none outside schema (chatbot reads views). If a client call site exists, note it in the PR and keep the admin branch.
- [ ] Verify the built schema still parses: the CI "Setup smoke" job runs `fluxbase schema sync` — rely on it plus a local eyeball of statement syntax.
- [ ] Commit: `fix(schema): restrict get_user_preferences to owner or admin`

### Task 1.4: markdown renderer fails closed

**Files:**
- Modify: `web/src/lib/utils/markdown.ts:41-43`
- Test: `web/src/lib/utils/markdown.test.ts` (new if absent)

**Steps:**
- [ ] Write failing test: mock `marked` (vi.mock) so `parse` throws; assert `renderMarkdown('<img src=x onerror=alert(1)>text')` returns **no raw `<`** (escaped), not the original string.
- [ ] Implement — fail closed but degrade to escaped text:

```ts
	} catch {
		// Fail closed: never return unsanitized input. Escape so the text still shows.
		return content
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}
```

- [ ] Run markdown tests + full `bun run test` → PASS.
- [ ] Commit: `fix(web): escape instead of passing through raw content when markdown rendering fails`

---

## Workstream 2 — CI coverage + mirror-drift guard (Issue B → PR)

Lands BEFORE the reliability work so backend regressions can fail CI from then on.

### Task 2.1: CI job for fluxbase

**Files:**
- Modify: `.github/workflows/ci.yml` (add a job; mirror the shape of `android-ci.yml`'s path filtering if trivial)

**Steps:**
- [ ] Add job:

```yaml
  fluxbase:
    name: Fluxbase tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<same SHA as other jobs>
      - uses: denoland/setup-deno@<pin a version>
        with:
          deno-version: v2.x
      - name: Run deno tests
        run: |
          FILES=$(git ls-files 'fluxbase/**/*.test.ts')
          deno test --no-lock --sloppy-imports --no-check $FILES
```

- [ ] While in the file: remove the invalid `cache:` / `cache-cancel-in-progress:` inputs from all six `oven-sh/setup-bun@v2` uses (v2 defines neither; v2 caches by default).
- [ ] Push to the PR branch and confirm the new job passes on GitHub.
- [ ] Commit: `ci: run fluxbase deno tests, drop invalid setup-bun inputs`

### Task 2.2: mirror-drift parity test (web vitest)

Text-level parity of the critical detector blocks between the two trees — catches the PR-7 class of drift.

**Files:**
- Create: `web/tests/unit/transport-mode-mirrors.test.ts`

**Steps:**
- [ ] Write the test (reads the fluxbase files as text, extracts the canonical blocks, compares to web's runtime values):

```ts
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRANSPORT_MODES } from '$lib/services/transport-mode/states';
import { MODE_PHYSICAL_LIMITS, MODE_CONTINUITY_LIMITS } from '$lib/utils/transport-mode.config';

const fb = (p: string) => readFileSync(`../../fluxbase/jobs/_shared/services/transport-mode/${p}`, 'utf8');

function extractArray(src: string, name: string): string[] {
	const m = src.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`));
	return (m?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((s) => s.replaceAll("'", '')) ?? [];
}

describe('transport-mode mirror parity (fluxbase ↔ web)', () => {
	test('TRANSPORT_MODES arrays are identical, in order', () => {
		const flux = extractArray(fb('states.ts'), 'TRANSPORT_MODES');
		expect(flux).toEqual([...TRANSPORT_MODES]);
	});

	test('mode physical + continuity limits cover the same modes', () => {
		const cfg = fb('config.ts');
		for (const mode of TRANSPORT_MODES) {
			expect(cfg).toContain(`${mode}: { min:`);
			expect(MODE_PHYSICAL_LIMITS[mode]).toBeDefined();
			expect(MODE_CONTINUITY_LIMITS[mode]).toBeDefined();
		}
	});

	test('running maps to pedestrian costing in BOTH valhalla-confirm mirrors', () => {
		expect(fb('valhalla-confirm.ts')).toMatch(/case 'running':\s*\n\s*case 'stationary':/);
		const web = readFileSync('src/lib/services/transport-mode/valhalla-confirm.ts', 'utf8');
		expect(web).toMatch(/case 'running':/);
	});
});
```

- [ ] Adjust regexes to the real file formatting while keeping the assertions semantic (mode list order, per-mode limit presence, running-costing presence).
- [ ] `bun run test:unit -- --run transport-mode-mirrors` → PASS. Break it deliberately once (comment the web `running` case) → FAIL → restore.
- [ ] Commit: `test(web): guard fluxbase↔web transport-mode mirrors against drift`

### Task 2.3: gitignore repo cruft

- [ ] Add `/test-results/` to root `.gitignore`. Commit with 2.2 or separately: `chore: ignore playwright test-results`

---

## Workstream 3 — Detection/import reliability (Issue C → PR)

### Task 3.1: checkpoint the detector watermark per batch

**Files:**
- Modify: `fluxbase/jobs/_shared/services/transport-mode/run-helpers.ts:125-203`

**Steps:**
- [ ] In `decodeAndPersist`, after `updated += await persistDecisions(db, userId, decisions);`, checkpoint so a killed run resumes where it stopped (the 1h lookback makes the redo safe):

```ts
      // Checkpoint per batch: a run killed by timeout/OOM mid-window must
      // resume near lastRecordedAt on the next run instead of re-decoding
      // the whole (up to 3-year) window from scratch.
      if (lastRecordedAt && failedChunks === 0) {
        await advanceWatermark(
          db,
          userId,
          new Date(new Date(lastRecordedAt).getTime() - LOOKBACK_MS)
        );
      }
```

- [ ] `LOOKBACK_MS` is already imported (line 10). Track `let failedChunks = 0;` fed by Task 3.2.
- [ ] Final watermark: only advance to `now` when `failedChunks === 0` for the whole run; otherwise leave the last per-batch checkpoint in place.
- [ ] Note: the scheduled job's per-user loop is untouched; a slow user now resumes instead of restarting.

### Task 3.2: don't silently skip failed mode updates

**Files:**
- Modify: `fluxbase/jobs/_shared/services/transport-mode/run-helpers.ts:216-258` (`persistDecisions`)

**Steps:**
- [ ] Change the update-failure branch from `console.error` to also counting: make `persistDecisions` `return { updated, failed }` (failed = chunk sizes whose update errored). Update the one caller; feed `failedChunks`.
- [ ] Keep the manual-override `.neq('transport_mode_manual', true)` filter untouched.
- [ ] Deno-run the states test (regression gate) — logic is exercised via Task 3.3's test where feasible; otherwise verified by review + the mirror parity test staying green.

### Task 3.3: unit-test the checkpoint math

**Files:**
- Modify: `fluxbase/jobs/_shared/services/transport-mode/run-helpers.ts` — extract a pure helper:

```ts
/** Resume point after a batch: the batch's last timestamp minus the lookback,
 *  so the next run re-decodes at most the lookback window. Null-safe. */
export function checkpointFrom(lastRecordedAt: string | null): Date | null {
  if (!lastRecordedAt) return null;
  return new Date(new Date(lastRecordedAt).getTime() - LOOKBACK_MS);
}
```

- [ ] Test (node:test, same style as `states.test.ts`, new file `run-helpers.test.ts`): `checkpointFrom('2026-01-01T12:00:00Z')` → `11:00:00Z`; `checkpointFrom(null)` → `null`.
- [ ] `deno test --no-lock --sloppy-imports --no-check fluxbase/jobs/_shared/services/transport-mode/run-helpers.test.ts` → PASS.
- [ ] Commit: `fix(jobs): checkpoint transport-mode watermark per batch and count failed updates`

### Task 3.4: import integrity — chronological order + duplicate-tolerant insert

**Files:**
- Modify: `fluxbase/jobs/_shared/utils/import-helpers.ts:348-368`

**Steps:**
- [ ] Sort the full parsed record set chronologically BEFORE batching (cross-batch order matters for the distance trigger), then insert with the ingest path's duplicate tolerance:

```ts
// The distance/speed trigger derives each row's metrics from the
// chronologically previous row — inserting in file order (or racing live
// ingest) permanently mis-attributes legs. Sort up front and tolerate
// (user_id, recorded_at) collisions with the live tracker.
allRecords.sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
```

and replace `const { error } = await fluxbase.from('tracker_data').insert(newRecords);` with `const { error } = await fluxbase.from('tracker_data').upsert(newRecords, { ignoreDuplicates: true });` (exact record-shape/variable names adapted to the real code at execution).
- [ ] Extract + test the comparator as a pure export `byRecordedAtAsc(a, b)` (node:test, `import-helpers.test.ts` new or existing).
- [ ] Commit: `fix(jobs): import points chronologically and tolerate live-ingest collisions`

### Task 3.5: outbound fetch timeouts on the geocode/valhalla path

**Files:**
- Modify: `fluxbase/functions/_shared/points-core.ts:295-300, 327-332` (both Pelias fetches)
- Modify: `fluxbase/jobs/_shared/services/external/valhalla.service.ts:218-224` (`trace_attributes` POST)

**Steps:**
- [ ] Pelias fetches: add `signal: AbortSignal.timeout(5000)` to the existing options object (mirrors `immich.service.ts:74`).
- [ ] Valhalla: add `signal: AbortSignal.timeout(30000)` — the surrounding try/catch already fails over to the next endpoint, and an abort throws like any error.
- [ ] Commit: `fix(fluxbase): bound outbound geocode/valhalla fetches with timeouts`

### Task 3.6: travel-page polling leak

**Files:**
- Modify: `web/src/routes/(user)/dashboard/travel/+page.svelte:631-641`

**Steps:**
- [ ] Hoist the interval into a variable and clear it on destroy:

```ts
let pollTimer: ReturnType<typeof setInterval> | null = null;
// in generateSuggestions:
pollTimer = setInterval(async () => { ... if (done) { clearInterval(pollTimer!); pollTimer = null; } ... }, 5000);
// add near other component lifecycle:
import { onDestroy } from 'svelte';
onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
```

- [ ] Commit: `fix(web): clear the trip-suggestion poll on navigation away`

---

## Workstream 4 — Security & privacy hardening (Issue D → PR — DISCREET)

Public issue/PR text stays generic: "Hardening pass: constrain outbound fetch targets, tighten database function permissions, validate auth redirects, and set safer defaults." No mechanics, no endpoint names beyond the diff.

### Task 4.1: lock down SECURITY DEFINER function EXECUTE rights

**Files:**
- Modify: `fluxbase/schema/public.sql` (a new hardening block near the existing revokes at :7433, :7444)

**Steps:**
- [ ] Grep all `SECURITY DEFINER` functions; for each helper not called by name from client code, add `REVOKE EXECUTE ON FUNCTION <fn>(<argtypes>) FROM PUBLIC;`. For the few the web client does call, `REVOKE ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated;`.
- [ ] Add the blanket guard for future functions: `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`
- [ ] Functions to cover (verify each against callers before deciding grant-back): `can_see_gps`, `can_see_trip`, `can_see_plan`, `is_discoverable_to`, `find_similar_users_by_preference`, `is_user_admin`, `get_user_tracking_data`, `get_user_preferences`, `get_public_activity_track`, `full_country`, `privacy_zones`, `get_shared_trip`, `is_trip_owner`, `request_user_profile`.
- [ ] Commit: `fix(schema): default-deny function execution, grant per caller`

### Task 4.2: constrain outbound fetch targets

**Files:**
- Create: `fluxbase/functions/_shared/outbound-guard.ts` — `assertPublicHttpUrl(url: string): void` + `fetchPublic(url, init)` wrapper:

```ts
const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const PRIVATE_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('blocked scheme');
  if (PRIVATE_HOSTS.has(url.hostname)) throw new Error('blocked host');
  if (PRIVATE_V4.some((re) => re.test(url.hostname))) throw new Error('blocked host');
  // Resolve and reject private/link-local/loopback addresses (v4 + v6).
  const records = await Deno.resolveDns(url.hostname, 'A').catch(() => []);
  for (const r of records) if (isPrivateIp(r)) throw new Error('blocked address');
  return url;
}

/** fetch that validates each redirect hop and never follows more than 3. */
export async function fetchPublic(raw: string, init?: RequestInit): Promise<Response> {
	let url = await assertPublicHttpUrl(raw);
	for (let hops = 0; hops < 3; hops++) {
		const response = await fetch(url, { ...init, redirect: 'manual' });
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get('location');
		if (!location) return response;
		url = await assertPublicHttpUrl(new URL(location, url).toString());
	}
	throw new Error('Too many redirects');
}
```

- [ ] Use in `functions/link-preview.ts` (replace the bare fetch + `redirect: 'follow'`).
- [ ] `functions/_shared/immich.service.ts`: validate the resolved base URL before each fetch; on non-2xx, return status-code-only error text (delete the 200-char body snippet at `:76-94`).
- [ ] Unit test the guard (node:test, pure parts): private v4 patterns, localhost, bad scheme reject; public host passes (DNS mocked or skipped for literal IPs).
- [ ] Commit: `fix(functions): constrain outbound fetches to public addresses, stop echoing upstream bodies`

### Task 4.3: auth redirect + token-flow tightening

**Files:**
- Modify: `web/src/routes/auth/callback/+page.svelte:103-108`, `web/src/routes/auth/+page.svelte:23-34`

**Steps:**
- [ ] Add a `safeRedirectTarget(raw: string | null): string` helper (allow only empty or single-rooted relative paths — must start with `/` and not `//`), use it before `goto`.
- [ ] Web tests for the helper (allow `/dashboard`, reject `https://evil.tld`, reject `//evil.tld`).
- [ ] Commit: `fix(web): only follow same-origin redirect targets after sign-in`

### Task 4.4: defaults, gates, and comparisons

**Files:**
- Modify: `fluxbase/functions/export-kb-tables.ts` (unauthenticated → admin or delete; header says the trigger is gone — prefer deletion after grep for references)
- Modify: `fluxbase/functions/health.ts` (keep a minimal 200 for the container healthcheck; move DB/env detail behind admin — check `Dockerfile`/`startup.sh` healthcheck expectations first)
- Modify: `fluxbase/functions/owntracks-points.ts:159` (constant-time compare via a small `timingSafeEqualStr` helper)
- Modify: `fluxbase/functions/trips-suggest-image.ts:1006` (log `configured: true`, never key prefixes) + `getPexelsRateLimit` default 0 → non-zero (e.g. 60/hour)
- Modify: `fluxbase/chatbots/wayli-assistant.ts:25-27` (non-zero rate/daily/token budgets, e.g. 20/min, 200/day, 100k tokens/day)
- [ ] One commit: `fix(fluxbase): safer defaults for limits, health detail, and legacy auth compare`
- [ ] Explicitly OUT of scope (recorded in the issue): making the `trip-images` bucket private — it invalidates every stored photo URL and needs a signed-URL rendering migration; track separately.

---

## Workstream 5 — Code health (Issue E → PR)

### Task 5.1: delete the dead legacy rule engine
- [ ] Re-verify zero importers: `grep -rn "lib/rules\|enhanced-transport-mode" web/src web/tests` must return only the files being deleted.
- [ ] `git rm -r web/src/lib/rules web/src/lib/utils/enhanced-transport-mode.ts web/tests/unit/rules/` (~2,300 lines).
- [ ] Prune `web/src/lib/utils/transport-mode.ts` of exports with zero non-test callers (`distinguishCarVsTrain`, `isPhysicallyImpossible`, `isModeSwitchPossible`, `analyzeModeHistory`, `analyzeMeasurementFrequency`, `calculateRollingAverageSpeed`, `calculateSignificantDistance`, `isStationaryVenue`, `isAtVenue`, `getSpeedBracket`), deleting the test blocks in `transport-mode.test.ts` that only cover them. Keep the geocode helpers the HMM uses.
- [ ] Full `bun run test` → PASS. Commit: `chore(web): remove the unused legacy transport-mode rule engine`

### Task 5.2: repo cruft sweep
- [ ] `git rm web/static/messages/{new_keys.txt,translate.py,translate_new_keys.py,translate_new_keys.mjs,en.snapshot.json}` + gitignore `web/static/messages/new_keys.txt`.
- [ ] Strip `// /Users/bart/...` first-line headers across web/src + fluxbase (mechanical; prettier after).
- [ ] After per-file grep verification, delete zero-reference components: `RegisterToComment.svelte`, `VisibilityToggle.svelte`, `TripTimeline.svelte` (NOTE: audit flagged TripTimeline as dead — double-check `{@html}` finding reference then delete), `RealtimeConnectionStatus.svelte`, `ui/language-switcher.svelte`.
- [ ] Remove the 9 unused ESLint devDependencies + `web/eslint.config.js` + the renovate eslint exception.
- [ ] Commit: `chore: remove translation scratch files, dead components, and the unused eslint toolchain`

### Task 5.3: Android date-helper dedup
- [ ] `EntryEditorScreen.kt:1151-1164` (`formatFriendlyDate`, `parseDateMillis`, `millisToIsoDate`) → reuse `core/.../designsystem/DateText.kt` + `core/.../util/IsoDates.kt`.
- [ ] `./gradlew :app:compileGplayDebugKotlin :app:testGplayDebugUnitTest` → PASS. Commit: `refactor(android): reuse core date helpers in the entry editor`

---

## Workstream 6 — UX quick wins (Issue F → PR)

### Task 6.1: Android stats mode colors
- [ ] `StatsScreen.kt:326-334` `modeColor()` → delegate to `TransportModeColors.forMode(mode)` (all 9 modes + unknown).
- [ ] Compile + unit tests. Commit: `fix(android): use the canonical mode palette on the stats screen`

### Task 6.2: locale correctness batch (web)
- [ ] `web/src/app.html:2`: `lang="%paraglide.lang%"` → `lang="en"` (runtime already corrects it; the placeholder is dead — Paraglide was removed, `hooks.ts:1`).
- [ ] Add the 4 missing keys (`transport.running`, `statistics.running`, `connections.immich.pickerCacheHint`, `connections.immich.pickerCached`) to all 10 non-English locales (translations supplied in-task; fluent speakers review later).
- [ ] Add a CI-side key-parity vitest: flatten `en.json`, assert every locale superset-of/equals key set (new file `web/tests/unit/i18n-parity.test.ts`).
- [ ] Commit: `fix(web): valid html lang, complete locale key parity`

### Task 6.3: travel page i18n sweep (the visible strings)
- [ ] Route the hardcoded strings through `t()` with new `travel.*` keys: section headers ("Where I've Been", "New Trip", "Auto-detect Trips", "Refresh All", "Detect new trips…"), filter chips, entry editor labels ("Edit Entry"/"New Entry", "Date range", "Save Draft", "Cancel"), pagination ("Page X of Y" — parameterized), aria-labels (:1437, :1454).
- [ ] Add the keys to en.json (+ the 10 locales for the short ones).
- [ ] Full web suite + `bun run check` → PASS. Commit: `fix(web): translate the remaining hardcoded travel-page strings`

### Task 6.4: fitness list pagination
- [ ] Replace the `.range(0, 199)` cap with "Load more" pagination keyed on `started_at` (monthly grouping already exists), plus a total-count label.
- [ ] Commit: `fix(web): page the fitness activity list instead of silently capping at 200`

---

## Issue G (tracking only — NOT in this plan's scope)

Feature opportunities recorded as one tracking issue, no implementation: journal search UI over the existing unused `search-journal-entries` RPC; server-side notification producers (table + read UIs exist, zero writers); friends-level trip visibility; web `/dashboard/stats` route + CSV export; Android Immich connection form + multi-day entries; `trip-images` signed-URL migration (design needed).

## Execution Order

1 → 2 → 3 → 4 → 5 → 6. Workstream 2 lands early so the drift guard and fluxbase CI backstop everything after it. Each workstream is an independent PR; merge order = execution order to keep rebase conflicts nil (they touch disjoint files).
