import { createWorkerClient } from '../../worker/client';
import type { GeocodeGeoJSONFeature } from '../utils/geojson-converter';

export interface TripLocation {
	id: string;
	user_id: string;
	tracker_type: string;
	device_id: string;
	recorded_at: string;
	location: { coordinates: [number, number] };
	country_code?: string;
	altitude?: number;
	accuracy?: number;
	speed?: number;
	heading?: number;
	battery_level?: number;
	is_charging?: boolean;
	activity_type?: string;
	raw_data?: Record<string, unknown>;
	geocode?: GeocodeData | GeocodeGeoJSONFeature | string | null;
	created_at: string;
	updated_at: string;
	// Additional fields for compatibility with statistics page
	name: string;
	description: string;
	type: 'tracker';
	transport_mode: string;
	coordinates: { lat: number; lng: number };
	city: string;
}

export interface GeocodeData {
	// New GeoJSON format
	type?: 'Feature';
	geometry?: {
		type: 'Point';
		coordinates: [number, number];
	};
	properties?: {
		display_name?: string;
		address?: Record<string, string>;
		place_id?: string;
		osm_type?: string;
		osm_id?: string;
		geocoded_at?: string;
		geocoding_provider?: string;
		geocoding_error?: string;
		geocoding_status?: 'success' | 'failed';
		retryable?: boolean;
		permanent?: boolean;
		[key: string]: unknown;
	};
	// Legacy format for backward compatibility
	display_name?: string;
	name?: string;
	amenity?: string;
	city?: string;
	error?: boolean;
	[key: string]: unknown;
}

export class TripLocationsService {
	private fluxbase: ReturnType<typeof createWorkerClient>;

	constructor() {
		// Use the worker client
		this.fluxbase = createWorkerClient();
	}

	// Note: Static client override functionality to be implemented in future version
	// For now, using dynamic client creation

	// Note: Static worker client override functionality to be implemented in future version
	// For now, using dynamic client creation

	// Instance method to switch to worker client
	useWorkerClient() {
		this.fluxbase = createWorkerClient();
		console.log('🔧 [TripLocationsService] Switched to worker Fluxbase client');
	}

	async getTripLocations(tripId: string, userId?: string): Promise<TripLocation[]> {
		try {
			// First, get the trip to get its date range
			const { data: trip, error: tripError } = await this.fluxbase
				.from('trips')
				.select('start_date, end_date, user_id')
				.eq('id', tripId)
				.single();

			if (tripError || !trip) {
				console.error('❌ Error fetching trip:', tripError);
				throw tripError || new Error('Trip not found');
			}

			// Use the trip's user_id if userId is not provided
			const targetUserId = userId || trip.user_id;

			// Fetch tracker data for the user within the trip's date range
			const { data: locations, error } = await this.fluxbase
				.from('tracker_data')
				.select('*')
				.eq('user_id', targetUserId)
				.gte('recorded_at', `${trip.start_date}T00:00:00Z`)
				.lte('recorded_at', `${trip.end_date}T23:59:59Z`)
				.order('recorded_at', { ascending: true });

			if (error) throw error;

			console.log(
				'🗺️ [TripLocationsService] Found',
				locations?.length || 0,
				'points for trip',
				tripId,
				'(',
				trip.start_date,
				'to',
				trip.end_date,
				')'
			);
			return this.transformLocations(locations || []);
		} catch (error) {
			console.error('❌ Error fetching trip locations:', error);
			throw error;
		}
	}

	async getLocationsByDateRange(
		startDate?: string,
		endDate?: string,
		limit = 10000,
		offset = 0
	): Promise<{
		locations: TripLocation[];
		total: number;
		hasMore: boolean;
	}> {
		try {
			let query = this.fluxbase
				.from('tracker_data')
				.select('*', { count: 'exact' })
				.order('recorded_at', { ascending: true })
				.range(offset, offset + limit - 1);

			if (startDate) {
				query = query.gte('recorded_at', startDate);
			}
			if (endDate) {
				query = query.lte('recorded_at', endDate + ' 23:59:59');
			}

			const { data: locations, error, count } = await query;

			if (error) throw error;

			const hasMore = count ? offset + limit < count : false;
			const transformedLocations = this.transformLocations(locations || []);

			return {
				locations: transformedLocations,
				total: count || 0,
				hasMore
			};
		} catch (error) {
			console.error('❌ Error fetching locations by date range:', error);
			throw error;
		}
	}

	private transformLocations(locations: unknown[]): TripLocation[] {
		return locations.map((loc, index) => {
			const locationObj = loc as Record<string, unknown>;
			const locationData = locationObj.location as { coordinates?: number[] } | null;
			const coordinates = locationData?.coordinates
				? {
						lat: locationData.coordinates[1] || 0,
						lng: locationData.coordinates[0] || 0
					}
				: { lat: 0, lng: 0 };

			let transportMode = 'unknown';
			if (locationObj.activity_type) {
				transportMode = String(locationObj.activity_type);
			} else if (locationObj.speed) {
				const speedKmh = Number(locationObj.speed) * 3.6;
				if (speedKmh < 5) transportMode = 'walking';
				else if (speedKmh < 20) transportMode = 'cycling';
				else if (speedKmh < 100) transportMode = 'car';
				else transportMode = 'airplane';
			}

			const geocode = locationObj.geocode as GeocodeData | null;

			return {
				id: `${locationObj.user_id}_${locationObj.recorded_at}_${index}`,
				user_id: String(locationObj.user_id),
				tracker_type: String(locationObj.tracker_type),
				device_id: String(locationObj.device_id),
				recorded_at: String(locationObj.recorded_at),
				location: { coordinates: locationData?.coordinates as [number, number] },
				country_code: locationObj.country_code ? String(locationObj.country_code) : undefined,
				altitude: locationObj.altitude !== undefined ? Number(locationObj.altitude) : undefined,
				accuracy: locationObj.accuracy !== undefined ? Number(locationObj.accuracy) : undefined,
				speed: locationObj.speed !== undefined ? Number(locationObj.speed) : undefined,
				heading: locationObj.heading !== undefined ? Number(locationObj.heading) : undefined,
				battery_level:
					locationObj.battery_level !== undefined ? Number(locationObj.battery_level) : undefined,
				is_charging:
					locationObj.is_charging !== undefined ? Boolean(locationObj.is_charging) : undefined,
				activity_type: locationObj.activity_type ? String(locationObj.activity_type) : undefined,
				raw_data: locationObj.raw_data as Record<string, unknown> | undefined,
				geocode: geocode || undefined,
				created_at: String(locationObj.created_at),
				updated_at: String(locationObj.updated_at),
				name:
					geocode && typeof geocode === 'object' && 'error' in geocode
						? 'Error occurred during geocoding'
						: geocode?.display_name || geocode?.name || 'Unknown Location',
				description: geocode?.amenity || '',
				type: 'tracker',
				transport_mode: transportMode,
				coordinates,
				city:
					geocode && typeof geocode === 'object' && 'error' in geocode ? '' : geocode?.city || ''
			};
		});
	}
}
