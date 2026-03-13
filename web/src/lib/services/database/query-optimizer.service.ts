import { errorHandler } from '../error-handler.service';

import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

interface QueryCacheEntry<T> {
	data: T;
	timestamp: number;
	ttl: number;
}

interface BatchQuery<T> {
	id: string;
	query: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

class QueryOptimizerService {
	private cache = new Map<string, QueryCacheEntry<unknown>>();
	private batchQueries = new Map<string, BatchQuery<unknown>[]>();
	private batchTimeouts = new Map<string, NodeJS.Timeout>();
	private fluxbase: FluxbaseClient | null = null;

	// Cache configuration
	private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
	private readonly MAX_CACHE_SIZE = 1000;
	private readonly BATCH_DELAY = 10; // 10ms batch window

	setFluxbaseClient(client: FluxbaseClient) {
		this.fluxbase = client;
	}

	// Cached query execution
	async cachedQuery<T>(
		key: string,
		queryFn: () => Promise<T>,
		ttl: number = this.DEFAULT_TTL
	): Promise<T> {
		// Check cache first
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.timestamp < cached.ttl) {
			return cached.data as T;
		}

		// Execute query and cache result
		try {
			const result = await queryFn();
			this.setCache(key, result, ttl);
			return result;
		} catch (error) {
			throw errorHandler.handleDatabaseError(error, { cacheKey: key });
		}
	}

	// Batch query execution
	async batchedQuery<T>(batchKey: string, queryId: string, queryFn: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			const batchQuery: BatchQuery<T> = {
				id: queryId,
				query: queryFn,
				resolve,
				reject
			};

			// Add to batch
			if (!this.batchQueries.has(batchKey)) {
				this.batchQueries.set(batchKey, []);
			}
			this.batchQueries.get(batchKey)!.push(batchQuery as BatchQuery<unknown>);

			// Schedule batch execution
			if (!this.batchTimeouts.has(batchKey)) {
				const timeout = setTimeout(() => {
					this.executeBatch(batchKey);
				}, this.BATCH_DELAY);
				this.batchTimeouts.set(batchKey, timeout);
			}
		});
	}

	// Optimized user profile queries
	async getUserProfileWithPreferences(userId: string) {
		const cacheKey = `user_profile_${userId}`;
		return this.cachedQuery(
			cacheKey,
			async () => {
				if (!this.fluxbase) throw new Error('Fluxbase client not initialized');

				const { data, error } = await this.fluxbase
					.from('user_profiles')
					.select(
						`
          *,
          user_preferences (*)
        `
					)
					.eq('id', userId)
					.single();

				if (error) throw error;
				return data;
			},
			10 * 60 * 1000
		); // 10 minutes cache
	}

	// Optimized trip queries with pagination
	async getTripsWithPagination(
		userId: string,
		page: number = 1,
		limit: number = 10,
		filters?: Record<string, unknown>
	) {
		const cacheKey = `trips_${userId}_${page}_${limit}_${JSON.stringify(filters)}`;
		return this.cachedQuery(
			cacheKey,
			async () => {
				if (!this.fluxbase) throw new Error('Fluxbase client not initialized');

				let query = this.fluxbase
					.from('trips')
					.select('*', { count: 'exact' })
					.eq('user_id', userId)
					.order('created_at', { ascending: false });

				// Apply filters
				if (filters) {
					Object.entries(filters).forEach(([key, value]) => {
						if (value !== undefined && value !== null) {
							query = query.eq(key, value);
						}
					});
				}

				// Apply pagination
				const offset = (page - 1) * limit;
				query = query.range(offset, offset + limit - 1);

				const { data, error, count } = await query;

				if (error) throw error;

				return {
					data,
					pagination: {
						page,
						limit,
						total: count || 0,
						totalPages: Math.ceil((count || 0) / limit),
						hasNext: page * limit < (count || 0),
						hasPrev: page > 1
					}
				};
			},
			2 * 60 * 1000
		); // 2 minutes cache
	}

	// Optimized statistics queries
	async getUserStatistics(userId: string, startDate?: string, endDate?: string) {
		const cacheKey = `stats_${userId}_${startDate}_${endDate}`;
		return this.cachedQuery(
			cacheKey,
			async () => {
				if (!this.fluxbase) throw new Error('Fluxbase client not initialized');

				// Build date filter
				let dateFilter = '';
				if (startDate && endDate) {
					dateFilter = `AND created_at >= '${startDate}' AND created_at <= '${endDate}'`;
				} else if (startDate) {
					dateFilter = `AND created_at >= '${startDate}'`;
				} else if (endDate) {
					dateFilter = `AND created_at <= '${endDate}'`;
				}

				// Execute optimized statistics queries
				const [tripsResult, locationsResult, poiResult] = await Promise.all([
					this.fluxbase.rpc('get_user_trip_stats', {
						user_id: userId,
						date_filter: dateFilter
					}),
					this.fluxbase.rpc('get_user_location_stats', {
						user_id: userId,
						date_filter: dateFilter
					}),
					this.fluxbase.rpc('get_user_poi_stats', {
						user_id: userId,
						date_filter: dateFilter
					})
				]);

				if (tripsResult.error) throw tripsResult.error;
				if (locationsResult.error) throw locationsResult.error;
				if (poiResult.error) throw poiResult.error;

				return {
					trips: tripsResult.data,
					locations: locationsResult.data,
					poi: poiResult.data
				};
			},
			5 * 60 * 1000
		); // 5 minutes cache
	}

	// Note: getJobsWithStatus() removed - Jobs are now managed by Fluxbase (jobs.queue)
	// Use fluxbase.jobs.list() instead via the service adapter

	// Batch location reverse geocoding
	async batchReverseGeocode(coordinates: Array<{ lat: number; lng: number }>) {
		const batchKey = 'reverse_geocode';
		const promises = coordinates.map((coord) =>
			this.batchedQuery(batchKey, `${coord.lat}_${coord.lng}`, async () => {
				// Individual geocoding logic here
				return { lat: coord.lat, lng: coord.lng, address: 'Geocoded address' };
			})
		);

		return Promise.all(promises);
	}

	// Cache management
	private setCache<T>(key: string, data: T, ttl: number): void {
		// Implement LRU cache eviction
		if (this.cache.size >= this.MAX_CACHE_SIZE) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			ttl
		});
	}

	private async executeBatch(batchKey: string): Promise<void> {
		const queries = this.batchQueries.get(batchKey) || [];
		this.batchQueries.delete(batchKey);
		this.batchTimeouts.delete(batchKey);

		if (queries.length === 0) return;

		// Execute all queries in parallel
		const results = await Promise.allSettled(queries.map((query) => query.query()));

		// Resolve/reject each promise
		results.forEach((result, index) => {
			const query = queries[index];
			if (result.status === 'fulfilled') {
				query.resolve(result.value);
			} else {
				query.reject(result.reason);
			}
		});
	}

	// Cache invalidation
	invalidateCache(pattern: string): void {
		for (const key of this.cache.keys()) {
			if (key.includes(pattern)) {
				this.cache.delete(key);
			}
		}
	}

	clearCache(): void {
		this.cache.clear();
	}

	// Cache statistics
	getCacheStats(): { size: number; keys: string[] } {
		return {
			size: this.cache.size,
			keys: Array.from(this.cache.keys())
		};
	}

	// Database indexing recommendations
	getIndexingRecommendations(): string[] {
		return [
			'CREATE INDEX IF NOT EXISTS idx_trips_user_id_created_at ON trips(user_id, created_at DESC);',
			// Note: idx_jobs_created_by_status removed - Jobs are now managed by Fluxbase (jobs.queue)
			'CREATE INDEX IF NOT EXISTS idx_user_profiles_id ON user_profiles(id);',
			'CREATE INDEX IF NOT EXISTS idx_trip_exclusions_user_id ON trip_exclusions(user_id);',
			'CREATE INDEX IF NOT EXISTS idx_poi_visits_user_id_visit_date ON poi_visits(user_id, visit_date DESC);',
			'CREATE INDEX IF NOT EXISTS idx_locations_user_id_created_at ON locations(user_id, created_at DESC);'
		];
	}
}

// Export singleton instance
export const queryOptimizer = new QueryOptimizerService();

// Helper functions for common query patterns
export const optimizedQueries = {
	// Get user profile with preferences
	getUserProfile: (userId: string) => queryOptimizer.getUserProfileWithPreferences(userId),

	// Get paginated trips
	getTrips: (userId: string, page?: number, limit?: number, filters?: Record<string, unknown>) =>
		queryOptimizer.getTripsWithPagination(userId, page, limit, filters),

	// Get user statistics
	getStatistics: (userId: string, startDate?: string, endDate?: string) =>
		queryOptimizer.getUserStatistics(userId, startDate, endDate),

	// Note: getJobs removed - Jobs are now managed by Fluxbase (jobs.queue)
	// Use serviceAdapter.getJobs() instead

	// Batch reverse geocoding
	batchGeocode: (coordinates: Array<{ lat: number; lng: number }>) =>
		queryOptimizer.batchReverseGeocode(coordinates)
};
