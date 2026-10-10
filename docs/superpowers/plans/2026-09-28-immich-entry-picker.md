# Immich Entry Picker — Implementation Plan (issue #13, phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Builds directly on `feat/immich-photos` (PR #225) — the `immich_assets` sync table, `immich-thumb` proxy, and Connections card from phase 1.

**Goal:** Make it convenient to select photos from the user's synced Immich library and attach them to journal entries. Attached photos become normal `trip_media` rows (display-size copies in the existing public-read `trip-images` bucket), so the private trip page, **public trip pages**, and all feed rendering work through the existing media pipeline with zero new auth machinery. Public pages show only what the user explicitly attached — never an automatic date-range dump.

**Design (scope confirmed with product owner):**
1. **Attach = copy display sizes.** Picking a photo fetches its thumbnail + preview through the authenticated `immich-thumb` proxy and uploads the blobs to the `trip-images` bucket. Originals stay in Immich.
2. **Picker: editor modal + trip hint.** A modal in the journal entry editor shows the synced Immich photo grid filtered to the entry's date (adjustable ±range), multi-select, "Add N photos". The private trip page shows a hint when Immich photos taken during the trip's date range are not yet attached, linking to the picker.
3. **EXIF kept.** Attached rows carry `taken_at` from Immich and GPS/city in the `exif` jsonb — consistent with uploaded photos.

## Architecture

- `trip_media` gains two nullable columns: `source text DEFAULT 'upload'` (`'upload' | 'immich'`) and `immich_asset_id text`. No other table changes; `public_trip_media` needs no change (public rendering uses the same storage paths as uploads).
- Attachment pipeline (client-side, reusing existing pieces): `getThumbUrl(assetId, size)` blobs from the authed proxy → upload to `trip-images` bucket → `createMedia({ ..., source: 'immich', immich_asset_id, taken_at, exif: { latitude, longitude }, entry_id })`.
- Uniqueness: one `trip_media` row per (trip, immich_asset_id) — the picker checks the trip's existing media and the trip hint counts only unattached assets.
- `deleteMedia` works unchanged (the copies are bucket files; the Immich original is untouched).
- Rendering: attached rows are indistinguishable from uploads to every consumer (entry blocks, `PhotoGallery`, private page, public page via `public_trip_media`).

## Tasks

### Task 1: schema + trip-media service
- `fluxbase/schema/public.sql`: `trip_media` += `source text DEFAULT 'upload'`, `immich_asset_id text`; index `(user_id, immich_asset_id)` WHERE `immich_asset_id IS NOT NULL`; column comments.
- `web/src/lib/types/media.types.ts`: `source?: 'upload' | 'immich'`, `immich_asset_id?: string | null`.
- `trip-media.service.ts`: `createMedia` accepts/persists the new fields; `listMedia` unchanged.
- Test: none for SQL; service fields verified in Task 3's mocks.

### Task 2: attachment service
- `immich.service.ts` += `attachPhotosToEntry(tripId, entryId, assets: ImmichAssetRow[])`: for each asset → fetch `thumbnail` + `preview` blobs via `getThumbUrl`-style authed proxy calls (reuse but return blobs directly — refactor `getThumbUrl` internals into `fetchThumbBlob`), upload both to the bucket via the same storage path pattern as `uploadMedia`, `createMedia` with `source: 'immich'`. Skips assets already attached (checks the trip's media by `immich_asset_id`).
- Tests: mock proxy fetch + storage upload + createMedia; asserts two uploads per photo, row fields (source/immich_asset_id/taken_at/exif), skip-already-attached, partial failure continues with the rest and reports counts.

### Task 3: `ImmichPhotoPicker.svelte` modal
- Props `{ open, tripId, initialDate }`; grid of `immich_assets` (date-range filter defaulting to the entry date ±3 days, adjustable), multi-select checkboxes, selected count, "Add N photos" → Task 2 pipeline → `dispatch('added', count)` so the travel page refreshes `mediaCache`.
- Test (`tests/components/ImmichPhotoPicker.test.ts`): grid render from mocked service, select/deselect, calls `attachPhotosToEntry`, dispatched event.

### Task 4: entry editor integration + trip hint
- travel/+page.svelte entry editor: "Add from Immich" button next to the existing photo upload (`handleAddPhotos` area, line ~683) → opens the picker with the entry's date; on `added`, refresh `mediaCache` and attach rows to the open entry (`attachMediaToEntry` or `editorInlineMediaIds` for new entries — mirror the existing upload flow).
- Trip hint: after `loadTripMedia`, count `immich_assets` in the trip's date range whose `immich_asset_id` is not among the trip's `trip_media.immich_asset_id` → if > 0, a dismissible banner: "N photos from your Immich library were taken during this trip — add them" → opens the picker at the trip level (attaches without entry_id; user can move them later like uploads).

### Task 5: i18n + final verification
- `travel.immichPicker.*` keys in en.json + translate pipeline.
- Full suite: `bun run test && bun run check && bun run lint`; deno suite untouched.

## Out of scope (documented)
- Automatic public strips (explicitly rejected — public pages show only attached photos).
- Copying originals; Immich album filters; deleting the Immich original on media delete.
