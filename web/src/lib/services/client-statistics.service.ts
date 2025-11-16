// src/lib/services/client-statistics.service.ts
// Client-side statistics calculation service for processing tracker data incrementally

import { fluxbase } from '$lib/fluxbase';
import {
	detectEnhancedMode,
	createEnhancedModeContext,
	type EnhancedModeContext
} from '$lib/utils/enhanced-transport-mode';
import { haversine } from '$lib/utils/multi-point-speed';
import {
	isAtTrainStation,
	getTrainStationName,
	isAtAirport,
	getAirportName
} from '$lib/utils/transport-mode';
import type { GeocodeGeoJSONFeature } from '$lib/utils/geojson-converter';
import { TransportDetectionReason } from '$lib/types/transport-mode.types';

import type { FluxbaseClient } from '@fluxbase/sdk';

// Type for visit data tracking
export interface VisitData {
	visitCount: number;
	timeSpent: number; // in milliseconds
	lastVisit: string; // ISO timestamp
}

// Optimized data structure for statistics calculation
export interface ClientStatistics {
	// Basic counts
	totalPoints: number;
	geopoints: number;

	// Distance and time
	totalDistance: number; // in meters
	timeSpentMoving: number; // in milliseconds

	// Unique tracking (using Maps for efficiency)
	uniqueCities: Map<string, VisitData>; // city key -> visit data
	uniqueCountries: Map<string, VisitData>; // country code -> visit data

	// Transport mode statistics
	transportModes: Map<
		string,
		{
			distance: number;
			time: number;
			points: number;
		}
	>;

	// Train station visits
	trainStationVisits: Map<string, number[]>; // station name -> timestamps

	// Country time distribution
	countryTimeDistribution: Map<string, number>; // country code -> time in ms

	// Geocoding statistics
	geocodingStats: {
		total: number;
		geocoded: number;
		successRate: number;
	};

	// Metadata
	dateRange: {
		startDate?: string;
		endDate?: string;
	};
	lastProcessedAt?: string;
}

// Raw tracker data point (minimal fields for processing)
export interface TrackerDataPoint {
	recorded_at: string;
	time_spent?: number;
	country_code?: string;
	location?: {
		type: string;
		coordinates: number[];
		crs?: { type: string; properties: { name: string } };
	}; // GeoJSON Point object
	coordinates?: number[]; // GeoJSON coordinates array [lon, lat] (fallback)
	speed?: number; // Speed in m/s from database
	distance?: number; // Distance in meters from previous point
	tz_diff?: number; // Timezone difference from UTC in hours
	type?: string;
	class?: string;
	addresstype?: string;
	city?: string;
	village?: string;
	transport_mode?: string;
	velocity?: number;
	detection_reason?: string;
}

// Progress callback for loading updates
export type ProgressCallback = (progress: {
	percentage: number;
	stage: string;
	pointsLoaded: number;
	totalPoints: number;
	currentBatch: number;
	totalBatches: number;
}) => void;

// Error callback for handling errors
export type ErrorCallback = (error: Error, canRetry: boolean) => void;

export class ClientStatisticsService {
	private fluxbase: FluxbaseClient;
	private statistics: ClientStatistics;
	private transportContext: EnhancedModeContext;
	private isProcessing: boolean = false;
	private currentOffset: number = 0;
	private totalCount: number = 0;
	private batchSize: number = 1000;
	private maxRetries: number = 3;
	private retryDelay: number = 1000; // 1 second
	private rawDataPoints: TrackerDataPoint[] = [];
	private isUsingSampledData: boolean = false;

	constructor(fluxbaseClient?: FluxbaseClient) {
		this.fluxbase = fluxbaseClient || fluxbase;
		this.statistics = this.initializeStatistics();
		this.transportContext = this.initializeTransportContext();
	}

	/**
	 * Initialize empty statistics object
	 */
	private initializeStatistics(): ClientStatistics {
		return {
			totalPoints: 0,
			geopoints: 0,
			totalDistance: 0,
			timeSpentMoving: 0,
			uniqueCities: new Map(),
			uniqueCountries: new Map(),
			transportModes: new Map(),
			trainStationVisits: new Map(),
			countryTimeDistribution: new Map(),
			geocodingStats: {
				total: 0,
				geocoded: 0,
				successRate: 0
			},
			dateRange: {}
		};
	}

	/**
	 * Create a GeoJSON Feature object from tracker data point
	 */
	private createGeocodeFeature(point: TrackerDataPoint): GeocodeGeoJSONFeature | null {
		const coords = this.extractCoordinates(point);
		if (!coords) return null;

		return {
			type: 'Feature',
			geometry: {
				type: 'Point',
				coordinates: [coords[0], coords[1]] // [lng, lat]
			},
			properties: {
				type: point.type || undefined,
				class: point.class || undefined,
				addresstype: point.addresstype || undefined,
				address: {
					...(point.city && { city: point.city }),
					...(point.village && { village: point.village })
				},
				geocoded_at: new Date().toISOString(),
				geocoding_provider: 'database'
			}
		};
	}

	/**
	 * Initialize transport mode detection context
	 */
	private initializeTransportContext(): EnhancedModeContext {
		return createEnhancedModeContext();
	}

	/**
	 * Get total count of tracker data points for a user
	 */
	async getTotalCount(userId: string, startDate?: string, endDate?: string): Promise<number> {
		console.log('📊 Getting total count for user:', userId);

		let query = this.fluxbase
			.from('tracker_data')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', userId)
			.not('location', 'is', null);

		if (startDate) {
			query = query.gte('recorded_at', startDate);
		}
		if (endDate) {
			query = query.lte('recorded_at', endDate + ' 23:59:59');
		}

		const { count, error } = await query;

		if (error) {
			console.error('❌ Error getting total count:', error);
			throw new Error(`Failed to get total count: ${error.message}`);
		}

		const total = count || 0;
		console.log(`📊 Total count: ${total.toLocaleString()} points`);
		return total;
	}

	/**
	 * Load and process tracker data in batches
	 */
	async loadAndProcessData(
		userId: string,
		startDate?: string,
		endDate?: string,
		onProgress?: ProgressCallback,
		onError?: ErrorCallback
	): Promise<ClientStatistics> {
		if (this.isProcessing) {
			throw new Error('Already processing data');
		}

		this.isProcessing = true;
		this.statistics = this.initializeStatistics();
		this.transportContext = this.initializeTransportContext();
		this.currentOffset = 0;
		this.isUsingSampledData = false;

		try {
			// Get total count first
			onProgress?.({
				percentage: 0,
				stage: 'Counting records...',
				pointsLoaded: 0,
				totalPoints: 0,
				currentBatch: 0,
				totalBatches: 0
			});

			this.totalCount = await this.getTotalCount(userId, startDate, endDate);
			this.statistics.dateRange = { startDate, endDate };

			if (this.totalCount === 0) {
				onProgress?.({
					percentage: 100,
					stage: 'No data found',
					pointsLoaded: 0,
					totalPoints: 0,
					currentBatch: 0,
					totalBatches: 0
				});
				return this.statistics;
			}

			const totalBatches = Math.ceil(this.totalCount / this.batchSize);
			let pointsLoaded = 0;
			let batchesCompleted = 0;

			onProgress?.({
				percentage: 0,
				stage: `Found ${this.totalCount.toLocaleString()} records. Loading data...`,
				pointsLoaded: 0,
				totalPoints: this.totalCount,
				currentBatch: 0,
				totalBatches
			});

			// Check if we should use smart sampling for large datasets
			if (this.totalCount > 2000) {
				console.log(`🧠 Using smart sampling for large dataset (${this.totalCount} points)`);

				onProgress?.({
					percentage: 50,
					stage: 'Loading sampled data...',
					pointsLoaded: 0,
					totalPoints: this.totalCount,
					currentBatch: 1,
					totalBatches: 1
				});

				try {
					// Load sampled data in chunks for better performance
					const allSampledData: TrackerDataPoint[] = [];
					const chunkSize = 1000;
					let currentOffset = 0;
					let hasMore = true;
					let samplingWasApplied = false;

					while (hasMore) {
						const { data: chunkData, samplingApplied } = await this.loadSmartSampledData(
							userId,
							startDate,
							endDate,
							currentOffset,
							chunkSize,
							this.totalCount
						);
						allSampledData.push(...chunkData);

						// Track if sampling was applied in any chunk
						if (samplingApplied) {
							samplingWasApplied = true;
						}

						onProgress?.({
							percentage: 50 + (currentOffset / this.totalCount) * 25,
							stage: 'Loading sampled data...',
							pointsLoaded: allSampledData.length,
							totalPoints: this.totalCount,
							currentBatch: Math.floor(currentOffset / chunkSize) + 1,
							totalBatches: Math.ceil(this.totalCount / chunkSize)
						});

						// Check if we have more data to load
						hasMore = chunkData.length === chunkSize;
						currentOffset += chunkSize;

						// Safety check to prevent infinite loops
						if (currentOffset > this.totalCount) {
							hasMore = false;
						}
					}

					// Set the flag for use in processBatch
					this.isUsingSampledData = samplingWasApplied;

					onProgress?.({
						percentage: 75,
						stage: 'Processing sampled data...',
						pointsLoaded: allSampledData.length,
						totalPoints: this.totalCount,
						currentBatch: 1,
						totalBatches: 1
					});

					console.log(`📊 Sampling applied: ${this.isUsingSampledData}`);

					// Process the sampled data
					this.processBatch(allSampledData);
					pointsLoaded = allSampledData.length;
					batchesCompleted = 1;
				} catch (samplingError) {
					console.error(
						'❌ Smart sampling failed, falling back to regular batch loading:',
						samplingError
					);

					// Fallback to regular batch loading
					onProgress?.({
						percentage: 0,
						stage: 'Falling back to regular loading...',
						pointsLoaded: 0,
						totalPoints: this.totalCount,
						currentBatch: 0,
						totalBatches
					});

					// Reset offset for regular loading
					this.currentOffset = 0;

					// Load data in batches
					while (this.currentOffset < this.totalCount) {
						const currentBatch = Math.floor(this.currentOffset / this.batchSize) + 1;

						onProgress?.({
							percentage: Math.round((batchesCompleted / totalBatches) * 100),
							stage: `Loading batch ${currentBatch} of ${totalBatches}...`,
							pointsLoaded,
							totalPoints: this.totalCount,
							currentBatch,
							totalBatches
						});

						const batchData = await this.loadBatch(userId, startDate, endDate);
						if (batchData.length === 0) break;

						// Process the batch
						this.processBatch(batchData);
						pointsLoaded += batchData.length;
						this.currentOffset += this.batchSize;
						batchesCompleted++;

						// Small delay to prevent overwhelming the browser
						await new Promise((resolve) => setTimeout(resolve, 10));
					}
				}
			} else {
				// Load data in batches for smaller datasets
				while (this.currentOffset < this.totalCount) {
					const currentBatch = Math.floor(this.currentOffset / this.batchSize) + 1;

					onProgress?.({
						percentage: Math.round((batchesCompleted / totalBatches) * 100),
						stage: `Loading batch ${currentBatch} of ${totalBatches}...`,
						pointsLoaded,
						totalPoints: this.totalCount,
						currentBatch,
						totalBatches
					});

					const batchData = await this.loadBatch(userId, startDate, endDate);
					if (batchData.length === 0) break;

					// Process the batch
					this.processBatch(batchData);
					pointsLoaded += batchData.length;
					this.currentOffset += this.batchSize;
					batchesCompleted++;

					// Small delay to prevent overwhelming the browser
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}

			// Finalize statistics
			this.finalizeStatistics();

			onProgress?.({
				percentage: 100,
				stage: 'Processing complete!',
				pointsLoaded,
				totalPoints: this.totalCount,
				currentBatch: totalBatches,
				totalBatches
			});

			return this.statistics;
		} catch (error) {
			console.error('❌ Error loading and processing data:', error);
			onError?.(error as Error, true);
			throw error;
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Load a single batch of tracker data
	 */
	private async loadBatch(
		userId: string,
		startDate?: string,
		endDate?: string
	): Promise<TrackerDataPoint[]> {
		let query = this.fluxbase
			.from('tracker_data')
			.select(
				`
				recorded_at,
				time_spent,
				country_code,
				location,
				speed,
				distance,
				tz_diff,
				geocode->properties->>type,
				geocode->properties->>class,
				geocode->properties->>addresstype,
				geocode->properties->>city,
				geocode->properties->address->>city,
				geocode->properties->address->>village
			`
			)
			.eq('user_id', userId)
			.not('location', 'is', null)
			.order('recorded_at', { ascending: true })
			.range(this.currentOffset, this.currentOffset + this.batchSize - 1);

		if (startDate) {
			query = query.gte('recorded_at', startDate);
		}
		if (endDate) {
			query = query.lte('recorded_at', endDate + ' 23:59:59');
		}

		const { data, error } = await query;

		if (error) {
			console.error('❌ Error loading batch:', error);
			throw new Error(`Failed to load batch: ${error.message}`);
		}

		// Process the data to handle COALESCE logic for city field
		const processedData =
			(data as any[])?.map((point) => ({
				...point,
				city: point.city || point.address_city || null
			})) || [];

		return processedData;
	}

	/**
	 * Load data using smart sampling for large datasets
	 */
	private async loadSmartSampledData(
		userId: string,
		startDate?: string,
		endDate?: string,
		offset: number = 0,
		limit: number = 1000,
		totalCount?: number
	): Promise<{ data: TrackerDataPoint[]; samplingApplied: boolean }> {
		try {
			// Get session for authentication
			const {
				data: { session },
				error: sessionError
			} = await this.fluxbase.auth.getSession();
			if (sessionError || !session) {
				throw new Error('User not authenticated');
			}

			// Call the smart sampling Edge Function
			const response = await fetch(`${this.getFunctionsUrl()}/tracker-data-smart`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.access_token}`
				},
				body: JSON.stringify({
					userId,
					startDate,
					endDate,
					maxPointsThreshold: 1000, // More aggressive threshold
					offset,
					limit,
					totalCount // Pass the already calculated total count
				})
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();

			if (result.error) {
				throw new Error(result.error);
			}

			const samplingApplied = result.metadata?.samplingApplied || false;

			console.log(`🧠 Smart sampling result:`, {
				returnedCount: result.metadata?.returnedCount || 0,
				totalCount: result.metadata?.totalCount || 0,
				samplingApplied,
				samplingLevel: result.metadata?.samplingLevel || 'unknown',
				samplingParams: result.metadata?.samplingParams || {}
			});

			// Transform the data to match the expected format
			const data = (result.data || []).map((point: any) => ({
				recorded_at: point.recorded_at,
				time_spent: point.time_spent,
				country_code: point.country_code,
				location: point.location,
				speed: point.speed,
				distance: point.distance,
				tz_diff: point.tz_diff,
				type: point.geocode?.properties?.type,
				class: point.geocode?.properties?.class,
				addresstype: point.geocode?.properties?.addresstype,
				city: point.geocode?.properties?.city || point.geocode?.properties?.address?.city,
				village: point.geocode?.properties?.address?.village
			}));

			return { data, samplingApplied };
		} catch (error) {
			console.error('❌ Error loading smart sampled data:', error);
			// Fallback to regular loading if smart sampling fails
			console.log('🔄 Falling back to regular batch loading...');
			throw error; // Let the calling method handle the fallback
		}
	}

	/**
	 * Get the functions URL for Edge Function calls
	 */
	private getFunctionsUrl(): string {
		// Use environment variable or default to local development
		const fluxbaseUrl = import.meta.env.PUBLIC_FLUXBASE_BASE_URL || 'http://localhost:8080';
		return `${fluxbaseUrl}/functions/v1`;
	}

	/**
	 * Process a batch of tracker data points
	 */
	private processBatch(batch: TrackerDataPoint[]): void {
		console.log(`🔄 Processing batch of ${batch.length} points`);

		// Process points and add transport mode information
		const processedBatch = batch.map((point, index) => {
			const prevPoint = batch[index - 1];
			const nextPoint = batch[index + 1];
			let transportMode = 'unknown';
			let velocity = 0;
			let detectionReason = 'unknown';

			// Determine transport mode using database speed field
			if (point.speed !== undefined && point.speed !== null) {
				// Use database speed field for transport mode detection
				const currentCoords = this.extractCoordinates(point);
				const previousCoords = prevPoint ? this.extractCoordinates(prevPoint) : null;

				if (currentCoords) {
					// Create proper GeoJSON Feature for transport mode detection
					const currentGeocode = this.createGeocodeFeature(point);

					// Database stores speed in km/h, convert to m/s for detectEnhancedMode
					const speedMps = point.speed / 3.6;

					// Use actual previous coordinates if available, otherwise use current
					const prevLat = previousCoords ? previousCoords[1] : currentCoords[1];
					const prevLng = previousCoords ? previousCoords[0] : currentCoords[0];

					// Calculate actual time difference
					const timeDiff = prevPoint
						? this.calculateTimeSpent(prevPoint, point) / 1000 // convert ms to seconds
						: 1;

					// Use database speed for transport mode detection
					const { mode, reason } = detectEnhancedMode(
						prevLat,
						prevLng, // previous lat, lng
						currentCoords[1],
						currentCoords[0], // current lat, lng
						timeDiff, // actual time difference in seconds
						currentGeocode,
						this.transportContext,
						speedMps // pass speed in m/s (detectEnhancedMode will convert to km/h)
					);

					transportMode = mode;
					detectionReason = reason;

					// Database speed is already in km/h
					velocity = point.speed;
				}
			} else if (nextPoint) {
				// Fallback to calculated velocity if no database speed available
				const currentCoords = this.extractCoordinates(point);
				const nextCoords = this.extractCoordinates(nextPoint);

				if (currentCoords && nextCoords) {
					const distance = haversine(
						currentCoords[1],
						currentCoords[0], // lat, lng
						nextCoords[1],
						nextCoords[0]
					);
					const timeSpent = this.calculateTimeSpent(point, nextPoint);

					if (timeSpent > 0) {
						// Calculate velocity in km/h
						velocity = (distance / timeSpent) * 3.6;
						console.log(
							`🚗 Fallback velocity calculation: distance=${distance.toFixed(2)}m, time=${timeSpent}ms, velocity=${velocity.toFixed(2)}km/h`
						);

						// Create proper GeoJSON Feature for transport mode detection
						const currentGeocode = this.createGeocodeFeature(point);

						const { mode, reason } = detectEnhancedMode(
							currentCoords[1],
							currentCoords[0], // prev lat, lng
							nextCoords[1],
							nextCoords[0], // curr lat, lng
							timeSpent / 1000, // convert to seconds
							currentGeocode,
							this.transportContext
						);

						transportMode = mode;
						detectionReason = reason;
					}
				}
			}

			// Add transport mode, velocity, and detection reason to the point
			return {
				...point,
				transport_mode: transportMode,
				velocity: velocity,
				detection_reason: detectionReason
			};
		});

		// Store processed data points for map visualization with lat/lon properties
		const mapDataPoints = processedBatch.map((point) => {
			const coords = this.extractCoordinates(point);
			return {
				...point,
				lat: coords?.[1] || null,
				lon: coords?.[0] || null
			};
		});
		this.rawDataPoints.push(...mapDataPoints);

		for (let i = 0; i < processedBatch.length; i++) {
			const point = processedBatch[i];

			// Basic counting
			this.statistics.totalPoints++;
			this.statistics.geopoints++;

			// Process geocoding statistics
			this.processGeocodingStats(point);

			// Process country and place data
			this.processLocationData(point);

			// Use current point's distance and mode
			// The distance field on a point represents: distance FROM previous TO this point
			// The mode field on a point represents: how we ARRIVED at this point
			// So we should aggregate: point.distance → point.transport_mode
			if (point.transport_mode && point.distance && point.distance > 0) {
				const mode = point.transport_mode;
				const distance = point.distance;
				const timeSpent = point.time_spent ? point.time_spent * 1000 : 0; // convert to ms

				// Different time thresholds for different transport modes
				// Long-distance modes (train, car, plane) can have longer intervals between updates
				// Walking/cycling should have shorter intervals to avoid GPS drift
				const longDistanceModes = ['train', 'car', 'plane', 'bus', 'tram', 'metro'];
				const maxTimeSpent = longDistanceModes.includes(mode)
					? 7200000  // 2 hours for long-distance travel
					: 1800000; // 30 minutes for walking/cycling

				if (mode !== 'stationary' && timeSpent > 0 && timeSpent < maxTimeSpent) {
					// Update total statistics
					this.statistics.totalDistance += distance;
					this.statistics.timeSpentMoving += timeSpent;

					// Update transport mode statistics
					const modeStats = this.statistics.transportModes.get(mode) || {
						distance: 0,
						time: 0,
						points: 0
					};

					modeStats.distance += distance;
					modeStats.time += timeSpent;
					modeStats.points++;

					this.statistics.transportModes.set(mode, modeStats);

					// Update country time distribution
					if (point.country_code) {
						const currentTime = this.statistics.countryTimeDistribution.get(point.country_code) || 0;
						this.statistics.countryTimeDistribution.set(point.country_code, currentTime + timeSpent);
					}
				}
			}

			// Process train station visits
			this.processTrainStationVisit(point);
		}
	}

	/**
	 * Process geocoding statistics for a point
	 */
	private processGeocodingStats(point: TrackerDataPoint): void {
		this.statistics.geocodingStats.total++;

		if (this.hasValidGeocode(point)) {
			this.statistics.geocodingStats.geocoded++;
		}
	}

	/**
	 * Check if geocode data is valid and useful
	 */
	private hasValidGeocode(point: TrackerDataPoint): boolean {
		return !!(point.coordinates || point.type || point.class);
	}

	/**
	 * Process location data (countries and unique places)
	 */
	private processLocationData(point: TrackerDataPoint): void {
		// Process country
		if (point.country_code) {
			const existing = this.statistics.uniqueCountries.get(point.country_code) || {
				visitCount: 0,
				timeSpent: 0,
				lastVisit: point.recorded_at
			};

			existing.visitCount++;
			existing.lastVisit = point.recorded_at;

			// Add time spent at this point (will be updated when we process transport mode)
			if (typeof point.time_spent === 'number' && point.time_spent > 0) {
				existing.timeSpent += point.time_spent * 1000; // convert to milliseconds
			}

			this.statistics.uniqueCountries.set(point.country_code, existing);
		}

		// Process unique cities
		if (point.type || point.addresstype) {
			const cityKey = this.generateCityKey(point);
			if (cityKey) {
				const existing = this.statistics.uniqueCities.get(cityKey) || {
					visitCount: 0,
					timeSpent: 0,
					lastVisit: point.recorded_at
				};

				existing.visitCount++;
				existing.lastVisit = point.recorded_at;

				// Add time spent at this point (will be updated when we process transport mode)
				if (typeof point.time_spent === 'number' && point.time_spent > 0) {
					existing.timeSpent += point.time_spent * 1000; // convert to milliseconds
				}

				this.statistics.uniqueCities.set(cityKey, existing);
			}
		}
	}

	/**
	 * Generate a unique key for a city based on geocode data
	 */
	private generateCityKey(point: TrackerDataPoint): string | null {
		// Use city/village from address properties, fallback to type/class
		const city = point.city || point.village;
		const type = point.type;
		const addresstype = point.addresstype;
		const country = point.country_code;

		// Create a location identifier from available data
		const location = city || type || addresstype;

		if (location && country) {
			return `${location}, ${country}`;
		} else if (location) {
			return location;
		}

		return null;
	}


	/**
	 * Extract coordinates from GeoJSON location field or geocode coordinates
	 */
	private extractCoordinates(point: TrackerDataPoint): [number, number] | null {
		// First try the GeoJSON location field
		if (
			point.location &&
			typeof point.location === 'object' &&
			point.location.coordinates &&
			Array.isArray(point.location.coordinates) &&
			point.location.coordinates.length >= 2
		) {
			const [lon, lat] = point.location.coordinates;
			if (!isNaN(lon) && !isNaN(lat)) {
				return [lon, lat]; // [lng, lat]
			}
		}

		// Fallback to geocode coordinates
		if (point.coordinates && Array.isArray(point.coordinates) && point.coordinates.length >= 2) {
			const [lon, lat] = point.coordinates;
			if (!isNaN(lon) && !isNaN(lat)) {
				return [lon, lat]; // [lng, lat]
			}
		}

		return null;
	}

	/**
	 * Calculate time spent between two points
	 */
	private calculateTimeSpent(current: TrackerDataPoint, next: TrackerDataPoint): number {
		// Use database-calculated time_spent if available
		if (typeof next.time_spent === 'number' && next.time_spent > 0) {
			const timeMs = next.time_spent * 1000; // convert to milliseconds
			// Only count continuous movement (less than 30 minutes)
			// This prevents tracking gaps (overnight, device off, etc.) from inflating transport mode times
			return timeMs < 1800000 ? timeMs : 0;
		}

		// Fallback to timestamp difference
		const currentTime = new Date(current.recorded_at).getTime();
		const nextTime = new Date(next.recorded_at).getTime();
		const timeDiff = nextTime - currentTime;

		// Only count continuous movement (less than 30 minutes)
		return timeDiff > 0 && timeDiff < 1800000 ? timeDiff : 0;
	}

	/**
	 * Process train station visits
	 */
	private processTrainStationVisit(point: TrackerDataPoint): void {
		// Create proper GeoJSON Feature for train station detection
		const geocode = this.createGeocodeFeature(point);
		if (!geocode) return;

		if (!isAtTrainStation(geocode)) return;

		const stationName = getTrainStationName(geocode);
		if (!stationName) return;

		const timestamp = new Date(point.recorded_at).getTime();
		const visits = this.statistics.trainStationVisits.get(stationName) || [];
		visits.push(timestamp);
		this.statistics.trainStationVisits.set(stationName, visits);
	}

	/**
	 * Finalize statistics calculations
	 */
	private finalizeStatistics(): void {
		console.log('🔧 Finalizing statistics...');

		// Calculate geocoding success rate
		this.statistics.geocodingStats.successRate =
			this.statistics.geocodingStats.total > 0
				? Math.round(
					(this.statistics.geocodingStats.geocoded / this.statistics.geocodingStats.total) * 100
				)
				: 0;

		// Filter out places and countries with short visits
		this.filterShortVisits();

		// Process train station visits (deduplicate visits within 1 hour)
		this.processTrainStationVisits();

		// Set last processed timestamp
		this.statistics.lastProcessedAt = new Date().toISOString();
	}

	/**
	 * Filter out places and countries with short visits
	 */
	private filterShortVisits(): void {
		const MIN_VISIT_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds

		// Filter unique cities
		const originalCitiesCount = this.statistics.uniqueCities.size;
		const filteredCities = new Map<string, VisitData>();

		for (const [cityKey, cityData] of this.statistics.uniqueCities.entries()) {
			if (cityData.timeSpent >= MIN_VISIT_TIME) {
				filteredCities.set(cityKey, cityData);
			}
		}

		this.statistics.uniqueCities = filteredCities;

		// Filter unique countries
		const originalCountriesCount = this.statistics.uniqueCountries.size;
		const filteredCountries = new Map<string, VisitData>();

		for (const [countryCode, countryData] of this.statistics.uniqueCountries.entries()) {
			if (countryData.timeSpent >= MIN_VISIT_TIME) {
				filteredCountries.set(countryCode, countryData);
			}
		}

		this.statistics.uniqueCountries = filteredCountries;

		console.log(`🔍 Filtered cities: ${filteredCities.size} (from ${originalCitiesCount})`);
		console.log(
			`🔍 Filtered countries: ${filteredCountries.size} (from ${originalCountriesCount})`
		);
	}

	/**
	 * Process and deduplicate train station visits
	 */
	private processTrainStationVisits(): void {
		const processedVisits = new Map<string, number>();

		for (const [stationName, timestamps] of this.statistics.trainStationVisits.entries()) {
			// Sort timestamps
			timestamps.sort((a, b) => a - b);

			// Count visits, skipping points within 1 hour of previous
			let count = 0;
			let lastVisit = -Infinity;

			for (const timestamp of timestamps) {
				if (timestamp - lastVisit > 1800 * 1000) {
					// 0.5 hour in milliseconds
					count++;
					lastVisit = timestamp;
				}
			}

			if (count > 0) {
				processedVisits.set(stationName, count);
			}
		}

		// Replace the raw timestamps with visit counts
		// Note: We need to convert the Map<string, number> to Map<string, number[]> for type compatibility
		// but since we're only using the count, we'll keep it as is and handle it in getFormattedStatistics
		this.statistics.trainStationVisits = processedVisits as any;
	}

	/**
	 * Get formatted statistics for display
	 */
	public getFormattedStatistics(): any {
		const totalDistanceKm = this.statistics.totalDistance / 1000;
		const timeSpentMovingHours =
			Math.round((this.statistics.timeSpentMoving / (1000 * 60 * 60)) * 100) / 100;
		const earthCircumferences = totalDistanceKm / 40075; // Earth circumference in km

		// Convert transport modes map to array
		const transport = Array.from(this.statistics.transportModes.entries()).map(([mode, stats]) => ({
			mode,
			distance: stats.distance, // Keep distance in meters, format in frontend
			time: Math.round((stats.time / (1000 * 60 * 60)) * 10) / 10, // convert to hours, round to 1 decimal
			points: stats.points,
			percentage: Math.round(
				this.statistics.totalDistance > 0
					? (stats.distance / this.statistics.totalDistance) * 100
					: 0
			)
		}));

		// Convert country time distribution to array
		// Calculate total time spent in all countries
		const totalCountryTime = Array.from(this.statistics.countryTimeDistribution.values()).reduce(
			(sum, time) => sum + time,
			0
		);

		const countryTimeDistribution = Array.from(
			this.statistics.countryTimeDistribution.entries()
		).map(([country, time]) => ({
			country_code: country,
			percent: totalCountryTime > 0 ? Math.round((time / totalCountryTime) * 100) : 0
		}));

		// Convert train station visits to array
		const trainStationVisits = Array.from(this.statistics.trainStationVisits.entries())
			.map(([name, count]) => ({
				name,
				count: typeof count === 'number' ? count : 0
			}))
			.sort((a, b) => b.count - a.count);

		// Calculate steps from walking distance - distance is already in meters
		// Average step length is approximately 0.7 meters
		const walking = transport.find((t) => t.mode === 'walking');
		const steps = walking && walking.distance > 0 ? Math.round(walking.distance / 0.7) : 0;

		return {
			totalDistance: isFinite(totalDistanceKm)
				? totalDistanceKm >= 1000
					? `${(totalDistanceKm / 1000).toFixed(1)}k km`
					: `${totalDistanceKm.toFixed(1)} km`
				: '0 km',
			earthCircumferences: earthCircumferences,
			geopoints: this.statistics.geopoints,
			timeSpentMoving: `${timeSpentMovingHours}h`,
			uniquePlaces: this.statistics.uniqueCities.size,
			countriesVisited: this.statistics.uniqueCountries.size,
			steps,
			transport,
			countryTimeDistribution,
			trainStationVisits,
			geocodingStats: this.statistics.geocodingStats,
			rawDataPoints: this.rawDataPoints // Include raw data points for map visualization
		};
	}

	/**
	 * Reset the service state
	 */
	reset(): void {
		this.statistics = this.initializeStatistics();
		this.transportContext = this.initializeTransportContext();
		this.currentOffset = 0;
		this.totalCount = 0;
		this.isProcessing = false;
		this.rawDataPoints = [];
		this.isUsingSampledData = false;
	}

	/**
	 * Check if currently processing
	 */
	isCurrentlyProcessing(): boolean {
		return this.isProcessing;
	}

	/**
	 * Get current progress information
	 */
	getCurrentProgress(): {
		pointsLoaded: number;
		totalPoints: number;
		percentage: number;
	} {
		return {
			pointsLoaded: this.currentOffset,
			totalPoints: this.totalCount,
			percentage: this.totalCount > 0 ? (this.currentOffset / this.totalCount) * 100 : 0
		};
	}
}
