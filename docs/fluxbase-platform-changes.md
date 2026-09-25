# Proposed Fluxbase platform changes (from the 2026-09-24 Wayli review)

Wayli-side fixes for everything found in the review have landed on
`fix/code-review-findings`. The items below are platform-side improvements in
`~/Dev/fluxbase` that would harden or simplify what Wayli had to work around.
Nothing here blocks the Wayli branch — each item names the workaround currently
in place.

## 1. Enforce per-user scoping when a chatbot→KB link is `filtered`

Wayli now stamps `metadata.user_id` on every KB document it ingests
(`sync-poi-embeddings.ts`) and relies on retrieval filtering by caller. That
filter is **best-effort today**: it activates when `opts.UserID != nil` OR the
link is `filtered`, but documents *without* a `user_id` key remain visible to
everyone (`IncludeGlobal` semantics).

- `internal/ai/kb_storage_search.go:1020-1038` — when
  `link.AccessLevel == "filtered"`, require `opts.UserID != nil` and drop the
  `IncludeGlobal` OR-clauses instead of treating them as opt-in.
- Same predicate in `SearchChunksWithFilter` (`:879-888`) and `searchHybrid`
  (`:231-240`) must stay consistent.

**Workaround in place:** all Wayli docs carry `user_id`; the boot-time
`kb export-table` (which produced unscoped docs) was removed.

## 2. Default chatbot→KB links to `filtered`

`internal/ai/kb_storage.go:425` creates links with `AccessLevel: "full"`. A
`filtered` default (with `full` as an explicit opt-in) would make the safe
behavior automatic for every tenant, not just careful ones.

## 3. `kb export-table` per-user metadata support

`internal/ai/table_exporter.go:92-123` writes only table-shape metadata. If
table export is meant to coexist with multi-user data, support mapping a column
(e.g. `user_id`) into document metadata during export. Until then Wayli avoids
`export-table` for user data entirely.

## 4. `install-cli.sh` should verify checksums

Releases already publish `.sha256` sidecars for every artifact
(`.github/workflows/release.yml:878-972`), but `install-cli.sh` never checks
them. Add `sha256sum -c` after download. Wayli's Dockerfile now does the
download+verify inline and no longer pipes the script from `main`, so this is
about protecting the script's other users.

## 5. URL query grammar: `between` / negated groups

`not.between` is not part of the URL filter grammar; the `not.` prefix recurses
one level and any unknown nested operator silently degrades to `col = $1`
(`internal/api/query_parser_sql.go:423-475`, default branch `:583-586`). That
silent-degrade is the dangerous part — Wayli's trip detection
accidentally matched **all rows** instead of none.

Options (either is fine, silent-wrong is the thing to fix):
- Add `between` (+ `not.between`) to the operator set, or
- Make the `not.` expansion **fail loudly** on an unknown nested operator.

Wayli rewrote its query with supported `or=(and(gte,lte),...)` composition
(`trip-detection.service.ts`), so this is now a robustness ask.

## 6. Multi-statement RPC scripts fail sync with a clear message

`internal/rpc/validator.go:157-196` rejects multi-statement scripts ("Multiple
SQL statements not allowed"). Good behavior — worth a line in the RPC docs
(`docs/src/content/docs/guides/rpc.md`) since Wayli initially assumed raw
scripts were allowed. Consider also documenting that un-annotated procedures
are callable by **any authenticated user** (validator.go:271-297) — that
default surprised us.

## 7. Turnkey app-user self-service deletion (optional)

`auth.users` has no self-delete endpoint (only dashboard accounts have
`DELETE /dashboard/auth/account`, which is a soft delete). Wayli ships an
authenticated edge function (`delete-account.ts`) that cleans storage + KB +
residual rows and then calls `DELETE /api/v1/admin/users/:id?type=app` via the
service client. A first-party `DELETE /api/v1/auth/account` (hard delete,
honoring tenant FK cascades) would save every BaaS consumer from reimplementing
this — Play/Apple both require the capability.

## 8. Minor: admin delete cascading documentation

The FK cascades that make user deletion work live in the *tenant's* declarative
schema (`REFERENCES auth.users ON DELETE CASCADE`), not in Fluxbase migrations.
Worth stating in the admin-users docs so tenants know deletion completeness is
their schema's responsibility (Wayli's declarative schema carries them; tables
without the FK — notifications, user_connections, visited_countries,
trip_shares received, comments/likes on others' content — need explicit
cleanup, which Wayli's function now does).
