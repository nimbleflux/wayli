/**
 * Visit Detection Service
 *
 * Detects place visits (restaurants, cafes, museums, etc.) from GPS tracker data.
 * Uses adaptive thresholds based on GPS point density to handle variable recording
 * frequency (e.g., OwnTracks battery-save mode).
 */

import type {
	PlaceVisit,
	VisitDetectionConfig,
	GPSCluster,
	TrackerPointForVisit,
	POIMatchResult,
	VisitCandidate,
	POICategory
} from '../types/visit.types';
import {
	DEFAULT_VISIT_DETECTION_CONFIG,
	VISIT_AMENITY_TYPES,
	getCategoryForAmenity
} from '../types/visit.types';
import type { NearbyPOI } from './external/pelias.service';

/**
 * Calculate the Haversine distance between two points in meters
 */
function haversineDistance(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number
): number {
	const R = 6371000; // Earth's radius in meters
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

/**
 * Calculate centroid of a set of points
 */
function calculateCentroid(points: TrackerPointForVisit[]): { lat: number; lon: number } {
	if (points.length === 0) {
		throw new Error('Cannot calculate centroid of empty points array');
	}

	let sumLat = 0;
	let sumLon = 0;

	for (const point of points) {
		const [lon, lat] = point.location.coordinates;
		sumLat += lat;
		sumLon += lon;
	}

	return {
		lat: sumLat / points.length,
		lon: sumLon / points.length
	};
}

/**
 * Get the appropriate minimum duration based on point density
 */
function getMinDurationForDensity(
	density: number,
	config: VisitDetectionConfig
): number {
	// density = points per minute
	if (density >= 1) {
		return config.minDurationDenseSeconds;
	} else if (density >= 0.2) {
		// 1 point per 5 minutes
		return config.minDurationSparseSeconds;
	} else {
		return config.minDurationVerySparseSeconds;
	}
}

/**
 * Extract cuisine from OSM addendum data
 */
function extractCuisine(addendum?: { osm?: Record<string, unknown> }): string | undefined {
	if (!addendum?.osm?.cuisine) {
		return undefined;
	}
	const cuisine = addendum.osm.cuisine;
	if (typeof cuisine === 'string') {
		// Cuisine can be semicolon-separated, take the first
		return cuisine.split(';')[0].trim();
	}
	return undefined;
}

/**
 * Extract amenity type from OSM addendum data
 */
function extractAmenity(addendum?: { osm?: Record<string, unknown> }): string | undefined {
	if (!addendum?.osm) {
		return undefined;
	}
	const osm = addendum.osm;

	// Check various OSM tags for venue type
	return (
		(osm.amenity as string) ||
		(osm.leisure as string) ||
		(osm.tourism as string) ||
		(osm.shop as string) ||
		undefined
	);
}

/**
 * Check if an amenity type is one we want to detect visits for
 */
function isVisitableAmenity(amenity: string | undefined): boolean {
	if (!amenity) return false;
	return (VISIT_AMENITY_TYPES as readonly string[]).includes(amenity);
}

/**
 * Calculate confidence score for a POI match
 */
function calculateConfidence(
	poi: NearbyPOI,
	clusterAvgAccuracy: number
): number {
	let confidence = 0.5; // Base confidence

	// Distance factor (closer = higher confidence)
	if (poi.distance_meters !== undefined) {
		if (poi.distance_meters <= 10) {
			confidence += 0.3;
		} else if (poi.distance_meters <= 25) {
			confidence += 0.2;
		} else if (poi.distance_meters <= 50) {
			confidence += 0.1;
		}
	} else {
		// Unknown distance, assume moderate
		confidence += 0.1;
	}

	// GPS accuracy factor (better accuracy = higher confidence)
	if (clusterAvgAccuracy <= 10) {
		confidence += 0.15;
	} else if (clusterAvgAccuracy <= 25) {
		confidence += 0.1;
	} else if (clusterAvgAccuracy <= 50) {
		confidence += 0.05;
	}

	// Pelias confidence factor
	if (poi.confidence !== undefined) {
		confidence += poi.confidence * 0.1;
	}

	return Math.min(confidence, 1.0);
}

/**
 * Match a cluster to nearby POIs
 */
function matchClusterToPOIs(
	cluster: GPSCluster,
	config: VisitDetectionConfig
): POIMatchResult {
	// Collect all nearby POIs from all points in the cluster
	const poiMap = new Map<string, { poi: NearbyPOI; count: number }>();

	for (const point of cluster.points) {
		const nearbyPois = point.geocode?.properties?.nearby_pois;
		if (!nearbyPois) continue;

		for (const poi of nearbyPois) {
			// Only consider POIs with names and visitable amenities
			if (!poi.name) continue;
			const amenity = extractAmenity(poi.addendum);
			if (!isVisitableAmenity(amenity)) continue;

			// Use OSM ID if available, otherwise use name as key
			const key = poi.osm_id || poi.name;

			if (poiMap.has(key)) {
				const existing = poiMap.get(key)!;
				existing.count++;
			} else {
				poiMap.set(key, { poi, count: 1 });
			}
		}
	}

	if (poiMap.size === 0) {
		return { primary: null, candidates: [], confidence: 0 };
	}

	// Score each POI
	const scoredCandidates: VisitCandidate[] = [];

	for (const { poi, count } of poiMap.values()) {
		const amenity = extractAmenity(poi.addendum);
		const cuisine = extractCuisine(poi.addendum);

		// Base confidence from distance and accuracy
		let confidence = calculateConfidence(poi, cluster.avgAccuracyMeters);

		// Boost confidence if POI appears in multiple points
		const appearanceRatio = count / cluster.points.length;
		confidence += appearanceRatio * 0.2;

		confidence = Math.min(confidence, 1.0);

		scoredCandidates.push({
			poi_name: poi.name,
			poi_amenity: amenity,
			poi_cuisine: cuisine,
			distance_meters: poi.distance_meters,
			confidence_score: confidence,
			osm_id: poi.osm_id
		});
	}

	// Sort by confidence (highest first)
	scoredCandidates.sort((a, b) => b.confidence_score - a.confidence_score);

	const primary = scoredCandidates[0] || null;
	const otherCandidates = scoredCandidates.slice(1, config.maxCandidates + 1);

	// Only include alternative candidates if primary confidence is low
	const shouldIncludeCandidates =
		primary && primary.confidence_score < config.ambiguousConfidenceThreshold;

	return {
		primary,
		candidates: shouldIncludeCandidates ? otherCandidates : [],
		confidence: primary?.confidence_score || 0
	};
}

/**
 * Detect GPS point clusters that represent potential visits
 */
export function detectClusters(
	points: TrackerPointForVisit[],
	config: VisitDetectionConfig = DEFAULT_VISIT_DETECTION_CONFIG
): GPSCluster[] {
	if (points.length < config.minPoints) {
		return [];
	}

	// Sort points by time
	const sortedPoints = [...points].sort(
		(a, b) => a.recorded_at.getTime() - b.recorded_at.getTime()
	);

	const clusters: GPSCluster[] = [];
	let currentCluster: TrackerPointForVisit[] = [sortedPoints[0]];

	for (let i = 1; i < sortedPoints.length; i++) {
		const point = sortedPoints[i];
		const prevPoint = sortedPoints[i - 1];

		// Calculate time gap
		const timeGapSeconds =
			(point.recorded_at.getTime() - prevPoint.recorded_at.getTime()) / 1000;

		// Calculate distance from cluster centroid
		const centroid = calculateCentroid(currentCluster);
		const [lon, lat] = point.location.coordinates;
		const distanceFromCentroid = haversineDistance(
			centroid.lat,
			centroid.lon,
			lat,
			lon
		);

		// Check if point belongs to current cluster
		const withinSpatialThreshold = distanceFromCentroid <= config.spatialRadiusMeters;
		const withinTimeThreshold = timeGapSeconds <= config.maxGapSeconds;

		if (withinSpatialThreshold && withinTimeThreshold) {
			// Add to current cluster
			currentCluster.push(point);
		} else if (distanceFromCentroid > config.exitRadiusMeters || !withinTimeThreshold) {
			// Finalize current cluster if it meets minimum requirements
			if (currentCluster.length >= config.minPoints) {
				const cluster = finalizeCluster(currentCluster, config);
				if (cluster) {
					clusters.push(cluster);
				}
			}
			// Start new cluster
			currentCluster = [point];
		} else {
			// Point is in transition zone, add to cluster but continue
			currentCluster.push(point);
		}
	}

	// Don't forget the last cluster
	if (currentCluster.length >= config.minPoints) {
		const cluster = finalizeCluster(currentCluster, config);
		if (cluster) {
			clusters.push(cluster);
		}
	}

	return clusters;
}

/**
 * Finalize a cluster and check if it meets duration requirements
 */
function finalizeCluster(
	points: TrackerPointForVisit[],
	config: VisitDetectionConfig
): GPSCluster | null {
	if (points.length === 0) return null;

	const startTime = points[0].recorded_at;
	const endTime = points[points.length - 1].recorded_at;
	const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000;

	// Calculate density (points per minute)
	const durationMinutes = durationSeconds / 60;
	const density = durationMinutes > 0 ? points.length / durationMinutes : 0;

	// Check if duration meets adaptive threshold
	const minDuration = getMinDurationForDensity(density, config);
	if (durationSeconds < minDuration) {
		return null;
	}

	// Calculate average accuracy
	let totalAccuracy = 0;
	let accuracyCount = 0;
	for (const point of points) {
		if (point.accuracy !== undefined) {
			totalAccuracy += point.accuracy;
			accuracyCount++;
		}
	}
	const avgAccuracy = accuracyCount > 0 ? totalAccuracy / accuracyCount : 50; // Default 50m

	return {
		points,
		centroid: calculateCentroid(points),
		startTime,
		endTime,
		durationSeconds,
		avgAccuracyMeters: avgAccuracy,
		density
	};
}

/**
 * Convert a cluster with POI match to a PlaceVisit
 */
function clusterToVisit(
	cluster: GPSCluster,
	match: POIMatchResult,
	userId: string
): PlaceVisit | null {
	if (!match.primary) {
		return null;
	}

	// Get location context from the first point that has it
	let city: string | undefined;
	let country: string | undefined;
	let countryCode: string | undefined;

	for (const point of cluster.points) {
		const props = point.geocode?.properties;
		if (props) {
			city = city || props.city || undefined;
			country = country || props.country || undefined;
			countryCode = countryCode || props.country_code || undefined;
		}
		if (city && country && countryCode) break;
	}

	// Get category for amenity
	const category = match.primary.poi_amenity
		? getCategoryForAmenity(match.primary.poi_amenity)
		: null;

	// Collect all OSM tags from matched POI
	const poiTags: Record<string, unknown> = {};
	for (const point of cluster.points) {
		const nearbyPois = point.geocode?.properties?.nearby_pois;
		if (!nearbyPois) continue;

		for (const poi of nearbyPois) {
			if (poi.name === match.primary.poi_name && poi.addendum?.osm) {
				Object.assign(poiTags, poi.addendum.osm);
				break;
			}
		}
		if (Object.keys(poiTags).length > 0) break;
	}

	return {
		user_id: userId,
		started_at: cluster.startTime,
		ended_at: cluster.endTime,
		location: {
			type: 'Point',
			coordinates: [cluster.centroid.lon, cluster.centroid.lat]
		},
		poi_name: match.primary.poi_name,
		poi_layer: 'venue',
		poi_amenity: match.primary.poi_amenity,
		poi_cuisine: match.primary.poi_cuisine,
		poi_category: category || undefined,
		poi_tags: Object.keys(poiTags).length > 0 ? poiTags : undefined,
		city,
		country,
		country_code: countryCode,
		confidence_score: match.confidence,
		gps_points_count: cluster.points.length,
		avg_accuracy_meters: cluster.avgAccuracyMeters,
		detection_method: 'time_cluster',
		candidates: match.candidates.length > 0 ? match.candidates : undefined
	};
}

/**
 * Detect place visits from GPS tracker data
 *
 * @param points Array of tracker points (should be for a single user)
 * @param userId User ID for the visits
 * @param config Optional custom configuration
 * @returns Array of detected place visits
 */
export function detectVisits(
	points: TrackerPointForVisit[],
	userId: string,
	config: VisitDetectionConfig = DEFAULT_VISIT_DETECTION_CONFIG
): PlaceVisit[] {
	// Detect clusters
	const clusters = detectClusters(points, config);

	// Match each cluster to POIs and create visits
	const visits: PlaceVisit[] = [];

	for (const cluster of clusters) {
		const match = matchClusterToPOIs(cluster, config);
		const visit = clusterToVisit(cluster, match, userId);

		if (visit) {
			visits.push(visit);
		}
	}

	return visits;
}

/**
 * Visit Detection Service class for dependency injection
 */
export class VisitDetectionService {
	private config: VisitDetectionConfig;

	constructor(config: Partial<VisitDetectionConfig> = {}) {
		this.config = { ...DEFAULT_VISIT_DETECTION_CONFIG, ...config };
	}

	/**
	 * Detect place visits from GPS tracker data
	 */
	detectVisits(points: TrackerPointForVisit[], userId: string): PlaceVisit[] {
		return detectVisits(points, userId, this.config);
	}

	/**
	 * Detect clusters without POI matching (useful for debugging)
	 */
	detectClusters(points: TrackerPointForVisit[]): GPSCluster[] {
		return detectClusters(points, this.config);
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<VisitDetectionConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Get current configuration
	 */
	getConfig(): VisitDetectionConfig {
		return { ...this.config };
	}
}
