/**
 * Trips management adapter.
 * Handles all trip-related operations including CRUD, suggestions, and image generation.
 * @module adapters/trips-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * Result of generating a suggested image for a trip.
 */
export interface SuggestedImageResult {
	/** The ID of the suggested trip */
	suggested_trip_id: string;
	/** Whether image generation succeeded */
	success: boolean;
	/** The generated image URL (if successful) */
	image_url?: string;
	/** Image attribution data (photographer, source, etc.) */
	attribution?: unknown;
	/** AI analysis of the trip for image selection */
	analysis?: unknown;
	/** Error message if generation failed */
	error?: string;
}

/**
 * Options for fetching trips with pagination and search.
 */
export interface GetTripsOptions {
	/** Maximum number of trips to return (default: 50) */
	limit?: number;
	/** Number of trips to skip for pagination (default: 0) */
	offset?: number;
	/** Search query to filter trips by title, description, or labels */
	search?: string;
}

/**
 * Pre-generated image data for bulk trip approval.
 */
export interface PreGeneratedImage {
	/** The image URL to use for the trip */
	image_url: string;
	/** Image attribution data */
	attribution?: unknown;
}

/**
 * Adapter for managing trips and trip suggestions.
 * Provides methods for creating, reading, updating trips, and managing
 * AI-generated trip suggestions.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const tripsAdapter = new TripsAdapter({ session });
 *
 * // Get completed trips
 * const trips = await tripsAdapter.getTrips({ limit: 20, search: 'Paris' });
 *
 * // Approve suggested trips
 * await tripsAdapter.approveSuggestedTrips(['trip-id-1', 'trip-id-2']);
 * ```
 */
export class TripsAdapter extends BaseAdapter {
	/**
	 * Creates a new TripsAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Calculates the total distance traveled during a trip from tracker data.
	 * Sums up distance values from tracker_data records within the date range.
	 *
	 * @param userId - The user's ID
	 * @param startDate - Trip start date (YYYY-MM-DD format)
	 * @param endDate - Trip end date (YYYY-MM-DD format)
	 * @returns Promise resolving to total distance in meters
	 * @private
	 */
	private async calculateTripDistance(
		userId: string,
		startDate: string,
		endDate: string
	): Promise<number> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase
			.from('tracker_data')
			.select('distance')
			.eq('user_id', userId)
			.gte('recorded_at', `${startDate}T00:00:00Z`)
			.lte('recorded_at', `${endDate}T23:59:59Z`)
			.not('country_code', 'is', null);

		if (error || !data) return 0;

		return data.reduce(
			(sum, row) => sum + (typeof row.distance === 'number' ? row.distance : 0),
			0
		);
	}

	/**
	 * Retrieves completed trips for the authenticated user.
	 * Supports pagination and text search across title, description, and labels.
	 *
	 * @param options - Query options for filtering and pagination
	 * @returns Promise resolving to array of trip objects
	 * @throws Error if user is not authenticated or query fails
	 *
	 * @example
	 * ```typescript
	 * // Get first page of trips
	 * const trips = await tripsAdapter.getTrips({ limit: 20, offset: 0 });
	 *
	 * // Search for trips
	 * const parisTrips = await tripsAdapter.getTrips({ search: 'Paris' });
	 * ```
	 */
	async getTrips(options?: GetTripsOptions) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const limit = options?.limit || 50;
		const offset = options?.offset || 0;
		const search = options?.search || '';

		let query = fluxbase
			.from('trips')
			.select('*')
			.eq('user_id', userData.user.id)
			.eq('status', 'completed')
			.order('created_at', { ascending: false });

		if (search) {
			query = query.or(
				`title.ilike.%${search}%,description.ilike.%${search}%,labels.cs.{${search}}`
			);
		}

		query = query.range(offset, offset + limit - 1);

		const { data: trips, error } = await query;

		if (error) {
			throw new Error(error.message || 'Failed to fetch trips');
		}

		return trips || [];
	}

	/**
	 * Creates a new trip for the authenticated user.
	 * Automatically calculates distance if start and end dates are provided.
	 *
	 * @param trip - Trip data to create
	 * @param trip.title - Required title for the trip
	 * @param trip.description - Optional description
	 * @param trip.start_date - Optional start date (YYYY-MM-DD)
	 * @param trip.end_date - Optional end date (YYYY-MM-DD)
	 * @param trip.status - Optional status (default: 'planned')
	 * @param trip.tags - Optional array of tags
	 * @param trip.metadata - Optional metadata object
	 * @returns Promise resolving to the created trip
	 * @throws Error if title is missing or creation fails
	 *
	 * @example
	 * ```typescript
	 * const newTrip = await tripsAdapter.createTrip({
	 *   title: 'Summer Vacation 2024',
	 *   description: 'Family trip to the coast',
	 *   start_date: '2024-07-01',
	 *   end_date: '2024-07-14',
	 *   tags: ['family', 'beach']
	 * });
	 * ```
	 */
	async createTrip(trip: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!trip.title) {
			throw new Error('Missing required field: title');
		}

		const { data: newTrip, error: createError } = await fluxbase
			.from('trips')
			.insert({
				user_id: userData.user.id,
				title: trip.title,
				description: trip.description || '',
				start_date: trip.start_date || null,
				end_date: trip.end_date || null,
				status: trip.status || 'planned',
				tags: trip.tags || [],
				metadata: trip.metadata || {}
			})
			.select()
			.single();

		if (createError) {
			throw new Error(createError.message || 'Failed to create trip');
		}

		// Calculate distance if dates provided
		if (newTrip.start_date && newTrip.end_date) {
			const distanceTraveled = await this.calculateTripDistance(
				userData.user.id,
				newTrip.start_date,
				newTrip.end_date
			);

			const { error: updateError } = await fluxbase
				.from('trips')
				.update({
					metadata: {
						...(newTrip.metadata || {}),
						distanceTraveled
					}
				})
				.eq('id', newTrip.id);

			if (!updateError) {
				newTrip.metadata = { ...(newTrip.metadata || {}), distanceTraveled };
			}
		}

		return newTrip;
	}

	/**
	 * Updates an existing trip.
	 * Verifies ownership before updating and recalculates distance if dates change.
	 *
	 * @param trip - Trip data to update (must include id)
	 * @param trip.id - Required trip ID
	 * @returns Promise resolving to the updated trip
	 * @throws Error if id is missing, trip not found, or update fails
	 *
	 * @example
	 * ```typescript
	 * const updated = await tripsAdapter.updateTrip({
	 *   id: 'trip-uuid',
	 *   title: 'Updated Title',
	 *   end_date: '2024-07-15'
	 * });
	 * ```
	 */
	async updateTrip(trip: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!trip.id) {
			throw new Error('Missing required field: id');
		}

		// Verify trip belongs to user
		const { data: existingTrip, error: fetchError } = await fluxbase
			.from('trips')
			.select('id')
			.eq('id', trip.id)
			.eq('user_id', userData.user.id)
			.single();

		if (fetchError || !existingTrip) {
			throw new Error('Trip not found');
		}

		const { data: updatedTrip, error: updateError } = await fluxbase
			.from('trips')
			.update({
				title: trip.title,
				description: trip.description,
				start_date: trip.start_date,
				end_date: trip.end_date,
				status: trip.status,
				tags: trip.tags,
				metadata: trip.metadata,
				updated_at: new Date().toISOString()
			})
			.eq('id', trip.id)
			.eq('user_id', userData.user.id)
			.select()
			.single();

		if (updateError) {
			throw new Error(updateError.message || 'Failed to update trip');
		}

		// Calculate distance if dates provided
		if (updatedTrip.start_date && updatedTrip.end_date) {
			const distanceTraveled = await this.calculateTripDistance(
				userData.user.id,
				updatedTrip.start_date,
				updatedTrip.end_date
			);

			const { error: distanceUpdateError } = await fluxbase
				.from('trips')
				.update({
					metadata: {
						...(updatedTrip.metadata || {}),
						distanceTraveled
					}
				})
				.eq('id', updatedTrip.id);

			if (!distanceUpdateError) {
				updatedTrip.metadata = { ...(updatedTrip.metadata || {}), distanceTraveled };
			}
		}

		return updatedTrip;
	}

	/**
	 * Retrieves location data associated with trips.
	 * Can include tracker data, locations, and POI visits.
	 *
	 * @param options - Options for filtering and selecting data types
	 * @param options.startDate - Filter by start date (YYYY-MM-DD)
	 * @param options.endDate - Filter by end date (YYYY-MM-DD)
	 * @param options.limit - Maximum records to return (default: 1000)
	 * @param options.offset - Records to skip for pagination
	 * @param options.includeTrackerData - Include raw tracker data
	 * @param options.includeLocations - Include processed locations
	 * @param options.includePOIs - Include POI visits
	 * @returns Promise resolving to object with requested data arrays
	 * @throws Error if user is not authenticated
	 *
	 * @example
	 * ```typescript
	 * const locationData = await tripsAdapter.getTripsLocations({
	 *   startDate: '2024-01-01',
	 *   endDate: '2024-12-31',
	 *   includeTrackerData: true,
	 *   includePOIs: true
	 * });
	 * console.log(`Found ${locationData.tracker_data.length} tracker points`);
	 * ```
	 */
	async getTripsLocations(options?: {
		startDate?: string;
		endDate?: string;
		limit?: number;
		offset?: number;
		includeTrackerData?: boolean;
		includeLocations?: boolean;
		includePOIs?: boolean;
	}) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const result: Record<string, unknown[]> = {};
		const limit = options?.limit || 1000;
		const offset = options?.offset || 0;

		if (options?.includeTrackerData) {
			let query = fluxbase
				.from('tracker_data')
				.select('*')
				.eq('user_id', userData.user.id)
				.order('recorded_at', { ascending: false })
				.range(offset, offset + limit - 1);

			if (options?.startDate) {
				query = query.gte('recorded_at', `${options.startDate}T00:00:00Z`);
			}
			if (options?.endDate) {
				query = query.lte('recorded_at', `${options.endDate}T23:59:59Z`);
			}

			const { data: trackerData } = await query;
			result.tracker_data = trackerData || [];
		}

		if (options?.includeLocations) {
			let query = fluxbase
				.from('locations')
				.select('*')
				.eq('user_id', userData.user.id)
				.order('created_at', { ascending: false })
				.range(offset, offset + limit - 1);

			if (options?.startDate) {
				query = query.gte('created_at', `${options.startDate}T00:00:00Z`);
			}
			if (options?.endDate) {
				query = query.lte('created_at', `${options.endDate}T23:59:59Z`);
			}

			const { data: locations } = await query;
			result.locations = locations || [];
		}

		if (options?.includePOIs) {
			let query = fluxbase
				.from('poi_visits')
				.select('*')
				.eq('user_id', userData.user.id)
				.order('visited_at', { ascending: false })
				.range(offset, offset + limit - 1);

			if (options?.startDate) {
				query = query.gte('visited_at', `${options.startDate}T00:00:00Z`);
			}
			if (options?.endDate) {
				query = query.lte('visited_at', `${options.endDate}T23:59:59Z`);
			}

			const { data: pois } = await query;
			result.pois = pois || [];
		}

		return result;
	}

	/**
	 * Retrieves AI-suggested trips (pending status) for the user.
	 * These are trips auto-generated by the trip detection algorithm.
	 *
	 * @param options - Pagination options
	 * @returns Promise resolving to object with trips array and pagination info
	 * @throws Error if user is not authenticated or query fails
	 *
	 * @example
	 * ```typescript
	 * const { trips, total } = await tripsAdapter.getSuggestedTrips({ limit: 10 });
	 * console.log(`${trips.length} of ${total} suggested trips`);
	 * ```
	 */
	async getSuggestedTrips(options?: { limit?: number; offset?: number }) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const limit = options?.limit || 50;
		const offset = options?.offset || 0;

		const {
			data: trips,
			error,
			count
		} = await fluxbase
			.from('trips')
			.select('*', { count: 'exact' })
			.eq('user_id', userData.user.id)
			.eq('status', 'pending')
			.order('created_at', { ascending: false })
			.range(offset, offset + limit - 1);

		if (error) {
			throw new Error(error.message || 'Failed to fetch suggested trips');
		}

		return {
			trips: trips || [],
			total: count || 0,
			limit,
			offset
		};
	}

	/**
	 * Deletes all suggested and rejected trips for the user.
	 * Use with caution as this cannot be undone.
	 *
	 * @returns Promise resolving to success message
	 * @throws Error if user is not authenticated or deletion fails
	 *
	 * @example
	 * ```typescript
	 * await tripsAdapter.clearAllSuggestedTrips();
	 * console.log('All suggested trips cleared');
	 * ```
	 */
	async clearAllSuggestedTrips() {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { error } = await fluxbase
			.from('trips')
			.delete()
			.eq('user_id', userData.user.id)
			.in('status', ['pending', 'rejected']);

		if (error) {
			throw new Error(error.message || 'Failed to clear suggested trips');
		}

		return { message: 'Suggested trips cleared successfully' };
	}

	/**
	 * Approves suggested trips, converting them to completed status.
	 * Calculates distance, applies pre-generated images, and triggers follow-up jobs.
	 *
	 * @param tripIds - Array of trip IDs to approve
	 * @param preGeneratedImages - Optional map of trip IDs to pre-generated images
	 * @returns Promise resolving to results with success/failure for each trip
	 * @throws Error if user is not authenticated or no trips found
	 *
	 * @example
	 * ```typescript
	 * const result = await tripsAdapter.approveSuggestedTrips(
	 *   ['trip-1', 'trip-2'],
	 *   { 'trip-1': { image_url: 'https://...', attribution: {...} } }
	 * );
	 * console.log(`Approved ${result.approved.length} trips`);
	 * ```
	 */
	async approveSuggestedTrips(
		tripIds: string[],
		preGeneratedImages?: Record<string, PreGeneratedImage>
	) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: trips, error: fetchError } = await fluxbase
			.from('trips')
			.select('*')
			.eq('user_id', userData.user.id)
			.in('id', tripIds);

		if (fetchError) {
			throw new Error(fetchError.message || 'Failed to fetch trips');
		}

		if (!trips || trips.length === 0) {
			throw new Error('No trips found to approve');
		}

		const approvedTrips = [];
		for (const trip of trips) {
			let distanceTraveled = 0;
			if (trip.start_date && trip.end_date) {
				distanceTraveled = await this.calculateTripDistance(
					userData.user.id,
					trip.start_date,
					trip.end_date
				);
			}

			const updatedMetadata: Record<string, unknown> = {
				...(trip.metadata || {}),
				distanceTraveled
			};

			let imageUrl: string | undefined;
			if (preGeneratedImages && preGeneratedImages[trip.id]) {
				imageUrl = preGeneratedImages[trip.id].image_url;
				updatedMetadata.image_attribution = preGeneratedImages[trip.id].attribution;
			}

			const updateData: Record<string, unknown> = {
				status: 'completed',
				metadata: updatedMetadata,
				updated_at: new Date().toISOString()
			};

			if (imageUrl) {
				updateData.image_url = imageUrl;
			}

			const { data: updatedTrip, error: updateError } = await fluxbase
				.from('trips')
				.update(updateData)
				.eq('id', trip.id)
				.eq('user_id', userData.user.id)
				.select()
				.single();

			if (updateError) {
				console.error(`Failed to approve trip ${trip.id}:`, updateError);
				approvedTrips.push({ tripId: trip.id, success: false, error: updateError.message });
				continue;
			}

			approvedTrips.push({ tripId: updatedTrip.id, success: true, trip: updatedTrip });
		}

		const result = { results: approvedTrips, approved: approvedTrips.filter((t) => t.success) };

		// Trigger follow-up jobs
		const successfullyApproved = approvedTrips.filter((t) => t.success);
		if (successfullyApproved.length > 0) {
			try {
				await fluxbase.jobs.submit('sync-trip-embeddings', {}, { namespace: 'wayli', priority: 5 });
			} catch {
				// Non-fatal
			}

			try {
				(fluxbase.rpc as any)
					.invoke('detect-place-visits-incremental', {}, { namespace: 'wayli' })
					.catch(() => {});
			} catch {
				// Non-fatal
			}
		}

		return result;
	}

	/**
	 * Generates images for multiple suggested trips using AI.
	 * Calls the image suggestion API for each trip in sequence.
	 *
	 * @param suggestedTripIds - Array of trip IDs to generate images for
	 * @returns Promise resolving to results array with image data or errors
	 *
	 * @example
	 * ```typescript
	 * const { results } = await tripsAdapter.generateSuggestedTripImages(['trip-1', 'trip-2']);
	 * results.forEach(r => {
	 *   if (r.success) console.log(`Image for ${r.suggested_trip_id}: ${r.image_url}`);
	 * });
	 * ```
	 */
	async generateSuggestedTripImages(
		suggestedTripIds: string[]
	): Promise<{ results: SuggestedImageResult[] }> {
		const results: SuggestedImageResult[] = [];

		for (const tripId of suggestedTripIds) {
			try {
				const result = await this.suggestTripImages(tripId);
				const data =
					result && typeof result === 'object' && 'data' in result
						? (result as { data: Record<string, unknown> }).data
						: result;

				const imageUrl =
					data && typeof data === 'object' && 'suggestedImageUrl' in data
						? (data as { suggestedImageUrl?: string }).suggestedImageUrl
						: undefined;
				const attribution =
					data && typeof data === 'object' && 'attribution' in data
						? (data as { attribution?: unknown }).attribution
						: undefined;
				const analysis =
					data && typeof data === 'object' && 'analysis' in data
						? (data as { analysis?: unknown }).analysis
						: undefined;

				results.push({
					suggested_trip_id: tripId,
					success: !!imageUrl,
					image_url: imageUrl,
					attribution,
					analysis
				});
			} catch (error) {
				results.push({
					suggested_trip_id: tripId,
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return { results };
	}

	/**
	 * Rejects suggested trips, marking them with 'rejected' status.
	 * Rejected trips can be cleared later with clearAllSuggestedTrips.
	 *
	 * @param tripIds - Array of trip IDs to reject
	 * @returns Promise resolving to object with rejected trips array
	 * @throws Error if user is not authenticated or rejection fails
	 *
	 * @example
	 * ```typescript
	 * const { rejected } = await tripsAdapter.rejectSuggestedTrips(['trip-1', 'trip-2']);
	 * console.log(`Rejected ${rejected.length} trips`);
	 * ```
	 */
	async rejectSuggestedTrips(tripIds: string[]) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: rejectedTrips, error } = await fluxbase
			.from('trips')
			.update({
				status: 'rejected',
				updated_at: new Date().toISOString()
			})
			.eq('user_id', userData.user.id)
			.in('id', tripIds)
			.select();

		if (error) {
			throw new Error(error.message || 'Failed to reject trips');
		}

		return { rejected: rejectedTrips || [] };
	}

	/**
	 * Converts a single suggested trip to a completed trip.
	 * Calculates distance based on tracker data within the trip dates.
	 *
	 * @param suggestedTripId - The ID of the suggested trip to approve
	 * @returns Promise resolving to the completed trip
	 * @throws Error if trip not found or conversion fails
	 *
	 * @example
	 * ```typescript
	 * const completedTrip = await tripsAdapter.createTripFromSuggestion('suggested-trip-id');
	 * console.log(`Created trip: ${completedTrip.title}`);
	 * ```
	 */
	async createTripFromSuggestion(suggestedTripId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: trip, error: fetchError } = await fluxbase
			.from('trips')
			.select('*')
			.eq('id', suggestedTripId)
			.eq('user_id', userData.user.id)
			.eq('status', 'pending')
			.single();

		if (fetchError || !trip) {
			throw new Error('Suggested trip not found');
		}

		let distanceTraveled = 0;
		if (trip.start_date && trip.end_date) {
			distanceTraveled = await this.calculateTripDistance(
				userData.user.id,
				trip.start_date,
				trip.end_date
			);
		}

		const { data: activeTrip, error: updateError } = await fluxbase
			.from('trips')
			.update({
				status: 'completed',
				metadata: {
					...(trip.metadata || {}),
					distanceTraveled
				},
				updated_at: new Date().toISOString()
			})
			.eq('id', suggestedTripId)
			.eq('user_id', userData.user.id)
			.select()
			.single();

		if (updateError) {
			throw new Error(updateError.message || 'Failed to create trip from suggestion');
		}

		return activeTrip;
	}

	/**
	 * Suggests images for a trip using AI analysis.
	 * Calls the trips-suggest-image edge function.
	 *
	 * @param tripIdOrDateRange - Either a trip ID or date range object
	 * @returns Promise resolving to image suggestion response
	 *
	 * @example
	 * ```typescript
	 * // By trip ID
	 * const result = await tripsAdapter.suggestTripImages('trip-uuid');
	 *
	 * // By date range
	 * const result = await tripsAdapter.suggestTripImages({
	 *   start_date: '2024-07-01',
	 *   end_date: '2024-07-14'
	 * });
	 * ```
	 */
	async suggestTripImages(tripIdOrDateRange: string | { start_date: string; end_date: string }) {
		const body =
			typeof tripIdOrDateRange === 'string' ? { trip_id: tripIdOrDateRange } : tripIdOrDateRange;

		return this.callApi('trips-suggest-image', {
			method: 'POST',
			body
		});
	}
}
