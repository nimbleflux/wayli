// src/lib/utils/api/schemas.ts
// Zod validation schemas for API endpoints

import { z } from 'zod';

// Common schemas
export const idParamSchema = z.object({
	id: z.string().uuid('Invalid ID format')
});

export const paginationSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	search: z.string().optional(),
	sortBy: z.string().optional(),
	sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const dateRangeSchema = z.object({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional()
});

// Job schemas
export const jobTypeSchema = z.enum([
	'trip_generation',
	'data_export',
	'data_import',
	'geocoding',
	'image_generation',
	'poi_detection',
	'trip_detection'
]);

export const jobPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const createJobSchemaCore = z.object({
	type: z.enum([
		'trip_generation',
		'data_export',
		'data_import',
		'geocoding',
		'image_generation',
		'poi_detection',
		'trip_detection'
	]),
	data: z.record(z.string(), z.unknown()),
	priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal')
});
export const createJobSchema = {
	safeParse: (data: unknown) =>
		(createJobSchemaCore.safeParse as any).call(createJobSchemaCore, data)
} as unknown as typeof createJobSchemaCore;
// Attach classic compatibility for test runner wrappers
(createJobSchema as any)._zod = z as any;

export const jobStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']);

export const jobQuerySchema = paginationSchema.extend({
	status: jobStatusSchema.optional(),
	type: jobTypeSchema.optional()
});

// Trip schemas
const dateOrDateTime = z
	.string()
	.refine((s) => /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.test(s), 'Invalid date format');

export const tripSchema = z.object({
	title: z.string().min(1, 'Title is required').max(255),
	description: z.string().optional(),
	start_date: dateOrDateTime,
	end_date: dateOrDateTime,
	image_url: z.string().url().optional(),
	labels: z.array(z.string()).optional(),
	status: z.enum(['draft', 'approved', 'completed', 'cancelled']).default('draft'),
	metadata: z.record(z.string(), z.unknown()).optional()
});

export const createTripSchemaCore = z.object({
	title: z.string().min(1, 'Title is required').max(255),
	description: z.string().optional(),
	start_date: z
		.string()
		.refine((s) => /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.test(s), 'Invalid date format'),
	end_date: z
		.string()
		.refine((s) => /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.test(s), 'Invalid date format'),
	image_url: z.string().url().optional(),
	labels: z.array(z.string()).optional(),
	status: z.enum(['draft', 'approved', 'completed', 'cancelled']).default('draft'),
	metadata: z.record(z.string(), z.unknown()).optional()
});
export const createTripSchema = {
	safeParse: (data: unknown) =>
		(createTripSchemaCore.safeParse as any).call(createTripSchemaCore, data)
} as unknown as typeof createTripSchemaCore;
(createTripSchema as any)._zod = z as any;

export const updateTripSchema = tripSchema.extend({
	id: z.string().uuid('Invalid trip ID')
});

export const tripQuerySchema = paginationSchema.extend({
	status: z.enum(['draft', 'approved', 'completed', 'cancelled']).optional(),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	search: z.string().optional()
});

// User schemas
export const userProfileSchema = z.object({
	display_name: z.string().min(1).max(100).optional(),
	bio: z.string().max(500).optional(),
	avatar_url: z.string().url().optional(),
	preferences: z.record(z.string(), z.unknown()).optional()
});

export const userQuerySchema = paginationSchema.extend({
	role: z.enum(['user', 'admin']).optional(),
	status: z.enum(['active', 'inactive', 'suspended']).optional()
});

// Authentication schemas
export const loginSchema = z.object({
	email: z.string().email('Invalid email format'),
	password: z.string().min(6, 'Password must be at least 6 characters')
});

export const registerSchema = z
	.object({
		email: z.string().email('Invalid email format'),
		password: z.string().min(8, 'Password must be at least 8 characters'),
		confirmPassword: z.string()
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords don't match",
		path: ['confirmPassword']
	});

export const twoFactorSchema = z.object({
	code: z.string().length(6, '2FA code must be 6 digits')
});

export const recoveryCodeSchema = z.object({
	code: z.string().min(8, 'Recovery code must be at least 8 characters')
});

// Trip generation schemas
export const tripGenerationSchema = z.object({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	useCustomHomeAddress: z.boolean().default(false),
	customHomeAddress: z.string().optional(),
	minTripDurationHours: z.number().min(0.5).max(168).default(2),
	minDataPointsPerDay: z.number().min(1).max(1000).default(10)
	// Note: minHomeDurationHours and minHomeDataPoints are no longer used
	// The new algorithm uses minAwayDurationHours and minStatusConfirmationPoints
});

// Export schemas
export const exportOptionsSchema = z.object({
	format: z.enum(['json', 'csv', 'gpx']),
	includeLocationData: z.boolean().default(true),
	includeWantToVisit: z.boolean().default(true),
	includeTrips: z.boolean().default(true),
	dateRange: dateRangeSchema.optional()
});

export const createExportSchema = exportOptionsSchema;

// User profile schemas
export const updateProfileSchema = userProfileSchema.partial();

// Add specific profile update schema for the auth API
export const profileUpdateSchema = z.object({
	first_name: z
		.string()
		.min(1, 'First name is required')
		.max(100, 'First name too long')
		.optional(),
	last_name: z.string().min(1, 'Last name is required').max(100, 'Last name too long').optional(),
	full_name: z.string().min(1, 'Full name is required').max(200, 'Full name too long').optional(),
	avatar_url: z.string().url('Invalid avatar URL').optional(),
	home_address: z.string().max(500, 'Home address too long').optional()
});

// Statistics query schemas
export const statisticsQuerySchema = z.object({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	limit: z.coerce.number().int().min(1).max(10000).default(5000),
	offset: z.coerce.number().int().min(0).default(0)
});

export const geocodingStatsQuerySchema = z.object({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional()
});

// Import schemas
export const importRequestSchema = z.object({
	format: z.enum(['json', 'csv', 'gpx', 'kml']),
	file: z.instanceof(File).optional(), // For file uploads
	filePath: z.string().optional() // For server-side processing
});

// Worker management schemas
export const workerManagementSchema = z.object({
	action: z.enum([
		'start',
		'stop',
		'restart',
		'status',
		'updateWorkers',
		'updateConfig',
		'testRealtime',
		'getRealtimeConfig'
	]),
	config: z.record(z.string(), z.unknown()).optional()
});

export const updatePreferencesSchema = z.object({
	theme: z.enum(['light', 'dark', 'system']).optional(),
	language: z.enum(['en', 'nl', 'es']).optional(),
	notifications: z.boolean().optional(),
	privacy: z.record(z.string(), z.unknown()).optional()
});

// Geocoding schemas
export const geocodeSearchSchema = z.object({
	q: z.string().min(3, 'Search query must be at least 3 characters'),
	limit: z.coerce.number().int().min(1).max(10).default(5)
});

// Trip exclusion schemas
export const createTripExclusionSchema = z.object({
	name: z.string().min(1),
	location: z.object({
		display_name: z.string().min(1),
		coordinates: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
	})
});

// Worker action schemas
export const workerActionSchema = z.object({
	action: z.enum([
		'start',
		'stop',
		'updateWorkers',
		'updateConfig',
		'testRealtime',
		'getRealtimeConfig'
	])
});

// 2FA schemas
export const setup2FASchema = z.object({
	secret: z.string().min(16, 'Secret must be at least 16 characters'),
	token: z.string().length(6, '2FA code must be 6 digits')
});

export const verify2FASchema = z.object({
	token: z.string().length(6, 'Token must be 6 characters')
});

// Password change schema
export const changePasswordSchema = z.object({
	currentPassword: z.string().min(1, 'Current password is required'),
	newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

// Location data query schema
export const locationDataQuerySchema = paginationSchema.extend({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	tripId: z.string().uuid().optional(),
	limit: z.coerce.number().int().min(1).max(10000).default(5000),
	offset: z.coerce.number().int().min(0).default(0),
	includeTrackerData: z.coerce.boolean().default(true),
	includeLocations: z.coerce.boolean().default(true),
	includePOIs: z.coerce.boolean().default(true)
});

// OwnTracks point schema
export const ownTracksPointSchema = z.object({
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
	tst: z.number().int().nonnegative(),
	alt: z.number().optional(),
	acc: z.number().min(0).optional(),
	vel: z.number().min(0).optional(),
	cog: z.number().min(0).max(360).optional(),
	batt: z.number().min(0).max(100).optional(),
	bs: z.coerce.boolean().optional(),
	vac: z.number().min(0).optional(),
	t: z.string().optional(),
	tid: z.string().optional(),
	inregions: z.string().optional()
});

export const ownTracksQuerySchema = z.object({
	user_id: z.string().uuid('Invalid user ID format'),
	lat: z.string().optional(),
	lon: z.string().optional(),
	tst: z.string().optional(),
	alt: z.string().optional(),
	acc: z.string().optional(),
	vel: z.string().optional(),
	cog: z.string().optional(),
	batt: z.string().optional(),
	bs: z.string().optional(),
	vac: z.string().optional(),
	t: z.string().optional(),
	tid: z.string().optional(),
	inregions: z.string().optional()
});

// Trip image suggestion schemas
export const tripImageSuggestionSchema = z.object({
	tripId: z.string().uuid('Invalid trip ID'),
	date: z.string().datetime('Invalid date format'),
	description: z.string().optional()
});

// Trip status schemas
export const tripStatusSchema = z.enum(['approved', 'pending', 'rejected', 'draft']);

export const tripSuggestedQuerySchema = z.object({
	status: tripStatusSchema.optional(),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(10)
});

// Admin worker management schemas
export const adminWorkerActionSchema = z.object({
	action: z.enum([
		'start',
		'stop',
		'restart',
		'status',
		'updateWorkers',
		'updateConfig',
		'testRealtime',
		'getRealtimeConfig'
	]),
	config: z.record(z.string(), z.unknown()).optional()
});

// 2FA verification schemas
export const twoFactorVerifySchema = z.object({
	token: z
		.string()
		.length(6, 'Token must be exactly 6 characters')
		.regex(/^\d{6}$/, 'Token must contain only digits')
});

export const twoFactorRecoverySchema = z.object({
	code: z
		.string()
		.length(8, 'Recovery code must be exactly 8 characters')
		.regex(/^[A-Z0-9]{8}$/, 'Recovery code must be 8 uppercase alphanumeric characters')
});

// Trip locations query schemas
export const tripLocationsQuerySchema = z.object({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	limit: z.coerce.number().int().min(1).max(10000).default(5000),
	offset: z.coerce.number().int().min(0).default(0),
	includeTrackerData: z.coerce.boolean().default(true),
	includeLocations: z.coerce.boolean().default(true),
	includePOIs: z.coerce.boolean().default(true)
});

// Trip exclusions schemas
export const tripExclusionSchema = z.object({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
	radius: z.number().min(0).max(10000).default(100),
	description: z.string().max(500).optional()
});

// Trip generation schemas
export const tripGenerationRequestSchema = z.object({
	startDate: z.string().datetime(),
	endDate: z.string().datetime(),
	includeLocationData: z.boolean().default(true),
	includeWantToVisit: z.boolean().default(false),
	includeTrips: z.boolean().default(true)
});

// Geocoding search schemas
export const geocodingSearchQuerySchema = z.object({
	query: z.string().min(3, 'Search query must be at least 3 characters'),
	limit: z.coerce.number().int().min(1).max(10).default(5),
	format: z.enum(['json', 'xml']).default('json')
});

// File upload schemas
export const fileUploadSchema = z.object({
	file: z
		.instanceof(File)
		.refine((file) => file.size <= 10 * 1024 * 1024, 'File size must be less than 10MB'),
	type: z.enum(['image', 'document', 'data']),
	metadata: z.record(z.string(), z.unknown()).optional()
});

// Notification schemas
export const notificationSchema = z.object({
	title: z.string().min(1).max(200),
	message: z.string().min(1).max(1000),
	type: z.enum(['info', 'success', 'warning', 'error']).default('info'),
	actionUrl: z.string().url().optional(),
	expiresAt: z.string().datetime().optional()
});

export const notificationQuerySchema = paginationSchema.extend({
	read: z.coerce.boolean().optional(),
	type: z.enum(['info', 'success', 'warning', 'error']).optional()
});

// Connection schemas
export const connectionSchema = z.object({
	name: z.string().min(1).max(100),
	type: z.enum(['owntracks', 'strava', 'google_fit', 'apple_health'] as const),
	config: z.record(z.string(), z.unknown()),
	enabled: z.boolean().default(true)
});

export const connectionQuerySchema = paginationSchema.extend({
	type: z.enum(['owntracks', 'strava', 'google_fit', 'apple_health'] as const).optional(),
	enabled: z.coerce.boolean().optional()
});

// Analytics schemas
export const analyticsQuerySchema = z.object({
	startDate: z.string().datetime(),
	endDate: z.string().datetime(),
	metrics: z
		.array(z.enum(['distance', 'duration', 'transport_modes', 'locations', 'countries']))
		.min(1),
	groupBy: z.enum(['day', 'week', 'month']).default('day'),
	includeBreakdown: z.coerce.boolean().default(false)
});

// Webhook schemas
export const webhookSchema = z.object({
	url: z.string().url('Invalid webhook URL'),
	events: z.array(z.enum(['location_update', 'trip_created', 'job_completed'])).min(1),
	secret: z.string().min(16, 'Webhook secret must be at least 16 characters').optional(),
	enabled: z.boolean().default(true)
});

export const webhookQuerySchema = paginationSchema.extend({
	enabled: z.coerce.boolean().optional(),
	event: z.enum(['location_update', 'trip_created', 'job_completed']).optional()
});

// Rate limiting schemas
export const rateLimitSchema = z.object({
	requests: z.number().int().min(1),
	window: z.number().int().min(1), // in seconds
	burst: z.number().int().min(1).optional()
});

// Server settings schemas
export const serverSettingsSchema = z.object({
	maintenanceMode: z.boolean().optional(),
	maxFileSize: z
		.number()
		.int()
		.min(1024)
		.max(100 * 1024 * 1024)
		.optional(), // 1KB to 100MB
	maxImportSize: z.number().int().min(1000).max(1000000).optional(), // 1K to 1M records
	geocodingEnabled: z.boolean().optional(),
	geocodingProvider: z.enum(['pelias', 'google', 'mapbox']).optional(),
	workerCount: z.number().int().min(1).max(10).optional()
});

// Search schemas
export const searchQuerySchema = z.object({
	q: z.string().min(1, 'Search query is required'),
	type: z.enum(['trips', 'locations', 'users']).optional(),
	limit: z.coerce.number().int().min(1).max(50).default(10)
});

// Location schemas
export const locationSchema = z.object({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
	accuracy: z.number().min(0).optional(),
	timestamp: z.string().datetime().optional()
});

export const locationQuerySchema = paginationSchema.extend({
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	tripId: z.string().uuid().optional()
});

// Admin user update schemas
export const adminUserUpdateSchema = z.object({
	role: z.enum(['user', 'admin']).optional(),
	status: z.enum(['active', 'inactive', 'suspended'] as const).optional(),
	metadata: z.record(z.string(), z.unknown()).optional()
});

// Response schemas
export const errorResponseSchema = z.object({
	error: z.string(),
	message: z.string().optional(),
	details: z.record(z.string(), z.unknown()).optional(),
	statusCode: z.number().optional()
});

export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
	z.object({
		data: dataSchema,
		message: z.string().optional(),
		statusCode: z.number().optional()
	});

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
	z.union([successResponseSchema(dataSchema), errorResponseSchema]);

// Export all schemas
export const schemas = {
	// Common
	idParam: idParamSchema,
	pagination: paginationSchema,
	dateRange: dateRangeSchema,

	// Jobs
	createJob: createJobSchema,
	jobQuery: jobQuerySchema,
	jobType: jobTypeSchema,
	jobPriority: jobPrioritySchema,
	jobStatus: jobStatusSchema,

	// Trips
	trip: tripSchema,
	createTrip: createTripSchema,
	updateTrip: updateTripSchema,
	tripQuery: tripQuerySchema,

	// Users
	userProfile: userProfileSchema,
	userQuery: userQuerySchema,

	// Authentication
	login: loginSchema,
	register: registerSchema,
	twoFactor: twoFactorSchema,
	recoveryCode: recoveryCodeSchema,

	// Trip Generation
	tripGeneration: tripGenerationSchema,

	// Export
	exportOptions: exportOptionsSchema,
	createExport: createExportSchema,

	// Users
	updateProfile: updateProfileSchema,
	updatePreferences: updatePreferencesSchema,

	// Geocoding
	geocodeSearch: geocodeSearchSchema,

	// Trip Exclusions
	createTripExclusion: createTripExclusionSchema,

	// Worker Actions
	workerAction: workerActionSchema,

	// 2FA
	setup2FA: setup2FASchema,
	verify2FA: verify2FASchema,
	changePassword: changePasswordSchema,

	// Location Data
	locationDataQuery: locationDataQuerySchema,

	// OwnTracks Points
	ownTracksPoint: ownTracksPointSchema,
	ownTracksQuery: ownTracksQuerySchema,

	// Trip Image Suggestions
	tripImageSuggestion: tripImageSuggestionSchema,
	tripSuggestedQuery: tripSuggestedQuerySchema,

	// Trip Status
	tripStatus: tripStatusSchema,

	// Admin
	adminUserUpdate: profileUpdateSchema, // Assuming adminUserUpdateSchema is profileUpdateSchema
	serverSettings: serverSettingsSchema,
	adminWorkerAction: adminWorkerActionSchema,

	// Search
	searchQuery: searchQuerySchema, // searchQuerySchema is not defined in the original file

	// File Upload
	fileUpload: fileUploadSchema,

	// Notifications
	notification: notificationSchema,
	notificationQuery: notificationQuerySchema,

	// Connections
	connection: connectionSchema,
	connectionQuery: connectionQuerySchema,

	// Analytics
	analyticsQuery: analyticsQuerySchema,

	// Webhooks
	webhook: webhookSchema,
	webhookQuery: webhookQuerySchema,

	// Rate Limiting
	rateLimit: rateLimitSchema,

	// Responses
	errorResponse: errorResponseSchema,
	successResponse: successResponseSchema,
	apiResponse: apiResponseSchema
} as const;

// Type exports
export type CreateJobRequest = z.infer<typeof createJobSchema>;
export type JobQuery = z.infer<typeof jobQuerySchema>;
export type TripRequest = z.infer<typeof tripSchema>;
export type UpdateTripRequest = z.infer<typeof updateTripSchema>;
export type TripQuery = z.infer<typeof tripQuerySchema>;
export type UserProfileRequest = z.infer<typeof userProfileSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
export type RegisterRequest = z.infer<typeof registerSchema>;
export type TripGenerationRequest = z.infer<typeof tripGenerationSchema>;
export type ExportOptionsRequest = z.infer<typeof exportOptionsSchema>;
export type LocationRequest = z.infer<typeof locationSchema>; // locationSchema is not defined
export type AdminUserUpdateRequest = z.infer<typeof profileUpdateSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>; // searchQuerySchema is not defined
export type NotificationRequest = z.infer<typeof notificationSchema>;
export type ConnectionRequest = z.infer<typeof connectionSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type WebhookRequest = z.infer<typeof webhookSchema>;
export type RateLimitRequest = z.infer<typeof rateLimitSchema>;
