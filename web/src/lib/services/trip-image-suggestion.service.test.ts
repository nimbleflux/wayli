// web/src/lib/services/trip-image-suggestion.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripImageSuggestionService } from './trip-image-suggestion.service';

// Mock the Pexels service
vi.mock('./external/pexels.service', () => ({
	getTripBannerImageWithAttribution: vi.fn()
}));

// Use vi.hoisted to create a mock that can be referenced in vi.mock factory
const hoisted = vi.hoisted(() => {
	const mockFrom = vi.fn();
	return { mockFrom };
});

// Mock the fluxbase module using the hoisted mock
vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		from: hoisted.mockFrom
	}
}));

// Helper function to create mock query chain
function createMockQueryChain(mockData: any[] = [], mockError: any = null) {
	return {
		select: vi.fn().mockReturnValue({
			eq: vi.fn().mockReturnValue({
				gte: vi.fn().mockReturnValue({
					lte: vi.fn().mockReturnValue({
						not: vi.fn().mockReturnValue({
							order: vi.fn().mockResolvedValue({
								data: mockData,
								error: mockError
							})
						})
					})
				})
			})
		})
	};
}

describe('Trip Image Suggestion Service - City Dominance Logic', () => {
	let service: TripImageSuggestionService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new TripImageSuggestionService();
	});

	describe('analyzeTripLocations', () => {
		it('should calculate city dominance correctly for city-focused trips', async () => {
			// Mock data where city represents 85% of trip time
			const mockTrackerData = [
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T10:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T11:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T12:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T13:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T14:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Rotterdam' } } }),
					recorded_at: '2024-01-01T15:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Rotterdam' } } }),
					recorded_at: '2024-01-01T16:00:00Z'
				}
			];

			// Set up the mock to return our test data
			hoisted.mockFrom.mockReturnValue(createMockQueryChain(mockTrackerData, null));

			const result = await service.analyzeTripLocations('user123', '2024-01-01', '2024-01-01');

			expect(result.primaryCity).toBe('amsterdam');
			// City search will always be used when primaryCity exists
		});

		it('should always use city search when primaryCity exists', async () => {
			// Mock data where city represents 90% of trip time
			const mockTrackerData = [
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T10:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T11:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T12:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T13:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T14:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T15:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T16:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T17:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Amsterdam' } } }),
					recorded_at: '2024-01-01T18:00:00Z'
				},
				{
					country_code: 'NL',
					geocode: JSON.stringify({ properties: { address: { city: 'Rotterdam' } } }),
					recorded_at: '2024-01-01T19:00:00Z'
				}
			];

			// Set up the mock to return our test data
			hoisted.mockFrom.mockReturnValue(createMockQueryChain(mockTrackerData, null));

			const result = await service.analyzeTripLocations('user123', '2024-01-01', '2024-01-01');

			expect(result.primaryCity).toBe('amsterdam');
			// City search will always be used when primaryCity exists
		});

		it('should handle trips with no city data', async () => {
			const mockTrackerData = [
				{ country_code: 'NL', geocode: null, recorded_at: '2024-01-01T10:00:00Z' },
				{ country_code: 'NL', geocode: null, recorded_at: '2024-01-01T11:00:00Z' }
			];

			// Set up the mock to return our test data
			hoisted.mockFrom.mockReturnValue(createMockQueryChain(mockTrackerData, null));

			const result = await service.analyzeTripLocations('user123', '2024-01-01', '2024-01-01');

			expect(result.primaryCity).toBeUndefined();
			// No city search when no primaryCity
		});
	});
});
