// /Users/bart/Dev/wayli/web/tests/unit/services/client-statistics-smart-sampling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientStatisticsService } from '../../../src/lib/services/client-statistics.service';
import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

// Helper to create a chainable mock that supports all methods
function createChainableMock(
	resolvedValue: { data: any[]; error: any } | { count: number; error: any }
) {
	const mock: any = {};

	const methods = ['select', 'eq', 'not', 'order', 'range', 'gte', 'lte', 'count'];

	methods.forEach((method) => {
		mock[method] = vi.fn().mockImplementation(() => {
			// Return a promise for the final call
			if ('data' in resolvedValue || 'count' in resolvedValue) {
				const result = { ...mock, then: (resolve: any) => resolve(resolvedValue) };
				// Make it thenable for await
				Object.assign(result, Promise.resolve(resolvedValue));
				return result;
			}
			return mock;
		});
	});

	return mock;
}

// Mock Fluxbase client with proper method chaining
const createMockFluxbase = (countValue: number = 0, batchData: any[] = []) => {
	const selectChain = createChainableMock({ data: batchData, error: null });
	const countChain = createChainableMock({ count: countValue, error: null });

	return {
		auth: {
			getSession: vi.fn()
		},
		from: vi.fn((tableName: string) => ({
			select: vi.fn().mockReturnValue(selectChain),
			count: vi.fn().mockReturnValue(countChain)
		}))
	} as unknown as FluxbaseClient;
};

describe('ClientStatisticsService - Smart Sampling', () => {
	let service: ClientStatisticsService;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should use client-side sampling for large datasets (>2000 points)', async () => {
		// Create mock with large dataset
		const mockFluxbase = createMockFluxbase(5000, [
			{
				recorded_at: '2024-01-01T00:00:00Z',
				location: { type: 'Point', coordinates: [0, 0] },
				speed: 0,
				distance: 0,
				time_spent: 0,
				country_code: 'US',
				tz_diff: 0
			}
		]);

		service = new ClientStatisticsService(mockFluxbase);

		// Spy on console.log to verify sampling message
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const onProgress = vi.fn();
		const onError = vi.fn();

		await service.loadAndProcessData(
			'test-user-id',
			'2024-01-01',
			'2024-01-31',
			onProgress,
			onError
		);

		// Verify that sampling strategy was logged (indicating large dataset handling)
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Sampling strategy'));

		consoleSpy.mockRestore();
	});

	it('should not sample for small datasets (<=2000 points)', async () => {
		// Create mock with small dataset
		const mockFluxbase = createMockFluxbase(1000, [
			{
				recorded_at: '2024-01-01T00:00:00Z',
				location: { type: 'Point', coordinates: [0, 0] },
				speed: 0,
				distance: 0,
				time_spent: 0,
				country_code: 'US',
				tz_diff: 0
			}
		]);

		service = new ClientStatisticsService(mockFluxbase);

		// Spy on console.log to verify no sampling message
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const onProgress = vi.fn();
		const onError = vi.fn();

		await service.loadAndProcessData(
			'test-user-id',
			'2024-01-01',
			'2024-01-31',
			onProgress,
			onError
		);

		// Verify that sampling strategy was NOT logged for small datasets
		const samplingLogCalls = consoleSpy.mock.calls.filter((call) =>
			call[0]?.toString().includes('Sampling strategy')
		);
		expect(samplingLogCalls).toHaveLength(0);

		consoleSpy.mockRestore();
	});

	it('should report progress during data loading', async () => {
		const mockFluxbase = createMockFluxbase(100, [
			{
				recorded_at: '2024-01-01T00:00:00Z',
				location: { type: 'Point', coordinates: [0, 0] },
				speed: 0,
				distance: 0,
				time_spent: 0,
				country_code: 'US',
				tz_diff: 0
			}
		]);

		service = new ClientStatisticsService(mockFluxbase);

		const onProgress = vi.fn();
		const onError = vi.fn();

		await service.loadAndProcessData(
			'test-user-id',
			'2024-01-01',
			'2024-01-31',
			onProgress,
			onError
		);

		// Verify progress was called with counting stage
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: 'Counting records...'
			})
		);
	});
});
