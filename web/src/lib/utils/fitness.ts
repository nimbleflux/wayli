/**
 * Fitness UI helpers: sport visuals, stat formatting and list grouping.
 */

export interface FitnessActivity {
	id: string;
	user_id: string;
	title: string | null;
	description: string | null;
	sport: string | null;
	sub_sport: string | null;
	started_at: string;
	ended_at: string | null;
	total_distance_m: number | null;
	elapsed_time_s: number | null;
	moving_time_s: number | null;
	avg_heartrate: number | null;
	max_heartrate: number | null;
	avg_power: number | null;
	max_power: number | null;
	avg_cadence: number | null;
	calories: number | null;
	manufacturer: string | null;
	product: string | null;
	serial_number: string | null;
	source_file: string | null;
	/** Sharing audience override; NULL inherits the global fitness default */
	visibility: 'private' | 'friends' | 'public' | null;
	created_at: string | null;
}

export interface SportTheme {
	/** Tailwind gradient classes for banners and card accents */
	gradient: string;
	/** Tailwind text color for icons/labels */
	text: string;
	/** Solid hex color for chart lines and map polylines */
	stroke: string;
	/** i18n key under fitness.sport.* */
	labelKey: string;
}

const DEFAULT_THEME: SportTheme = {
	gradient: 'from-slate-500 to-slate-700',
	text: 'text-slate-600 dark:text-slate-300',
	stroke: '#64748b',
	labelKey: 'fitness.sport.generic'
};

const SPORT_THEMES: Record<string, SportTheme> = {
	cycling: {
		gradient: 'from-emerald-500 to-teal-700',
		text: 'text-emerald-600 dark:text-emerald-300',
		stroke: '#10b981',
		labelKey: 'fitness.sport.cycling'
	},
	e_biking: {
		gradient: 'from-emerald-400 to-cyan-600',
		text: 'text-emerald-600 dark:text-emerald-300',
		stroke: '#22d3ee',
		labelKey: 'fitness.sport.e_biking'
	},
	running: {
		gradient: 'from-orange-500 to-red-600',
		text: 'text-orange-600 dark:text-orange-300',
		stroke: '#f97316',
		labelKey: 'fitness.sport.running'
	},
	walking: {
		gradient: 'from-lime-500 to-green-600',
		text: 'text-lime-600 dark:text-lime-300',
		stroke: '#84cc16',
		labelKey: 'fitness.sport.walking'
	},
	hiking: {
		gradient: 'from-amber-500 to-orange-700',
		text: 'text-amber-600 dark:text-amber-300',
		stroke: '#f59e0b',
		labelKey: 'fitness.sport.hiking'
	},
	swimming: {
		gradient: 'from-sky-500 to-blue-700',
		text: 'text-sky-600 dark:text-sky-300',
		stroke: '#0ea5e9',
		labelKey: 'fitness.sport.swimming'
	},
	rowing: {
		gradient: 'from-cyan-500 to-blue-700',
		text: 'text-cyan-600 dark:text-cyan-300',
		stroke: '#06b6d4',
		labelKey: 'fitness.sport.rowing'
	}
};

export function sportTheme(sport: string | null | undefined): SportTheme {
	if (!sport) return DEFAULT_THEME;
	return SPORT_THEMES[sport] ?? DEFAULT_THEME;
}

/** Distance in meters → localized "12.3 km" / "840 m". */
export function formatDistance(meters: number | null | undefined): string {
	if (meters == null) return '—';
	if (meters < 1000) return `${Math.round(meters)} m`;
	return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

/** Seconds → "1:23:45" or "23:45". */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds == null) return '—';
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return h > 0
		? `${h}:${mm}:${String(sec).padStart(2, '0')}`
		: `${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatSpeed(metersPerSecond: number | null | undefined): string {
	if (metersPerSecond == null) return '—';
	return `${(metersPerSecond * 3.6).toFixed(1)}`;
}

/** Group activities into month buckets, newest first. */
export function groupByMonth(
	activities: FitnessActivity[]
): Array<{ label: string; activities: FitnessActivity[] }> {
	const groups = new Map<string, FitnessActivity[]>();
	for (const activity of activities) {
		const d = new Date(activity.started_at);
		const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
		const list = groups.get(label) ?? [];
		list.push(activity);
		groups.set(label, list);
	}
	return Array.from(groups.entries()).map(([label, list]) => ({ label, activities: list }));
}

/**
 * Elevation gain in meters from a chronological altitude series (nulls
 * skipped). Uses a hysteresis threshold so per-sample barometric noise
 * doesn't accumulate: only sustained changes of at least `threshold` meters
 * count, and the anchor only moves once such a change is confirmed.
 */
export function elevationGain(altitudes: Array<number | null | undefined>, threshold = 2): number {
	let gain = 0;
	let anchor: number | null = null;
	for (const alt of altitudes) {
		if (alt == null || Number.isNaN(alt)) continue;
		if (anchor === null) {
			anchor = alt;
			continue;
		}
		const delta = alt - anchor;
		if (Math.abs(delta) >= threshold) {
			if (delta > 0) gain += delta;
			anchor = alt;
		}
	}
	return Math.round(gain);
}

/**
 * Centered moving average over a window of `halfWindow * 2 + 1` samples,
 * skipping nulls. Tames single-sample GPS speed spikes for display purposes.
 */
export function movingAverage(
	values: Array<number | null | undefined>,
	halfWindow: number
): Array<number | null> {
	const result: Array<number | null> = new Array(values.length).fill(null);
	for (let i = 0; i < values.length; i++) {
		let sum = 0;
		let n = 0;
		for (
			let j = Math.max(0, i - halfWindow);
			j <= Math.min(values.length - 1, i + halfWindow);
			j++
		) {
			const v = values[j];
			if (v != null && !Number.isNaN(v)) {
				sum += v;
				n++;
			}
		}
		result[i] = n > 0 ? sum / n : null;
	}
	return result;
}

/**
 * Cumulative distance in meters along a lat/lon track (haversine), used as a
 * fallback x axis when the device reported no per-record distance.
 */
export function cumulativeDistances(points: Array<{ lat: number; lon: number }>): number[] {
	const EARTH_RADIUS_M = 6371000;
	const out: number[] = [];
	let total = 0;
	let prev: { lat: number; lon: number } | null = null;
	for (const p of points) {
		if (prev) {
			const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
			const dLon = ((p.lon - prev.lon) * Math.PI) / 180;
			const lat1 = (prev.lat * Math.PI) / 180;
			const lat2 = (p.lat * Math.PI) / 180;
			const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
			total += 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
		}
		out.push(total);
		prev = p;
	}
	return out;
}

/** A translate function over i18n keys (the pages pass their `t`). */
export type Translate = (key: string) => string;

/**
 * Format a FIT sub_sport slug for display (#221). Known slugs translate via
 * the `fitness.subSport.*` keys; unknown device-specific slugs fall back to
 * the raw slug with underscores replaced by spaces.
 */
export function formatSubSport(slug: string | null | undefined, t: Translate): string {
	if (!slug) return '';
	const label = t(`fitness.subSport.${slug}`);
	if (label !== `fitness.subSport.${slug}`) return label;
	return slug.replace(/_/g, ' ');
}
