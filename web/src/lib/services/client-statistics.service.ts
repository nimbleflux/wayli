// src/lib/services/client-statistics.service.ts
// Client-side statistics calculation service for processing tracker data incrementally

import { fluxbase } from '$lib/fluxbase';
import {
	detectTransportModes,
	type ModeObservation,
	type DetectionContext
} from '$lib/services/transport-mode';
import { haversine } from '$lib/utils/multi-point-speed';
import {
	isAtTrainStation,
	getTrainStationName,
	isAtAirport,
	getAirportName
} from '$lib/utils/transport-mode';
import type { GeocodeGeoJSONFeature } from '$lib/utils/geojson-converter';
import { TransportDetectionReason } from '$lib/types/transport-mode.types';

import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

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

/**
 * Coerce a value (PostgREST returns Postgres `numeric`/`decimal` as JSON
 * strings) to a finite JS number. Returns `null` for null/undefined/empty so
 * callers can keep treating missing values as null rather than 0 or NaN.
 */
function toNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
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
	accuracy?: number; // GPS accuracy (HDOP/radius) in meters
	heading?: number; // Course over ground in degrees [0, 360)
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
	private isProcessing: boolean = false;
	private currentOffset: number = 0;
	private totalCount: number = 0;
	private batchSize: number = 1000;
	private rawDataPoints: TrackerDataPoint[] = [];
	private calendarPoints: TrackerDataPoint[] = [];
	private isUsingSampledData: boolean = false;

	// Cross-batch continuity: tail of the previous batch's live observations,
	// threaded into the next detectTransportModes call so journeys spanning a
	// page boundary decode as one Viterbi segment instead of two.
	private detectionContext: DetectionContext = {};

	// Sampling configuration
	private readonly MAX_POINTS_TARGET = 3000; // Target max points to process
	private readonly SAMPLING_THRESHOLD = 2000; // Start sampling above this count

	constructor(fluxbaseClient?: FluxbaseClient) {
		this.fluxbase = fluxbaseClient || fluxbase;
		this.statistics = this.initializeStatistics();
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
	 * Get total count of tracker data points for a user
	 */
	async getTotalCount(userId: string, startDate?: string, endDate?: string): Promise<number> {
		let query = this.fluxbase
			.from<Record<string, any>>('tracker_data')
			.count('*')
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

		return count || 0;
	}

	/**
	 * Load the trailing ~53 weeks of per-day distance/time/point-count aggregates
	 * for the activity calendar. Unlike loadAndProcessData, this is NOT bounded
	 * by the date picker — the calendar always shows the last year ending today
	 * (like GitHub's contribution graph).
	 *
	 * Uses the activity_calendar RPC so Postgres does the aggregation: returns
	 * ~one row per day (only days with data), instead of every raw point (~75k
	 * rows for a full year). This keeps the payload tiny and the calendar fast.
	 * Results are cached in this.calendarPoints; safe to call once per page load.
	 */
	async loadCalendarHistory(userId: string, weeks = 53): Promise<void> {
		// Already loaded for this instance? Skip (avoids re-fetching on every
		// date-range change — the calendar window is independent of the picker).
		if (this.calendarPoints.length > 0) return;

		// Session-level cache: past days only change on import, so a 24-hour
		// cache is safe and makes most page loads instant after the first.
		const cacheKey = `wayli:calendar:${userId}:${weeks}`;
		try {
			const cached = sessionStorage.getItem(cacheKey);
			if (cached) {
				const entry = JSON.parse(cached);
				if (entry.ts && Date.now() - entry.ts < 24 * 60 * 60 * 1000) {
					this.calendarPoints = entry.data;
					return;
				}
			}
		} catch {
			/* sessionStorage may be unavailable (SSR / privacy mode) — ignore */
		}

		try {
			const days = weeks * 7;
			const { data, error } = await (this.fluxbase.rpc as any).invoke(
				'activity-calendar',
				{ user_id: userId, days },
				{ namespace: 'wayli' }
			);
			if (error) {
				console.error('❌ loadCalendarHistory RPC error:', error);
				return;
			}
			// rpc.invoke returns { data: { result: <rows>, status, ... } }.
			// The result may be an array, a JSON string, or the data itself may
			// be the array (depending on the fluxbase version). Unwrap robustly.
			let rows: any[] = [];
			const raw = data as any;
			if (Array.isArray(raw)) {
				rows = raw;
			} else if (raw?.result) {
				rows = typeof raw.result === 'string' ? JSON.parse(raw.result) : raw.result;
			} else if (Array.isArray(raw?.data)) {
				rows = raw.data;
			} else if (raw?.data?.result) {
				rows = typeof raw.data.result === 'string' ? JSON.parse(raw.data.result) : raw.data.result;
			}
			if (!Array.isArray(rows)) {
				console.error('❌ loadCalendarHistory: unexpected RPC response shape:', raw);
				return;
			}
			this.calendarPoints = rows.map((row) => ({
				recorded_at: `${row.day}T12:00:00`,
				lat: 0,
				lng: 0,
				distance: Number(row.distance) || 0,
				time_spent: Number(row.time_spent) || 0,
				speed: 0
			}));
			// Persist to sessionStorage for the session-level cache — but only if
			// the result looks complete (more than a handful of days). A broken
			// result (e.g. 2-6 days when the user has months of history) would
			// otherwise be cached for 24h and block the real data from loading.
			if (this.calendarPoints.length >= 3) {
				try {
					sessionStorage.setItem(
						cacheKey,
						JSON.stringify({ ts: Date.now(), data: this.calendarPoints })
					);
				} catch {
					/* quota / unavailable — ignore */
				}
			}
		} catch (err) {
			// Non-fatal: the calendar widget just stays empty.
			console.error('❌ loadCalendarHistory failed:', err);
		}
	}

	/** Expose the trailing-window points for the calendar/streaks widgets. */
	getCalendarPoints(): TrackerDataPoint[] {
		return this.calendarPoints;
	}

	/**
	 * Calculate sampling strategy based on total count.
	 * Returns the sample rate (1 = no sampling, N = keep every Nth point).
	 */
	private calculateSamplingStrategy(totalCount: number): {
		sampleRate: number;
		effectiveBatches: number;
	} {
		if (totalCount <= this.SAMPLING_THRESHOLD) {
			// No sampling needed
			return {
				sampleRate: 1,
				effectiveBatches: Math.ceil(totalCount / this.batchSize)
			};
		}

		// Calculate sample rate to get close to MAX_POINTS_TARGET
		const sampleRate = Math.ceil(totalCount / this.MAX_POINTS_TARGET);
		const expectedPoints = Math.ceil(totalCount / sampleRate);
		const effectiveBatches = Math.ceil(expectedPoints / this.batchSize);

		console.log(
			`🧮 Sampling strategy: ${totalCount} points → sample every ${sampleRate}th point → ~${expectedPoints} points`
		);

		return { sampleRate, effectiveBatches };
	}

	/**
	 * Load and process tracker data in batches with client-side sampling.
	 * Uses simple pagination and samples every Nth point when dataset is large.
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
		this.currentOffset = 0;
		this.isUsingSampledData = false;
		this.rawDataPoints = [];
		this.detectionContext = {};

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

			// Calculate sampling strategy
			const { sampleRate, effectiveBatches } = this.calculateSamplingStrategy(this.totalCount);
			this.isUsingSampledData = sampleRate > 1;

			const totalBatches = Math.ceil(this.totalCount / this.batchSize);
			let pointsLoaded = 0;
			let pointsProcessed = 0;
			let batchesCompleted = 0;
			let globalPointIndex = 0; // Track position across all batches for sampling

			const stageName = this.isUsingSampledData
				? `Found ${this.totalCount.toLocaleString()} records. Sampling every ${sampleRate}th point...`
				: `Found ${this.totalCount.toLocaleString()} records. Loading data...`;

			onProgress?.({
				percentage: 0,
				stage: stageName,
				pointsLoaded: 0,
				totalPoints: this.totalCount,
				currentBatch: 0,
				totalBatches
			});

			// Load data in batches with pagination
			while (this.currentOffset < this.totalCount) {
				const currentBatch = Math.floor(this.currentOffset / this.batchSize) + 1;

				onProgress?.({
					percentage: Math.round((this.currentOffset / this.totalCount) * 90),
					stage: this.isUsingSampledData
						? `Loading batch ${currentBatch} of ${totalBatches} (sampling)...`
						: `Loading batch ${currentBatch} of ${totalBatches}...`,
					pointsLoaded: pointsProcessed,
					totalPoints: this.totalCount,
					currentBatch,
					totalBatches
				});

				// Fetch batch using standard pagination
				const batchData = await this.loadBatch(userId, startDate, endDate);
				if (batchData.length === 0) break;

				pointsLoaded += batchData.length;

				// Apply client-side sampling if needed
				let dataToProcess: TrackerDataPoint[];
				if (sampleRate > 1) {
					// Sample every Nth point, maintaining global index across batches.
					// Each kept point only carries its own slice since the previous
					// RAW point, so distance/time_spent totals would shrink ~N× —
					// scale them so aggregates (distance totals, per-country visit
					// time) stay representative on long ranges.
					dataToProcess = batchData
						.filter((_, index) => {
							const globalIndex = globalPointIndex + index;
							return globalIndex % sampleRate === 0;
						})
						.map((point) => ({
							...point,
							distance: point.distance != null ? point.distance * sampleRate : point.distance,
							time_spent:
								point.time_spent != null ? point.time_spent * sampleRate : point.time_spent
						}));
				} else {
					dataToProcess = batchData;
				}

				globalPointIndex += batchData.length;

				// Process the (possibly sampled) batch
				if (dataToProcess.length > 0) {
					this.processBatch(dataToProcess);
					pointsProcessed += dataToProcess.length;
				}

				this.currentOffset += this.batchSize;
				batchesCompleted++;

				// Small delay to prevent overwhelming the browser
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			// Finalize statistics
			onProgress?.({
				percentage: 95,
				stage: 'Finalizing statistics...',
				pointsLoaded: pointsProcessed,
				totalPoints: this.totalCount,
				currentBatch: totalBatches,
				totalBatches
			});

			this.finalizeStatistics();

			onProgress?.({
				percentage: 100,
				stage: this.isUsingSampledData
					? `Complete! Processed ${pointsProcessed.toLocaleString()} of ${this.totalCount.toLocaleString()} points`
					: 'Processing complete!',
				pointsLoaded: pointsProcessed,
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
			.from<Record<string, any>>('tracker_data')
			.select(
				`
				recorded_at,
				time_spent,
				country_code,
				location,
				speed,
				distance,
				accuracy,
				heading,
				tz_diff,
				transport_mode,
				detection_reason,
				geocode->properties->>city,
				geocode->properties->>address->>city,
				geocode->properties->>address->>village
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

		// Process the data: handle COALESCE logic for city field and coerce
		// Postgres numeric columns to JS numbers. PostgREST returns numeric /
		// decimal columns as JSON strings (to preserve precision), but the
		// TrackerDataPoint interface and downstream consumers (e.g. the map
		// popup's `.toFixed` calls) expect real numbers. Coercing here, at the
		// single row→point boundary, keeps the interface honest everywhere.
		const processedData =
			(data as any[])?.map((point) => ({
				...point,
				city: point.city || point.address_city || null,
				speed: toNumber(point.speed),
				distance: toNumber(point.distance),
				accuracy: toNumber(point.accuracy),
				heading: toNumber(point.heading),
				tz_diff: toNumber(point.tz_diff),
				time_spent: toNumber(point.time_spent)
			})) || [];

		return processedData;
	}

	/**
	 * Process a batch of tracker data points
	 */
	private processBatch(batch: TrackerDataPoint[]): void {
		console.log(`🔄 Processing batch of ${batch.length} points`);

		// 1. Pre-compute velocity (km/h) for every point. Used for both the map
		//    and as the speed input to transport-mode detection. Falls back to a
		//    haversine-derived velocity when the DB speed field is absent.
		const velocities = batch.map((point, index) => {
			if (point.speed !== undefined && point.speed !== null) return point.speed;
			const nextPoint = batch[index + 1];
			const currentCoords = this.extractCoordinates(point);
			const nextCoords = nextPoint ? this.extractCoordinates(nextPoint) : null;
			if (currentCoords && nextCoords) {
				const distance = haversine(
					currentCoords[1],
					currentCoords[0],
					nextCoords[1],
					nextCoords[0]
				);
				const timeSpent = this.calculateTimeSpent(point, nextPoint!);
				if (timeSpent > 0) return (distance / timeSpent) * 3.6;
			}
			return 0;
		});

		// 2. Split points into "stored" (job already decoded them) vs "live"
		//    (need detection now). Stored modes are trusted as-is; live points
		//    are decoded with the HMM detector (global Viterbi smoothing → no
		//    flicker), which is the same algorithm the background job uses.
		const liveIndices: number[] = [];
		const liveObservations: ModeObservation[] = [];
		batch.forEach((point, index) => {
			if (point.transport_mode) return; // stored — keep it
			const coords = this.extractCoordinates(point);
			if (!coords) return;
			liveIndices.push(index);
			liveObservations.push({
				timestamp: new Date(point.recorded_at).getTime(),
				lat: coords[1],
				lng: coords[0],
				speed: velocities[index],
				heading: point.heading ?? null,
				accuracy: point.accuracy ?? null,
				geocode: this.createGeocodeFeature(point)
			});
		});

		// Run the HMM over all live points in the batch at once. They're in
		// chronological order (the query orders by recorded_at asc), so
		// gap-segmentation inside detectTransportModes handles segment boundaries.
		// `detectionContext` carries the previous batch's tail so journeys spanning
		// a page boundary decode coherently (no car/train flip at the seam).
		const liveDecisions = detectTransportModes(liveObservations, this.detectionContext);

		// Remember the tail of this batch's live observations for the next call.
		// Only retain live points (stored-mode points already have an authoritative
		// mode and don't need continuity seeding). If there are none, keep the
		// previous context so a fully-stored page doesn't wipe the live tail.
		if (liveObservations.length > 0) {
			const TAIL = 6;
			this.detectionContext = {
				prevObs: liveObservations.slice(-TAIL)
			};
		}

		// 3. Build the processed batch: stored modes pass through; live points
		//    get their HMM decision; points we couldn't geocode fall back to the
		//    legacy per-point detector for safety.
		const processedBatch = batch.map((point, index) => {
			let transportMode = 'unknown';
			let detectionReason = 'unknown';

			if (point.transport_mode) {
				// Persisted by the background job — single source of truth.
				transportMode = point.transport_mode;
				detectionReason = point.detection_reason ?? 'persisted_mode';
			} else {
				const livePos = liveIndices.indexOf(index);
				if (livePos >= 0 && livePos < liveDecisions.length) {
					const d = liveDecisions[livePos];
					transportMode = d.mode;
					detectionReason = d.reason;
				} else if (velocities[index] !== undefined) {
					// Last-resort fallback: the point had no usable coordinates so it
					// wasn't included in the batch-level Viterbi decode. Decode it on
					// its own via the HMM's emission-only single-point path (the same
					// path detectTransportModes uses for 1-point segments). Using the
					// HMM here keeps the mode vocabulary coherent and avoids the
					// legacy per-point rule engine, which flickers car↔train.
					const ts = new Date(point.recorded_at).getTime();
					const [decision] = detectTransportModes(
						[
							{
								timestamp: ts,
								lat: 0,
								lng: 0,
								speed: velocities[index],
								heading: point.heading ?? null,
								accuracy: point.accuracy ?? null,
								geocode: this.createGeocodeFeature(point)
							}
						],
						this.detectionContext
					);
					if (decision) {
						transportMode = decision.mode;
						detectionReason = decision.reason;
					}
				}
			}

			return {
				...point,
				transport_mode: transportMode,
				velocity: velocities[index],
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
				// boat/swimming deliberately excluded — short-distance water modes (#220)
				const longDistanceModes = ['train', 'car', 'plane', 'bus', 'tram', 'metro'];
				const maxTimeSpent = longDistanceModes.includes(mode)
					? 7200000 // 2 hours for long-distance travel
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
						const currentTime =
							this.statistics.countryTimeDistribution.get(point.country_code) || 0;
						this.statistics.countryTimeDistribution.set(
							point.country_code,
							currentTime + timeSpent
						);
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

		// Process unique cities (only if we have city data)
		if (point.city) {
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
		const filteredCities = new Map<string, VisitData>();

		for (const [cityKey, cityData] of this.statistics.uniqueCities.entries()) {
			if (cityData.timeSpent >= MIN_VISIT_TIME) {
				filteredCities.set(cityKey, cityData);
			}
		}

		this.statistics.uniqueCities = filteredCities;

		// Filter unique countries
		const filteredCountries = new Map<string, VisitData>();

		for (const [countryCode, countryData] of this.statistics.uniqueCountries.entries()) {
			if (countryData.timeSpent >= MIN_VISIT_TIME) {
				filteredCountries.set(countryCode, countryData);
			}
		}

		this.statistics.uniqueCountries = filteredCountries;
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

		// Count unique places where user spent at least 8 hours
		const MIN_TIME_FOR_PLACE_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
		const uniquePlacesCount = Array.from(this.statistics.uniqueCities.values()).filter(
			(city) => city.timeSpent >= MIN_TIME_FOR_PLACE_MS
		).length;

		return {
			totalDistance: isFinite(totalDistanceKm)
				? totalDistanceKm >= 1000
					? `${(totalDistanceKm / 1000).toFixed(1)}k km`
					: `${totalDistanceKm.toFixed(1)} km`
				: '0 km',
			earthCircumferences: earthCircumferences,
			geopoints: this.statistics.geopoints,
			timeSpentMoving: `${timeSpentMovingHours}h`,
			uniquePlaces: uniquePlacesCount,
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
