//
// Shared types for the HMM transport-mode detector. Kept dependency-free
// (no Svelte, no DOM) so the Deno background job and the browser import the
// exact same module.

import type { GeocodeGeoJSONFeature } from '../../utils/geojson-converter';
import type { TransportMode } from './states';

/**
 * A single observation used as input to the HMM. `geocode` is optional because
 * the Deno job reads it as a raw JSON blob; feature extraction tolerates null.
 *
 * Speed is in km/h (matching the tracker_data.speed column convention).
 * Heading is in degrees [0, 360). Accuracy is the GPS HDOP radius in meters.
 */
export interface ModeObservation {
	/** ISO timestamp or epoch ms — used only for gap segmentation + ordering. */
	timestamp: number;
	lat: number;
	lng: number;
	/** km/h. Computed server-side by trigger_calculate_distance for tracker_data. */
	speed: number;
	/** Degrees [0, 360). null when the device didn't report a heading. */
	heading: number | null;
	/** GPS accuracy radius in meters; lower is better. null when unknown. */
	accuracy: number | null;
	/** Pelias reverse-geocode result. Carries OSM railway/highway/aeroway tags. */
	geocode?: GeocodeGeoJSONFeature | null; /**
	 * Activity-recognition hint from tracker_data.activity_type (#255):
	 * still | on_foot | running | in_vehicle | on_bike, or null. Optional —
	 * OwnTracks and other trackers never send it, so every consumer must
	 * stay hint-neutral when absent.
	 */
	activityType?: string | null;
}

/**
 * Pre-computed features per observation. Emission probabilities are derived
 * from these so the HMM core stays pure math (no I/O, no geocode parsing).
 */
export interface ModeFeatures {
	speed: number; // km/h, clamped >= 0
	speedCV: number; // coefficient of variation over a rolling window
	headingTurnRate: number; // deg/s of bearing change (0 = straight, low for trains)
	atTrainStation: boolean;
	atAirport: boolean;
	onHighway: boolean;
	atVenue: boolean; // any POI venue (boosts stationary)
	accuracyWeight: number; // 0..1, down-weights noisy fixes in emission calc
	/**
	 * Per-point rail-anchor weight in [0,1], injected by the detector after
	 * feature extraction. Higher for points temporally close to a station point
	 * WITHIN THE SAME GAP-BOUNDED SEGMENT (so a station visit anchors train
	 * classification locally, near the station, rather than across an entire
	 * long driving segment that merely passed one station). 0 when the point is
	 * far from any station point or no segment context was supplied.
	 */
	stationProximity: number;
	/**
	 * Per-point water evidence (#220): the reverse geocode says the point is on
	 * open water — a permanent no-result failure, the marine layer, or an OSM
	 * water tag. Gate for the boat/swimming emissions.
	 */
	onWater: boolean; /** Activity-recognition hint (#255), threaded from the observation. Absent/null = neutral. */
	activityType?: string | null;
}

/**
 * Segment-level signals computed once per Viterbi segment (not per point) and
 * threaded into the emission model. Currently just the measurement-density
 * signal; station anchoring is per-point (via ModeFeatures.stationProximity).
 */
export interface SegmentContext {
	/** Mean inter-point interval for the segment (the measurement-density signal). */
	meanIntervalSec: number;
	/**
	 * Fraction [0,1] of the segment's geocoded points with water evidence
	 * (#220). 0 when no point in the segment carries a geocode attempt — an
	 * un-geocoded segment must never trigger the water modes.
	 */
	waterFraction: number;
	/**
	 * Segment-mean speed (km/h), 0 for single-point segments (#242). A whole
	 * segment's average is far more robust than any per-point speed — the
	 * running-vs-cycling discriminator leans on it.
	 */
	meanSpeedKmh: number;
}

export interface SegmentDetection {
	mode: TransportMode;
	reason: string;
	confidence: number; // 0..1
}

/**
 * Optional context threaded between successive `detectTransportModes` calls so a
 * journey spanning a page/batch boundary is decoded as one Viterbi segment
 * instead of two independent halves that can disagree at the seam.
 *
 * `prevObs` should be the last N observations of the previous batch (most-recent
 * last). They are prepended for feature extraction + Viterbi context and then
 * trimmed from the returned decisions, so the output stays 1:1 with the current
 * batch's observations. A >SEGMENT_GAP_MS gap between the tail and the current
 * batch splits them naturally (the tail's recomputed decisions are discarded).
 */
export interface DetectionContext {
	prevObs?: ModeObservation[];
	/**
	 * Modes the user has switched off (#220). Disabled modes get zero emission
	 * probability — a hard exclusion. Empty/undefined keeps prior behavior.
	 */
	disabledModes?: TransportMode[];
}

/** Result of decoding one gap-bounded segment. */
export interface SegmentResult {
	/** One mode per input observation, aligned by index. */
	modes: TransportMode[];
	/** Human-readable reason per observation, aligned by index. */
	reasons: string[];
	/** Viterbi posterior confidence per observation, aligned by index. */
	confidences: number[];
}

/**
 * Extracted transport-mode decision for a single point, ready to persist to
 * tracker_data.transport_mode / detection_reason / transport_mode_confidence.
 */
export interface PointModeDecision {
	timestamp: number;
	mode: TransportMode;
	reason: string;
	confidence: number;
}
