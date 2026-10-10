// Mirrors web/src/lib/utils/transport-mode.config.ts. Update both together.

/**
 * Hard ceiling on observed speed (km/h) used by feature extraction to clamp
 * garbage GPS-derived values. The fastest mode we model is airplane (band
 * ceiling ~1000), but anything above this in a tracker feed is a glitch (the DB
 * has recorded values up to ~481000 from the distance trigger dividing by a
 * near-zero time delta). Clamping here keeps a single bad point from poisoning
 * a CV window or dominating an emission. Sits above the airplane band ceiling
 * in MODE_PHYSICAL_LIMITS so legitimate flight isn't clipped.
 */
export const MAX_PLAUSIBLE_SPEED_KMH = 1000;

export const MODE_PHYSICAL_LIMITS = {
	stationary: { min: 0, max: 2 },
	// #242: walking was 0-12 ("includes running"); running now owns the
	// 6.5-25 band. The 6.5-8 overlap is deliberate — per-point speeds there
	// are GPS-noise-dominated, the HMM + segment context decide (effective
	// boundary ~7.7 km/h, see the running discriminator in model.ts).
	walking: { min: 0, max: 8 },
	cycling: { min: 5, max: 45 },
	car: { min: 10, max: 180 },
	train: { min: 30, max: 350 },
	airplane: { min: 150, max: 1000 },
	boat: { min: 0, max: 100 },
	swimming: { min: 0, max: 8 },
	running: { min: 6.5, max: 25 }
} as const;

export const SPEED_CV_THRESHOLDS = {
	TRAIN_LIKE: 0.15,
	CAR_LIKE: 0.25
} as const;

export const MODE_CONTINUITY_LIMITS = {
	stationary: { maxSpeedDiff: 3 },
	walking: { maxSpeedDiff: 5 },
	cycling: { maxSpeedDiff: 15 },
	car: { maxSpeedDiff: 50 },
	train: { maxSpeedDiff: 30 },
	airplane: { maxSpeedDiff: 1500 },
	boat: { maxSpeedDiff: 40 },
	swimming: { maxSpeedDiff: 4 },
	running: { maxSpeedDiff: 6 }
} as const;
