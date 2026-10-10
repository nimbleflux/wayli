import type {
	PointData,
	SpeedCalculationConfig,
	SpeedSegment
} from '../types/transport-detection.types';

/**
 * Multi-point speed calculation for noise reduction and stability
 */

export const SPEED_CALCULATION_CONFIG: SpeedCalculationConfig = {
	DEFAULT_WINDOW_SIZE: 5, // Number of points to use
	MIN_WINDOW_SIZE: 3, // Minimum points required
	MAX_WINDOW_SIZE: 10, // Maximum points to prevent lag
	OUTLIER_THRESHOLD: 2.0, // Standard deviations for outlier detection
	WEIGHT_DECAY: 0.8, // Weight decay factor for older points
	MIN_DISTANCE_THRESHOLD: 10, // Minimum distance in meters to consider
	MAX_SPEED_THRESHOLD: 500 // Maximum realistic speed in km/h
};

// ponytail: beyond this accuracy radius a fix is too noisy to trust for speed/mode math.
const MAX_RELIABLE_ACCURACY_M = 100;

/**
 * Haversine distance calculation in meters
 */
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

/**
 * Calculate speed using multiple points for noise reduction
 */
export function calculateMultiPointSpeed(
	points: PointData[],
	windowSize: number = SPEED_CALCULATION_CONFIG.DEFAULT_WINDOW_SIZE
): number {
	// Exclude points with unusably poor accuracy — their speeds/positions only add noise.
	// Points without an accuracy value are kept (older data + computed fallbacks).
	const usable = points.filter(
		(p) => p.accuracy === undefined || p.accuracy <= MAX_RELIABLE_ACCURACY_M
	);
	const considered = usable.length >= SPEED_CALCULATION_CONFIG.MIN_WINDOW_SIZE ? usable : points;

	// Check if points have pre-calculated speeds (from database)
	const pointsWithSpeed = considered.filter(
		(p) => p.speed !== undefined && p.speed !== null && p.speed > 0
	);

	// If we have enough points with pre-calculated speeds, use those instead of calculating from coordinates
	if (pointsWithSpeed.length >= Math.min(3, considered.length)) {
		// Pair each recent speed with its source accuracy so filtering doesn't break alignment
		const recent = pointsWithSpeed.slice(-windowSize).map((p) => ({
			speed: p.speed!,
			accuracy: p.accuracy
		}));
		// Filter outliers
		const entries = recent.filter(
			(e) => e.speed > 0 && e.speed < SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD
		);
		if (entries.length === 0) return 0;

		// Calculate weighted average (more weight on recent speeds, less on low-accuracy fixes)
		let weightedSum = 0;
		let totalWeight = 0;
		entries.forEach((entry, index) => {
			// ponytail: accuracy weighting — halve the weight of fixes above 50m
			const accuracyFactor = entry.accuracy !== undefined && entry.accuracy > 50 ? 0.5 : 1;
			const weight =
				Math.pow(SPEED_CALCULATION_CONFIG.WEIGHT_DECAY, entries.length - 1 - index) *
				accuracyFactor;
			weightedSum += entry.speed * weight;
			totalWeight += weight;
		});

		return totalWeight > 0
			? Math.min(weightedSum / totalWeight, SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD)
			: 0;
	}

	// Fallback: Calculate from coordinates and timestamps
	// Handle case with only 2 points (simple speed calculation)
	if (considered.length === 2) {
		const [prev, curr] = considered;
		const distance = haversine(prev.lat, prev.lng, curr.lat, curr.lng);
		const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // seconds
		if (timeDiff > 0 && distance > SPEED_CALCULATION_CONFIG.MIN_DISTANCE_THRESHOLD) {
			const speedMs = distance / timeDiff;
			const speedKmh = speedMs * 3.6;
			return Math.min(speedKmh, SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD);
		}
		return 0;
	}

	if (considered.length < SPEED_CALCULATION_CONFIG.MIN_WINDOW_SIZE) {
		return 0;
	}

	// Use the most recent points
	const recentPoints = considered.slice(-windowSize);

	// Calculate distances and times between consecutive points
	const segments: SpeedSegment[] = [];
	for (let i = 1; i < recentPoints.length; i++) {
		const prev = recentPoints[i - 1];
		const curr = recentPoints[i];

		const distance = haversine(prev.lat, prev.lng, curr.lat, curr.lng);
		const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // seconds

		if (timeDiff > 0 && distance > SPEED_CALCULATION_CONFIG.MIN_DISTANCE_THRESHOLD) {
			segments.push({
				distance,
				time: timeDiff,
				speed: (distance / timeDiff) * 3.6 // km/h
			});
		}
	}

	if (segments.length === 0) return 0;

	// Filter out outliers
	const filteredSegments = filterOutliers(segments);

	// Calculate weighted average speed
	const weightedSpeed = calculateWeightedAverageSpeed(filteredSegments);

	return Math.min(weightedSpeed, SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD);
}

/**
 * Filter out GPS outliers using statistical methods
 */
function filterOutliers(segments: SpeedSegment[]): SpeedSegment[] {
	if (segments.length < 3) return segments;

	const speeds = segments.map((s) => s.speed);
	const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
	const variance =
		speeds.reduce((sum, speed) => sum + Math.pow(speed - mean, 2), 0) / speeds.length;
	const stdDev = Math.sqrt(variance);

	const threshold = mean + SPEED_CALCULATION_CONFIG.OUTLIER_THRESHOLD * stdDev;

	return segments.filter((segment) => segment.speed <= threshold && segment.speed >= 0);
}

/**
 * Calculate weighted average with more weight for recent points
 */
function calculateWeightedAverageSpeed(segments: SpeedSegment[]): number {
	if (segments.length === 0) return 0;

	let weightedSum = 0;
	let totalWeight = 0;

	segments.forEach((segment, index) => {
		const weight = Math.pow(SPEED_CALCULATION_CONFIG.WEIGHT_DECAY, segments.length - 1 - index);
		weightedSum += segment.speed * weight;
		totalWeight += weight;
	});

	return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Get adaptive window size based on GPS data quality
 *
 * Prefers the GPS `accuracy` field (a direct measure of fix quality) over the
 * inter-point-distance heuristic. Larger window => more smoothing for noisy fixes.
 */
export function getAdaptiveWindowSize(pointHistory: PointData[]): number {
	if (pointHistory.length < 3) return SPEED_CALCULATION_CONFIG.MIN_WINDOW_SIZE;

	// Direct fix-quality proxy when accuracy is available
	const accuracies = pointHistory
		.map((p) => p.accuracy)
		.filter((a): a is number => typeof a === 'number' && a > 0);

	if (accuracies.length >= Math.min(3, pointHistory.length)) {
		const avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
		if (avgAccuracy > 50) return 7; // Noisy GPS
		if (avgAccuracy > 25) return 5; // Moderate noise
		return 3; // Clean GPS
	}

	// Fallback: estimate noise from inter-point distance
	const distances: number[] = [];
	for (let i = 1; i < pointHistory.length; i++) {
		const dist = haversine(
			pointHistory[i - 1].lat,
			pointHistory[i - 1].lng,
			pointHistory[i].lat,
			pointHistory[i].lng
		);
		distances.push(dist);
	}

	const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;

	// Use larger window for noisy GPS data
	if (avgDistance > 100) return 7; // Noisy GPS
	if (avgDistance > 50) return 5; // Moderate noise
	return 3; // Clean GPS
}

/**
 * Set speed calculation window size with bounds checking
 */
export function setSpeedCalculationWindow(windowSize: number): number {
	return Math.max(
		SPEED_CALCULATION_CONFIG.MIN_WINDOW_SIZE,
		Math.min(windowSize, SPEED_CALCULATION_CONFIG.MAX_WINDOW_SIZE)
	);
}
