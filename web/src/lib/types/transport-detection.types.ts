import type { GeocodeGeoJSONFeature } from '../utils/geojson-converter';
import type { GPSFrequencyAnalysis } from '../utils/speed-pattern-analysis';

/**
 * Core interfaces for the enhanced transport mode detection system
 */

export interface PointData {
	lat: number;
	lng: number;
	timestamp: number;
	geocode?: GeocodeGeoJSONFeature | null;
	speed?: number;
	accuracy?: number; // GPS accuracy radius in meters; lower is better
}

export interface ModeHistoryEntry {
	mode: string;
	timestamp: number;
	speed: number;
	coordinates: { lat: number; lng: number };
	confidence: number;
	reason: string;
}

export interface JourneyContext {
	type: 'train' | 'airplane' | 'car' | 'cycling' | 'walking';
	startTime: number;
	startStation?: string;
	startAirport?: string;
	endStation?: string;
	endAirport?: string;
	startCoordinates?: { lat: number; lng: number };
	endCoordinates?: { lat: number; lng: number };
	totalDistance: number;
	averageSpeed: number;
}

export interface DetectionContext {
	// Current and previous point data
	current: PointData;
	previous: PointData;

	// Historical data for analysis
	pointHistory: PointData[];
	modeHistory: ModeHistoryEntry[];

	// Geographic context
	atTrainStation: boolean;
	atAirport: boolean;
	onHighway: boolean;
	stationName?: string;
	airportName?: string;

	// Speed context
	currentSpeed: number;
	averageSpeed: number;
	speedHistory: number[];
	rollingAverageSpeed: number;

	// GPS frequency analysis (for confidence modifiers)
	gpsFrequency: GPSFrequencyAnalysis;

	// Journey context
	currentJourney?: JourneyContext;

	// Configuration
	speedCalculationWindow: number;
}

export interface DetectionResult {
	mode: string;
	confidence: number; // 0-1
	reason: string;
	metadata?: Record<string, any>;
}

export interface DetectionRule {
	name: string;
	priority: number; // Higher number = higher priority
	canApply: (context: DetectionContext) => boolean;
	detect: (context: DetectionContext) => DetectionResult | null;
}

export interface SpeedCalculationConfig {
	DEFAULT_WINDOW_SIZE: number;
	MIN_WINDOW_SIZE: number;
	MAX_WINDOW_SIZE: number;
	OUTLIER_THRESHOLD: number;
	WEIGHT_DECAY: number;
	MIN_DISTANCE_THRESHOLD: number;
	MAX_SPEED_THRESHOLD: number;
}

export interface SpeedBracket {
	min: number;
	max: number;
	mode: string;
}

export interface SpeedSegment {
	distance: number; // meters
	time: number; // seconds
	speed: number; // km/h
}
