import { describe, expect, test } from 'vitest';
import { pickCurrentTrip } from '$lib/utils/utils';

// Issue #288: the travel page surfaces "the trip the user is on right now" —
// the active trip whose end_date hasn't passed, latest first.

const trip = (overrides: Partial<{ id: string; status: string; end_date: string }> = {}) => ({
	id: overrides.id ?? 't1',
	status: overrides.status ?? 'active',
	end_date: overrides.end_date ?? '2026-11-22'
});

describe('pickCurrentTrip', () => {
	test('returns null when there are no trips', () => {
		expect(pickCurrentTrip([], '2026-11-22')).toBeNull();
	});

	test('returns null when no trip is active', () => {
		expect(pickCurrentTrip([trip({ status: 'completed' })], '2026-11-22')).toBeNull();
	});

	test('returns null when the active trip has already ended', () => {
		expect(pickCurrentTrip([trip({ end_date: '2026-11-21' })], '2026-11-22')).toBeNull();
	});

	test('returns the active trip ending today', () => {
		expect(pickCurrentTrip([trip()], '2026-11-22')?.id).toBe('t1');
	});

	test('returns the active trip with a future end_date', () => {
		expect(pickCurrentTrip([trip({ end_date: '2026-12-01' })], '2026-11-22')?.id).toBe('t1');
	});

	test('prefers the trip ending latest when several are active', () => {
		const current = pickCurrentTrip(
			[
				trip({ id: 'older', end_date: '2026-11-25' }),
				trip({ id: 'newest', end_date: '2026-11-30' }),
				trip({ id: 'oldest', end_date: '2026-11-23' })
			],
			'2026-11-22'
		);
		expect(current?.id).toBe('newest');
	});

	test('ignores planned trips even when they end in the future', () => {
		expect(
			pickCurrentTrip([trip({ status: 'planned', end_date: '2026-12-01' })], '2026-11-22')
		).toBeNull();
	});

	test('defaults today to the current local date', () => {
		const today = new Date();
		const yyyy = today.getFullYear();
		const mm = String(today.getMonth() + 1).padStart(2, '0');
		const dd = String(today.getDate()).padStart(2, '0');
		expect(pickCurrentTrip([trip({ end_date: `${yyyy}-${mm}-${dd}` })])?.id).toBe('t1');
		expect(pickCurrentTrip([trip({ end_date: '2000-01-01' })])).toBeNull();
	});
});
