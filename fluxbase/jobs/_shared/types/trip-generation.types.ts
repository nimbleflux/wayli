import type { GeocodedLocation } from './geocoding.types';
import type { GeocodeGeoJSONFeature } from '../utils/geojson-converter';

// Define VisitedLocation interface locally to avoid circular dependencies
export interface VisitedLocation {
	cityName: string;
	countryName: string;
	countryCode: string;
	stateName?: string;
	durationHours: number;
	dataPoints: number;
	coordinates: {
		lat: number;
		lng: number;
	};
	tz_diff?: number; // Timezone difference from UTC in hours
}

export interface TripGenerationData {
	startDate: string;
	endDate: string;
	useCustomHomeAddress: boolean;
	customHomeAddress?: string;
	// Configuration options
	minTripDurationHours?: number;
	minDataPointsPerDay?: number;
}

export interface TripExclusion {
	id: string;
	name: string;
	value: string;
	exclusion_type: 'city' | 'address' | 'region';
	location?: GeocodedLocation;
	created_at: string;
	updated_at: string;
}

export interface TrackerDataPoint {
	user_id: string;
	location: {
		type: string;
		coordinates: number[];
	};
	recorded_at: string;
	country_code?: string;
	geocode?:
		| GeocodeGeoJSONFeature // New GeoJSON format
		| {
				// Legacy format for backward compatibility
				address?: {
					city?: string;
					town?: string;
					village?: string;
					municipality?: string;
					suburb?: string;
					[key: string]: string | undefined;
				};
				city?: string;
				town?: string;
				village?: string;
				municipality?: string;
				suburb?: string;
				name?: string;
				display_name?: string;
				[key: string]: unknown;
		  }
		| string; // Allow for string (JSON) formats
}

// Interface for data returned by get_user_tracking_data function
export interface TrackingDataPoint {
	user_id: string;
	recorded_at: string;
	lat: number;
	lon: number;
	altitude?: number;
	accuracy?: number;
	speed?: number;
	activity_type?: string;
	geocode?: unknown;
	distance?: number;
	time_spent?: number;
}

export interface DetectedTrip {
	id: string;
	user_id: string;
	startDate: string;
	endDate: string;
	title: string;
	description: string;
	location: {
		type: string;
		coordinates: number[];
	};
	cityName: string;
	dataPoints: number;
	overnightStays: number;
	distanceFromHome: number;
	status: 'pending' | 'approved' | 'rejected' | 'created';
	metadata: {
		totalDurationHours: number;
		visitedCities: string[];
		visitedCountries: string[];
		visitedCountryCodes: string[];
		isMultiCountryTrip: boolean;
		isMultiCityTrip: boolean;
		tripType: 'city' | 'country' | 'multi-city' | 'multi-country';
		primaryLocation: string;
		primaryCountry: string;
		primaryCountryCode: string;
		homeCity: string;
		homeCountry: string;
		homeCountryCode: string;
		[key: string]: unknown;
	};
	created_at: string;
	updated_at: string;
}

// New types for enhanced trip detection
export interface SuggestedTrip {
	id: string;
	user_id: string;
	startDate: string;
	endDate: string;
	title: string;
	description: string;
	location: {
		type: string;
		coordinates: number[];
	};
	cityName: string;

	dataPoints: number;
	overnightStays: number;
	distanceFromHome: number;
	status: 'pending' | 'approved' | 'rejected' | 'created';
	metadata: {
		primaryLocation?: string;
		visitedPlaces?: string[];
		totalDistance?: number;
		averageSpeed?: number;
		transportModes?: string[];
		weatherConditions?: string[];
		[key: string]: unknown;
	};
	created_at: string;
	updated_at: string;
}

export interface OvernightStay {
	date: string;
	location: {
		type: string;
		coordinates: number[];
	};
	cityName: string;
	countryName?: string;
	startTime: string;
	endTime: string;
	durationHours: number;
	dataPoints: number;
}

export interface HomeAddress {
	display_name: string;
	coordinates?: {
		lat: number;
		lng: number;
	};
	address?: {
		city?: string;
		town?: string;
		village?: string;
		municipality?: string;
		state?: string;
		country?: string;
		[key: string]: string | undefined;
	};
}

export interface TripGenerationProgress {
	message: string;
	startDate?: string;
	endDate?: string;
	homeAddress?: string;
	dataPoints?: number;
	exclusionsCount?: number;
	tripsDetected?: number;
	tripsWithBanners?: number;
	tripsGenerated?: number;
	totalTime?: string;
	// New progress fields
	overnightStaysDetected?: number;
	suggestedTripsCount?: number;
	approvedTripsCount?: number;
	imageGenerationProgress?: number;
}

// New types for image generation queue
export interface ImageGenerationJob {
	id: string;
	suggested_trip_id: string;
	user_id: string;
	cityName: string;
	status: 'queued' | 'processing' | 'completed' | 'failed';
	priority: number;
	attempts: number;
	max_attempts: number;
	created_at: string;
	updated_at: string;
	completed_at?: string;
	error?: string;
	image_url?: string;
}
