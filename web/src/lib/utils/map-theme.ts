/**
 * Watch the documentElement's class list for dark/light theme changes and
 * swap a Leaflet map's basemap layer accordingly.
 *
 * Usage:
 *   const cleanup = watchMapTheme(map, createBasemapLayer);
 *   // later, on unmount:
 *   cleanup();
 *
 * The factory is called once on mount and again whenever the theme flips.
 * Returns a cleanup function that disconnects the MutationObserver.
 *
 * ponytail: this is the smallest reliable cross-component pattern — one
 * MutationObserver per map, no shared state, no Svelte stores. Each map
 * owns its basemap layer; we just notify it when the theme changes.
 */

import 'maplibre-gl/dist/maplibre-gl.css';
import type * as L from 'leaflet';
// maplibre-gl locates its web worker relative to import.meta.url — which
// breaks once a bundler moves or renames the module (Vite's dev pre-bundle
// hashes the filename, the production build inlines the logic into a
// chunk). The worker then 404s silently: no style, no tiles, no error
// event. Import the worker through Vite's ?worker&url query so the bundler
// emits it (with its maplibre-gl-shared.mjs dependency) as a real file and
// hand the URL to maplibre via its public setter before the first map.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export function isDarkMode(): boolean {
	if (typeof document === 'undefined') return false;
	return document.documentElement.classList.contains('dark');
}

export type TileTheme = 'light' | 'dark';

/**
 * OpenFreeMap vector styles (https://openfreemap.org) — free for
 * production use, no API key, no rate limits. Positron/Dark keep the same
 * minimal look as the CartoDB light_all/dark_all tiles they replace (those
 * now require an API key and render an "API KEY REQUIRED" watermark).
 * Centralised here so the attribution stays consistent across maps.
 */
export const OFM_STYLE_URLS: Record<TileTheme, string> = {
	light: 'https://tiles.openfreemap.org/styles/positron',
	dark: 'https://tiles.openfreemap.org/styles/dark'
};

/** Attribution required by OpenFreeMap's terms of use. */
export const MAP_ATTRIBUTION =
	'&copy; OpenFreeMap &copy; OpenMapTiles — data from OpenStreetMap contributors';

/**
 * Build the basemap layer: the OpenFreeMap vector style rendered through
 * MapLibre GL, bridged into Leaflet's tilePane by the official
 * @maplibre/maplibre-gl-leaflet plugin. All Leaflet overlays (markers,
 * clusters, heat layers, polylines) render on top unchanged.
 *
 * Async on purpose — maplibre-gl is heavy (~250 kB gzipped) and only map
 * pages should pay for it; the dynamic import keeps it out of every other
 * chunk.
 */
export async function createBasemapLayer(theme: TileTheme): Promise<L.Layer> {
	const [{ maplibreGL }, { setWorkerUrl }] = await Promise.all([
		import('@maplibre/maplibre-gl-leaflet'),
		import('maplibre-gl')
	]);
	setWorkerUrl(maplibreWorkerUrl);
	return maplibreGL({
		style: OFM_STYLE_URLS[theme],
		// The bridge disables the GL map's own attribution control and
		// forwards this string to Leaflet's attribution control instead.
		attributionControl: { customAttribution: MAP_ATTRIBUTION }
	});
}

/**
 * Watch theme changes and rebuild the basemap on the given map.
 *
 * @param map The Leaflet map instance.
 * @param buildLayer Called with the current theme; must return a new
 *   `L.Layer` (not yet added to the map — we add it). May return a promise
 *   — the OpenFreeMap layer lazy-loads maplibre-gl. Called once immediately
 *   for the initial theme, then again on every theme flip.
 * @returns Cleanup function — call on component destroy to detach the
 *   observer.
 */
export function watchMapTheme(
	map: L.Map,
	buildLayer: (theme: TileTheme) => L.Layer | Promise<L.Layer>
): () => void {
	let currentLayer: L.Layer | null = null;
	let currentTheme: TileTheme | null = null;
	// Tokens out stale loads: a layer that resolves after the theme flipped
	// again (or the map was torn down) must never be added.
	let loadToken = 0;
	// Captured so the returned cleanup can cancel it. The dashboard layout
	// destroys the page DOM on navigation ({#key page.url.pathname}); an armed
	// invalidateSize() firing against a detached map triggers Leaflet's
	// unguarded parentNode loops → "can't access property parentNode".
	let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;
	let sizeObserver: ResizeObserver | null = null;

	const apply = () => {
		// Guard: a theme-mutation (e.g. a Svelte transition toggling classes on
		// <html>) can fire after the owning page has torn the map down. Bail
		// before touching a detached container. `_loaded === false` is set by
		// map.remove(); checking it covers the gap before cleanup runs.
		if (disposed || !map || (map as any)._loaded === false) return;
		const theme: TileTheme = isDarkMode() ? 'dark' : 'light';
		// Only rebuild if the theme actually changed — prevents unnecessary
		// layer loads when the MutationObserver fires for unrelated class
		// changes (e.g. Svelte adding/removing transition classes).
		if (theme === currentTheme) return;
		const token = ++loadToken;
		// The basemap loads asynchronously (dynamic import, then the style
		// fetch inside the GL map). Keep the previous layer until the
		// replacement is ready so a slow load never leaves a blank map.
		Promise.resolve()
			.then(() => buildLayer(theme))
			.then((next) => {
				if (disposed || token !== loadToken || !map || (map as any)._loaded === false) return;
				// Guard: a map initialized on a zero-size container has a NaN
				// center — the GL layer would throw "Invalid LatLng (NaN, NaN)"
				// (the production Travel-page crash). Skip; the size watcher
				// below retries once the container has real dimensions.
				const size = map.getSize();
				if (size.x === 0 || size.y === 0) return;
				const previous = currentLayer;
				currentLayer = next;
				currentTheme = theme;
				next.addTo(map);
				try {
					previous?.remove();
				} catch {
					// previous layer may be partially initialized
				}
				// Invalidate size after swap so Leaflet recalculates the visible
				// tile range. Without this, layers sometimes don't render on maps
				// inside {#key} blocks or collapsed sections.
				if (invalidateTimer) clearTimeout(invalidateTimer);
				invalidateTimer = setTimeout(() => {
					invalidateTimer = null;
					try {
						map.invalidateSize();
					} catch {
						// map may have been removed
					}
				}, 100);
			})
			.catch((err) => console.error('[map-theme] failed to load basemap layer:', err));
	};

	apply();

	const observer = new MutationObserver(apply);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class']
	});

	// Retry when the map container gains real dimensions: a basemap add that
	// was skipped (zero-size guard above) needs to run once layout settles —
	// e.g. a trip card expanding on the Travel page.
	const container = map.getContainer();
	if (typeof ResizeObserver !== 'undefined' && container) {
		sizeObserver = new ResizeObserver(() => {
			if (disposed || !currentLayer) apply();
		});
		sizeObserver.observe(container);
	}

	return () => {
		disposed = true;
		// Drop any in-flight layer load as well.
		loadToken++;
		observer.disconnect();
		sizeObserver?.disconnect();
		if (invalidateTimer) {
			clearTimeout(invalidateTimer);
			invalidateTimer = null;
		}
		if (currentLayer) {
			// The maplibre-gl layer's onRemove accesses this._glMap — if the
			// GL context was lost or never fully initialized (async style
			// loading vs fast unmount), remove() throws and breaks the
			// teardown chain. Guard so the rest of the cleanup still runs.
			try {
				currentLayer.remove();
			} catch {
				// Layer was never fully attached — safe to skip.
			}
			currentLayer = null;
		}
	};
}
