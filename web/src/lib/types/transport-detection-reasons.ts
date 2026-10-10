// Shared enum for transport detection reasons
// This reduces bandwidth by sending enum keys instead of full text descriptions
export enum TransportDetectionReason {
	// Legacy reasons (kept for backward compatibility)
	HIGH_VELOCITY_PLANE = 'HIGH_VELOCITY_PLANE',
	TRAIN_STATION_AND_SPEED = 'TRAIN_STATION_AND_SPEED',
	AIRPORT_AND_PLANE_SPEED = 'AIRPORT_AND_PLANE_SPEED',
	PLANE_SPEED_ONLY = 'PLANE_SPEED_ONLY',
	TRAIN_SPEED_ONLY = 'TRAIN_SPEED_ONLY',
	CAR_SPEED_ONLY = 'CAR_SPEED_ONLY',
	WALKING_SPEED_ONLY = 'WALKING_SPEED_ONLY',
	CYCLING_SPEED_ONLY = 'CYCLING_SPEED_ONLY',
	STATIONARY_SPEED_ONLY = 'STATIONARY_SPEED_ONLY',
	HIGHWAY_OR_MOTORWAY = 'HIGHWAY_OR_MOTORWAY',
	FAST_SEGMENT = 'FAST_SEGMENT',
	CONTINUITY_BROKEN = 'CONTINUITY_BROKEN',
	KEEP_CONTINUITY = 'KEEP_CONTINUITY',
	SUSPICIOUS_SEGMENT = 'SUSPICIOUS_SEGMENT',
	MIN_DURATION_NOT_MET = 'MIN_DURATION_NOT_MET',
	GEOGRAPHICALLY_IMPLAUSIBLE = 'GEOGRAPHICALLY_IMPLAUSIBLE',
	GOLF_COURSE_WALKING = 'GOLF_COURSE_WALKING',
	DEFAULT = 'DEFAULT',

	// New enhanced detection reasons
	SPEED_BRACKET_MATCH = 'SPEED_BRACKET_MATCH',
	MULTI_POINT_SPEED_STABLE = 'MULTI_POINT_SPEED_STABLE',
	HIGH_SPEED_CONTINUITY = 'HIGH_SPEED_CONTINUITY',
	SPEED_SIMILARITY = 'SPEED_SIMILARITY',
	BOTH_STATIONS_DETECTED = 'BOTH_STATIONS_DETECTED',
	FINAL_STATION_ONLY = 'FINAL_STATION_ONLY',
	STARTING_STATION_ONLY = 'STARTING_STATION_ONLY',
	TRAIN_JOURNEY_CONTINUATION = 'TRAIN_JOURNEY_CONTINUATION',
	AIRPLANE_JOURNEY_CONTINUATION = 'AIRPLANE_JOURNEY_CONTINUATION',
	TRAIN_SPEED_WITHOUT_STATION = 'TRAIN_SPEED_WITHOUT_STATION',
	TRAIN_JOURNEY_END = 'TRAIN_JOURNEY_END',
	MODE_CONTINUITY = 'MODE_CONTINUITY',
	GRADUAL_TRANSITION = 'GRADUAL_TRANSITION',
	GEOGRAPHIC_CONTEXT_VALIDATION = 'GEOGRAPHIC_CONTEXT_VALIDATION',
	PHYSICALLY_IMPOSSIBLE = 'PHYSICALLY_IMPOSSIBLE',

	// User-set override (segment editor on the Location Data map). The live HMM
	// detector also writes this string for points the user manually relabelled.
	USER_OVERRIDE = 'user_override'
}

// Frontend translation map for user-friendly display
export const TRANSPORT_DETECTION_REASON_LABELS: Record<TransportDetectionReason, string> = {
	[TransportDetectionReason.HIGH_VELOCITY_PLANE]:
		'Velocity above 400 km/h, segment marked as plane',
	[TransportDetectionReason.TRAIN_STATION_AND_SPEED]:
		'Visited train station and then travelled at train-like speed',
	[TransportDetectionReason.AIRPORT_AND_PLANE_SPEED]:
		'Visited airport and then travelled at plane speed',
	[TransportDetectionReason.PLANE_SPEED_ONLY]: 'Speed above 350 km/h, likely plane',
	[TransportDetectionReason.TRAIN_SPEED_ONLY]: 'Speed in train range, likely train',
	[TransportDetectionReason.CAR_SPEED_ONLY]: 'Speed in car range, likely car',
	[TransportDetectionReason.WALKING_SPEED_ONLY]: 'Speed in walking range, likely walking',
	[TransportDetectionReason.CYCLING_SPEED_ONLY]: 'Speed in cycling range, likely cycling',
	[TransportDetectionReason.STATIONARY_SPEED_ONLY]: 'Speed below 2 km/h, likely stationary or idle',
	[TransportDetectionReason.HIGHWAY_OR_MOTORWAY]: 'Detected motorway or highway, assumed car',
	[TransportDetectionReason.FAST_SEGMENT]: 'Fast segment, possible high-speed travel',
	[TransportDetectionReason.CONTINUITY_BROKEN]: 'Continuity broken, mode reset',
	[TransportDetectionReason.KEEP_CONTINUITY]: 'Continuity maintained, mode preserved',
	[TransportDetectionReason.SUSPICIOUS_SEGMENT]: 'Suspicious segment detected',
	[TransportDetectionReason.MIN_DURATION_NOT_MET]: 'Minimum duration not met for mode',
	[TransportDetectionReason.GEOGRAPHICALLY_IMPLAUSIBLE]: 'Geographically implausible movement',
	[TransportDetectionReason.GOLF_COURSE_WALKING]: 'Walking on a golf course, likely walking',
	[TransportDetectionReason.DEFAULT]: 'Default mode assignment',

	// New enhanced detection reason labels
	[TransportDetectionReason.SPEED_BRACKET_MATCH]: 'Speed matches transport mode bracket',
	[TransportDetectionReason.MULTI_POINT_SPEED_STABLE]:
		'Stable speed calculated from multiple points',
	[TransportDetectionReason.HIGH_SPEED_CONTINUITY]: 'Maintaining mode at high speed',
	[TransportDetectionReason.SPEED_SIMILARITY]: 'Speed similar to previous, maintaining mode',
	[TransportDetectionReason.BOTH_STATIONS_DETECTED]: 'Both start and end train stations detected',
	[TransportDetectionReason.FINAL_STATION_ONLY]:
		'Final train station detected, assuming train travel',
	[TransportDetectionReason.STARTING_STATION_ONLY]: 'Continuing from starting train station',
	[TransportDetectionReason.TRAIN_JOURNEY_CONTINUATION]: 'Continuing existing train journey',
	[TransportDetectionReason.AIRPLANE_JOURNEY_CONTINUATION]: 'Continuing existing airplane journey',
	[TransportDetectionReason.TRAIN_SPEED_WITHOUT_STATION]:
		'Train-like speed without station context',
	[TransportDetectionReason.TRAIN_JOURNEY_END]: 'Train journey ended',
	[TransportDetectionReason.MODE_CONTINUITY]: 'Maintaining previous transport mode',
	[TransportDetectionReason.GRADUAL_TRANSITION]: 'Gradual transition between modes',
	[TransportDetectionReason.GEOGRAPHIC_CONTEXT_VALIDATION]:
		'Mode validated against geographic context',
	[TransportDetectionReason.PHYSICALLY_IMPOSSIBLE]:
		'Mode changed due to physically impossible combination',
	[TransportDetectionReason.USER_OVERRIDE]: 'Set manually'
};

// Stage-2 (Valhalla) evidence strings — machine values written to
// tracker_data.detection_reason by valhalla-confirm. Raw strings (not enum
// members) because the job writes lowercase machine identifiers.
export const VALHALLA_EVIDENCE_LABELS: Record<string, string> = {
	valhalla_rail_edge: 'Map-matched onto railroad tracks (train confirmed)',
	valhalla_footway_edge: 'Map-matched onto footpaths (walking confirmed)',
	valhalla_cycleway_edge: 'Map-matched onto cycleways (cycling confirmed)',
	valhalla_motorway_edge: 'Map-matched onto high-speed roads (car confirmed)',
	valhalla_rail_run_context: 'Part of a journey with confirmed rail matching (train)',
	valhalla_pedestrian_not_rail: 'Rail corridors nearby match as footpaths — not a train',
	valhalla_offroad_rail:
		'Road matching failed at train-like speed — traveled off the road network (train)',
	valhalla_offroad_air: 'Sustained speed beyond ground transport (plane)'
};

// Stage-1 (HMM detector) reason strings — detector.ts reasonFor() writes these
// lowercase machine identifiers directly to detection_reason.
export const HMM_REASON_LABELS: Record<string, string> = {
	speed_below_stationary_threshold: 'Barely moving — stationary or idle',
	speed_in_walking_range: 'Speed in walking range, likely walking',
	speed_in_running_range: 'Speed in running range, likely running (#242)',
	speed_in_cycling_range: 'Speed in cycling range, likely cycling',
	speed_in_car_range: 'Speed in car range, likely car',
	speed_in_high_speed_car_range: 'High speed in car range, likely car',
	speed_in_airplane_range: 'Speed in airplane range, likely plane',
	steady_speed_with_rail_context: 'Steady speed near rail context, likely train',
	open_water_no_land_evidence: 'Moving over open water — reverse geocoder finds no land',
	open_water_slow_speed: 'Slow movement over open water, likely swimming',
	hmm_decoded: 'Decoded by the movement model'
};

// Helper function to get user-friendly label
export function getTransportDetectionReasonLabel(
	reason: TransportDetectionReason | string
): string {
	if (Object.values(TransportDetectionReason).includes(reason as TransportDetectionReason)) {
		return TRANSPORT_DETECTION_REASON_LABELS[reason as TransportDetectionReason];
	}
	if (typeof reason === 'string') {
		if (VALHALLA_EVIDENCE_LABELS[reason]) return VALHALLA_EVIDENCE_LABELS[reason];
		if (HMM_REASON_LABELS[reason]) return HMM_REASON_LABELS[reason];
	}
	// Fallback for legacy string values or unknown reasons
	return reason as string;
}
