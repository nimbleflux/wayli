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
export function isAtVenue(
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined
): boolean {
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
		'golf_course', 'sports_centre', 'fitness_centre', 'swimming_pool',
		'park', 'playground', 'garden', 'nature_reserve', 'stadium',
		// Amenity - Food & Drink
		'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'biergarten',
		// Amenity - Entertainment
		'cinema', 'theatre', 'nightclub', 'casino', 'arts_centre',
		// Amenity - Education
		'school', 'university', 'college', 'library', 'kindergarten',
		// Amenity - Healthcare
		'hospital', 'clinic', 'doctors', 'dentist', 'pharmacy',
		// Amenity - Other
		'place_of_worship', 'community_centre', 'social_facility',
		'bank', 'post_office', 'townhall', 'courthouse',
		// Tourism
		'hotel', 'motel', 'hostel', 'guest_house', 'camp_site',
		'museum', 'gallery', 'attraction', 'theme_park', 'zoo', 'aquarium',
		// Shop (major ones where people browse)
		'supermarket', 'department_store', 'mall', 'shopping_centre'
	];

	return stationaryVenueTypes.includes(venueType.toLowerCase());
}
// Haversine distance in meters
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const toRad = (x: number) => (x * Math.PI) / 180;
	const R = 6371e3;
	const φ1 = toRad(lat1),
		φ2 = toRad(lat2);
	const Δφ = toRad(lat2 - lat1),
		Δλ = toRad(lng2 - lng1);
	const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

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
					c === 'transport:station' ||
					c === 'transport:rail' ||
					c.startsWith('transport:rail:')
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
		const railwayStationTypes = ['station', 'halt', 'platform', 'stop', 'subway_entrance', 'tram_stop'];
		if (railway && railwayStationTypes.includes(railway)) {
			return true;
		}

		// Public transport station types
		const publicTransportTypes = ['station', 'platform', 'stop_position', 'stop_area'];
		if (publicTransport && publicTransportTypes.includes(publicTransport)) {
			return true;
		}

		// Building is a train station
		if (building === 'train_station') {
			return true;
		}
	}

	// Legacy Nominatim-style detection for backward compatibility with existing data
	const hasRailwayClass =
		props.class === 'railway' || (props.address && props.address.class === 'railway');
	const hasPlatformType =
		props.type === 'platform' || (props.address && props.address.type === 'platform');

	return !!(
		props.type === 'railway_station' ||
		props.class === 'railway' ||
		props.type === 'platform' ||
		props.addresstype === 'railway' ||
		hasRailwayClass ||
		hasPlatformType
	);
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
		const aerowayTypes = ['aerodrome', 'terminal', 'gate', 'helipad', 'heliport', 'runway', 'taxiway', 'apron'];
		if (aeroway && aerowayTypes.includes(aeroway)) {
			return true;
		}

		// Building is an airport terminal
		if (building === 'terminal' || building === 'airport') {
			return true;
		}
	}

	// Legacy Nominatim-style detection for backward compatibility with existing data
	const airportTypes = ['airport', 'aerodrome', 'runway', 'terminal', 'helipad'];
	const airportClasses = ['aeroway', 'aerialway'];

	return !!(
		(props.type && typeof props.type === 'string' && airportTypes.includes(props.type)) ||
		(props.class && typeof props.class === 'string' && airportClasses.includes(props.class)) ||
		props.addresstype === 'aeroway' ||
		(props.address &&
			props.address.type &&
			typeof props.address.type === 'string' &&
			airportTypes.includes(props.address.type)) ||
		(props.address &&
			props.address.class &&
			typeof props.address.class === 'string' &&
			airportClasses.includes(props.address.class))
	);
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
	const majorHighwayTypes = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'];

	// Pelias addendum/OSM-based detection (preferred for Pelias data)
	const osm = getOsmDataFromAddendum(reverseGeocode);
	if (osm) {
		const highway = osm.highway as string | undefined;
		if (highway && majorHighwayTypes.includes(highway)) {
			return true;
		}
	}

	// Legacy Nominatim-style detection for backward compatibility with existing data
	const highwayTypes = ['motorway', 'trunk', 'primary', 'highway'];
	const highwayClasses = ['highway'];

	return !!(
		(props.type && typeof props.type === 'string' && highwayTypes.includes(props.type)) ||
		(props.class && typeof props.class === 'string' && highwayClasses.includes(props.class)) ||
		props.addresstype === 'highway' ||
		(props.address &&
			props.address.type &&
			typeof props.address.type === 'string' &&
			highwayTypes.includes(props.address.type)) ||
		(props.address &&
			props.address.class &&
			typeof props.class === 'string' &&
			highwayClasses.includes(props.address.class))
	);
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

// Enhanced transport mode detection with all constraints
export function detectEnhancedMode(
	prevLat: number,
	prevLng: number,
	currLat: number,
	currLng: number,
	dt: number, // seconds
	reverseGeocode: GeocodeGeoJSONFeature | null | undefined,
	context: EnhancedModeContext,
	speedMps?: number
): { mode: string; reason: string } {
	const speedKmh =
		typeof speedMps === 'number'
			? speedMps * 3.6
			: dt > 0
				? (haversine(prevLat, prevLng, currLat, currLng) / dt) * 3.6
				: 0;
	// Note: previous speed is derived from context.lastSpeed when needed in callers

	// Update context (defer lastSpeed assignment until after logic that needs previous)
	context.speedHistory.push(speedKmh);
	while (context.speedHistory.length > 10) {
		context.speedHistory.shift();
	}

	// Calculate average speed
	context.averageSpeed =
		context.speedHistory.reduce((a, b) => a + b, 0) / context.speedHistory.length;

	// Check if at train station
	const atTrainStation = isAtTrainStation(reverseGeocode);
	const stationName = atTrainStation ? getTrainStationName(reverseGeocode) : null;

	// Record train station visit
	if (atTrainStation && stationName) {
		const stationInfo = {
			timestamp: Date.now(),
			name: stationName,
			coordinates: { lat: currLat, lng: currLng }
		};
		context.trainStations.push(stationInfo);
		context.lastTrainStation = stationInfo;
	}

	// Phase 1: Check if at airport
	const atAirport = isAtAirport(reverseGeocode);
	const airportName = atAirport ? getAirportName(reverseGeocode) : null;

	// Record airport visit
	if (atAirport && airportName) {
		const airportInfo = {
			timestamp: Date.now(),
			name: airportName,
			coordinates: { lat: currLat, lng: currLng }
		};
		context.airports.push(airportInfo);
		context.lastAirport = airportInfo;
	}

	// Phase 1: Update distance tracking
	if (context.lastKnownCoordinates) {
		const distance = calculateSignificantDistance(context.lastKnownCoordinates, {
			lat: currLat,
			lng: currLng
		});
		context.totalDistanceTraveled += distance;
	}
	context.lastKnownCoordinates = { lat: currLat, lng: currLng, timestamp: Date.now() };

	// Phase 2: AGGRESSIVE highway/motorway detection - OVERRIDE everything else
	const onHighway = isOnHighwayOrMotorway(reverseGeocode);
	let detectedMode: string;
	let reason: string;

	// HIGHWAY/MOTORWAY OVERRIDE - This takes absolute priority
	if (onHighway && speedKmh >= 30 && speedKmh <= 200) {
		detectedMode = 'car';
		reason = TransportDetectionReason.HIGHWAY_OR_MOTORWAY;

		// Force end any existing train or airplane journeys on highways
		if (context.isInTrainJourney) {
			context.isInTrainJourney = false;
			context.trainJourneyStartTime = undefined;
			context.trainJourneyStartStation = undefined;
		}
		if (context.isInAirplaneJourney) {
			context.isInAirplaneJourney = false;
			context.airplaneJourneyStartTime = undefined;
			context.airplaneJourneyStartAirport = undefined;
		}
	} else {
		// Only proceed with normal detection if NOT on highway
		// Phase 2: Enhanced car vs train distinction with highway/motorway detection
		let speedBracket = distinguishCarVsTrain(speedKmh, atTrainStation, context, reverseGeocode);

		// --- Fallback: Always assign a mode based on speed if no context is available ---
		if (
			(speedBracket === 'unknown' || !speedBracket) &&
			typeof speedKmh === 'number' &&
			speedKmh >= 0
		) {
			speedBracket = 'car';
		}

		// Venue-based stationary detection enhancement
		// If at a stationary venue (restaurant, golf course, etc.) and speed is low,
		// increase confidence in stationary mode even with GPS drift
		const atStationaryVenue = isStationaryVenue(reverseGeocode);
		if (atStationaryVenue && speedKmh < 5) {
			// At a venue where people typically stay stationary, and speed is very low
			// This helps overcome GPS drift that might otherwise show as walking
			speedBracket = 'stationary';
		} else if (atStationaryVenue && speedKmh < 10 && speedBracket === 'walking') {
			// At a stationary venue but showing walking speeds - likely GPS drift
			// Keep as walking but with lower confidence (context suggests stationary)
			// The venue context provides additional information for downstream processing
		}

		// Phase 2: More restrictive train detection - only if NOT on highway/motorway
		detectedMode = speedBracket;
		reason = TransportDetectionReason.DEFAULT;

		// Add venue context to reason if at a stationary venue
		if (atStationaryVenue && detectedMode === 'stationary') {
			reason = TransportDetectionReason.VENUE_STATIONARY;
		}

		// Only detect train if NOT on highway/motorway
		if (!onHighway) {
			// Proactively start a train journey when at a station and moving at >= 30 km/h
			if (!context.isInTrainJourney && atTrainStation && speedKmh >= 30) {
				context.isInTrainJourney = true;
				context.trainJourneyStartTime = Date.now();
				context.trainJourneyStartStation = stationName || 'Unknown';
				detectedMode = 'train';
				reason = TransportDetectionReason.TRAIN_STATION_AND_SPEED;
			}

			if (speedBracket === 'train' || (context.isInTrainJourney && speedKmh >= 30)) {
				if (!context.isInTrainJourney && atTrainStation) {
					context.isInTrainJourney = true;
					context.trainJourneyStartTime = Date.now();
					context.trainJourneyStartStation = stationName || 'Unknown';
					detectedMode = 'train';
					reason = TransportDetectionReason.TRAIN_STATION_AND_SPEED;
				} else if (context.isInTrainJourney) {
					detectedMode = 'train';
					reason = TransportDetectionReason.TRAIN_SPEED_ONLY;
					if (atTrainStation && context.trainJourneyStartStation !== stationName) {
						context.isInTrainJourney = false;
						context.trainJourneyStartTime = undefined;
						context.trainJourneyStartStation = undefined;
						reason = TransportDetectionReason.TRAIN_STATION_AND_SPEED;
					}
				} else if (
					context.lastTrainStation &&
					Date.now() - context.lastTrainStation.timestamp < 3600000 &&
					speedKmh >= 50 // Higher threshold for train detection without station
				) {
					context.isInTrainJourney = true;
					context.trainJourneyStartTime = context.lastTrainStation.timestamp;
					context.trainJourneyStartStation = context.lastTrainStation.name;
					detectedMode = 'train';
					reason = TransportDetectionReason.TRAIN_STATION_AND_SPEED;
				}
			}

			if (context.isInTrainJourney && speedKmh < 30) {
				context.isInTrainJourney = false;
				context.trainJourneyStartTime = undefined;
				context.trainJourneyStartStation = undefined;
				detectedMode = speedBracket;
				reason = TransportDetectionReason.MIN_DURATION_NOT_MET;
			}
		}
	}

	// Phase 2: EXTREMELY restrictive airplane detection - ONLY if NOT on highway
	if (!onHighway) {
		// Only detect airplane if: 1) At airport AND 2) Very high speed (400+ km/h) AND 3) Significant distance
		if (atAirport && speedKmh >= 400 && isSignificantDistance(context.totalDistanceTraveled)) {
			if (!context.isInAirplaneJourney) {
				context.isInAirplaneJourney = true;
				context.airplaneJourneyStartTime = Date.now();
				context.airplaneJourneyStartAirport = airportName || 'Unknown';
				detectedMode = 'airplane';
				reason = TransportDetectionReason.AIRPORT_AND_SPEED;
			}
		} else if (context.isInAirplaneJourney && speedKmh >= 400) {
			// Continue airplane journey only if speed remains very high
			detectedMode = 'airplane';
			reason = TransportDetectionReason.AIRPLANE_SPEED_ONLY;
			if (atAirport && context.airplaneJourneyStartAirport !== airportName) {
				// End airplane journey at different airport
				context.isInAirplaneJourney = false;
				context.airplaneJourneyStartTime = undefined;
				context.airplaneJourneyStartAirport = undefined;
				reason = TransportDetectionReason.AIRPORT_AND_SPEED;
			}
		} else if (context.isInAirplaneJourney && speedKmh < 400) {
			// End airplane journey if speed drops below airplane threshold
			context.isInAirplaneJourney = false;
			context.airplaneJourneyStartTime = undefined;
			context.airplaneJourneyStartAirport = undefined;
			detectedMode = getSpeedBracket(speedKmh);
			reason = TransportDetectionReason.MIN_DURATION_NOT_MET;
		}
	} else {
		// On highway - NEVER detect airplane, force end any existing airplane journey
		if (context.isInAirplaneJourney) {
			context.isInAirplaneJourney = false;
			context.airplaneJourneyStartTime = undefined;
			context.airplaneJourneyStartAirport = undefined;
		}
		// If we're on highway and speed is reasonable, it's a car
		if (speedKmh >= 30 && speedKmh <= 200) {
			detectedMode = 'car';
			reason = TransportDetectionReason.HIGHWAY_OR_MOTORWAY;
		}
	}

	// --- Phase 2: ENHANCED CONTINUITY LOGIC ---
	// BUT ONLY if we're NOT on highway (highway override takes absolute priority)
	if (
		!onHighway &&
		context.currentMode &&
		context.currentMode !== 'stationary' &&
		context.currentMode !== 'unknown' &&
		dt < MIN_STOP_DURATION
	) {
		// Phase 2: Analyze mode history and rolling average for better continuity decisions
		const { shouldMaintainMode, confidence } = analyzeModeHistory(
			context,
			speedKmh,
			atTrainStation,
			atAirport
		);

		// Get rolling average speed for more stable speed-based decisions
		const rollingAvgSpeed = calculateRollingAverageSpeed(context, speedKmh, 5);

		// Prevent direct car->plane switch
		if (context.currentMode === 'car' && detectedMode === 'airplane') {
			detectedMode = 'car';
			reason = TransportDetectionReason.KEEP_CONTINUITY;
		} else if (detectedMode !== 'airplane') {
			// Use enhanced mode switch validation with rolling average speed and geographic context
			if (
				isModeSwitchPossible(
					context.currentMode,
					detectedMode,
					atTrainStation,
					rollingAvgSpeed,
					atAirport
				)
			) {
				// If mode history analysis suggests maintaining current mode with high confidence
				if (shouldMaintainMode && confidence > 0.7) {
					detectedMode = context.currentMode;
					reason = TransportDetectionReason.KEEP_CONTINUITY;
				}
			} else {
				// Mode switch not possible, maintain current mode
				detectedMode = context.currentMode;
				reason = TransportDetectionReason.KEEP_CONTINUITY;
			}
		}
	}

	// Phase 2: Final check for physically impossible combinations
	if (isPhysicallyImpossible(detectedMode, speedKmh)) {
		// Force mode switch to a physically possible mode based on speed
		if (speedKmh <= 8) {
			detectedMode = 'walking';
		} else if (speedKmh <= 30) {
			detectedMode = 'cycling';
		} else if (speedKmh <= 200) {
			detectedMode = 'car';
		} else if (speedKmh <= 300) {
			detectedMode = 'train';
		} else {
			detectedMode = 'airplane';
		}
		reason = TransportDetectionReason.PHYSICALLY_IMPOSSIBLE;
	}

	context.currentMode = detectedMode;
	context.lastSpeed = speedKmh;

	// Phase 1: Update mode history
	context.modeHistory.push({
		mode: detectedMode,
		timestamp: Date.now(),
		speed: speedKmh,
		coordinates: { lat: currLat, lng: currLng }
	});

	// Keep only last 10 mode history entries
	while (context.modeHistory.length > 10) {
		context.modeHistory.shift();
	}

	return { mode: detectedMode, reason };
}

// Legacy functions for backward compatibility

// Legacy detectMode removed; use detectEnhancedMode instead
