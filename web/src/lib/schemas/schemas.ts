import { z } from 'zod';

// Base schemas for common patterns
export const emailSchema = z.string().email('Invalid email address');
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const dateSchema = z.string().datetime({ message: 'Invalid date format' });
export const positiveNumberSchema = z.number().positive({ message: 'Must be a positive number' });
export const nonNegativeNumberSchema = z
	.number()
	.nonnegative({ message: 'Must be a non-negative number' });

// Coordinate schemas
export const coordinateSchema = z.object({
	lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
	lng: z.number().min(-180).max(180, 'Longitude must be between -180 and 180')
});

export const locationSchema = z.object({
	type: z.literal('Point'),
	coordinates: z
		.tuple([z.number(), z.number()])
		.refine(
			([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90,
			'Invalid coordinates'
		)
});

// User-related schemas
export const userProfileSchema = z.object({
	id: uuidSchema,
	first_name: z.string().min(1, 'First name is required').max(100, 'First name too long'),
	last_name: z.string().min(1, 'Last name is required').max(100, 'Last name too long'),
	full_name: z.string().min(1, 'Full name is required').max(200, 'Full name too long'),
	role: z.enum(['user', 'admin']).default('user'),
	avatar_url: z.string().url('Invalid avatar URL').optional(),
	home_address: z
		.object({
			display_name: z.string(),
			coordinates: coordinateSchema
		})
		.optional(),
	created_at: dateSchema,
	updated_at: dateSchema
});

export const userPreferencesSchema = z.object({
	id: uuidSchema,
	theme: z.enum(['light', 'dark', 'system']).default('system'),
	language: z.string().default('en'),
	timezone: z.string().default('UTC'),
	units: z.enum(['metric', 'imperial']).default('metric'),
	notifications_enabled: z.boolean().default(true),
	email_notifications: z.boolean().default(true),
	created_at: dateSchema,
	updated_at: dateSchema
});

// Authentication schemas
export const signUpSchema = z.object({
	email: emailSchema,
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.max(128, 'Password too long'),
	firstName: z.string().min(1, 'First name is required').max(100, 'First name too long'),
	lastName: z.string().min(1, 'Last name is required').max(100, 'Last name too long')
});

export const signInSchema = z.object({
	email: emailSchema,
	password: z.string().min(1, 'Password is required')
});

export const passwordChangeSchema = z.object({
	currentPassword: z.string().min(1, 'Current password is required'),
	newPassword: z
		.string()
		.min(8, 'New password must be at least 8 characters')
		.max(128, 'New password too long')
});

// Two-Factor Authentication schemas
export const twoFactorEnableSchema = z.object({
	code: z
		.string()
		.length(6, '2FA code must be exactly 6 digits')
		.regex(/^\d{6}$/, '2FA code must contain only digits')
});

export const twoFactorDisableSchema = z.object({
	password: z.string().min(1, 'Password is required')
});

// Trip-related schemas
export const tripSchema = z.object({
	id: uuidSchema.optional(),
	title: z.string().min(1, 'Trip title is required').max(200, 'Trip title too long'),
	description: z.string().max(1000, 'Description too long').optional(),
	start_date: dateSchema,
	end_date: dateSchema,
	location: locationSchema,
	city_name: z.string().max(100, 'City name too long').optional(),
	status: z.enum(['draft', 'approved', 'rejected']).default('draft'),
	user_id: uuidSchema,
	created_at: dateSchema.optional(),
	updated_at: dateSchema.optional()
});

export const tripExclusionSchema = z.object({
	id: uuidSchema.optional(),
	name: z.string().min(1, 'Exclusion name is required').max(100, 'Exclusion name too long'),
	exclusion_type: z.enum(['city', 'address', 'coordinates']),
	value: z.string().min(1, 'Exclusion value is required').max(500, 'Exclusion value too long'),
	coordinates: coordinateSchema.optional(),
	user_id: uuidSchema,
	created_at: dateSchema.optional(),
	updated_at: dateSchema.optional()
});

// Job-related schemas
export const jobSchema = z.object({
	id: uuidSchema.optional(),
	type: z.enum([
		'reverse_geocoding_missing',
		'data_import',
		'trip_generation',
		'poi_visit_detection'
	]),
	status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).default('queued'),
	priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
	progress: nonNegativeNumberSchema.max(100, 'Progress cannot exceed 100%').default(0),
	data: z.record(z.string(), z.unknown()).optional(),
	error: z.string().optional(),
	worker_id: uuidSchema.optional(),
	created_by: uuidSchema,
	started_at: dateSchema.optional(),
	completed_at: dateSchema.optional(),
	created_at: dateSchema.optional(),
	updated_at: dateSchema.optional()
});

export const jobCreateSchema = z.object({
	type: z.enum([
		'reverse_geocoding_missing',
		'data_import',
		'trip_generation',
		'poi_visit_detection'
	]),
	data: z.record(z.string(), z.unknown()).optional(),
	priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal')
});

// Geocoding schemas
export const geocodeSearchSchema = z.object({
	q: z
		.string()
		.min(3, 'Search query must be at least 3 characters')
		.max(500, 'Search query too long')
});

export const reverseGeocodeSchema = z.object({
	lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
	lng: z.number().min(-180).max(180, 'Longitude must be between -180 and 180')
});

// Statistics schemas
export const statisticsQuerySchema = z.object({
	startDate: dateSchema.optional(),
	endDate: dateSchema.optional()
});

// Import schemas
export const importSchema = z.object({
	file: z.instanceof(File, { message: 'File is required' }),
	format: z.enum(['json', 'gpx', 'geojson'], { message: 'Invalid format' })
});

// Pagination schemas
export const paginationSchema = z.object({
	page: z.number().int().positive().default(1),
	limit: z.number().int().positive().max(100).default(10),
	search: z.string().max(100).optional()
});

// Admin schemas
export const adminUserUpdateSchema = z.object({
	id: uuidSchema,
	role: z.enum(['user', 'admin']),
	email: emailSchema.optional(),
	first_name: z.string().min(1).max(100).optional(),
	last_name: z.string().min(1).max(100).optional()
});

// Worker schemas
export const workerSchema = z.object({
	id: uuidSchema.optional(),
	worker_id: z.string().min(1, 'Worker ID is required').max(100, 'Worker ID too long'),
	status: z.enum(['active', 'inactive', 'error']).default('active'),
	last_heartbeat: dateSchema.optional(),
	created_at: dateSchema.optional(),
	updated_at: dateSchema.optional()
});

// POI schemas
export const poiSchema = z.object({
	id: uuidSchema.optional(),
	name: z.string().min(1, 'POI name is required').max(200, 'POI name too long'),
	description: z.string().max(1000, 'Description too long').optional(),
	location: locationSchema,
	category: z.string().max(100, 'Category too long').optional(),
	rating: nonNegativeNumberSchema.max(5, 'Rating cannot exceed 5').optional(),
	visit_count: nonNegativeNumberSchema.default(0),
	first_visit: dateSchema.optional(),
	last_visit: dateSchema.optional(),
	user_id: uuidSchema,
	created_at: dateSchema.optional(),
	updated_at: dateSchema.optional()
});

// Trip generation schemas
export const tripGenerationSchema = z.object({
	startDate: dateSchema.optional(),
	endDate: dateSchema.optional(),
	useCustomHomeAddress: z.boolean().default(false),
	customHomeAddress: z.string().max(500, 'Custom home address too long').optional()
});

// File upload schemas
export const fileUploadSchema = z.object({
	file: z.instanceof(File, { message: 'File is required' }),
	maxSize: z
		.number()
		.positive()
		.default(1024 * 1024 * 1024), // 1GB default
	allowedTypes: z.array(z.string()).default(['.json', '.gpx', '.geojson'])
});

// API response schemas
export const apiResponseSchema = z.object({
	success: z.boolean(),
	data: z.unknown().optional(),
	error: z
		.object({
			message: z.string(),
			code: z.string(),
			details: z.unknown().optional()
		})
		.optional(),
	meta: z
		.object({
			timestamp: dateSchema,
			pagination: z
				.object({
					page: z.number(),
					limit: z.number(),
					total: z.number(),
					totalPages: z.number(),
					hasNext: z.boolean(),
					hasPrev: z.boolean()
				})
				.optional()
		})
		.optional()
});

// Validation helper functions
export const validateWithSchema = <T>(
	schema: z.ZodSchema<T>,
	data: unknown
): { success: true; data: T } | { success: false; error: string } => {
	try {
		const validatedData = schema.parse(data);
		return { success: true, data: validatedData };
	} catch (error) {
		if (error instanceof z.ZodError) {
			const zodError = error as z.ZodError<T>;
			const errorMessage = zodError.issues
				.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
				.join(', ');
			return { success: false, error: errorMessage };
		}
		return { success: false, error: 'Validation failed' };
	}
};

// Note: Partial validation removed due to Zod v4 compatibility issues
// Use validateWithSchema with a manually created partial schema if needed
