//
// Pure statistics computations for the Location Data page. Every function here
// takes the already-processed tracker points (the `rawDataPoints` array the
// statistics service builds) and returns a derived structure — no I/O, no DOM,
// fully unit-testable. The page component consumes these for the new charts
// and summary widgets.

export interface ProcessedPoint {
	recorded_at: string;
	lat: number | null;
	lon: number | null;
	speed?: number | null; // km/h (DB speed column)
	velocity?: number; // km/h (computed fallback)
	distance?: number | null; // meters from previous point
	time_spent?: number | null; // seconds from previous point
	transport_mode?: string;
	country_code?: string | null;
	accuracy?: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(iso: string): Date {
	return new Date(iso);
}

function dayKey(d: Date): string {
	// Local YYYY-MM-DD — we want the user's calendar day, not UTC.
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** km/h on a point, preferring the DB speed, then the computed velocity. */
export function pointSpeed(p: ProcessedPoint): number {
	return p.speed ?? p.velocity ?? 0;
}

// ─── Activity calendar ──────────────────────────────────────────────────────

export interface CalendarDay {
	date: string; // YYYY-MM-DD
	distance: number; // meters
	movingTime: number; // seconds
	points: number;
}

/**
 * Aggregate points into per-local-day buckets for the GitHub-style activity
 * calendar. `days` controls how far back from the last point to render (empty
 * days are filled with zero so the calendar grid is complete). Distance and
 * moving time come from each point's `distance`/`time_spent` (already
 * pre-filtered for continuous movement upstream).
 */
export function activityCalendar(
	points: ProcessedPoint[],
	days = 365,
	opts: { anchorToday?: boolean } = {}
): CalendarDay[] {
	if (points.length === 0) return [];
	const anchorToday = opts.anchorToday ?? true;

	const sorted = [...points].sort(
		(a, b) => toDate(a.recorded_at).getTime() - toDate(b.recorded_at).getTime()
	);

	// Anchor the window. When anchorToday is true (the default for the calendar
	// widget), the grid ALWAYS spans [today − days+1, today] so it fills the
	// full grid regardless of which days have data — like GitHub's graph.
	// When false, the window is anchored to the data (earliest→latest point),
	// matching the historical behaviour.
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const last = anchorToday ? today : toDate(sorted[sorted.length - 1].recorded_at);
	const end = new Date(last);
	end.setHours(0, 0, 0, 0);
	const start = new Date(end.getTime() - (days - 1) * MS_PER_DAY);

	const byDay = new Map<string, CalendarDay>();
	const cursor = new Date(start);
	cursor.setHours(0, 0, 0, 0);
	const endDay = dayKey(end);

	// Seed zero buckets across the whole span.
	while (dayKey(cursor) <= endDay) {
		const k = dayKey(cursor);
		byDay.set(k, { date: k, distance: 0, movingTime: 0, points: 0 });
		cursor.setDate(cursor.getDate() + 1);
	}

	for (const p of sorted) {
		const k = dayKey(toDate(p.recorded_at));
		const bucket = byDay.get(k);
		if (!bucket) continue;
		bucket.distance += p.distance ?? 0;
		bucket.movingTime += p.time_spent ?? 0;
		bucket.points += 1;
	}

	return Array.from(byDay.values());
}

// ─── Time-of-day distribution ───────────────────────────────────────────────

export interface HourBucket {
	hour: number; // 0-23
	points: number;
	distance: number; // meters
}

/**
 * Bucket points by local hour-of-day to reveal activity patterns (commute
 * peaks, evening walks). Useful for the radial chart.
 */
export function timeOfDayDistribution(points: ProcessedPoint[]): HourBucket[] {
	const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
		hour: h,
		points: 0,
		distance: 0
	}));
	for (const p of points) {
		const h = toDate(p.recorded_at).getHours();
		buckets[h].points += 1;
		buckets[h].distance += p.distance ?? 0;
	}
	return buckets;
}

// ─── Speed distribution ─────────────────────────────────────────────────────

export interface SpeedBucket {
	label: string;
	min: number; // km/h inclusive
	max: number; // km/h exclusive
	count: number;
	dominantMode: string | null;
}

const DEFAULT_SPEED_BINS: Array<{ label: string; min: number; max: number }> = [
	{ label: '0 (still)', min: 0, max: 1 },
	{ label: '1–5', min: 1, max: 5 },
	{ label: '5–10', min: 5, max: 10 },
	{ label: '10–25', min: 10, max: 25 },
	{ label: '25–50', min: 25, max: 50 },
	{ label: '50–90', min: 50, max: 90 },
	{ label: '90–130', min: 90, max: 130 },
	{ label: '130–200', min: 130, max: 200 },
	{ label: '200+', min: 200, max: Infinity }
];

/** Histogram of speeds with the dominant transport mode per bucket. */
export function speedDistribution(
	points: ProcessedPoint[],
	bins: Array<{ label: string; min: number; max: number }> = DEFAULT_SPEED_BINS
): SpeedBucket[] {
	const buckets: SpeedBucket[] = bins.map((b) => ({ ...b, count: 0, dominantMode: null }));
	const modeTally: Array<Map<string, number>> = bins.map(() => new Map());

	for (const p of points) {
		const speed = pointSpeed(p);
		for (let i = 0; i < buckets.length; i++) {
			if (speed >= buckets[i].min && speed < buckets[i].max) {
				buckets[i].count += 1;
				const mode = p.transport_mode ?? 'unknown';
				modeTally[i].set(mode, (modeTally[i].get(mode) ?? 0) + 1);
				break;
			}
		}
	}

	for (let i = 0; i < buckets.length; i++) {
		let best: string | null = null;
		let bestN = 0;
		for (const [mode, n] of modeTally[i]) {
			if (n > bestN) {
				bestN = n;
				best = mode;
			}
		}
		buckets[i].dominantMode = best;
	}
	return buckets;
}

// ─── Records & streaks ──────────────────────────────────────────────────────

export interface RecordsAndStreaks {
	longestDayDistance: { date: string; distance: number } | null; // meters
	longestStreak: number; // consecutive days with ≥1 point
	currentStreak: number; // consecutive days up to the last point
	busiestDay: { date: string; points: number } | null;
	totalDaysTracked: number;
}

/**
 * Compute personal records and tracking streaks from the calendar buckets.
 */
export function recordsAndStreaks(points: ProcessedPoint[]): RecordsAndStreaks {
	if (points.length === 0) {
		return {
			longestDayDistance: null,
			longestStreak: 0,
			currentStreak: 0,
			busiestDay: null,
			totalDaysTracked: 0
		};
	}

	const calendar = activityCalendar(points, 365 * 5);
	let longestDayDistance: RecordsAndStreaks['longestDayDistance'] = null;
	let busiestDay: RecordsAndStreaks['busiestDay'] = null;
	let totalDaysTracked = 0;

	for (const day of calendar) {
		if (day.points > 0) totalDaysTracked += 1;
		if (!longestDayDistance || day.distance > longestDayDistance.distance) {
			longestDayDistance = { date: day.date, distance: day.distance };
		}
		if (!busiestDay || day.points > busiestDay.points) {
			busiestDay = { date: day.date, points: day.points };
		}
	}

	// Streaks over days that have at least one point.
	let longestStreak = 0;
	let currentRun = 0;
	let currentStreak = 0;
	let prevDate: Date | null = null;
	const sortedDays = calendar
		.filter((d) => d.points > 0)
		.sort((a, b) => a.date.localeCompare(b.date));

	for (const day of sortedDays) {
		const d = new Date(day.date + 'T00:00:00');
		if (prevDate) {
			const gap = Math.round((d.getTime() - prevDate.getTime()) / MS_PER_DAY);
			if (gap === 1) {
				currentRun += 1;
			} else {
				currentRun = 1;
			}
		} else {
			currentRun = 1;
		}
		longestStreak = Math.max(longestStreak, currentRun);
		prevDate = d;
	}
	currentStreak = currentRun;

	return {
		longestDayDistance,
		longestStreak,
		currentStreak,
		busiestDay,
		totalDaysTracked
	};
}

// ─── Period-over-period delta ───────────────────────────────────────────────

export interface PeriodTotals {
	totalDistance: number; // meters
	movingTime: number; // seconds
	points: number;
}

/**
 * Sum distance / moving time / points. Used to compute the previous-period
 * totals for the ▲/▼ deltas on the stat cards.
 */
export function periodTotals(points: ProcessedPoint[]): PeriodTotals {
	let totalDistance = 0;
	let movingTime = 0;
	let count = 0;
	for (const p of points) {
		totalDistance += p.distance ?? 0;
		movingTime += p.time_spent ?? 0;
		count += 1;
	}
	return { totalDistance, movingTime, points: count };
}

/**
 * Percentage change from `prev` to `curr` for a given numeric field. Returns
 * null when prev is 0 (avoids div-by-zero / misleading +∞).
 */
export function percentDelta(prev: number, curr: number): number | null {
	if (prev === 0) return null;
	return ((curr - prev) / prev) * 100;
}
