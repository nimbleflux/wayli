/**
 * POI (Point of Interest) visits adapter.
 * Manages detection and retrieval of visited points of interest.
 * @module adapters/poi-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * A recorded visit to a point of interest.
 */
export interface POIVisit {
	/** Unique identifier for the visit */
	id: string;
	/** User ID who made the visit */
	user_id: string;
	/** Name of the POI (if identified) */
	poi_name?: string;
	/** ISO timestamp when the visit occurred */
	visited_at: string;
	/** Geographic coordinates of the POI */
	location?: {
		/** Latitude coordinate */
		lat: number;
		/** Longitude coordinate */
		lon: number;
	};
}

/**
 * Options for detecting POI visits from tracker data.
 */
export interface DetectPOIVisitsOptions {
	/** Start date for analysis (YYYY-MM-DD) */
	startDate: string;
	/** End date for analysis (YYYY-MM-DD) */
	endDate: string;
	/** Radius in meters to consider as same location (default: 300) */
	radius?: number;
	/** Minimum duration in seconds to count as a visit (default: 3600) */
	minDuration?: number;
	/** Minimum interval in seconds between visits (default: 3600) */
	minInterval?: number;
}

/**
 * Adapter for managing Point of Interest (POI) visits.
 * Detects and retrieves locations the user has visited repeatedly.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const poiAdapter = new POIAdapter({ session });
 *
 * // Detect POI visits in a date range
 * const job = await poiAdapter.detectPOIVisits({
 *   startDate: '2024-01-01',
 *   endDate: '2024-12-31'
 * });
 *
 * // Get all detected POI visits
 * const visits = await poiAdapter.getPOIVisits();
 * ```
 */
export class POIAdapter extends BaseAdapter {
	/**
	 * Creates a new POIAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Triggers a background job to detect POI visits from tracker data.
	 * The job analyzes location patterns to identify frequently visited places.
	 *
	 * @param options - Detection options
	 * @param options.startDate - Start of analysis period
	 * @param options.endDate - End of analysis period
	 * @param options.radius - Clustering radius in meters (default: 300)
	 * @param options.minDuration - Minimum stay duration in seconds (default: 3600)
	 * @param options.minInterval - Minimum time between visits (default: 3600)
	 * @returns Promise resolving to the created job
	 * @throws Error if user not authenticated or job creation fails
	 *
	 * @example
	 * ```typescript
	 * const job = await poiAdapter.detectPOIVisits({
	 *   startDate: '2024-01-01',
	 *   endDate: '2024-06-30',
	 *   radius: 200,
	 *   minDuration: 1800 // 30 minutes
	 * });
	 * ```
	 */
	async detectPOIVisits(options: DetectPOIVisitsOptions) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Create a job for POI detection
		const { data: job, error } = await fluxbase.jobs.submit(
			'poi_detection',
			{
				start_date: options.startDate,
				end_date: options.endDate,
				radius: options.radius || 300,
				min_duration: options.minDuration || 3600,
				min_interval: options.minInterval || 3600
			},
			{
				namespace: 'wayli',
				priority: 5
			}
		);

		if (error) {
			throw new Error(error.message || 'Failed to create POI detection job');
		}

		return job;
	}

	/**
	 * Retrieves all detected POI visits for the authenticated user.
	 * Returns visits sorted by most recent first.
	 *
	 * @returns Promise resolving to array of POI visits
	 * @throws Error if user not authenticated or query fails
	 *
	 * @example
	 * ```typescript
	 * const visits = await poiAdapter.getPOIVisits();
	 * visits.forEach(v => {
	 *   console.log(`Visited ${v.poi_name} on ${v.visited_at}`);
	 * });
	 * ```
	 */
	async getPOIVisits(): Promise<POIVisit[]> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: poiVisits, error } = await fluxbase
			.from('poi_visits')
			.select('*')
			.eq('user_id', userData.user.id)
			.order('visited_at', { ascending: false });

		if (error) {
			throw new Error(error.message || 'Failed to fetch POI visits');
		}

		return poiVisits || [];
	}
}
