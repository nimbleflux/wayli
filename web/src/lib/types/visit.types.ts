/**
 * Types for place visit detection and storage
 */

import type { NearbyPOI } from '../services/external/pelias.service';

/**
 * POI amenity types we detect visits for
 */
export const VISIT_AMENITY_TYPES = [
	// Food & Drink
	'restaurant',
	'cafe',
	'bar',
	'pub',
	'fast_food',
	'food_court',
	'biergarten',
	'ice_cream',
	// Entertainment
	'cinema',
	'theatre',
	'nightclub',
	'casino',
	// Culture
	'museum',
	'gallery',
	'library',
	// Shopping
	'mall',
	'supermarket',
	'marketplace',
	// Wellness
	'gym',
	'spa',
	'swimming_pool',
	// Accommodation
	'hotel',
	'hostel',
	'guest_house'
] as const;

export type VisitAmenityType = (typeof VISIT_AMENITY_TYPES)[number];

/**
 * High-level POI categories for easier querying
 */
export const POI_CATEGORIES = {
	food: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'biergarten', 'ice_cream'],
	entertainment: ['cinema', 'theatre', 'nightclub', 'casino'],
	culture: ['museum', 'gallery', 'library'],
	shopping: ['mall', 'supermarket', 'marketplace'],
	wellness: ['gym', 'spa', 'swimming_pool'],
	accommodation: ['hotel', 'hostel', 'guest_house']
} as const;

export type POICategory = keyof typeof POI_CATEGORIES;

/**
 * Get the high-level category for an amenity type
 */
export function getCategoryForAmenity(amenity: string): POICategory | null {
	for (const [category, amenities] of Object.entries(POI_CATEGORIES)) {
		if ((amenities as readonly string[]).includes(amenity)) {
			return category as POICategory;
		}
	}
	return null;
}

/**
 * A candidate POI match for a visit
 */
export interface VisitCandidate {
	poi_name: string;
	poi_amenity?: string;
	poi_cuisine?: string;
	distance_meters?: number;
	confidence_score: number;
	osm_id?: string;
}

/**
 * A detected place visit
 */
export interface PlaceVisit {
	id?: string;
	user_id: string;

	// Temporal
	started_at: Date;
	ended_at: Date;
	duration_minutes?: number; // Generated column

	// Spatial
	location: {
		type: 'Point';
		coordinates: [number, number]; // [lon, lat]
	};

	// POI details
	poi_name?: string;
	poi_layer?: string;
	poi_amenity?: string;
	poi_cuisine?: string;
	poi_category?: POICategory;
	poi_tags?: Record<string, unknown>;

	// Location context
	city?: string;
	country?: string;
	country_code?: string;

	// Confidence
	confidence_score?: number;
	gps_points_count?: number;
	avg_accuracy_meters?: number;
	detection_method?: 'time_cluster' | 'user_confirmed';

	// Alternatives (if ambiguous)
	candidates?: VisitCandidate[];

	// Metadata
	created_at?: Date;
	updated_at?: Date;
}

/**
 * Configuration for visit detection algorithm
 */
export interface VisitDetectionConfig {
	// Spatial clustering
	spatialRadiusMeters: number; // Points within this radius form a cluster (default: 50)
	exitRadiusMeters: number; // Must move this far to "exit" a visit (default: 100)

	// Temporal thresholds (adaptive based on point density)
	minDurationDenseSeconds: number; // Min duration when >=1 point/min (default: 600 = 10 min)
	minDurationSparseSeconds: number; // Min duration when <1 point/min (default: 900 = 15 min)
	minDurationVerySparseSeconds: number; // Min duration when <1 point/5min (default: 1200 = 20 min)
	maxGapSeconds: number; // Max gap before considering visit ended (default: 900 = 15 min)

	// Minimum requirements
	minPoints: number; // Minimum GPS points required (default: 3)

	// Confidence thresholds
	ambiguousConfidenceThreshold: number; // Below this, store alternative candidates (default: 0.8)
	maxCandidates: number; // Max alternative candidates to store (default: 3)
}

/**
 * Default configuration for visit detection
 */
export const DEFAULT_VISIT_DETECTION_CONFIG: VisitDetectionConfig = {
	spatialRadiusMeters: 50,
	exitRadiusMeters: 100,
	minDurationDenseSeconds: 10 * 60, // 10 minutes
	minDurationSparseSeconds: 15 * 60, // 15 minutes
	minDurationVerySparseSeconds: 20 * 60, // 20 minutes
	maxGapSeconds: 15 * 60, // 15 minutes
	minPoints: 3,
	ambiguousConfidenceThreshold: 0.8,
	maxCandidates: 3
};

/**
 * A cluster of GPS points that might represent a visit
 */
export interface GPSCluster {
	points: TrackerPointForVisit[];
	centroid: { lat: number; lon: number };
	startTime: Date;
	endTime: Date;
	durationSeconds: number;
	avgAccuracyMeters: number;
	density: number; // points per minute
}

/**
 * Minimal tracker point data needed for visit detection
 */
export interface TrackerPointForVisit {
	recorded_at: Date;
	location: {
		type: 'Point';
		coordinates: [number, number]; // [lon, lat]
	};
	accuracy?: number;
	geocode?: {
		properties?: {
			city?: string;
			country?: string;
			country_code?: string;
			nearby_pois?: NearbyPOI[];
		};
	};
}

/**
 * Result of matching a cluster to nearby POIs
 */
export interface POIMatchResult {
	primary: VisitCandidate | null;
	candidates: VisitCandidate[];
	confidence: number;
}
