/**
 * Central settings store.
 *
 * Fetches all `wayli.*` settings in a single bulk request (the Fluxbase batch
 * endpoint supports a `prefix` filter that returns every visible key under a
 * namespace at once, RLS-filtered) and caches them for the lifetime of the
 * page. This replaces the ad-hoc `fluxbase.settings.get('wayli.x')` calls that
 * each fired their own request — and 404'd when the key was unset.
 *
 * Visibility is enforced server-side by RLS: anonymous callers only receive
 * `is_public` rows; authenticated callers receive non-secret rows. The store
 * simply surfaces whatever the server returned, so it never leaks settings the
 * caller isn't allowed to see.
 *
 * `loadPublicSettings()` is idempotent and safe to call from multiple places
 * (e.g. the root layout fires it once on mount); the first call wins and later
 * callers await the same promise.
 */

import { fluxbase } from '$lib/fluxbase';
import { browser } from '$app/environment';

// The namespace this app reads. All Wayli settings live under `wayli.*`.
const SETTING_PREFIX = 'wayli.';

// Known public settings keys — used as a fallback when the server doesn't
// support the `prefix` option on the batch endpoint (Fluxbase < 2026.8.4).
const PUBLIC_KEYS = [
	'wayli.community_enabled',
	'wayli.landing_redirect_username',
	'wayli.is_setup_complete',
	'wayli.public_trips_require_auth',
	'wayli.server_name',
	'wayli.pexels_rate_limit',
	'wayli.pelias_endpoint',
	'wayli.valhalla_endpoint',
	'wayli.immich_enabled',
	'wayli.immich_endpoint',
	'wayli.ai.daily_request_limit',
	'wayli.ai.daily_token_budget'
];

// Reactive cache. `null` = not loaded yet; `Record<string, unknown>` once
// populated (possibly empty if the caller can't see any keys). `loading` tracks
// the in-flight fetch so concurrent callers share one request.
const settingsState = $state<{
	values: Record<string, unknown> | null;
	loading: boolean;
}>({
	values: null,
	loading: false
});

let loadPromise: Promise<void> | null = null;

/**
 * Fetch all visible `wayli.*` settings once and cache them.
 *
 * Uses the namespace `prefix` fetch (one request, no key list needed, silently
 * drops keys the caller can't read — no per-key 404s). Requires Fluxbase SDK
 * ≥ 2026.8.3 (the `prefix` option on `getMany`).
 */
export async function loadPublicSettings(force = false): Promise<void> {
	if (!browser) return;

	// Already loaded (and not forced) — nothing to do.
	if (!force && settingsState.values !== null) return;
	// Already in flight — piggyback on the existing request.
	if (loadPromise && !force) return loadPromise;

	settingsState.loading = true;
	loadPromise = (async () => {
		try {
			// Try the prefix fetch first (requires Fluxbase server ≥ 2026.8.4).
			// Pass a non-empty keys array so older servers that don't support
			// prefix don't reject with "keys is required".
			const result = await fluxbase.settings.getMany(PUBLIC_KEYS, { prefix: SETTING_PREFIX });
			settingsState.values = result ?? {};
		} catch {
			// Fallback: explicit key list (works on all server versions).
			try {
				const result = await fluxbase.settings.getMany(PUBLIC_KEYS);
				settingsState.values = result ?? {};
			} catch {
				// Network/auth error — cache an empty map so callers get
				// fallbacks rather than re-fetching on every read.
				settingsState.values = {};
			}
		} finally {
			settingsState.loading = false;
		}
	})();

	return loadPromise;
}

/**
 * Read a cached setting value. Returns `fallback` when the key is absent
 * (unset, or not visible to this caller). Call `loadPublicSettings()` first
 * (the root layout does this on mount).
 */
export function getSetting<T = unknown>(key: string, fallback: T): T {
	const v = settingsState.values?.[key];
	return v === undefined ? fallback : (v as T);
}

/** True once the initial bulk fetch has completed (success or failure). */
export function settingsReady(): boolean {
	return settingsState.values !== null;
}

/** Reactive access to the whole settings map (for `$derived` consumers). */
export function allSettings(): Record<string, unknown> | null {
	return settingsState.values;
}
