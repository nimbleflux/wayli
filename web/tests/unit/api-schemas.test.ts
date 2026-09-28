// src/tests/unit/api-schemas.test.ts
// Tests for API validation schemas

import { describe, it, expect } from 'vitest';
import { MOCK_PASSWORD_OLD, MOCK_PASSWORD_NEW, MOCK_PASSWORD_WEAK } from '../helpers/test-fixtures';

import {
	paginationSchema,
	dateRangeSchema,
	idParamSchema,
	createJobSchema,
	jobStatusSchema,
	createTripSchema,
	updateTripSchema,
	createExportSchema,
	updateProfileSchema,
	profileUpdateSchema,
	updatePreferencesSchema,
	geocodeSearchSchema,
	createTripExclusionSchema,
	adminUserUpdateSchema,
	serverSettingsSchema,
	workerActionSchema,
	setup2FASchema,
	verify2FASchema,
	changePasswordSchema,
	locationDataQuerySchema,
	ownTracksPointSchema
} from '$lib/utils/api/schemas.testing';

describe('API Validation Schemas', () => {
	describe('paginationSchema', () => {
		it('should validate correct pagination parameters', () => {
			const validData = {
				page: '1',
				limit: '10',
				search: 'test'
			};

			const result = paginationSchema.safeParse(validData);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.limit).toBe(10);
				expect(result.data.search).toBe('test');
			}
		});

		it('should use default values when not provided', () => {
			const data = {};

			const result = paginationSchema.safeParse(data);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.limit).toBe(20);
			}
		});

		it('should reject invalid page numbers', () => {
			const invalidData = {
				page: '0',
				limit: '10'
			};

			const result = paginationSchema.safeParse(invalidData);
			expect(result.success).toBe(false);
		});

		it('should reject invalid limit values', () => {
			const invalidData = {
				page: '1',
				limit: '101' // over max limit
			};

			const result = paginationSchema.safeParse(invalidData);
			expect(result.success).toBe(false);
		});
	});

	describe('dateRangeSchema', () => {
		it('should validate correct date range', () => {
			const validData = {
				startDate: '2024-01-01T00:00:00Z',
				endDate: '2024-12-31T23:59:59Z'
			};

			const result = dateRangeSchema.safeParse(validData);
			expect(result.success).toBe(true);
		});

		it('should allow optional dates', () => {
			const data = {};

			const result = dateRangeSchema.safeParse(data);
			expect(result.success).toBe(true);
		});
	});

	describe('idParamSchema', () => {
		it('should validate UUID format', () => {
			const validId = {
				id: '123e4567-e89b-12d3-a456-426614174000'
			};

			const result = idParamSchema.safeParse(validId);
			expect(result.success).toBe(true);
		});

		it('should reject invalid UUID format', () => {
			const invalidId = {
				id: 'not-a-uuid'
			};

			const result = idParamSchema.safeParse(invalidId);
			expect(result.success).toBe(false);
		});
	});

	describe('createJobSchema', () => {
		it('should validate correct job data', () => {
			const validJob = {
				type: 'data_import',
				data: { fileId: '123', format: 'csv' },
				priority: 'high'
			};

			const result = createJobSchema.safeParse(validJob);
			expect(result.success).toBe(true);
		});

		it('should use default priority when not provided', () => {
			const job = {
				type: 'data_import',
				data: { fileId: '123' }
			};

			const result = createJobSchema.safeParse(job);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.priority).toBe('normal');
			}
		});

		it('should reject empty type', () => {
			const invalidJob = {
				type: '',
				data: { fileId: '123' }
			};

			const result = createJobSchema.safeParse(invalidJob);
			expect(result.success).toBe(false);
		});

		it('should reject invalid priority', () => {
			const invalidJob = {
				type: 'data_import',
				data: { fileId: '123' },
				priority: 'invalid'
			};

			const result = createJobSchema.safeParse(invalidJob);
			expect(result.success).toBe(false);
		});
	});

	describe('jobStatusSchema', () => {
		it('should validate all valid statuses', () => {
			const validStatuses = ['queued', 'processing', 'completed', 'failed', 'cancelled'];

			validStatuses.forEach((status) => {
				const result = jobStatusSchema.safeParse(status);
				expect(result.success).toBe(true);
			});
		});

		it('should reject invalid status', () => {
			const result = jobStatusSchema.safeParse('invalid');
			expect(result.success).toBe(false);
		});
	});

	describe('createTripSchema', () => {
		it('should validate correct trip data', () => {
			const validTrip = {
				title: 'Summer Vacation',
				description: 'A wonderful trip to the beach',
				start_date: '2024-06-01',
				end_date: '2024-06-15',
				labels: ['vacation', 'beach'],
				metadata: { weather: 'sunny' },
				image_url: 'https://example.com/image.jpg'
			};

			const result = createTripSchema.safeParse(validTrip);
			expect(result.success).toBe(true);
		});

		it('should reject empty title', () => {
			const invalidTrip = {
				title: '',
				start_date: '2024-06-01',
				end_date: '2024-06-15'
			};

			const result = createTripSchema.safeParse(invalidTrip);
			expect(result.success).toBe(false);
		});

		it('should reject title that is too long', () => {
			const invalidTrip = {
				title: 'a'.repeat(256), // over 255 character limit
				start_date: '2024-06-01',
				end_date: '2024-06-15'
			};

			const result = createTripSchema.safeParse(invalidTrip);
			expect(result.success).toBe(false);
		});

		it('should reject invalid image URL', () => {
			const invalidTrip = {
				title: 'Test Trip',
				start_date: '2024-06-01',
				end_date: '2024-06-15',
				image_url: 'not-a-url'
			};

			const result = createTripSchema.safeParse(invalidTrip);
			expect(result.success).toBe(false);
		});
	});

	describe('updateTripSchema', () => {
		it('should extend createTripSchema with id', () => {
			const validUpdate = {
				id: '123e4567-e89b-12d3-a456-426614174000',
				title: 'Updated Trip',
				start_date: '2024-06-01',
				end_date: '2024-06-15'
			};

			const result = updateTripSchema.safeParse(validUpdate);
			expect(result.success).toBe(true);
		});
	});

	describe('createExportSchema', () => {
		it('should validate correct export data', () => {
			const validExport = {
				format: 'json',
				includeLocationData: true,
				includeWantToVisit: true,
				includeTrips: true,
				startDate: '2024-01-01',
				endDate: '2024-12-31'
			};

			const result = createExportSchema.safeParse(validExport);
			expect(result.success).toBe(true);
		});

		it('should reject invalid format', () => {
			const invalidExport = {
				format: 'invalid',
				includeLocationData: true,
				includeWantToVisit: true,
				includeTrips: true
			};

			const result = createExportSchema.safeParse(invalidExport);
			expect(result.success).toBe(false);
		});
	});

	describe('updateProfileSchema', () => {
		it('should validate correct profile data', () => {
			const validProfile = {
				first_name: 'John',
				last_name: 'Doe',
				home_address: '123 Main St',
				avatar_url: 'https://example.com/avatar.jpg'
			};

			const result = updateProfileSchema.safeParse(validProfile);
			expect(result.success).toBe(true);
		});

		it('should allow partial updates', () => {
			const partialProfile = {
				first_name: 'John'
			};

			const result = updateProfileSchema.safeParse(partialProfile);
			expect(result.success).toBe(true);
		});

		it('should accept a geocoded home_address object (#205)', () => {
			// The settings page stores the geocoded suggestion object, not a string
			const result = profileUpdateSchema.safeParse({
				home_address: {
					display_name: '11 Dent Street, Huskisson, NSW, Australia',
					lat: -35.0347,
					lon: 150.6739,
					coordinates: { lat: -35.0347, lng: 150.6739 },
					name: '11 Dent Street',
					layer: 'address',
					address: { city: 'Huskisson' }
				}
			});
			expect(result.success).toBe(true);
		});

		it('should accept a manual coordinates home_address object (#205)', () => {
			const result = profileUpdateSchema.safeParse({
				home_address: {
					display_name: '-35.042, 150.669',
					coordinates: { lat: -35.042, lng: 150.669 },
					address: { city: 'Huskisson' },
					layer: 'address'
				}
			});
			expect(result.success).toBe(true);
		});
	});

	describe('updatePreferencesSchema', () => {
		it('should validate correct preferences data', () => {
			const validPreferences = {
				theme: 'dark',
				language: 'en',
				notifications_enabled: true,
				timezone: 'UTC+00:00'
			};

			const result = updatePreferencesSchema.safeParse(validPreferences);
			expect(result.success).toBe(true);
		});

		it('should reject invalid theme', () => {
			const invalidPreferences = {
				theme: 'invalid'
			};

			const result = updatePreferencesSchema.safeParse(invalidPreferences);
			expect(result.success).toBe(false);
		});

		it('should reject invalid language', () => {
			const invalidPreferences = {
				language: 'invalid'
			};

			const result = updatePreferencesSchema.safeParse(invalidPreferences);
			expect(result.success).toBe(false);
		});
	});

	describe('geocodeSearchSchema', () => {
		it('should validate search query with minimum length', () => {
			const validQuery = {
				q: 'Amsterdam, Netherlands'
			};

			const result = geocodeSearchSchema.safeParse(validQuery);
			expect(result.success).toBe(true);
		});

		it('should reject query that is too short', () => {
			const invalidQuery = {
				q: 'ab' // less than 3 characters
			};

			const result = geocodeSearchSchema.safeParse(invalidQuery);
			expect(result.success).toBe(false);
		});
	});

	describe('createTripExclusionSchema', () => {
		it('should validate correct exclusion data', () => {
			const validExclusion = {
				name: 'Home',
				location: {
					display_name: '123 Main St, City, Country',
					coordinates: {
						lat: 40.7128,
						lng: -74.006
					}
				}
			};

			const result = createTripExclusionSchema.safeParse(validExclusion);
			expect(result.success).toBe(true);
		});

		it('should reject missing location data', () => {
			const invalidExclusion = {
				name: 'Home'
			};

			const result = createTripExclusionSchema.safeParse(invalidExclusion);
			expect(result.success).toBe(false);
		});
	});

	describe('adminUserUpdateSchema', () => {
		it('should validate correct admin update data', () => {
			const validUpdate = {
				userId: '123e4567-e89b-12d3-a456-426614174000',
				role: 'admin',
				email: 'admin@example.com'
			};

			const result = adminUserUpdateSchema.safeParse(validUpdate);
			expect(result.success).toBe(true);
		});

		it('should reject invalid role', () => {
			const invalidUpdate = {
				userId: '123e4567-e89b-12d3-a456-426614174000',
				role: 'invalid'
			};

			const result = adminUserUpdateSchema.safeParse(invalidUpdate);
			expect(result.success).toBe(false);
		});
	});

	describe('serverSettingsSchema', () => {
		it('should validate correct server settings', () => {
			const validSettings = {
				server_name: 'Wayli Server'
			};

			const result = serverSettingsSchema.safeParse(validSettings);
			expect(result.success).toBe(true);
		});
	});

	describe('workerActionSchema', () => {
		it('should validate all valid worker actions', () => {
			const validActions = [
				'start',
				'stop',
				'updateWorkers',
				'updateConfig',
				'testRealtime',
				'getRealtimeConfig'
			];

			validActions.forEach((action) => {
				const result = workerActionSchema.safeParse({ action });
				expect(result.success).toBe(true);
			});
		});
	});

	describe('2FA Schemas', () => {
		describe('setup2FASchema', () => {
			it('should validate correct 2FA setup data', () => {
				const validSetup = {
					secret: 'JBSWY3DPEHPK3PXP',
					token: '123456'
				};

				const result = setup2FASchema.safeParse(validSetup);
				expect(result.success).toBe(true);
			});

			it('should reject short secret', () => {
				const invalidSetup = {
					secret: 'short',
					token: '123456'
				};

				const result = setup2FASchema.safeParse(invalidSetup);
				expect(result.success).toBe(false);
			});
		});

		describe('verify2FASchema', () => {
			it('should validate correct 2FA verification data', () => {
				const validVerify = {
					token: '123456'
				};

				const result = verify2FASchema.safeParse(validVerify);
				expect(result.success).toBe(true);
			});

			it('should reject short token', () => {
				const invalidVerify = {
					token: '12345' // 5 digits instead of 6
				};

				const result = verify2FASchema.safeParse(invalidVerify);
				expect(result.success).toBe(false);
			});
		});
	});

	describe('changePasswordSchema', () => {
		it('should validate correct password change data', () => {
			const validChange = {
				currentPassword: MOCK_PASSWORD_OLD,
				newPassword: MOCK_PASSWORD_NEW
			};

			const result = changePasswordSchema.safeParse(validChange);
			expect(result.success).toBe(true);
		});

		it('should reject short new password', () => {
			const invalidChange = {
				currentPassword: MOCK_PASSWORD_OLD,
				newPassword: MOCK_PASSWORD_WEAK
			};

			const result = changePasswordSchema.safeParse(invalidChange);
			expect(result.success).toBe(false);
		});
	});

	describe('locationDataQuerySchema', () => {
		it('should validate correct location data query', () => {
			const validQuery = {
				startDate: '2024-01-01T00:00:00Z',
				endDate: '2024-12-31T23:59:59Z',
				limit: '5000',
				offset: '0',
				includeTrackerData: 'true',
				includeLocations: 'true',
				includePOIs: 'true'
			};

			const result = locationDataQuerySchema.safeParse(validQuery);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.limit).toBe(5000);
				expect(result.data.offset).toBe(0);
			}
		});

		it('should reject limit that is too high', () => {
			const invalidQuery = {
				limit: '10001' // over max limit (now 10000)
			};

			const result = locationDataQuerySchema.safeParse(invalidQuery);
			expect(result.success).toBe(false);
		});
	});

	describe('ownTracksPointSchema', () => {
		it('should validate correct OwnTracks point data', () => {
			const validPoint = {
				lat: 40.7128,
				lon: -74.006,
				tst: 1640995200,
				alt: 10,
				acc: 5,
				vel: 0,
				cog: 0,
				batt: 80,
				bs: 1,
				vac: 0,
				t: 'p',
				tid: 'AB',
				inregions: 'home'
			};

			const result = ownTracksPointSchema.safeParse(validPoint);
			expect(result.success).toBe(true);
		});

		it('should reject invalid latitude', () => {
			const invalidPoint = {
				lat: 91, // over 90
				lon: -74.006,
				tst: 1640995200
			};

			const result = ownTracksPointSchema.safeParse(invalidPoint);
			expect(result.success).toBe(false);
		});

		it('should reject invalid longitude', () => {
			const invalidPoint = {
				lat: 40.7128,
				lon: 181, // over 180
				tst: 1640995200
			};

			const result = ownTracksPointSchema.safeParse(invalidPoint);
			expect(result.success).toBe(false);
		});

		it('should reject negative timestamp', () => {
			const invalidPoint = {
				lat: 40.7128,
				lon: -74.006,
				tst: -1
			};

			const result = ownTracksPointSchema.safeParse(invalidPoint);
			expect(result.success).toBe(false);
		});
	});
});
