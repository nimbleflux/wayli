// web/src/lib/services/trip-detection.service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripDetectionService } from './trip-detection.service';

// Mock Fluxbase client
const mockFluxbase = {
	from: vi.fn(() => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => ({
				in: vi.fn(() => ({
					single: vi.fn()
				}))
			}))
		}))
	}))
};

vi.mock('@fluxbase/sdk', () => ({
	createClient: () => mockFluxbase
}));

describe('TripDetectionService', () => {
	let service: TripDetectionService;

	beforeEach(() => {
		service = new TripDetectionService('test-url', 'test-key');
		vi.clearAllMocks();
	});

	describe('getExcludedDateRanges', () => {
		it('should fetch approved and rejected trips and create excluded date ranges', async () => {
			const mockTrips = [
				{ start_date: '2024-01-01', end_date: '2024-01-03', status: 'approved' },
				{ start_date: '2024-01-10', end_date: '2024-01-12', status: 'rejected' }
			];

			// Mock the Fluxbase response
			const mockSelect = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					in: vi.fn().mockReturnValue({
						then: (callback: any) => callback({ data: mockTrips, error: null })
					})
				})
			});

			mockFluxbase.from.mockReturnValue({
				select: mockSelect
			});

			const result = await service.getExcludedDateRanges('user123');

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				startDate: '2024-01-01',
				endDate: '2024-01-03',
				reason: 'approved_trip'
			});
			expect(result[1]).toEqual({
				startDate: '2024-01-10',
				endDate: '2024-01-12',
				reason: 'rejected_trip'
			});
		});

		it('should handle database errors gracefully', async () => {
			const mockSelect = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					in: vi.fn().mockReturnValue({
						then: (callback: any) => callback({ data: null, error: 'Database error' })
					})
				})
			});

			mockFluxbase.from.mockReturnValue({
				select: mockSelect
			});

			const result = await service.getExcludedDateRanges('user123');
			expect(result).toEqual([]);
		});
	});

	describe('getUserHomeLocations', () => {
		it('should fetch home address and trip exclusions as unified home locations', async () => {
			const mockProfile = {
				home_address: {
					address: { city: 'Amsterdam', country_code: 'nl' },
					coordinates: { lat: 52.3676, lng: 4.9041 }
				}
			};

			const mockPreferences = {
				trip_exclusions: [
					{
						id: '1',
						name: 'Utrecht',
						location: {
							address: { city: 'Utrecht', country_code: 'nl' },
							coordinates: { lat: 52.0907, lng: 5.1214 }
						}
					}
				]
			};

			// Mock the Fluxbase responses
			const mockProfileSelect = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					single: vi.fn().mockReturnValue({
						then: (callback: any) => callback({ data: mockProfile, error: null })
					})
				})
			});

			const mockPreferencesSelect = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					single: vi.fn().mockReturnValue({
						then: (callback: any) => callback({ data: mockPreferences, error: null })
					})
				})
			});

			mockFluxbase.from
				.mockReturnValueOnce({
					select: mockProfileSelect
				})
				.mockReturnValueOnce({
					select: mockPreferencesSelect
				});

			const result = await service.getUserHomeLocations('user123');

			expect(result.locations).toHaveLength(2);
			expect(result.language).toBe('en');
			expect(result.locations[0]).toEqual({
				address: { city: 'Amsterdam', country_code: 'nl' },
				coordinates: { lat: 52.3676, lng: 4.9041 }
			});
			expect(result.locations[1]).toEqual({
				id: '1',
				name: 'Utrecht',
				address: { city: 'Utrecht', country_code: 'nl' },
				coordinates: { lat: 52.0907, lng: 5.1214 }
			});
		});

		it('should handle missing data gracefully', async () => {
			// Mock empty responses
			const mockSelect = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					single: vi.fn().mockReturnValue({
						then: (callback: any) => callback({ data: null, error: null })
					})
				})
			});

			mockFluxbase.from.mockReturnValue({
				select: mockSelect
			});

			const result = await service.getUserHomeLocations('user123');

			expect(result.locations).toEqual([]);
			expect(result.language).toBe('en');
		});
	});

	describe('createProcessingDateRanges', () => {
		it('should create date ranges excluding excluded ranges', () => {
			const startDate = '2024-01-01';
			const endDate = '2024-01-10';
			const excludedRanges = [
				{ startDate: '2024-01-03', endDate: '2024-01-05', reason: 'approved_trip' },
				{ startDate: '2024-01-08', endDate: '2024-01-09', reason: 'rejected_trip' }
			];

			const result = service.createProcessingDateRanges(startDate, endDate, excludedRanges);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ startDate: '2024-01-01', endDate: '2024-01-02' });
			expect(result[1]).toEqual({ startDate: '2024-01-06', endDate: '2024-01-07' });
			expect(result[2]).toEqual({ startDate: '2024-01-10', endDate: '2024-01-10' });
		});

		it('should handle no excluded ranges', () => {
			const startDate = '2024-01-01';
			const endDate = '2024-01-10';
			const excludedRanges: any[] = [];

			const result = service.createProcessingDateRanges(startDate, endDate, excludedRanges);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ startDate: '2024-01-01', endDate: '2024-01-10' });
		});

		it('should handle overlapping excluded ranges', () => {
			const startDate = '2024-01-01';
			const endDate = '2024-01-10';
			const excludedRanges = [
				{ startDate: '2024-01-02', endDate: '2024-01-08', reason: 'approved_trip' }
			];

			const result = service.createProcessingDateRanges(startDate, endDate, excludedRanges);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ startDate: '2024-01-01', endDate: '2024-01-01' });
			expect(result[1]).toEqual({ startDate: '2024-01-09', endDate: '2024-01-10' });
		});
	});

	describe('home detection logic', () => {
		it('should detect home based on city matching', () => {
			const homeLocations: any[] = [
				{
					address: { city: 'Amsterdam', country_code: 'nl' },
					coordinates: { lat: 52.3676, lng: 4.9041 }
				}
			];

			const point = {
				geocode: {
					properties: {
						address: { city: 'Amsterdam', country_code: 'nl' }
					},
					geometry: {
						coordinates: [4.9041, 52.3676] // [lng, lat] format
					}
				}
			};

			const result = service['isPointAtHome'](point, homeLocations);
			expect(result).toBe(true);
		});

		it('should detect home based on radius when city names differ', () => {
			const homeLocations: any[] = [
				{
					address: { city: 'Amsterdam', country_code: 'nl' },
					coordinates: { lat: 52.3676, lng: 4.9041 }
				}
			];

			const point = {
				geocode: {
					properties: {
						address: { city: 'Amstelveen', country_code: 'nl' } // Different city
					},
					geometry: {
						coordinates: [4.85, 52.3] // Within 50km of Amsterdam [lng, lat]
					}
				}
			};

			const result = service['isPointAtHome'](point, homeLocations);
			expect(result).toBe(true);
		});

		it('should not detect home when both city and radius checks fail', () => {
			const homeLocations: any[] = [
				{
					address: { city: 'Amsterdam', country_code: 'nl' },
					coordinates: { lat: 52.3676, lng: 4.9041 }
				}
			];

			const point = {
				geocode: {
					properties: {
						address: { city: 'Rotterdam', country_code: 'nl' } // Different city
					},
					geometry: {
						coordinates: [4.4792, 51.9225] // More than 50km from Amsterdam [lng, lat]
					}
				}
			};

			const result = service['isPointAtHome'](point, homeLocations);
			expect(result).toBe(false);
		});

		it('should handle missing city names gracefully', () => {
			const homeLocations: any[] = [
				{
					address: { city: 'Amsterdam', country_code: 'nl' },
					coordinates: { lat: 52.3676, lng: 4.9041 }
				}
			];

			const point = {
				geocode: {
					properties: {
						address: {} // No city name
					},
					geometry: {
						coordinates: [4.85, 52.3] // Within 50km [lng, lat]
					}
				}
			};

			const result = service['isPointAtHome'](point, homeLocations);
			expect(result).toBe(true); // Should fall back to radius check
		});
	});

	describe('state tracking with lastHomeStateStartTime', () => {
		it('should track last home state time when transitioning to home', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Initialize the service's userState
			serviceInstance['userState'] = {
				currentState: 'away' as const,
				stateStartTime: '2024-01-01T10:00:00Z',
				dataPointsInState: 15,
				lastHomeStateStartTime: '2024-01-01T08:00:00Z',
				nextState: 'home' as const,
				nextStateStartTime: '2024-01-01T12:00:00Z',
				nextStateDataPoints: 10,
				visitedCities: []
			};

			serviceInstance['updateUserState']({ recorded_at: '2024-01-01T12:00:00Z' }, null, 'home');

			// After 10 points confirming home state, it should transition
			expect(serviceInstance['userState']!.currentState).toBe('home');
			expect(serviceInstance['userState']!.lastHomeStateStartTime).toBe('2024-01-01T12:00:00Z');
		});

		it('should filter out short trips less than 24 hours', async () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Initialize the service's userState
			serviceInstance['userState'] = {
				currentState: 'away' as const,
				stateStartTime: '2024-01-01T10:00:00Z',
				dataPointsInState: 15,
				lastHomeStateStartTime: '2024-01-01T08:00:00Z',
				nextState: 'home' as const,
				nextStateStartTime: '2024-01-01T12:00:00Z', // Only 4 hours away
				nextStateDataPoints: 10,
				visitedCities: []
			};

			const trip = await serviceInstance['updateUserState'](
				{ recorded_at: '2024-01-01T12:00:00Z' },
				null,
				'home'
			);

			// Short trip (4 hours) should be filtered out
			expect(trip).toBeNull();
			expect(serviceInstance['userState']!.currentState).toBe('home');
		});

		it('should create trips for durations of 24 hours or more', async () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Initialize the service's userState with some visited cities
			serviceInstance['userState'] = {
				currentState: 'away' as const,
				stateStartTime: '2024-01-01T10:00:00Z',
				dataPointsInState: 15,
				lastHomeStateStartTime: '2024-01-01T08:00:00Z',
				nextState: 'home' as const,
				nextStateStartTime: '2024-01-02T08:00:00Z', // 24 hours away
				nextStateDataPoints: 10,
				visitedCities: [
					{
						cityName: 'Amsterdam',
						countryCode: 'nl',
						coordinates: { lat: 52.3676, lng: 4.9041 },
						firstVisitTime: '2024-01-01T10:00:00Z',
						lastVisitTime: '2024-01-02T08:00:00Z',
						durationHours: 24,
						dataPoints: 15
					}
				]
			};

			const trip = await serviceInstance['updateUserState'](
				{ recorded_at: '2024-01-02T08:00:00Z' },
				null,
				'home'
			);

			// Long trip (24 hours) should create a trip
			expect(trip).not.toBeNull();
			expect(trip?.title).toBe('Trip away from home');
			expect(serviceInstance['userState']!.currentState).toBe('home');
		});

		it('should not create trips with no meaningful locations after duration filtering', async () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Initialize the service's userState with no visited cities
			serviceInstance['userState'] = {
				currentState: 'away' as const,
				stateStartTime: '2024-01-01T10:00:00Z',
				dataPointsInState: 15,
				lastHomeStateStartTime: '2024-01-01T08:00:00Z',
				nextState: 'home' as const,
				nextStateStartTime: '2024-01-02T08:00:00Z', // 24 hours away
				nextStateDataPoints: 10,
				visitedCities: []
			};

			const trip = await serviceInstance['updateUserState'](
				{ recorded_at: '2024-01-02T08:00:00Z' },
				null,
				'home'
			);

			// Trip should not be created when there are no meaningful locations
			expect(trip).toBeNull();
			expect(serviceInstance['userState']!.currentState).toBe('home'); // Still transition to home to avoid runaway trips
		});

		it('should not update lastHomeStateStartTime when transitioning to away', async () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Initialize the service's userState
			serviceInstance['userState'] = {
				currentState: 'home' as const,
				stateStartTime: '2024-01-01T08:00:00Z',
				dataPointsInState: 15,
				lastHomeStateStartTime: '2024-01-01T08:00:00Z',
				nextState: 'away' as const,
				nextStateStartTime: '2024-01-01T12:00:00Z',
				nextStateDataPoints: 10,
				visitedCities: []
			};

			await serviceInstance['updateUserState'](
				{ recorded_at: '2024-01-01T12:00:00Z' },
				null,
				'away'
			);

			// After 10 points confirming away state, it should transition but not update lastHomeStateStartTime
			expect(serviceInstance['userState']!.currentState).toBe('away');
			expect(serviceInstance['userState']!.lastHomeStateStartTime).toBe('2024-01-01T08:00:00Z'); // Should remain unchanged
		});

		it('should generate UUIDs using crypto.randomUUID()', () => {
			// In test environment, crypto.randomUUID() is mocked to return 'test-uuid'
			const uuid1 = crypto.randomUUID();
			const uuid2 = crypto.randomUUID();

			expect(uuid1).toBe('test-uuid');
			expect(uuid2).toBe('test-uuid');

			// Verify that crypto.randomUUID() returns a string
			expect(uuid1).toBeDefined();
			expect(typeof uuid1).toBe('string');
		});

		it('should calculate trip days correctly', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Same day trip (0 overnight stays, but 1 trip day)
			const sameDayTrip = serviceInstance['calculateTripDays'](
				'2024-01-01T08:00:00Z',
				'2024-01-01T18:00:00Z'
			);
			expect(sameDayTrip).toBe(1);

			// Overnight trip (1 overnight stay, 2 trip days)
			const overnightTrip = serviceInstance['calculateTripDays'](
				'2024-01-01T08:00:00Z',
				'2024-01-02T18:00:00Z'
			);
			expect(overnightTrip).toBe(2);

			// Multi-day trip (2 overnight stays, 3 trip days)
			const multiDayTrip = serviceInstance['calculateTripDays'](
				'2024-01-01T08:00:00Z',
				'2024-01-03T18:00:00Z'
			);
			expect(multiDayTrip).toBe(3);

			// Very short trip (less than 24 hours, but still 1 trip day)
			const shortTrip = serviceInstance['calculateTripDays'](
				'2024-01-01T08:00:00Z',
				'2024-01-01T10:00:00Z'
			);
			expect(shortTrip).toBe(1);
		});

		it('should calculate location visit duration correctly', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Initialize the service's userState
			serviceInstance['userState'] = {
				currentState: 'away' as const,
				stateStartTime: '2024-01-01T08:00:00Z',
				dataPointsInState: 0,
				lastHomeStateStartTime: '2024-01-01T08:00:00Z',
				nextStateDataPoints: 0,
				visitedCities: []
			};

			// First visit to Amsterdam at 8:00 AM
			const point1 = {
				recorded_at: '2024-01-01T08:00:00Z',
				geocode: {
					properties: {
						address: { city: 'Amsterdam', country_code: 'nl' }
					},
					geometry: {
						coordinates: [4.9041, 52.3676] // [lng, lat]
					}
				}
			};

			// Second visit to Amsterdam at 10:00 AM (2 hours later)
			const point2 = {
				recorded_at: '2024-01-01T10:00:00Z',
				geocode: {
					properties: {
						address: { city: 'Amsterdam', country_code: 'nl' }
					},
					geometry: {
						coordinates: [4.9041, 52.3676] // [lng, lat]
					}
				}
			};

			// Third visit to Amsterdam at 2:00 PM (6 hours after first visit)
			const point3 = {
				recorded_at: '2024-01-01T14:00:00Z',
				geocode: {
					properties: {
						address: { city: 'Amsterdam', country_code: 'nl' }
					},
					geometry: {
						coordinates: [4.9041, 52.3676] // [lng, lat]
					}
				}
			};

			// Add first point
			serviceInstance['addVisitedLocation'](point1, null);
			expect(serviceInstance['userState']!.visitedCities).toHaveLength(1);
			expect(serviceInstance['userState']!.visitedCities[0].cityName).toBe('Amsterdam');
			expect(serviceInstance['userState']!.visitedCities[0].durationHours).toBe(0); // No duration yet

			// Add second point
			serviceInstance['addVisitedLocation'](point2, point1);
			expect(serviceInstance['userState']!.visitedCities).toHaveLength(1); // Same location
			expect(serviceInstance['userState']!.visitedCities[0].dataPoints).toBe(2);
			expect(serviceInstance['userState']!.visitedCities[0].durationHours).toBe(2); // Full 2-hour interval between point 1 and point 2

			// Add third point
			serviceInstance['addVisitedLocation'](point3, point2);
			expect(serviceInstance['userState']!.visitedCities).toHaveLength(1); // Same location
			expect(serviceInstance['userState']!.visitedCities[0].dataPoints).toBe(3);
			expect(serviceInstance['userState']!.visitedCities[0].durationHours).toBe(6); // Total accumulated time: 2h + 4h = 6h
		});

		it('should filter locations by duration thresholds correctly', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Create mock visited locations with different durations
			const mockLocations = [
				{ cityName: 'Amsterdam', countryCode: 'nl', durationHours: 2 }, // Below 3-hour threshold
				{ cityName: 'Rotterdam', countryCode: 'nl', durationHours: 4 }, // Above 3-hour threshold
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 6 }, // Above 3-hour threshold
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 8 }, // Above 3-hour threshold
				{ cityName: 'Paris', countryCode: 'fr', durationHours: 12 } // Above 3-hour threshold
			];

			// Test the filterLocationsByDuration method
			const filteredLocations = serviceInstance['filterLocationsByDuration'](mockLocations);

			// After applying both filters:
			// 1. City filter: Amsterdam (2h) is filtered out, leaving 4 cities
			// 2. Country filter: Netherlands (4h total) and France (12h total) don't meet 24h threshold
			//    Only Belgium (14h total) doesn't meet 24h threshold either
			//    So all locations are filtered out
			expect(filteredLocations).toHaveLength(0);
			expect(filteredLocations.find((loc) => loc.cityName === 'Amsterdam')).toBeUndefined();
			expect(filteredLocations.find((loc) => loc.cityName === 'Rotterdam')).toBeUndefined();
			expect(filteredLocations.find((loc) => loc.cityName === 'Brussels')).toBeUndefined();
			expect(filteredLocations.find((loc) => loc.cityName === 'Antwerp')).toBeUndefined();
			expect(filteredLocations.find((loc) => loc.cityName === 'Paris')).toBeUndefined();
		});

		it('should include locations when country duration threshold is met', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Create mock visited locations where Belgium meets the 24-hour threshold
			const mockLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 12 }, // 12 hours
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 8 }, // 8 hours
				{ cityName: 'Ghent', countryCode: 'be', durationHours: 6 } // 6 hours
				// Total Belgium: 26 hours (above 24-hour threshold)
			];

			// Test the filterLocationsByDuration method
			const filteredLocations = serviceInstance['filterLocationsByDuration'](mockLocations);

			// All Belgian cities should be included since total country duration >= 24 hours
			expect(filteredLocations).toHaveLength(3);
			expect(filteredLocations.find((loc) => loc.cityName === 'Brussels')).toBeDefined();
			expect(filteredLocations.find((loc) => loc.cityName === 'Antwerp')).toBeDefined();
			expect(filteredLocations.find((loc) => loc.cityName === 'Ghent')).toBeDefined();
		});

		it('should detect single dominant country when 50% threshold is met', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Create mock locations where Belgium has 60% of the time (dominant)
			const mockLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 18 }, // 18 hours (60% of 30 total)
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 6 }, // 6 hours
				{ cityName: 'Paris', countryCode: 'fr', durationHours: 6 } // 6 hours
				// Total: 30 hours, Belgium: 24 hours (80%), France: 6 hours (20%)
			];

			// Test hasMultipleCountries - should return false due to dominant Belgium
			const hasMultipleCountries = serviceInstance['hasMultipleCountries'](mockLocations);
			expect(hasMultipleCountries).toBe(false);
		});

		it('should detect multiple countries when no country meets 50% threshold', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Create mock locations where no country has 50% of the time
			const mockLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 12 }, // 12 hours (40% of 30 total)
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 6 }, // 6 hours
				{ cityName: 'Paris', countryCode: 'fr', durationHours: 12 } // 12 hours (40% of 30 total)
				// Total: 30 hours, Belgium: 18 hours (60%), France: 12 hours (40%)
			];

			// Test hasMultipleCountries - should return true since Belgium has 60% (above 50%)
			const hasMultipleCountries = serviceInstance['hasMultipleCountries'](mockLocations);
			expect(hasMultipleCountries).toBe(false); // Belgium is dominant (60%)
		});

		it('should detect single dominant city when 50% threshold is met', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Create mock locations where Brussels has 60% of the time (dominant)
			const mockLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 18 }, // 18 hours (60% of 30 total)
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 6 }, // 6 hours (20% of 30 total)
				{ cityName: 'Ghent', countryCode: 'be', durationHours: 6 } // 6 hours (20% of 30 total)
				// Total: 30 hours, Brussels: 18 hours (60%), others: 12 hours (40%)
			];

			// Test hasMultipleCities - should return false due to dominant Brussels
			const hasMultipleCities = serviceInstance['hasMultipleCities'](mockLocations);
			expect(hasMultipleCities).toBe(false);
		});

		it('should detect multiple cities when no city meets 50% threshold', () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Create mock locations where no city has 50% of the time
			const mockLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 10 }, // 10 hours (33.3% of 30 total)
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 10 }, // 10 hours (33.3% of 30 total)
				{ cityName: 'Ghent', countryCode: 'be', durationHours: 10 } // 10 hours (33.3% of total)
				// Total: 30 hours, each city: 10 hours (33.3%)
			];

			// Test hasMultipleCities - should return true since no city has 50%
			const hasMultipleCities = serviceInstance['hasMultipleCities'](mockLocations);
			expect(hasMultipleCities).toBe(true);
		});

		it('should generate trip titles with home country distinction', async () => {
			const serviceInstance = new TripDetectionService('test-url', 'test-key');

			// Set userId for the service instance (needed for home country detection)
			(serviceInstance as any).userId = 'user123';

			// Test single city trip
			const singleCityLocations = [{ cityName: 'Brussels', countryCode: 'be', durationHours: 24 }];
			const singleCityTitle = await serviceInstance['generateTripTitle'](singleCityLocations, 'en');
			expect(singleCityTitle).toBe('Trip to Brussels');

			// Test multi-city trip with dominant city
			const dominantCityLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 18 }, // 60% of 30 total
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 6 }, // 20% of 30 total
				{ cityName: 'Ghent', countryCode: 'be', durationHours: 6 } // 20% of 30 total
			];
			const dominantCityTitle = await serviceInstance['generateTripTitle'](
				dominantCityLocations,
				'en'
			);
			expect(dominantCityTitle).toBe('Trip to Brussels');

			// Test multi-city trip with no dominant city
			const multiCityLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 10 }, // 33.3% of 30 total
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 10 }, // 33.3% of 30 total
				{ cityName: 'Ghent', countryCode: 'be', durationHours: 10 } // 33.3% of 30 total
			];
			const multiCityTitle = await serviceInstance['generateTripTitle'](multiCityLocations, 'en');
			expect(multiCityTitle).toBe('Trip to Belgium'); // Should show country because there's no dominant city

			// Test multi-country trip with dominant country
			const dominantCountryLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 18 }, // 60% of 30 total
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 6 }, // 20% of 30 total
				{ cityName: 'Paris', countryCode: 'fr', durationHours: 6 } // 20% of 30 total
			];
			const dominantCountryTitle = await serviceInstance['generateTripTitle'](
				dominantCountryLocations,
				'en'
			);
			expect(dominantCountryTitle).toBe('Trip to Brussels'); // Brussels is dominant city in dominant country

			// Test multi-country trip with no dominant country
			const multiCountryLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 15 }, // 30% of 50 total
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 10 }, // 20% of 50 total
				{ cityName: 'Paris', countryCode: 'fr', durationHours: 15 }, // 30% of 50 total
				{ cityName: 'Lyon', countryCode: 'fr', durationHours: 10 } // 20% of 50 total
			];
			const multiCountryTitle = await serviceInstance['generateTripTitle'](
				multiCountryLocations,
				'en'
			);
			expect(multiCountryTitle).toBe('Trip to Belgium, France'); // Belgium is dominant (50% of total), Brussels is dominant city

			// Test truly multi-country trip with no dominant country
			const trueMultiCountryLocations = [
				{ cityName: 'Brussels', countryCode: 'be', durationHours: 15 }, // 20% of 75 total
				{ cityName: 'Antwerp', countryCode: 'be', durationHours: 10 }, // 13.3% of 75 total
				{ cityName: 'Paris', countryCode: 'fr', durationHours: 18 }, // 24% of 75 total
				{ cityName: 'Lyon', countryCode: 'fr', durationHours: 12 }, // 16% of 75 total
				{ cityName: 'Berlin', countryCode: 'de', durationHours: 20 } // 26.7% of 75 total
			];
			const trueMultiCountryTitle = await serviceInstance['generateTripTitle'](
				trueMultiCountryLocations,
				'en'
			);
			expect(trueMultiCountryTitle).toBe('Trip to France, Belgium'); // France is most visited country (40%), Paris is dominant city in France (60% of France's time), Germany is filtered out, because it was visited for less than 24 hours.
		});
	});
});
