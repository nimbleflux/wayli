import { TransportDetectionReason } from '../types/transport-mode.types';
import type { GeocodeGeoJSONFeature } from './geojson-converter';

import { SPEED_BRACKETS } from './transport-mode.config';

// =============================================================================
// Addendum/OSM Tag Extraction Helpers
// =============================================================================

/**
 * Extracts OSM data from the addendum field of a geocode feature.
 * Returns the osm object or null if not available.
 */
function getOsmDataFromAddendum(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): Record<string, unknown> | null {
	if (!reverseGeocode?.properties?.addendum) return null;

	const addendum = reverseGeocode.properties.addendum as Record<string, unknown>;
	const osm = addendum.osm;

	if (!osm || typeof osm !== 'object') return null;
	return osm as Record<string, unknown>;
}

/**
 * Gets the venue type from addendum OSM data.
 * Checks leisure, amenity, tourism, shop, sport tags in priority order.
 */
export function getVenueTypeFromAddendum(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): string | null {
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (!osm) return null;

	return (
		(osm.leisure as string) ||
		(osm.amenity as string) ||
		(osm.tourism as string) ||
		(osm.shop as string) ||
		(osm.sport as string) ||
		null
	);
}

/**
 * Checks if the person is at a known venue type (restaurant, golf course, etc.)
 * This is useful for improving stationary detection confidence.
 */
export function isAtVenue(reverseGeocode: GeocodeGeoJSONFeature | null | undefined): boolean {
	return getVenueTypeFromAddendum(reverseGeocode) !== null;
}

/**
 * Checks if the venue type suggests stationary activity.
 * Returns true for venues where people typically stay for extended periods.
 */
export function isStationaryVenue(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	const venueType = getVenueTypeFromAddendum(reverseGeocode);
	if (!venueType) return false;

	// Venue types where people typically stay stationary
	const stationaryVenueTypes = [
		// Leisure
		'golf_course',
		'sports_centre',
		'fitness_centre',
		'swimming_pool',
		'park',
		'playground',
		'garden',
		'nature_reserve',
		'stadium',
		// Amenity - Food & Drink
		'restaurant',
		'cafe',
		'bar',
		'pub',
		'fast_food',
		'food_court',
		'biergarten',
		// Amenity - Entertainment
		'cinema',
		'theatre',
		'nightclub',
		'casino',
		'arts_centre',
		// Amenity - Education
		'school',
		'university',
		'college',
		'library',
		'kindergarten',
		// Amenity - Healthcare
		'hospital',
		'clinic',
		'doctors',
		'dentist',
		'pharmacy',
		// Amenity - Other
		'place_of_worship',
		'community_centre',
		'social_facility',
		'bank',
		'post_office',
		'townhall',
		'courthouse',
		// Tourism
		'hotel',
		'motel',
		'hostel',
		'guest_house',
		'camp_site',
		'museum',
		'gallery',
		'attraction',
		'theme_park',
		'zoo',
		'aquarium',
		// Shop (major ones where people browse)
		'supermarket',
		'department_store',
		'mall',
		'shopping_centre'
	];

	return stationaryVenueTypes.includes(venueType.toLowerCase());
}
/**
 * Checks if the geocode evidence suggests the point is on (or immediately at)
 * open water (#220). Three signal classes:
 *   1. A permanent reverse-geocode failure — Pelias had no land record for the
 *      coordinate. Rate-limit and transport failures are flagged `retryable`
 *      and must NOT count (a missing lookup is not evidence of water).
 *   2. Pelias marine layer / water categories.
 *   3. OSM water tags in the addendum (waterway, natural=water|coastline|bay,
 *      man_made=pier|breakwater|groyne, seamark:type).
 */
export function isOnWaterGeocode(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || typeof reverseGeocode !== 'object' || !reverseGeocode.properties) {
		return false;
	}

	const props = reverseGeocode.properties as Record<string, unknown>;

	// Signal 1: permanent NO-RESULT failures (open water has no land record).
	// Only no-result-class errors count — infra failures ("All Pelias endpoints
	// failed", 5xx) are also non-retryable but are NOT evidence of water.
	if (
		props.geocoding_status === 'failed' &&
		props.retryable !== true &&
		/no results/i.test(String(props.geocode_error ?? ''))
	) {
		return true;
	}

	// Signal 2: Pelias marine layer / water categories
	if (props.layer === 'marine') return true;
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category) && category.some((c) => String(c).includes('water'))) {
		return true;
	}

	// Signal 3: OSM water tags
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		if (typeof osm.waterway === 'string' && osm.waterway.length > 0) return true;
		if (['water', 'coastline', 'bay'].includes(osm.natural as string)) return true;
		if (['pier', 'breakwater', 'groyne'].includes(osm['man_made'] as string)) return true;
		if (typeof osm['seamark:type'] === 'string' && osm['seamark:type'].length > 0) return true;
	}

	return false;
}

// ponytail: haversine consolidated into multi-point-speed.ts; re-exported here for back-compat.
export { haversine } from './multi-point-speed';
import { haversine } from './multi-point-speed';

// Speed brackets for transport modes (km/h)
export const MIN_STOP_DURATION = 300; // 5 minutes

// Enhanced Context object to track transport mode state with airport support
export interface EnhancedModeContext {
	currentMode: string;
	lastSpeed: number;

	// Train tracking (existing)
	trainStations: Array<{
		timestamp: number;
		name: string;
		coordinates: { lat: number; lng: number };
	}>;
	lastTrainStation?: {
		timestamp: number;
		name: string;
		coordinates: { lat: number; lng: number };
	};
	isInTrainJourney: boolean;
	trainJourneyStartTime?: number;
	trainJourneyStartStation?: string;

	// Airport tracking (Phase 1)
	airports: Array<{
		timestamp: number;
		name: string;
		coordinates: { lat: number; lng: number };
	}>;
	lastAirport?: {
		timestamp: number;
		name: string;
		coordinates: { lat: number; lng: number };
	};
	isInAirplaneJourney: boolean;
	airplaneJourneyStartTime?: number;
	airplaneJourneyStartAirport?: string;

	// Speed and history tracking (Phase 1)
	averageSpeed: number;
	speedHistory: number[];
	modeHistory: Array<{
		mode: string;
		timestamp: number;
		speed: number;
		coordinates: { lat: number; lng: number };
	}>;

	// Distance tracking (Phase 1)
	totalDistanceTraveled: number;
	lastKnownCoordinates?: { lat: number; lng: number; timestamp: number };
}

// Get speed bracket for a given speed
export function getSpeedBracket(speedKmh: number): string {
	for (const bracket of SPEED_BRACKETS) {
		if (speedKmh >= bracket.min && speedKmh < bracket.max) {
			return bracket.mode;
		}
	}
	return 'unknown';
}

// Check if a point is at a train station
export function isAtTrainStation(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const props = reverseGeocode.properties;

	// Pelias category-based detection
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		// Check for train/rail related categories
		if (
			category.some(
				(c) =>
					c === 'transport:station' || c === 'transport:rail' || c.startsWith('transport:rail:')
			)
		) {
			return true;
		}
	}

	// Addendum/OSM-based detection (merged from all Pelias features)
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		// Check for railway-related OSM tags
		const railway = osm.railway as string | undefined;
		const publicTransport = osm.public_transport as string | undefined;
		const building = osm.building as string | undefined;

		// Railway station types
		const railwayStationTypes = [
			'station',
			'halt',
			'platform',
			'stop',
			'subway_entrance',
			'tram_stop'
		];
		if (railway && railwayStationTypes.includes(railway)) {
			return true;
		}

		// Public transport station types
		const publicTransportTypes = ['station', 'platform', 'stop_position', 'stop_area'];
		if (publicTransport && publicTransportTypes.includes(publicTransport)) {
			return true;
		}

		// Building is a train station or transportation building
		if (building === 'train_station' || building === 'transportation') {
			return true;
		}
	}

	return false;
}

// Get train station name from reverse geocode
export function getTrainStationName(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): string | null {
	if (!reverseGeocode || !reverseGeocode.properties) return null;

	const props = reverseGeocode.properties;

	// Pelias properties (preferred)
	const name = (props.name as string) || props.label || props.display_name || '';
	const city = props.locality || props.address?.city || '';

	if (city && name && name !== city) {
		return `${city} - ${name}`;
	}
	return name || city || null;
}

// Phase 1: Airport Detection Functions

// Check if a point is at an airport
export function isAtAirport(reverseGeocode: GeocodeGeoJSONFeature | null | undefined): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const props = reverseGeocode.properties;

	// Pelias category-based detection
	const category = props.category as string[] | undefined;
	if (category && Array.isArray(category)) {
		// Check for air transport related categories
		if (category.some((c) => c.startsWith('transport:air'))) {
			return true;
		}
	}

	// Addendum/OSM-based detection (merged from all Pelias features)
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		// Check for aeroway-related OSM tags
		const aeroway = osm.aeroway as string | undefined;
		const building = osm.building as string | undefined;

		// Aeroway types that indicate airport
		const aerowayTypes = [
			'aerodrome',
			'terminal',
			'gate',
			'helipad',
			'heliport',
			'runway',
			'taxiway',
			'apron'
		];
		if (aeroway && aerowayTypes.includes(aeroway)) {
			return true;
		}

		// Building is an airport terminal
		if (building === 'terminal' || building === 'airport' || building === 'airport_terminal') {
			return true;
		}
	}

	return false;
}

// Get airport name from reverse geocode
export function getAirportName(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): string | null {
	if (!reverseGeocode || !reverseGeocode.properties) return null;

	const props = reverseGeocode.properties;

	// Pelias properties (preferred)
	const name = (props.name as string) || props.label || props.display_name || '';
	const city = props.locality || props.address?.city || '';

	if (city && name && name !== city) {
		return `${city} - ${name}`;
	}
	return name || city || null;
}

// Calculate significant distance threshold for airplane detection
export function calculateSignificantDistance(
	startCoords: { lat: number; lng: number },
	endCoords: { lat: number; lng: number }
): number {
	return haversine(startCoords.lat, startCoords.lng, endCoords.lat, endCoords.lng);
}

// Check if distance traveled indicates airplane journey (>50km)
export function isSignificantDistance(distanceMeters: number): boolean {
	const AIRPLANE_DISTANCE_THRESHOLD = 50000; // 50km in meters
	return distanceMeters > AIRPLANE_DISTANCE_THRESHOLD;
}

// Phase 2: Calculate rolling average speed to handle traffic jams and station stops
export function calculateRollingAverageSpeed(
	context: EnhancedModeContext,
	currentSpeed: number,
	windowSize: number = 5
): number {
	const history = context.speedHistory;

	// If we don't have enough history, use current speed
	if (history.length < 2) {
		return currentSpeed;
	}

	// Use the last N speeds including current speed
	const recentSpeeds = [...history.slice(-windowSize), currentSpeed];

	// Calculate weighted average (more recent speeds have higher weight)
	const weights = recentSpeeds.map((_, index) => index + 1);
	const weightedSum = recentSpeeds.reduce((sum, speed, index) => sum + speed * weights[index], 0);
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

	return weightedSum / totalWeight;
}

// Phase 2: Analyze measurement frequency for transport mode detection with rolling average
export function analyzeMeasurementFrequency(
	context: EnhancedModeContext,
	currentSpeed: number
): { likelyMode: string; confidence: number; rollingAvgSpeed: number } {
	const history = context.modeHistory;
	if (history.length < 3) {
		return { likelyMode: 'unknown', confidence: 0, rollingAvgSpeed: currentSpeed };
	}

	// Calculate rolling average speed to handle traffic jams and station stops
	const rollingAvgSpeed = calculateRollingAverageSpeed(context, currentSpeed, 5);

	// Calculate average time between measurements (in seconds)
	const recentTimestamps = history.slice(-5).map((h) => h.timestamp);
	const timeDiffs = [];
	for (let i = 1; i < recentTimestamps.length; i++) {
		timeDiffs.push((recentTimestamps[i] - recentTimestamps[i - 1]) / 1000);
	}
	const avgTimeBetweenMeasurements = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;

	// Define frequency thresholds (in seconds)
	const HIGH_FREQUENCY = 30; // < 30 seconds = high frequency (navigation enabled)
	const MEDIUM_FREQUENCY = 120; // 30-120 seconds = medium frequency
	const LOW_FREQUENCY = 300; // 120-300 seconds = low frequency
	// > 300 seconds = very low frequency

	let likelyMode = 'unknown';
	let confidence = 0;

	// High frequency + car speeds (using rolling average) = Car with navigation
	if (
		avgTimeBetweenMeasurements < HIGH_FREQUENCY &&
		rollingAvgSpeed >= 30 &&
		rollingAvgSpeed <= 120
	) {
		likelyMode = 'car';
		confidence = 0.8;
	}
	// High frequency + low speeds = Walking/cycling
	else if (avgTimeBetweenMeasurements < HIGH_FREQUENCY && rollingAvgSpeed < 30) {
		likelyMode = rollingAvgSpeed < 8 ? 'walking' : 'cycling';
		confidence = 0.7;
	}
	// Low frequency + high speeds (using rolling average) = Train
	else if (
		avgTimeBetweenMeasurements > MEDIUM_FREQUENCY &&
		rollingAvgSpeed >= 50 &&
		rollingAvgSpeed <= 200
	) {
		likelyMode = 'train';
		confidence = 0.8;
	}
	// Very low frequency + very high speeds = Airplane
	else if (avgTimeBetweenMeasurements > LOW_FREQUENCY && rollingAvgSpeed >= 200) {
		likelyMode = 'airplane';
		confidence = 0.9;
	}
	// Medium frequency + ambiguous speeds = Less certain
	else if (
		avgTimeBetweenMeasurements >= HIGH_FREQUENCY &&
		avgTimeBetweenMeasurements <= MEDIUM_FREQUENCY
	) {
		// Use speed brackets as fallback with rolling average
		likelyMode = getSpeedBracket(rollingAvgSpeed);
		confidence = 0.4;
	}

	return { likelyMode, confidence, rollingAvgSpeed };
}

// Phase 2: Analyze mode history for better continuity decisions
export function analyzeModeHistory(
	context: EnhancedModeContext,
	currentSpeed: number,
	atTrainStation: boolean,
	atAirport: boolean
): { shouldMaintainMode: boolean; confidence: number } {
	const history = context.modeHistory;
	if (history.length < 3) {
		return { shouldMaintainMode: false, confidence: 0 };
	}

	const recentModes = history.slice(-3).map((h) => h.mode);
	const currentMode = context.currentMode;

	// Check for consistent recent mode
	const modeConsistency =
		recentModes.filter((mode) => mode === currentMode).length / recentModes.length;

	// Check for speed consistency
	const recentSpeeds = history.slice(-3).map((h) => h.speed);
	const speedConsistency = recentSpeeds.every(
		(speed) => Math.abs(speed - currentSpeed) < 20 // Within 20 km/h of current speed
	)
		? 1
		: 0;

	// Geographic context consistency
	const hasGeographicContext =
		(currentMode === 'train' && atTrainStation) ||
		(currentMode === 'airplane' && atAirport) ||
		(currentMode === 'car' && !atTrainStation && !atAirport);

	const confidence =
		modeConsistency * 0.4 + speedConsistency * 0.3 + (hasGeographicContext ? 0.3 : 0);
	const shouldMaintainMode = confidence > 0.6;

	return { shouldMaintainMode, confidence };
}

// Phase 2: Check if location is on highway/motorway
export function isOnHighwayOrMotorway(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
	if (!reverseGeocode || !reverseGeocode.properties) return false;

	const props = reverseGeocode.properties;

	// OSM highway types that indicate major roads (motorways, trunk roads, primary roads)
	const majorHighwayTypes = [
		'motorway',
		'motorway_link',
		'trunk',
		'trunk_link',
		'primary',
		'primary_link'
	];

	// Pelias addendum/OSM-based detection
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		const highway = osm.highway as string | undefined;
		if (highway && majorHighwayTypes.includes(highway)) {
			return true;
		}
	}

	return false;
}

// Phase 2: Enhanced car vs train distinction based on geographic context, measurement frequency, and road type
export function distinguishCarVsTrain(
	speedKmh: number,
	atTrainStation: boolean,
	context: EnhancedModeContext,
	reverseGeocode?: GeocodeGeoJSONFeature | null | undefined
): string {
	// Phase 2: Strong highway/motorway indicator = car
	if (reverseGeocode && isOnHighwayOrMotorway(reverseGeocode) && speedKmh >= 30) {
		return 'car';
	}

	// If at train station and speed is in train range, likely train
	if (atTrainStation && speedKmh >= 25 && speedKmh <= 120) {
		return 'train';
	}

	// If recently at train station and speed is high, likely train
	if (
		context.lastTrainStation &&
		Date.now() - context.lastTrainStation.timestamp < 1800000 && // 30 minutes
		speedKmh >= 30 &&
		speedKmh <= 120
	) {
		return 'train';
	}

	// Phase 2: Use measurement frequency and rolling average to distinguish car vs train in ambiguous speed range
	if (speedKmh >= 30 && speedKmh <= 130) {
		const { likelyMode, confidence, rollingAvgSpeed } = analyzeMeasurementFrequency(
			context,
			speedKmh
		);

		// If frequency analysis gives high confidence for car (navigation enabled)
		if (likelyMode === 'car' && confidence > 0.7) {
			return 'car';
		}
		// If frequency analysis gives high confidence for train (low frequency)
		else if (likelyMode === 'train' && confidence > 0.7) {
			return 'train';
		}
		// Use rolling average speed for better decision making
		else if (rollingAvgSpeed >= 30 && rollingAvgSpeed <= 130) {
			// Rolling average suggests car speeds with high frequency = car
			// Rolling average suggests train speeds with low frequency = train
			return rollingAvgSpeed > 80 ? 'train' : 'car';
		}
		// Fallback to geographic context
		else {
			return atTrainStation ? 'train' : 'car';
		}
	}

	// Use speed brackets for other cases
	return getSpeedBracket(speedKmh);
}

// Phase 2: Check for physically impossible speed/mode combinations
export function isPhysicallyImpossible(mode: string, speedKmh: number): boolean {
	// Define maximum realistic speeds for each mode
	const MAX_SPEEDS = {
		walking: 8, // Maximum walking speed
		cycling: 30, // Maximum cycling speed (even professional cyclists rarely exceed this in normal conditions)
		car: 200, // Maximum car speed (highway speeds)
		train: 300, // Maximum train speed
		airplane: 1000, // Maximum airplane speed
		stationary: 2 // Maximum stationary speed (GPS drift)
	};

	const maxSpeed = MAX_SPEEDS[mode as keyof typeof MAX_SPEEDS];
	return maxSpeed !== undefined && speedKmh > maxSpeed;
}

// Phase 2: Enhanced mode switch validation with speed-based rules
export function isModeSwitchPossible(
	fromMode: string,
	toMode: string,
	atTrainStation: boolean,
	currentSpeed?: number,
	atAirport?: boolean
): boolean {
	// Same mode is always allowed (not a switch)
	if (fromMode === toMode) return true;

	// Phase 2: Check for physically impossible combinations
	if (currentSpeed !== undefined) {
		// If the target mode is physically impossible at current speed, don't allow the switch
		if (isPhysicallyImpossible(toMode, currentSpeed)) {
			return false;
		}
		// If maintaining current mode is physically impossible, force a switch
		if (isPhysicallyImpossible(fromMode, currentSpeed)) {
			return true; // Allow switch to any mode that's physically possible
		}
	}

	// Phase 2: Speed-based transition rules
	const SLOW_SPEED_THRESHOLD = 5; // km/h - must slow down for certain transitions
	const isSlowEnough = currentSpeed === undefined || currentSpeed < SLOW_SPEED_THRESHOLD;

	// High-speed mode transitions require slowing down first
	const highSpeedModes = ['airplane', 'train', 'car'];
	const requiresSlowdown = highSpeedModes.includes(fromMode) && highSpeedModes.includes(toMode);

	if (requiresSlowdown && !isSlowEnough) {
		return false; // Must slow down before switching between high-speed modes
	}

	// Specific transition rules with speed requirements
	if (fromMode === 'airplane' && toMode !== 'stationary' && !isSlowEnough) {
		return false; // Must slow down after airplane before other modes
	}

	if (toMode === 'airplane' && fromMode !== 'stationary' && !isSlowEnough) {
		return false; // Must slow down before airplane
	}

	// Geographic context rules
	if (fromMode === 'car' && toMode === 'train' && !atTrainStation) return false;
	if (fromMode === 'train' && toMode === 'car' && !atTrainStation) return false;
	if (fromMode === 'cycling' && toMode === 'train') return false; // Can't switch from cycling to train
	if (fromMode === 'train' && toMode === 'cycling') return false; // Can't switch from train to cycling

	// Airport context rules
	if (fromMode === 'airplane' && toMode === 'airplane' && !atAirport) {
		return false; // Can't continue airplane journey without airport context
	}

	// Stationary can switch to anything
	if (fromMode === 'stationary') return true;

	// Walking can switch to anything
	if (fromMode === 'walking') return true;

	// Cycling can switch to anything except train
	if (fromMode === 'cycling') {
		return toMode !== 'train';
	}

	// Car can only switch to train at station, or to walking/cycling/stationary
	if (fromMode === 'car') {
		return ['walking', 'cycling', 'stationary', ...(atTrainStation ? ['train'] : [])].includes(
			toMode
		);
	}

	// Train can only switch to car at station, or to walking/stationary
	if (fromMode === 'train') {
		return ['walking', 'stationary', ...(atTrainStation ? ['car'] : [])].includes(toMode);
	}

	// Airplane can switch to anything (landing)
	if (fromMode === 'airplane') return true;

	return true;
}
