// Enhanced speed brackets for transport modes (km/h)
// More realistic and non-overlapping brackets based on your constraints
export const SPEED_BRACKETS = [
	{ min: 0, max: 2, mode: 'stationary' },
	{ min: 2, max: 10, mode: 'walking' }, // Increased to 10 to allow jogging/running
	{ min: 10, max: 35, mode: 'cycling' }, // Increased to 35 for fast cycling/downhill
	{ min: 35, max: 110, mode: 'car' }, // Adjusted for city and highway driving
	{ min: 60, max: 200, mode: 'train' }, // Lowered to 60 for regional trains (overlaps with car)
	{ min: 200, max: Infinity, mode: 'airplane' }
];

/**
 * Hard ceiling on observed speed (km/h) used by feature extraction to clamp
 * garbage GPS-derived values. The fastest mode we model is airplane (band
 * ceiling ~1000), but anything above this in a tracker feed is a glitch (the DB
 * has recorded values up to ~481000 from the distance trigger dividing by a
 * near-zero time delta). Clamping here keeps a single bad point from poisoning
 * a CV window or dominating an emission. Sits at the airplane band ceiling in
 * MODE_PHYSICAL_LIMITS so legitimate flight isn't clipped.
 */
export const MAX_PLAUSIBLE_SPEED_KMH = 1000;

// Physical limits for each transport mode (absolute maximum speeds possible)
export const MODE_PHYSICAL_LIMITS = {
	stationary: { min: 0, max: 2 },
	// #242: walking was 0-12 ("includes running"); running now owns the
	// 6.5-25 band. The 6.5-8 overlap is deliberate — per-point speeds there
	// are GPS-noise-dominated, the HMM + segment context decide (effective
	// boundary ~7.7 km/h, see the running discriminator in the emission model).
	walking: { min: 0, max: 8 },
	cycling: { min: 5, max: 45 }, // Includes downhill/racing bikes
	car: { min: 10, max: 180 }, // Typical car speeds (some cars can go faster, but rare)
	train: { min: 30, max: 350 }, // Regional to high-speed trains
	airplane: { min: 150, max: 1000 }, // Commercial aircraft
	boat: { min: 0, max: 100 }, // #220: dinghies to fast cruisers; ferries ~70
	swimming: { min: 0, max: 8 }, // #220: leisure to sprint freestyle
	running: { min: 6.5, max: 25 } // #242: jogging to sprinting
} as const;

// Minimum requirements for mode detection
export const MODE_DETECTION_REQUIREMENTS = {
	// Minimum consecutive points required to confirm a mode change
	MIN_POINTS_FOR_MODE_CHANGE: 3,
	// Minimum distance (meters) required to confirm a mode change
	MIN_DISTANCE_FOR_MODE_CHANGE: 200,
	// Minimum time (seconds) required to confirm a mode change
	MIN_TIME_FOR_MODE_CHANGE: 30
} as const;

// Mode-specific continuity limits (maximum allowed speed changes)
export const MODE_CONTINUITY_LIMITS = {
	// Maximum speed difference (km/h) allowed to maintain mode
	stationary: { maxSpeedDiff: 3 }, // Can't suddenly go from 0→30 while stationary
	walking: { maxSpeedDiff: 5 }, // Can't accelerate from 8→31 km/h while walking
	cycling: { maxSpeedDiff: 15 }, // Can accelerate more (downhill, pedaling harder)
	car: { maxSpeedDiff: 50 }, // Can accelerate significantly (0→50 is possible)
	train: { maxSpeedDiff: 30 }, // Trains accelerate gradually
	airplane: { maxSpeedDiff: 1500 }, // Aircraft can have high speed variations (descent, approach)
	boat: { maxSpeedDiff: 40 }, // #220: planing hulls get on step quickly
	swimming: { maxSpeedDiff: 4 }, // #220: swimmers change speed slowly
	running: { maxSpeedDiff: 6 } // #242: run/walk transitions are smooth
} as const;

// Physical acceleration limits (maximum km/h change per second)
export const ACCELERATION_LIMITS = {
	walking: 2, // Walking/running max acceleration: ~2 km/h per second
	cycling: 5, // Cycling max acceleration: ~5 km/h per second
	car: 15, // Car max acceleration: ~15 km/h per second (0-60 in 4s)
	train: 10, // Train max acceleration: ~10 km/h per second
	airplane: 20, // Aircraft max acceleration: ~20 km/h per second (on ground/takeoff)
	boat: 10, // #220: planing hull 0-30 in ~3s
	swimming: 1 // #220: push-off glide aside, swimmers are slow to accelerate
} as const;

// Speed brackets for car/train overlap zone (60-110 km/h)
export const CAR_TRAIN_OVERLAP_BRACKETS = [
	{ min: 60, max: 110, mode: 'car' }, // Default to car in overlap
	{ min: 60, max: 110, mode: 'train' } // Can be overridden by context (station, straight trajectory)
];

/**
 * Coefficient-of-variation thresholds for the train-vs-car decision.
 * Trains maintain very steady speeds (low CV); cars vary more due to traffic, lights, turns.
 * These are the canonical "train-like" / "car-like" boundaries shared across detection helpers.
 */
export const SPEED_CV_THRESHOLDS = {
	TRAIN_LIKE: 0.15, // CV below this with high mean speed → train-like
	CAR_LIKE: 0.25 // CV above this → car-like variance
} as const;

/**
 * Map a speed (km/h) to a transport mode using SPEED_BRACKETS (first match wins,
 * so car takes precedence over train in the 60-110 overlap). Single source of truth
 * for speed→mode lookup; prefer this over re-implementing bracket logic per call site.
 */
export function getModeFromSpeed(speedKmh: number): string {
	for (const bracket of SPEED_BRACKETS) {
		if (speedKmh >= bracket.min && speedKmh < bracket.max) {
			return bracket.mode;
		}
	}
	return 'unknown';
}
