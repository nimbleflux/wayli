/**
 * Unified color constants — the single source of truth for all non-CSS colors.
 *
 * Before this file existed, transport mode colors were defined inconsistently
 * across multiple pages (location-data vs data-editor used different keys AND
 * different hex values). This module consolidates them into one canonical
 * palette that matches the database's `transport_mode` values
 * (`stationary|walking|cycling|car|train|airplane|boat|swimming`).
 *
 * The web map page imports this palette through
 * `$lib/services/transport-mode/visuals.ts` (which adds icons and picker
 * order); keep it as the single source of truth.
 */

/**
 * Transport mode colors — canonical palette using DB key names.
 *
 * Design criteria:
 * - Distinguishable on both light (CartoDB light_all) and dark (dark_all) map tiles
 * - Avoids red/green-only encoding (accessibility / colorblind consideration)
 * - Sufficient luminance contrast for polyline rendering
 * - `airplane` uses sky blue instead of black (#000 was invisible on dark tiles)
 *
 * Mirrored by the Android app's `TransportModeColors.kt` — update both together.
 */
export const TRANSPORT_MODE_COLORS: Record<string, string> = {
	car: '#dc2626', // red — high energy, visible on dark tiles
	train: '#7c3aed', // purple — distinct from car's red
	airplane: '#0ea5e9', // sky blue — visible on dark tiles (replaces black)
	cycling: '#ea580c', // orange — warm, distinct from walking's green
	walking: '#16a34a', // green — matches --success token
	boat: '#0369a1', // deep teal-blue (#220 water modes)
	swimming: '#06b6d4', // cyan
	stationary: '#2563eb', // blue — low activity, distinct from unknown's grey
	unknown: '#6b7280' // grey — fallback
} as const;

/**
 * Trip plan item category colors.
 *
 * Used for itinerary items in the trip planner and public trip reader.
 * Was previously duplicated verbatim in two files — now shared.
 */
export const PLAN_CATEGORY_COLORS: Record<string, string> = {
	sightseeing: '#3b82f6',
	food: '#f59e0b',
	activity: '#22c55e',
	transport: '#8b5cf6',
	accommodation: '#ec4899',
	rest: '#6b7280',
	shopping: '#14b8a6'
} as const;

/**
 * Map element colors.
 *
 * Previously repeated as inline literals across 8+ files. Centralized here
 * so map components use consistent colors for start/end markers, polylines, etc.
 */
export const MAP_COLORS = {
	startMarker: '#16a34a', // green = start of track
	endMarker: '#dc2626', // red = end of track
	selectedMarker: '#dc2626', // selected point/marker
	trackLine: '#3b82f6', // GPS track polyline
	highlight: '#233869', // Wayli navy — highlight overlay
	homeMarker: '#3b82f6', // home address marker
	visitedCountry: '#3b82f6', // WorldMap visited country fill
	border: '#1d4ed8' // WorldMap border
} as const;

/**
 * Fallback color for unknown/unmatched modes.
 * Convenience constant so we don't repeat the hex literal.
 */
export const UNKNOWN_MODE_COLOR = '#6b7280';
