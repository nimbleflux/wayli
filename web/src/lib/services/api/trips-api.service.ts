// src/lib/services/api/trips-api.service.ts
// Trips API Service for handling trip-related API operations

import { z } from 'zod';

import { errorHandler, ErrorCode } from '../error-handler.service';
import { getTripsService } from '../service-layer-adapter';

import type { FluxbaseClient } from '@fluxbase/sdk';

// Validation schemas
const createTripSchema = z.object({
	title: z.string().min(1, 'Title is required').max(255, 'Title too long'),
	description: z.string().optional(),
	start_date: z.string().min(1, 'Start date is required'),
	end_date: z.string().min(1, 'End date is required'),
	labels: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	image_url: z.string().optional()
});

const updateTripSchema = z.object({
	id: z.string().uuid('Invalid trip ID'),
	title: z.string().min(1, 'Title is required').max(255, 'Title too long'),
	description: z.string().optional(),
	start_date: z.string().min(1, 'Start date is required'),
	end_date: z.string().min(1, 'End date is required'),
	labels: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	image_url: z.string().optional()
});

const tripQuerySchema = z.object({
	page: z.coerce.number().min(1, 'Page must be at least 1').default(1),
	limit: z.coerce
		.number()
		.min(1, 'Limit must be at least 1')
		.max(100, 'Limit too high')
		.default(10),
	search: z.string().optional(),
	status: z.enum(['approved', 'pending', 'rejected']).optional(),
	start_date: z.string().optional(),
	end_date: z.string().optional()
});

export interface TripsApiServiceConfig {
	fluxbase: FluxbaseClient;
}

export interface CreateTripRequest {
	title: string;
	description?: string;
	start_date: string;
	end_date: string;
	labels?: string[];
	metadata?: Record<string, unknown>;
	image_url?: string;
}

export interface UpdateTripRequest {
	id: string;
	title: string;
	description?: string;
	start_date: string;
	end_date: string;
	labels?: string[];
	metadata?: Record<string, unknown>;
	image_url?: string;
}

export interface TripQuery {
	page?: number;
	limit?: number;
	search?: string;
	status?: string;
	start_date?: string;
	end_date?: string;
}

export interface Trip {
	id: string;
	user_id: string;
	title: string;
	description?: string;
	start_date: string;
	end_date: string;
	labels?: string[];
	metadata?: Record<string, unknown>;
	image_url?: string;
	status: string;
	created_at: string;
	updated_at: string;
}

export interface TripsResponse {
	trips: Trip[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		hasNext: boolean;
		hasPrev: boolean;
	};
}

export interface CreateTripResult {
	trip: Trip;
	message: string;
}

export interface UpdateTripResult {
	trip: Trip;
	message: string;
}

export class TripsApiService {
	private fluxbase: FluxbaseClient;

	constructor(config: TripsApiServiceConfig) {
		this.fluxbase = config.fluxbase;
	}

	/**
	 * Get trips for a user with pagination and filtering
	 */
	async getTrips(userId: string, query: TripQuery = {}): Promise<TripsResponse> {
		// Validate query parameters
		const validatedQuery = tripQuerySchema.parse(query);
		const { page = 1, limit = 10, search, status, start_date, end_date } = validatedQuery;

		// Build query
		let dbQuery = this.fluxbase
			.from('trips')
			.select('*', { count: 'exact' })
			.eq('user_id', userId)
			.order('created_at', { ascending: false });

		// Apply filters
		if (search) {
			dbQuery = dbQuery.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
		}

		if (status) {
			dbQuery = dbQuery.eq('status', status);
		}

		if (start_date) {
			dbQuery = dbQuery.gte('start_date', start_date);
		}

		if (end_date) {
			dbQuery = dbQuery.lte('end_date', end_date);
		}

		// Apply pagination
		const offset = (page - 1) * limit;
		dbQuery = dbQuery.range(offset, offset + limit - 1);

		const { data: trips, error, count } = await dbQuery;

		if (error) {
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to fetch trips',
				500,
				error,
				{ userId, query }
			);
		}

		const total = count || 0;
		const totalPages = Math.ceil(total / limit);

		return {
			trips: trips as Trip[],
			pagination: {
				page,
				limit,
				total,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1
			}
		};
	}

	/**
	 * Get a single trip by ID
	 */
	async getTripById(tripId: string, userId: string): Promise<Trip> {
		if (!tripId) {
			throw errorHandler.createError(ErrorCode.MISSING_REQUIRED_FIELD, 'Trip ID is required', 400, {
				field: 'tripId'
			});
		}

		const { data: trip, error } = await this.fluxbase
			.from('trips')
			.select('*')
			.eq('id', tripId)
			.eq('user_id', userId)
			.single();

		if (error) {
			if (error.code === 'PGRST116') {
				throw errorHandler.createError(ErrorCode.RECORD_NOT_FOUND, 'Trip not found', 404, {
					tripId,
					userId
				});
			}
			throw errorHandler.createError(ErrorCode.DATABASE_ERROR, 'Failed to fetch trip', 500, error, {
				tripId,
				userId
			});
		}

		return trip as Trip;
	}

	/**
	 * Create a new trip
	 */
	async createTrip(userId: string, request: CreateTripRequest): Promise<CreateTripResult> {
		// Validate request
		this.validateCreateTripRequest(request);

		// Validate dates
		this.validateTripDates(request.start_date, request.end_date);

		// Create trip using service layer
		const tripsService = await getTripsService();
		const trip = await tripsService.createTrip({
			title: request.title,
			description: request.description,
			start_date: request.start_date,
			end_date: request.end_date,
			metadata: {
				...request.metadata,
				labels: request.labels,
				image_url: request.image_url
			}
		});

		return {
			trip: trip as Trip,
			message: 'Trip created successfully'
		};
	}

	/**
	 * Update an existing trip
	 */
	async updateTrip(userId: string, request: UpdateTripRequest): Promise<UpdateTripResult> {
		// Validate request
		this.validateUpdateTripRequest(request);

		// Validate dates
		this.validateTripDates(request.start_date, request.end_date);

		// Check if trip exists and user has access
		await this.getTripById(request.id, userId);

		// Update trip using service layer
		const tripsService = await getTripsService();
		const trip = await tripsService.updateTrip({
			id: request.id,
			title: request.title,
			description: request.description,
			start_date: request.start_date,
			end_date: request.end_date,
			metadata: {
				...request.metadata,
				labels: request.labels,
				image_url: request.image_url
			}
		});

		return {
			trip: trip as Trip,
			message: 'Trip updated successfully'
		};
	}

	/**
	 * Delete a trip
	 */
	async deleteTrip(tripId: string, userId: string): Promise<{ message: string }> {
		if (!tripId) {
			throw errorHandler.createError(ErrorCode.MISSING_REQUIRED_FIELD, 'Trip ID is required', 400, {
				field: 'tripId'
			});
		}

		// Check if trip exists and user has access
		await this.getTripById(tripId, userId);

		// Delete trip
		const { error } = await this.fluxbase
			.from('trips')
			.delete()
			.eq('id', tripId)
			.eq('user_id', userId);

		if (error) {
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to delete trip',
				500,
				error,
				{ tripId, userId }
			);
		}

		return { message: 'Trip deleted successfully' };
	}

	/**
	 * Search trips
	 */
	async searchTrips(userId: string, searchQuery: string): Promise<Trip[]> {
		if (!searchQuery || searchQuery.trim().length === 0) {
			throw errorHandler.createError(
				ErrorCode.MISSING_REQUIRED_FIELD,
				'Search query is required',
				400,
				{ field: 'searchQuery' }
			);
		}

		const { data: trips, error } = await this.fluxbase
			.from('trips')
			.select('*')
			.eq('user_id', userId)
			.or(
				`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,labels.cs.{${searchQuery}}`
			)
			.order('created_at', { ascending: false });

		if (error) {
			throw errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Failed to search trips',
				500,
				error,
				{ userId, searchQuery }
			);
		}

		return trips as Trip[];
	}

	/**
	 * Validate create trip request
	 */
	validateCreateTripRequest(request: CreateTripRequest): void {
		createTripSchema.parse(request);
	}

	/**
	 * Validate update trip request
	 */
	validateUpdateTripRequest(request: UpdateTripRequest): void {
		updateTripSchema.parse(request);
	}

	/**
	 * Validate trip dates
	 */
	private validateTripDates(startDate: string, endDate: string): void {
		const start = new Date(startDate);
		const end = new Date(endDate);

		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			throw errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Invalid date format', 400, {
				startDate,
				endDate
			});
		}

		if (end < start) {
			throw errorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'End date must be after start date',
				400,
				{ startDate, endDate }
			);
		}
	}
}
