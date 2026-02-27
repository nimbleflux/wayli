/**
 * Tests for Trip Exclusions API Service
 * @module tests/unit/services/api/trip-exclusions-api
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripExclusionsApiService } from '$lib/services/api/trip-exclusions-api.service';
import type { GeocodedLocation } from '$lib/types/geocoding.types';

// Mock the fluxbase module
const mockFluxbase = {
	from: vi.fn()
};

// Mock user data
const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
const mockSession = {
	user: {
		id: mockUserId,
		email: 'test@example.com'
	}
};

describe('TripExclusionsApiService', () => {
	let service: TripExclusionsApiService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new TripExclusionsApiService({ fluxbase: mockFluxbase as any });
	});

	describe('getTripExclusions', () => {
		it('should return empty array when user has no exclusions', async () => {
			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: null },
							error: null
						})
					})
				})
			});

			const result = await service.getTripExclusions(mockUserId);

			expect(result.exclusions).toEqual([]);
		});

		it('should return user exclusions when they exist', async () => {
			const mockExclusions = [
				{
					id: '1',
					name: 'Home',
					location: {
						coordinates: { lat: 52.52, lng: 13.405 },
						display_name: 'Berlin, Germany'
					},
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z'
				}
			];

			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: mockExclusions },
							error: null
						})
					})
				})
			});

			const result = await service.getTripExclusions(mockUserId);

			expect(result.exclusions).toEqual(mockExclusions);
		});

		it('should handle database errors', async () => {
			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: null,
							error: { message: 'Database error' }
						})
					})
				})
			});

			await expect(service.getTripExclusions(mockUserId)).rejects.toThrow();
		});
	});

	describe('createTripExclusion', () => {
		const mockLocation: GeocodedLocation = {
			coordinates: { lat: 52.52, lng: 13.405 },
			display_name: 'Berlin, Germany'
		};

		it('should create a new trip exclusion', async () => {
			const mockExclusions = [];
			const newExclusion = {
				id: expect.any(String),
				name: 'Work',
				location: mockLocation,
				created_at: expect.any(String),
				updated_at: expect.any(String)
			};

			mockFluxbase.from = vi.fn()
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: mockExclusions },
								error: null
							})
						})
					})
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnValue({
						eq: vi.fn().mockResolvedValue({
							error: null
						})
					})
				});

			const result = await service.createTripExclusion(mockUserId, {
				name: 'Work',
				location: mockLocation
			});

			expect(result.exclusion).toMatchObject(newExclusion);
		});

		it('should enforce maximum of 10 exclusions', async () => {
			const mockExclusions = Array.from({ length: 10 }, (_, i) => ({
				id: `${i}`,
				name: `Exclusion ${i}`,
				location: mockLocation,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z'
			}));

			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: mockExclusions },
							error: null
						})
					})
				})
			});

			await expect(
				service.createTripExclusion(mockUserId, {
					name: 'One Too Many',
					location: mockLocation
				})
			).rejects.toThrow('Maximum of 10 trip exclusions allowed');
		});

		it('should prevent duplicate exclusion names', async () => {
			const mockExclusions = [
				{
					id: '1',
					name: 'Home',
					location: mockLocation,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z'
				}
			];

			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: mockExclusions },
							error: null
						})
					})
				})
			});

			await expect(
				service.createTripExclusion(mockUserId, {
					name: 'Home',
					location: mockLocation
				})
			).rejects.toThrow('An exclusion with this name already exists');
		});

		it('should validate required fields', async () => {
			await expect(
				service.createTripExclusion(mockUserId, {
					name: '',
					location: mockLocation
				})
			).rejects.toThrow('Name is required');

			await expect(
				service.createTripExclusion(mockUserId, {
					name: 'Test',
					location: null as any
				})
			).rejects.toThrow('Location is required');
		});
	});

	describe('updateTripExclusion', () => {
		const mockLocation: GeocodedLocation = {
			coordinates: { lat: 52.52, lng: 13.405 },
			display_name: 'Berlin, Germany'
		};

		it('should update an existing exclusion', async () => {
			const mockExclusions = [
				{
					id: '1',
					name: 'Home',
					location: mockLocation,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z'
				}
			];

			mockFluxbase.from = vi.fn()
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: mockExclusions },
								error: null
							})
						})
					})
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnValue({
						eq: vi.fn().mockResolvedValue({
							error: null
						})
					})
				});

			const result = await service.updateTripExclusion(mockUserId, {
				id: '1',
				name: 'Updated Home',
				location: mockLocation
			});

			expect(result.exclusion.name).toBe('Updated Home');
		});

		it('should return 404 for non-existent exclusion', async () => {
			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: [] },
							error: null
						})
					})
				})
			});

			await expect(
				service.updateTripExclusion(mockUserId, {
					id: '999',
					name: 'Does Not Exist',
					location: mockLocation
				})
			).rejects.toThrow('Trip exclusion not found');
		});
	});

	describe('deleteTripExclusion', () => {
		it('should delete an existing exclusion', async () => {
			const mockExclusions = [
				{
					id: '1',
					name: 'Home',
					location: {
						coordinates: { lat: 52.52, lng: 13.405 },
						display_name: 'Berlin, Germany'
					},
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z'
				}
			];

			mockFluxbase.from = vi.fn()
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: mockExclusions },
								error: null
							})
						})
					})
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnValue({
						eq: vi.fn().mockResolvedValue({
							error: null
						})
					})
				});

			const result = await service.deleteTripExclusion(mockUserId, { id: '1' });

			expect(result.message).toBe('Trip exclusion deleted successfully');
		});

		it('should return 404 for non-existent exclusion', async () => {
			mockFluxbase.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: [] },
							error: null
						})
					})
				})
			});

			await expect(
				service.deleteTripExclusion(mockUserId, { id: '999' })
			).rejects.toThrow('Trip exclusion not found');
		});
	});
});
