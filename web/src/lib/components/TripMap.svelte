<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { watchMapTheme, createBasemapLayer } from '$lib/utils/map-theme';
	import { MAP_COLORS } from '$lib/utils/colors';
	import type { Map as LeafletMap } from 'leaflet';

	type Props = {
		points: Array<{ lat: number; lng: number }>;
		/**
		 * Pre-snapped route segments (decoded trips.metadata.routeShape). When
		 * non-empty these replace `points` for the main track — each segment
		 * is its own polyline so gaps (privacy-zone crossings) are never
		 * bridged with a straight line.
		 */
		segments?: Array<Array<{ lat: number; lng: number }>>;
		markers?: Array<{ lat: number; lng: number; label: string }>;
		highlightPoints?: Array<{ lat: number; lng: number }>;
		class?: string;
	};

	let {
		points,
		segments = [],
		markers = [],
		highlightPoints = [],
		class: className = 'h-80'
	}: Props = $props();

	let mapContainer: HTMLDivElement;
	let map = $state<LeafletMap | null>(null);
	let L: any = null;
	let mainLayer: any = null;
	let highlightLayer: any = null;
	let cleanupThemeWatcher: (() => void) | null = null;

	let destroyed = false;

	onMount(async () => {
		L = await import('leaflet');

		// Guard: the container may have been removed while Leaflet was loading
		// (async import yields to the microtask queue, allowing unmounts).
		if (!mapContainer || !mapContainer.isConnected) return;

		const mapInstance = L.map(mapContainer, { scrollWheelZoom: true });
		map = mapInstance;
		// ponytail: theme-aware basemap — rebuilds on dark/light toggle
		cleanupThemeWatcher = watchMapTheme(mapInstance, createBasemapLayer);

		mainLayer = L.layerGroup().addTo(map);
		highlightLayer = L.layerGroup().addTo(map);

		setTimeout(() => map?.invalidateSize(), 200);
	});

	// Single effect: redraws everything when any input changes.
	// Reads all reactive values at the top so Svelte tracks them.
	$effect(() => {
		const m = map;
		const pts = points;
		const segs = segments;
		const mkrs = markers;
		const hp = highlightPoints;
		const lib = L;
		const ml = mainLayer;
		const hl = highlightLayer;

		if (!m || !lib || !ml || !hl) return;

		// --- Main layer ---
		ml.clearLayers();

		// Track geometry: snapped segments when provided (one polyline per
		// segment — the gaps between them are privacy-zone crossings and must
		// not be bridged), else the raw points as a single polyline.
		const trackPolylines: any[] = [];
		const trackPoints: Array<{ lat: number; lng: number }> = [];

		if (segs.length > 0) {
			for (const seg of segs) {
				if (seg.length < 2) continue;
				const pl = lib.polyline(
					seg.map((p) => [p.lat, p.lng] as [number, number]),
					{
						color: MAP_COLORS.trackLine,
						weight: 4,
						opacity: 0.6
					}
				);
				pl.addTo(ml);
				trackPolylines.push(pl);
				trackPoints.push(...seg);
			}
		} else if (pts.length > 0 || mkrs.length > 0) {
			const sampled =
				pts.length > 1500 ? pts.filter((_, i) => i % Math.ceil(pts.length / 1500) === 0) : pts;

			if (sampled.length > 1) {
				const latlngs = sampled.map((p) => [p.lat, p.lng] as [number, number]);
				const mainPolyline = lib.polyline(latlngs, {
					color: MAP_COLORS.trackLine,
					weight: 4,
					opacity: 0.6
				});
				mainPolyline.addTo(ml);
				trackPolylines.push(mainPolyline);
			}
			trackPoints.push(...sampled);
		}

		if (trackPoints.length > 0) {
			lib
				.circleMarker([trackPoints[0].lat, trackPoints[0].lng], {
					radius: 5,
					fillColor: MAP_COLORS.startMarker,
					color: '#fff',
					weight: 2,
					fillOpacity: 1
				})
				.addTo(ml);
		}
		if (trackPoints.length > 1) {
			const last = trackPoints[trackPoints.length - 1];
			lib
				.circleMarker([last.lat, last.lng], {
					radius: 5,
					fillColor: MAP_COLORS.endMarker,
					color: '#fff',
					weight: 2,
					fillOpacity: 1
				})
				.addTo(ml);
		}

		for (const marker of mkrs) {
			lib
				.circleMarker([marker.lat, marker.lng], {
					radius: 6,
					fillColor: MAP_COLORS.highlight,
					color: '#fff',
					weight: 2,
					fillOpacity: 0.9
				})
				.bindPopup(marker.label)
				.addTo(ml);
		}

		// --- Highlight layer ---
		hl.clearLayers();

		if (hp.length > 0) {
			const hlatlngs = hp.map((p) => [p.lat, p.lng] as [number, number]);
			lib.polyline(hlatlngs, { color: MAP_COLORS.highlight, weight: 6, opacity: 0.9 }).addTo(hl);

			lib
				.circleMarker(hlatlngs[0], {
					radius: 7,
					fillColor: MAP_COLORS.highlight,
					color: '#fff',
					weight: 2,
					fillOpacity: 1
				})
				.addTo(hl);
			if (hlatlngs.length > 1) {
				lib
					.circleMarker(hlatlngs[hlatlngs.length - 1], {
						radius: 7,
						fillColor: MAP_COLORS.highlight,
						color: '#fff',
						weight: 2,
						fillOpacity: 1
					})
					.addTo(hl);
			}

			m.fitBounds(lib.latLngBounds(hlatlngs), { padding: [50, 50], maxZoom: 14 });
		} else if (trackPolylines.length > 0) {
			// Combined bounds across all track segments/polylines.
			const bounds = lib.latLngBounds(trackPolylines.map((pl: any) => pl.getBounds()));
			if (bounds.isValid()) {
				m.fitBounds(bounds, { padding: [30, 30] });
			}
		} else if (trackPoints.length > 0) {
			// Single point or markers only: center on first point
			m.setView([trackPoints[0].lat, trackPoints[0].lng], 13);
		} else if (mkrs.length > 0) {
			m.setView([mkrs[0].lat, mkrs[0].lng], 3);
		} else {
			m.setView([0, 0], 2);
		}

		// Recompute the map's pixel size. When this component is reused (e.g.
		// the map div is re-parented inside a newly-expanded trip card without a
		// remount), Leaflet keeps a stale 0×0 size and tiles/layers don't lay out
		// even though they were redrawn above. invalidateSize forces a relayout.
		m.invalidateSize();
	});

	onDestroy(() => {
		destroyed = true;
		// Each cleanup step is guarded: a partial init (async Leaflet import,
		// async maplibre-gl style load, WebGL context loss) can make any of
		// them throw. The page must not crash because a map cleanup failed.
		try {
			cleanupThemeWatcher?.();
		} catch {
			// basemap layer was never fully attached
		}
		try {
			map?.remove();
		} catch {
			// map was partially initialized — the GL context is reclaimed
			// by the browser when the container is removed from the DOM.
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</svelte:head>

<div bind:this={mapContainer} class="relative z-0 rounded-lg {className}"></div>
