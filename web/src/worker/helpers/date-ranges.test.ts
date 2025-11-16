// tests/lib/services/queue/helpers/date-ranges.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { findAvailableDateRanges } from './date-ranges';

import type { FluxbaseClient } from '@fluxbase/sdk';
// Minimal env to satisfy config imported by fluxbase worker client
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-cookie-secret';
// Prevent importing the real worker client/config
vi.mock('$lib/shared/worker-fluxbase-client', () => ({ fluxbase: {} as unknown }));

type DateRangesMockOptions = {
	earliest?: string | null;
	latest?: string | null;
	trips?: Array<{ start_date: string; end_date: string }>;
	errorOnEarliest?: boolean;
	errorOnTrips?: boolean;
	throwOnFrom?: boolean;
};

function createMockFluxbase(options: DateRangesMockOptions = {}): FluxbaseClient {
	return {
		from: vi.fn().mockImplementation((table: string) => {
			if (options.throwOnFrom) throw new Error('boom');
			if (table === 'tracker_data') {
				const api: {
					_ascending: boolean;
					select: ReturnType<typeof vi.fn>;
					eq: ReturnType<typeof vi.fn>;
					not: ReturnType<typeof vi.fn>;
					order: ReturnType<typeof vi.fn>;
					limit: ReturnType<typeof vi.fn>;
				} = {
					_ascending: true,
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					not: vi.fn().mockReturnThis(),
					order: vi.fn().mockImplementation((_col: string, opts: { ascending: boolean }) => {
						api._ascending = opts?.ascending ?? true;
						return api;
					})
				};
				api.limit = vi.fn().mockImplementation(async () => {
					if (options.errorOnEarliest && api._ascending) {
						return { data: null, error: { message: 'fail' } };
					}
					const date = api._ascending ? options.earliest : options.latest;
					return { data: date ? [{ recorded_at: date }] : [], error: null };
				});
				return api;
			}
			if (table === 'trips') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockImplementation((field: string) => {
						if (field === 'user_id') {
							return {
								eq: vi.fn().mockResolvedValue({
									data: options.trips ?? [],
									error: options.errorOnTrips ? { message: 'fail' } : null
								})
							};
						}
						// For the first .eq() call (user_id), return an object with another .eq() method
						return {
							eq: vi.fn().mockResolvedValue({
								data: options.trips ?? [],
								error: options.errorOnTrips ? { message: 'fail' } : null
							})
						};
					})
				} as unknown;
			}
			return {} as unknown;
		})
	} as unknown as FluxbaseClient;
}

describe('findAvailableDateRanges', () => {
	let mockClient: FluxbaseClient;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty array when earliest or latest data is missing', async () => {
		mockClient = createMockFluxbase({ earliest: null, latest: null, trips: [] });
		const result = await findAvailableDateRanges('user1', undefined, undefined, mockClient);
		expect(result).toEqual([]);
	});

	it('applies user date constraints correctly', async () => {
		mockClient = createMockFluxbase({ earliest: '2025-01-01', latest: '2025-01-31', trips: [] });

		const result = await findAvailableDateRanges('user1', '2025-01-10', '2025-01-20', mockClient);

		// With user constraints, should return the constrained range
		expect(result).toEqual([{ startDate: '2025-01-10', endDate: '2025-01-20' }]);
	});

	it('excludes trip dates from available ranges', async () => {
		mockClient = createMockFluxbase({
			earliest: '2025-01-01',
			latest: '2025-01-10',
			trips: [
				{ start_date: '2025-01-03', end_date: '2025-01-04' },
				{ start_date: '2025-01-07', end_date: '2025-01-08' }
			]
		});

		const result = await findAvailableDateRanges('user1', undefined, undefined, mockClient);

		// Should exclude the trip dates and return available ranges
		expect(result).toEqual([
			{ startDate: '2025-01-01', endDate: '2025-01-02' },
			{ startDate: '2025-01-05', endDate: '2025-01-06' },
			{ startDate: '2025-01-09', endDate: '2025-01-10' }
		]);
	});

	it('filters out ranges shorter than 2 days', async () => {
		mockClient = createMockFluxbase({
			earliest: '2025-01-01',
			latest: '2025-01-03',
			trips: [{ start_date: '2025-01-02', end_date: '2025-01-02' }]
		});

		const result = await findAvailableDateRanges('user1', undefined, undefined, mockClient);
		// Should return available ranges excluding the trip date
		expect(result).toEqual([
			{ startDate: '2025-01-01', endDate: '2025-01-01' },
			{ startDate: '2025-01-03', endDate: '2025-01-03' }
		]);
	});

	it('returns empty array if Fluxbase errors', async () => {
		mockClient = createMockFluxbase({ errorOnEarliest: true });
		const result = await findAvailableDateRanges('user1', undefined, undefined, mockClient);
		expect(result).toEqual([]);
	});

	it('handles unexpected thrown errors gracefully', async () => {
		mockClient = createMockFluxbase({ throwOnFrom: true });
		const result = await findAvailableDateRanges('user1', undefined, undefined, mockClient);
		expect(result).toEqual([]);
	});
});
