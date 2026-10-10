import { describe, test, expect } from 'vitest';
import {
	activityCalendar,
	timeOfDayDistribution,
	speedDistribution,
	recordsAndStreaks,
	periodTotals,
	percentDelta,
	type ProcessedPoint
} from './aggregate';

function pt(day: string, hour: number, opts: Partial<ProcessedPoint> = {}): ProcessedPoint {
	// day = 'YYYY-MM-DD'
	return {
		recorded_at: `${day}T${String(hour).padStart(2, '0')}:00:00`,
		lat: 52,
		lon: 4,
		speed: 0,
		distance: 0,
		time_spent: 0,
		transport_mode: 'stationary',
		country_code: 'NL',
		...opts
	};
}

describe('activityCalendar', () => {
	test('returns empty for no points', () => {
		expect(activityCalendar([])).toEqual([]);
	});

	test('buckets points into local days and sums distance/time', () => {
		const points = [
			pt('2026-03-01', 9, { distance: 1000, time_spent: 300 }),
			pt('2026-03-01', 18, { distance: 500, time_spent: 120 }),
			pt('2026-03-03', 9, { distance: 2000, time_spent: 600 })
		];
		// anchorToday:false keeps the historical data-anchored window so the
		// fixed-date assertions below remain stable.
		const cal = activityCalendar(points, 10, { anchorToday: false });
		const byDate = new Map(cal.map((d) => [d.date, d]));
		expect(byDate.get('2026-03-01')?.distance).toBe(1500);
		expect(byDate.get('2026-03-01')?.points).toBe(2);
		expect(byDate.get('2026-03-01')?.movingTime).toBe(420);
		expect(byDate.get('2026-03-02')?.points).toBe(0); // seeded empty
		expect(byDate.get('2026-03-03')?.distance).toBe(2000);
	});

	test('respects the days span (data-anchored)', () => {
		const points = [pt('2026-03-10', 9)];
		const cal = activityCalendar(points, 5, { anchorToday: false });
		expect(cal.length).toBe(5);
		expect(cal[0].date).toBe('2026-03-06');
		expect(cal[4].date).toBe('2026-03-10');
	});

	test('anchorToday always spans [today-days+1, today] regardless of data', () => {
		// A point from yesterday: the window ends at today and spans the
		// requested days, with empty cells for the days without data.
		const yesterday = new Date();
		yesterday.setHours(0, 0, 0, 0);
		yesterday.setDate(yesterday.getDate() - 1);
		const ymd = (d: Date) => {
			const y = d.getFullYear();
			const m = String(d.getMonth() + 1).padStart(2, '0');
			const dd = String(d.getDate()).padStart(2, '0');
			return `${y}-${m}-${dd}`;
		};
		const points: ProcessedPoint[] = [
			{ recorded_at: `${ymd(yesterday)}T09:00:00`, lat: 52, lon: 4, distance: 100, time_spent: 60 }
		];
		const cal = activityCalendar(points, 10, { anchorToday: true });
		expect(cal.length).toBe(10);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		// Last cell is today.
		expect(cal[cal.length - 1].date).toBe(ymd(today));
		// Yesterday's cell has the data; today's is empty.
		expect(cal.find((d) => d.date === ymd(yesterday))?.points).toBe(1);
		expect(cal[cal.length - 1].points).toBe(0);
	});
});

describe('timeOfDayDistribution', () => {
	test('counts points per hour (0-23) with zeroed buckets', () => {
		const points = [
			pt('2026-03-01', 8),
			pt('2026-03-01', 8),
			pt('2026-03-01', 21, { distance: 500 })
		];
		const dist = timeOfDayDistribution(points);
		expect(dist).toHaveLength(24);
		expect(dist[8].points).toBe(2);
		expect(dist[21].points).toBe(1);
		expect(dist[21].distance).toBe(500);
		expect(dist[3].points).toBe(0); // empty bucket
	});
});

describe('speedDistribution', () => {
	test('bins speeds and finds dominant mode per bucket', () => {
		const points: ProcessedPoint[] = [
			{
				recorded_at: '2026-03-01T09:00:00',
				lat: 52,
				lon: 4,
				speed: 0,
				transport_mode: 'stationary'
			},
			{ recorded_at: '2026-03-01T09:00:10', lat: 52, lon: 4, speed: 5, transport_mode: 'walking' },
			{ recorded_at: '2026-03-01T09:00:20', lat: 52, lon: 4, speed: 6, transport_mode: 'walking' },
			{ recorded_at: '2026-03-01T09:00:30', lat: 52, lon: 4, speed: 70, transport_mode: 'car' }
		];
		const dist = speedDistribution(points);
		expect(dist.find((b) => b.label === '0 (still)')?.count).toBe(1);
		expect(dist.find((b) => b.label === '5–10')?.count).toBe(2);
		expect(dist.find((b) => b.label === '5–10')?.dominantMode).toBe('walking');
		expect(dist.find((b) => b.label === '50–90')?.count).toBe(1);
	});

	test('every point falls into exactly one bin (total preserved)', () => {
		const speeds = [0, 3, 7, 15, 40, 70, 100, 150, 250];
		const points: ProcessedPoint[] = speeds.map((speed, i) => ({
			recorded_at: `2026-03-01T09:0${i}:00`,
			lat: 52,
			lon: 4,
			speed
		}));
		const dist = speedDistribution(points);
		const total = dist.reduce((a, b) => a + b.count, 0);
		expect(total).toBe(speeds.length);
	});
});

describe('recordsAndStreaks', () => {
	test('handles empty input', () => {
		const r = recordsAndStreaks([]);
		expect(r.longestDayDistance).toBeNull();
		expect(r.longestStreak).toBe(0);
		expect(r.currentStreak).toBe(0);
		expect(r.busiestDay).toBeNull();
		expect(r.totalDaysTracked).toBe(0);
	});

	test('finds busiest + longest-distance day + counts tracked days', () => {
		const points = [
			pt('2026-03-01', 9, { distance: 1000 }),
			pt('2026-03-01', 10),
			pt('2026-03-01', 11),
			pt('2026-03-03', 9, { distance: 5000 })
		];
		const r = recordsAndStreaks(points);
		expect(r.busiestDay?.date).toBe('2026-03-01');
		expect(r.busiestDay?.points).toBe(3);
		expect(r.longestDayDistance?.date).toBe('2026-03-03');
		expect(r.longestDayDistance?.distance).toBe(5000);
		expect(r.totalDaysTracked).toBe(2);
	});

	test('computes longest streak across consecutive days', () => {
		// Mar 1,2,3 (streak 3), gap, Mar 5,6 (streak 2)
		const points = [
			pt('2026-03-01', 9),
			pt('2026-03-02', 9),
			pt('2026-03-03', 9),
			pt('2026-03-05', 9),
			pt('2026-03-06', 9)
		];
		const r = recordsAndStreaks(points);
		expect(r.longestStreak).toBe(3);
		// Current streak runs to the last tracked day → 2 (Mar 5,6)
		expect(r.currentStreak).toBe(2);
	});
});

describe('periodTotals + percentDelta', () => {
	test('sums distance, time, count', () => {
		const points = [
			pt('2026-03-01', 9, { distance: 1000, time_spent: 300 }),
			pt('2026-03-01', 10, { distance: 500, time_spent: 120 })
		];
		const t = periodTotals(points);
		expect(t.totalDistance).toBe(1500);
		expect(t.movingTime).toBe(420);
		expect(t.points).toBe(2);
	});

	test('percentDelta returns null when prev is 0', () => {
		expect(percentDelta(0, 100)).toBeNull();
	});

	test('percentDelta computes the change', () => {
		expect(percentDelta(100, 150)).toBe(50);
		expect(percentDelta(200, 100)).toBe(-50);
	});
});
