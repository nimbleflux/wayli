/**
 * Integration tests for Exclusion Zones functionality
 * Tests the complete flow of exclusion zones in place visit detection
 * @module tests/integration/exclusion-zones
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fluxbase } from '$lib/fluxbase';
import { HomeAddressAdapter } from '$lib/services/api/adapters/home-address-adapter';
import { TripExclusionsApiService } from '$lib/services/api/trip-exclusions-api.service';
import { forwardGeocode } from '$lib/services/external/pelias.service';

// Mock fluxbase
vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: {
			getUser: vi.fn(),
			getSession: vi.fn()
		},
		from: vi.fn()
	}
}));

// Mock pelias service
vi.mock('$lib/services/external/pelias.service', () => ({
	forwardGeocode: vi.fn()
}));

describe('Exclusion Zones Integration', () => {
	const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
	const mockSession = {
		user: {
			id: mockUserId,
			email: 'test@example.com'
		}
	};

	// Mock location data
	const berlinLocation = {
		lat: 52.52,
		lon: 13.405
	};

	const mockHomeAddress = {
		address: 'Alexanderplatz, Berlin, Germany',
		location: berlinLocation,
		display_name: 'Alexanderplatz, Berlin, Germany'
	};

	const mockTripExclusions = [
		{
			id: '1',
			name: 'Work',
			location: {
				coordinates: { lat: 52.50, lng: 13.45 },
				display_name: 'Potsdamer Platz, Berlin, Germany'
			},
			created_at: '2024-01-01T00:00:00Z',
			updated_at: '2024-01-01T00:00:00Z'
		}
	];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Home Address Exclusion Zone', () => {
		it('should store and retrieve home address for exclusion', async () => {
			const adapter = new HomeAddressAdapter({ session: mockSession });

			// Mock geocoding service
			vi.mocked(forwardGeocode).mockResolvedValue({
				lat: berlinLocation.lat,
				lon: berlinLocation.lon,
				display_name: mockHomeAddress.display_name
			});

			vi.mocked(fluxbase.auth.getUser).mockResolvedValue({
				data: { user: mockSession.user }
			});

			vi.mocked(fluxbase.from).mockReturnValue({
				upsert: vi.fn().mockReturnValue({
					onConflict: vi.fn().mockReturnValue({ error: null })
				}),
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { home_address: mockHomeAddress },
							error: null
						})
					})
				})
			});

			// Set home address
			const setResult = await adapter.setHomeAddress({
				address: mockHomeAddress.address
			});
			expect(setResult.home_address.location).toEqual(berlinLocation);

			// Get home address
			const getResult = await adapter.getHomeAddress();
			expect(getResult.home_address).toEqual(mockHomeAddress);
		});

		it('should clear home address and remove from exclusion zones', async () => {
			const adapter = new HomeAddressAdapter({ session: mockSession });

			vi.mocked(fluxbase.auth.getUser).mockResolvedValue({
				data: { user: mockSession.user }
			});

			vi.mocked(fluxbase.from).mockReturnValue({
				update: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({ error: null })
				})
			});

			const result = await adapter.clearHomeAddress();
			expect(result.message).toBe('Home address cleared successfully');
		});
	});

	describe('Trip Exclusions Management', () => {
		let service: TripExclusionsApiService;

		beforeEach(() => {
			service = new TripExclusionsApiService({ fluxbase: fluxbase as any });
		});

		it('should create and list trip exclusions', async () => {
			vi.mocked(fluxbase.from)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: [] },
								error: null
							})
						})
					})
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnValue({
						eq: vi.fn().mockResolvedValue({ error: null })
					})
				})
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: mockTripExclusions },
								error: null
							})
						})
					})
				});

			// Create exclusion
			const createResult = await service.createTripExclusion(mockUserId, {
				name: 'Work',
				location: mockTripExclusions[0].location
			});
			expect(createResult.exclusion.name).toBe('Work');

			// List exclusions
			const listResult = await service.getTripExclusions(mockUserId);
			expect(listResult.exclusions).toHaveLength(1);
			expect(listResult.exclusions[0].name).toBe('Work');
		});

		it('should update existing trip exclusion', async () => {
			const updatedLocation = {
				coordinates: { lat: 52.51, lng: 13.42 },
				display_name: 'Mitte, Berlin, Germany'
			};

			vi.mocked(fluxbase.from)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: mockTripExclusions },
								error: null
							})
						})
					})
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnValue({
						eq: vi.fn().mockResolvedValue({ error: null })
					})
				});

			const result = await service.updateTripExclusion(mockUserId, {
				id: '1',
				name: 'Updated Work',
				location: updatedLocation
			});

			expect(result.exclusion.name).toBe('Updated Work');
			expect(result.exclusion.location).toEqual(updatedLocation);
		});

		it('should delete trip exclusion', async () => {
			vi.mocked(fluxbase.from)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: mockTripExclusions },
								error: null
							})
						})
					})
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnValue({
						eq: vi.fn().mockResolvedValue({ error: null })
					})
				})
				.mockReturnValueOnce({
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { trip_exclusions: [] },
								error: null
							})
						})
					})
				});

			// Delete exclusion
			const deleteResult = await service.deleteTripExclusion(mockUserId, { id: '1' });
			expect(deleteResult.message).toBe('Trip exclusion deleted successfully');

			// Verify empty list
			const listResult = await service.getTripExclusions(mockUserId);
			expect(listResult.exclusions).toHaveLength(0);
		});

		it('should enforce maximum of 10 exclusions', async () => {
			const tenExclusions = Array.from({ length: 10 }, (_, i) => ({
				id: `${i}`,
				name: `Exclusion ${i}`,
				location: {
					coordinates: { lat: 52.5 + i * 0.01, lng: 13.4 + i * 0.01 },
					display_name: `Location ${i}`
				},
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z'
			}));

			vi.mocked(fluxbase.from).mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { trip_exclusions: tenExclusions },
							error: null
						})
					})
				})
			});

			await expect(
				service.createTripExclusion(mockUserId, {
					name: 'One Too Many',
					location: {
						coordinates: { lat: 52.6, lng: 13.5 },
						display_name: 'Too Many Location'
					}
				})
			).rejects.toThrow('Maximum of 10 trip exclusions allowed');
		});
	});

	describe('Combined Exclusion Zones', () => {
		it('should load both home address and trip exclusions together', async () => {
			// Mock home address
			vi.mocked(fluxbase.auth.getUser).mockResolvedValue({
				data: { user: mockSession.user }
			});

			vi.mocked(fluxbase.from).mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn()
							.mockResolvedValueOnce({
								data: { home_address: mockHomeAddress },
								error: null
							})
							.mockResolvedValueOnce({
								data: { trip_exclusions: mockTripExclusions },
								error: null
							})
					})
				})
			});

			// Load home address
			const homeAdapter = new HomeAddressAdapter({ session: mockSession });
			const homeResult = await homeAdapter.getHomeAddress();
			expect(homeResult.home_address).toEqual(mockHomeAddress);

			// Load trip exclusions
			const tripService = new TripExclusionsApiService({ fluxbase: fluxbase as any });
			const tripResult = await tripService.getTripExclusions(mockUserId);
			expect(tripResult.exclusions).toHaveLength(1);

			// Verify both are loaded
			expect(homeResult.home_address?.location).toBeDefined();
			expect(tripResult.exclusions[0].location.coordinates).toBeDefined();
		});

		it('should handle empty exclusion zones gracefully', async () => {
			vi.mocked(fluxbase.auth.getUser).mockResolvedValue({
				data: { user: mockSession.user }
			});

			vi.mocked(fluxbase.from).mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn()
							.mockResolvedValueOnce({
								data: { home_address: null },
								error: null
							})
							.mockResolvedValueOnce({
								data: { trip_exclusions: [] },
								error: null
							})
					})
				})
			});

			// Load home address (null)
			const homeAdapter = new HomeAddressAdapter({ session: mockSession });
			const homeResult = await homeAdapter.getHomeAddress();
			expect(homeResult.home_address).toBeNull();

			// Load trip exclusions (empty)
			const tripService = new TripExclusionsApiService({ fluxbase: fluxbase as any });
			const tripResult = await tripService.getTripExclusions(mockUserId);
			expect(tripResult.exclusions).toHaveLength(0);
		});
	});

	describe('Exclusion Zone Location Data', () => {
		it('should maintain valid coordinate format', async () => {
			const exclusion = mockTripExclusions[0];

			// Verify location structure
			expect(exclusion.location).toBeDefined();
			expect(exclusion.location.coordinates).toBeDefined();
			expect(exclusion.location.coordinates.lat).toBeGreaterThanOrEqual(-90);
			expect(exclusion.location.coordinates.lat).toBeLessThanOrEqual(90);
			expect(exclusion.location.coordinates.lng).toBeGreaterThanOrEqual(-180);
			expect(exclusion.location.coordinates.lng).toBeLessThanOrEqual(180);
		});

		it('should support display_name for UI rendering', async () => {
			const homeAddress = mockHomeAddress;

			expect(homeAddress.display_name).toBeDefined();
			expect(typeof homeAddress.display_name).toBe('string');
		});
	});
});
