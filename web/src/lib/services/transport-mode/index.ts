//
// Public surface of the HMM transport-mode detector. Both the browser
// (Location Data page) and the Deno background job import from here so there
// is a single source of truth for transport-mode detection.

export { detectTransportModes } from './detector';
export { SEGMENT_GAP_MS, LOOKBACK_MS, segmentByGaps } from './segmentation';
export { normalizeMode, TRANSPORT_MODES, GREEN_MODES, STATIONARY_MODES } from './states';
export type { TransportMode } from './states';
export type {
	ModeObservation,
	PointModeDecision,
	ModeFeatures,
	SegmentResult,
	DetectionContext
} from './types';
