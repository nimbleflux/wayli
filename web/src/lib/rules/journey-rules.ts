// /Users/bart/Dev/wayli/web/src/lib/rules/journey-rules.ts

import type {
	DetectionContext,
	DetectionResult,
	DetectionRule
} from '../types/transport-detection.types';
import { isPhysicallyPossible } from '../utils/speed-pattern-analysis';
import { MODE_DETECTION_REQUIREMENTS, MODE_PHYSICAL_LIMITS } from '../utils/transport-mode.config';
import { haversine } from '../utils/multi-point-speed';

/**
 * Journey continuation and context-based detection rules
 */

/**
 * Minimum mode duration rule - prevents single-point mode switches
 */
export class MinimumModeDurationRule implements DetectionRule {
	name = 'Minimum Mode Duration';
	priority = 68; // Higher than most detection rules to enforce consistency

	canApply(context: DetectionContext): boolean {
		return context.modeHistory.length >= MODE_DETECTION_REQUIREMENTS.MIN_POINTS_FOR_MODE_CHANGE;
	}

	detect(context: DetectionContext): DetectionResult | null {
		// Get the last N points to check for mode consistency
		const recentModes = context.modeHistory.slice(
			-MODE_DETECTION_REQUIREMENTS.MIN_POINTS_FOR_MODE_CHANGE
		);
		const currentModeFromBracket = this.getCurrentModeFromSpeed(context.currentSpeed);
		const dominantRecentMode = this.getDominantMode(recentModes);

		// If the speed-based mode differs from dominant recent mode
		if (currentModeFromBracket !== dominantRecentMode) {
			// CRITICAL: Check physical limits FIRST before enforcing continuity
			const limits = MODE_PHYSICAL_LIMITS[dominantRecentMode as keyof typeof MODE_PHYSICAL_LIMITS];

			if (limits) {
				// If current speed violates physical limits, allow immediate mode change
				// Physics overrides minimum distance requirements
				if (context.currentSpeed > limits.max) {
					// Severe violation (>20% over limit) - force immediate change
					const percentOver = ((context.currentSpeed - limits.max) / limits.max) * 100;

					return null; // Let PhysicalPossibilityValidationRule handle severe violations
				}

				if (context.currentSpeed < limits.min && context.currentSpeed > 0) {
					// Below minimum speed for this mode
					return null; // Let other rules determine appropriate mode
				}
			}

			// Check if we're at a high-priority location (station, airport, highway)
			const isHighPriorityLocation =
				context.atTrainStation || context.atAirport || context.onHighway;

			// Allow immediate mode change for high-priority locations
			if (isHighPriorityLocation) {
				return null; // Let other high-priority rules handle it
			}

			// Calculate total distance covered in recent mode history
			const totalDistance = this.calculateTotalDistance(
				context.pointHistory.slice(-MODE_DETECTION_REQUIREMENTS.MIN_POINTS_FOR_MODE_CHANGE)
			);

			// Only enforce minimum distance if speed is physically plausible for current mode
			if (totalDistance < MODE_DETECTION_REQUIREMENTS.MIN_DISTANCE_FOR_MODE_CHANGE) {
				return {
					mode: dominantRecentMode,
					confidence: 0.75,
					reason: `Maintaining ${dominantRecentMode} mode - insufficient distance (${totalDistance.toFixed(0)}m of ${MODE_DETECTION_REQUIREMENTS.MIN_DISTANCE_FOR_MODE_CHANGE}m required) for mode change to ${currentModeFromBracket}`,
					metadata: {
						currentSpeedBasedMode: currentModeFromBracket,
						dominantRecentMode,
						distanceTraveled: totalDistance,
						minDistanceRequired: MODE_DETECTION_REQUIREMENTS.MIN_DISTANCE_FOR_MODE_CHANGE,
						recentPoints: recentModes.length,
						withinPhysicalLimits: true
					}
				};
			}
		}

		return null; // Mode is consistent or has met minimum requirements
	}

	private getCurrentModeFromSpeed(speed: number): string {
		if (speed < 2) return 'stationary';
		if (speed < 10) return 'walking';
		if (speed < 35) return 'cycling';
		if (speed < 110) return 'car';
		if (speed < 200) return 'train';
		return 'airplane';
	}

	private getDominantMode(modes: Array<{ mode: string }>): string {
		const modeCount = new Map<string, number>();
		modes.forEach((m) => {
			modeCount.set(m.mode, (modeCount.get(m.mode) || 0) + 1);
		});

		let dominantMode = modes[modes.length - 1].mode;
		let maxCount = 0;
		modeCount.forEach((count, mode) => {
			if (count > maxCount) {
				maxCount = count;
				dominantMode = mode;
			}
		});

		return dominantMode;
	}

	private calculateTotalDistance(points: Array<{ lat: number; lng: number }>): number {
		if (points.length < 2) return 0;

		let total = 0;
		for (let i = 1; i < points.length; i++) {
			total += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
		}
		return total;
	}
}

/**
 * Train journey continuation rule
 */
export class TrainJourneyContinuationRule implements DetectionRule {
	name = 'Train Journey Continuation';
	priority = 70;

	canApply(context: DetectionContext): boolean {
		const journey = context.currentJourney;
		return (
			journey?.type === 'train' &&
			Boolean(journey?.startStation) &&
			journey?.startStation !== 'Unknown' && // Require valid station name
			context.currentSpeed >= 30 &&
			context.currentSpeed <= 200
		);
	}

	detect(context: DetectionContext): DetectionResult {
		const journey = context.currentJourney!;
		const timeSinceStart = Date.now() - journey.startTime;

		return {
			mode: 'train',
			confidence: 0.8,
			reason: `Continuing train journey from ${journey.startStation || 'unknown station'}`,
			metadata: {
				journeyType: 'train',
				startStation: journey.startStation,
				timeSinceStart: timeSinceStart,
				speed: context.currentSpeed
			}
		};
	}
}

/**
 * Airplane journey continuation rule
 */
export class AirplaneJourneyContinuationRule implements DetectionRule {
	name = 'Airplane Journey Continuation';
	priority = 75;

	canApply(context: DetectionContext): boolean {
		return context.currentJourney?.type === 'airplane' && context.currentSpeed >= 200;
	}

	detect(context: DetectionContext): DetectionResult {
		const journey = context.currentJourney!;
		const timeSinceStart = Date.now() - journey.startTime;

		return {
			mode: 'airplane',
			confidence: 0.85,
			reason: `Continuing airplane journey from ${journey.startAirport || 'unknown airport'}`,
			metadata: {
				journeyType: 'airplane',
				startAirport: journey.startAirport,
				timeSinceStart: timeSinceStart,
				speed: context.currentSpeed
			}
		};
	}
}

/**
 * Mode continuity rule for low speeds
 */
export class ModeContinuityRule implements DetectionRule {
	name = 'Mode Continuity';
	priority = 30;

	canApply(context: DetectionContext): boolean {
		return context.modeHistory.length > 0 && context.currentSpeed < 20; // Only for slow speeds
	}

	detect(context: DetectionContext): DetectionResult | null {
		const lastMode = context.modeHistory[context.modeHistory.length - 1].mode;

		// Don't maintain high-speed modes at low speeds
		if (['airplane', 'train'].includes(lastMode)) {
			return null;
		}

		return {
			mode: lastMode,
			confidence: 0.7,
			reason: `Maintaining previous mode (${lastMode}) at low speed`
		};
	}
}

/**
 * Gradual transition rule - prevents sudden mode changes
 */
export class GradualTransitionRule implements DetectionRule {
	name = 'Gradual Transition';
	priority = 25;

	canApply(context: DetectionContext): boolean {
		return context.modeHistory.length >= 2;
	}

	detect(context: DetectionContext): DetectionResult | null {
		const lastMode = context.modeHistory[context.modeHistory.length - 1].mode;
		const secondLastMode = context.modeHistory[context.modeHistory.length - 2].mode;

		// Prevent impossible transitions
		const impossibleTransitions = [
			['walking', 'airplane'],
			['cycling', 'airplane'],
			['airplane', 'cycling'],
			['train', 'cycling'],
			['cycling', 'train']
		];

		for (const [from, to] of impossibleTransitions) {
			if (secondLastMode === from && lastMode === to) {
				return {
					mode: from, // Revert to previous mode
					confidence: 0.8,
					reason: `Impossible transition from ${from} to ${to}, maintaining ${from}`
				};
			}
		}

		return null;
	}
}

/**
 * Mode continuity fallback rule - maintains previous mode when no other rules apply
 */
export class ModeContinuityFallbackRule implements DetectionRule {
	name = 'Mode Continuity Fallback';
	priority = 15;

	canApply(context: DetectionContext): boolean {
		return context.modeHistory.length > 0;
	}

	detect(context: DetectionContext): DetectionResult {
		const lastMode = context.modeHistory[context.modeHistory.length - 1].mode;

		return {
			mode: lastMode,
			confidence: 0.5,
			reason: `Maintaining previous mode (${lastMode}) when no specific detection rules apply`,
			metadata: {
				fallbackType: 'mode_continuity',
				previousMode: lastMode,
				currentSpeed: context.currentSpeed
			}
		};
	}
}

/**
 * Default fallback rule
 */
export class DefaultRule implements DetectionRule {
	name = 'Default Fallback';
	priority = 10;

	canApply(context: DetectionContext): boolean {
		return true; // Always applicable as final fallback
	}

	detect(context: DetectionContext): DetectionResult {
		// First try to use the previous mode if available
		if (context.modeHistory.length > 0) {
			const lastMode = context.modeHistory[context.modeHistory.length - 1].mode;

			// Check if previous mode is still physically possible
			if (isPhysicallyPossible(lastMode, context.currentSpeed)) {
				return {
					mode: lastMode,
					confidence: 0.4,
					reason: `Using previous mode (${lastMode}) as fallback when detection fails`
				};
			}
		}

		// Speed-based fallback when no previous mode is available or previous mode impossible
		let mode = 'unknown';
		if (context.currentSpeed < 2) mode = 'stationary';
		else if (context.currentSpeed < 10) mode = 'walking';
		else if (context.currentSpeed < 35) mode = 'cycling';
		else if (context.currentSpeed < 110)
			mode = 'car'; // Updated to match new brackets
		else if (context.currentSpeed < 200) mode = 'train';
		else mode = 'airplane';

		return {
			mode,
			confidence: 0.3,
			reason: `Default speed-based detection: ${context.currentSpeed.toFixed(1)} km/h`
		};
	}
}
