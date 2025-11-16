// /Users/bart/Dev/wayli/web/tests/unit/services/client-statistics-smart-sampling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientStatisticsService } from '../../../src/lib/services/client-statistics.service';
import type { FluxbaseClient } from '@fluxbase/sdk';

// Mock Fluxbase client
const mockFluxbase = {
	auth: {
		getSession: vi.fn()
	},
	from: vi.fn(() => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => ({
				not: vi.fn(() => ({
					order: vi.fn(() => ({
						range: vi.fn(() => ({
							gte: vi.fn(() => ({
								lte: vi.fn(() => Promise.resolve({ data: [], error: null }))
							}))
						}))
					}))
				}))
			}))
		}))
	}))
} as unknown as FluxbaseClient;

// Mock fetch for Edge Function calls
global.fetch = vi.fn();

describe('ClientStatisticsService - Smart Sampling', () => {
	let service: ClientStatisticsService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new ClientStatisticsService(mockFluxbase);
	});

	it('should use smart sampling for large datasets (>1000 points)', async () => {
		// Mock session
		mockFluxbase.auth.getSession.mockResolvedValue({
			data: { session: { access_token: 'test-token' } },
			error: null
		});

		// Mock fetch response for smart sampling
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					data: [
						{
							recorded_at: '2024-01-01T00:00:00Z',
							location: { type: 'Point', coordinates: [0, 0] },
							speed: 0,
							distance: 0,
							time_spent: 0,
							country_code: 'US',
							tz_diff: 0,
							geocode: { properties: { type: 'test' } }
						}
					],
					metadata: {
						totalCount: 5000,
						returnedCount: 1500,
						samplingApplied: true
					}
				})
		});

		// Mock getTotalCount to return large number
		vi.spyOn(service as any, 'getTotalCount').mockResolvedValue(5000);

		const onProgress = vi.fn();
		const onError = vi.fn();

		// This should trigger smart sampling
		await service.loadAndProcessData(
			'test-user-id',
			'2024-01-01',
			'2024-01-31',
			onProgress,
			onError
		);

		// Verify that fetch was called for smart sampling
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/tracker-data-smart'),
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Authorization: 'Bearer test-token',
					'Content-Type': 'application/json'
				}),
				body: JSON.stringify({
					userId: 'test-user-id',
					startDate: '2024-01-01',
					endDate: '2024-01-31',
					maxPointsThreshold: 1000,
					offset: 0,
					limit: 1000,
					totalCount: 5000
				})
			})
		);

		// Verify progress was called with sampling stages
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: 'Loading sampled data...'
			})
		);
	});

	it('should fallback to regular loading if smart sampling fails', async () => {
		// Mock session
		mockFluxbase.auth.getSession.mockResolvedValue({
			data: { session: { access_token: 'test-token' } },
			error: null
		});

		// Mock fetch to fail
		global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

		// Mock getTotalCount to return large number
		vi.spyOn(service as any, 'getTotalCount').mockResolvedValue(5000);

		// Mock loadBatch to return test data
		vi.spyOn(service as any, 'loadBatch').mockResolvedValue([
			{
				recorded_at: '2024-01-01T00:00:00Z',
				location: { type: 'Point', coordinates: [0, 0] },
				speed: 0,
				distance: 0,
				time_spent: 0,
				country_code: 'US',
				tz_diff: 0,
				type: 'test'
			}
		]);

		const onProgress = vi.fn();
		const onError = vi.fn();

		// This should trigger smart sampling, fail, and fallback
		await service.loadAndProcessData(
			'test-user-id',
			'2024-01-01',
			'2024-01-31',
			onProgress,
			onError
		);

		// Verify that fetch was called (smart sampling attempted)
		expect(global.fetch).toHaveBeenCalled();

		// Verify fallback progress was called
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: 'Falling back to regular loading...'
			})
		);
	});

	it('should use regular loading for small datasets (<=1000 points)', async () => {
		// Mock getTotalCount to return small number
		vi.spyOn(service as any, 'getTotalCount').mockResolvedValue(1000);

		// Mock loadBatch to return test data
		vi.spyOn(service as any, 'loadBatch').mockResolvedValue([
			{
				recorded_at: '2024-01-01T00:00:00Z',
				location: { type: 'Point', coordinates: [0, 0] },
				speed: 0,
				distance: 0,
				time_spent: 0,
				country_code: 'US',
				tz_diff: 0,
				type: 'test'
			}
		]);

		const onProgress = vi.fn();
		const onError = vi.fn();

		// This should use regular loading
		await service.loadAndProcessData(
			'test-user-id',
			'2024-01-01',
			'2024-01-31',
			onProgress,
			onError
		);

		// Verify that fetch was NOT called (no smart sampling)
		expect(global.fetch).not.toHaveBeenCalled();

		// Verify regular batch loading progress
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: expect.stringContaining('Loading batch')
			})
		);
	});
});
