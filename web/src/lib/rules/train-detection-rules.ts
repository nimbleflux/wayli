// /Users/bart/Dev/wayli/web/src/lib/rules/train-detection-rules.ts

import type {
	DetectionContext,
	DetectionResult,
	DetectionRule
} from '../types/transport-detection.types';
import {
	calculateSpeedVariance,
	hasTrainLikeSpeedPattern,
	hasStraightTrajectory
} from '../utils/speed-pattern-analysis';

/**
 * Specific train detection rules based on your constraints
 */

/**
 * Both train stations detected rule - highest confidence
 */
export class BothStationsDetectedRule implements DetectionRule {
	name = 'Both Train Stations Detected';
	priority = 95;

	canApply(context: DetectionContext): boolean {
		return (
			context.currentJourney?.type === 'train' &&
			Boolean(context.currentJourney?.startStation) &&
			Boolean(context.currentJourney?.endStation) &&
			context.currentSpeed >= 30
		);
	}

	detect(context: DetectionContext): DetectionResult | null {
		const journey = context.currentJourney!;
		return {
			mode: 'train',
			confidence: 0.95,
			reason: `Both start (${journey.startStation}) and end (${journey.endStation}) train stations detected`,
			metadata: {
				startStation: journey.startStation,
				endStation: journey.endStation,
				journeyType: 'train_complete'
			}
		};
	}
}

/**
 * Final station only rule - assume train travel before that point
 * Enhanced with backward-looking speed analysis
 */
export class FinalStationOnlyRule implements DetectionRule {
	name = 'Final Station Only';
	priority = 85;

	canApply(context: DetectionContext): boolean {
		return (
			context.atTrainStation &&
			context.currentJourney?.type !== 'train' &&
			this.hadTrainSpeedBeforeStation(context)
		);
	}

	detect(context: DetectionContext): DetectionResult | null {
		const analysis = this.analyzeSpeedBeforeStation(context);

		return {
			mode: 'train',
			confidence: analysis.confidence,
			reason: `Final train station (${context.stationName}) detected with prior train-like speed pattern (avg: ${analysis.avgSpeed.toFixed(1)} km/h for ${analysis.duration.toFixed(1)} min)`,
			metadata: {
				stationName: context.stationName,
				detectionType: 'final_station_with_speed_analysis',
				priorAvgSpeed: analysis.avgSpeed,
				priorMaxSpeed: analysis.maxSpeed,
				priorDuration: analysis.duration,
				confidenceFactors: analysis.factors,
				currentSpeed: context.currentSpeed
			}
		};
	}

	/**
	 * Check if user had train-like speeds before arriving at station
	 */
	private hadTrainSpeedBeforeStation(context: DetectionContext): boolean {
		// Look back 30 minutes in mode history
		const lookbackWindow = 30 * 60 * 1000;
		const cutoffTime = Date.now() - lookbackWindow;

		const recentModes = context.modeHistory.filter((m) => m.timestamp > cutoffTime);

		if (recentModes.length < 5) return false; // Need minimum data points

		const recentSpeeds = recentModes.map((m) => m.speed);

		// Calculate metrics
		const avgSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
		const maxSpeed = Math.max(...recentSpeeds);
		const highSpeedCount = recentSpeeds.filter((s) => s >= 80).length;

		// Train-like pattern: average > 70 km/h OR max > 100 km/h with multiple high-speed points
		return avgSpeed >= 70 || (maxSpeed >= 100 && highSpeedCount >= 3);
	}

	/**
	 * Analyze speed pattern before arriving at station
	 * Returns detailed analysis with confidence scoring
	 */
	private analyzeSpeedBeforeStation(context: DetectionContext): {
		avgSpeed: number;
		maxSpeed: number;
		duration: number; // in minutes
		confidence: number;
		factors: string[];
	} {
		const lookbackWindow = 30 * 60 * 1000;
		const cutoffTime = Date.now() - lookbackWindow;

		const recentModes = context.modeHistory.filter((m) => m.timestamp > cutoffTime);
		const recentSpeeds = recentModes.map((m) => m.speed);

		const avgSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
		const maxSpeed = Math.max(...recentSpeeds);
		const duration =
			recentModes.length > 0
				? (recentModes[recentModes.length - 1].timestamp - recentModes[0].timestamp) / 60000
				: 0;

		// Calculate confidence based on multiple factors
		let confidence = 0.75; // Base confidence
		const factors: string[] = [];

		// Factor 1: High average speed
		if (avgSpeed >= 100) {
			confidence += 0.15;
			factors.push('high_avg_speed');
		} else if (avgSpeed >= 80) {
			confidence += 0.1;
			factors.push('train_avg_speed');
		}

		// Factor 2: Very high max speed
		if (maxSpeed >= 140) {
			confidence += 0.1;
			factors.push('very_high_max_speed');
		}

		// Factor 3: Sustained duration
		if (duration >= 15) {
			confidence += 0.05;
			factors.push('sustained_duration');
		}

		// Factor 4: Multiple high-speed samples (consistency)
		const highSpeedCount = recentSpeeds.filter((s) => s >= 80).length;
		const highSpeedRatio = highSpeedCount / recentSpeeds.length;
		if (highSpeedRatio >= 0.6) {
			confidence += 0.1;
			factors.push('consistent_high_speed');
		}

		return {
			avgSpeed,
			maxSpeed,
			duration,
			confidence: Math.min(confidence, 0.95),
			factors
		};
	}
}

/**
 * Starting station only rule - continue until significant slowdown
 */
export class StartingStationOnlyRule implements DetectionRule {
	name = 'Starting Station Only';
	priority = 80;

	canApply(context: DetectionContext): boolean {
		const journey = context.currentJourney;
		return (
			journey?.type === 'train' &&
			Boolean(journey?.startStation) &&
			journey?.startStation !== 'Unknown' && // Require valid station name
			!journey?.endStation
		);
		// Note: Speed check removed to allow detection of slowdowns
	}

	detect(context: DetectionContext): DetectionResult | null {
		const journey = context.currentJourney!;
		const timeSinceStart = Date.now() - journey.startTime;

		// Continue train journey until significant slowdown (5+ minutes at low speed)
		const hasSignificantSlowdown = this.checkForSignificantSlowdown(context);

		if (hasSignificantSlowdown) {
			return {
				mode: 'stationary', // User has stopped, likely at destination
				confidence: 0.8,
				reason: `Train journey ended - significant slowdown detected after departing from ${journey.startStation}`,
				metadata: {
					startStation: journey.startStation,
					timeSinceStart: timeSinceStart,
					detectionType: 'slowdown_after_train'
				}
			};
		}

		// If speed is above walking/cycling pace (>25 km/h), likely still on train
		// This handles slower regional trains and trains in stations
		if (context.currentSpeed >= 25 || this.hasRecentHighSpeed(context)) {
			return {
				mode: 'train',
				confidence: 0.85,
				reason: `Continuing train journey from ${journey.startStation} (speed: ${context.currentSpeed.toFixed(1)} km/h)`,
				metadata: {
					startStation: journey.startStation,
					timeSinceStart: timeSinceStart,
					detectionType: 'continuing_from_start',
					currentSpeed: context.currentSpeed
				}
			};
		}

		// Low speed but not extended slowdown - still on train (maybe stopping at station)
		return {
			mode: 'train',
			confidence: 0.7,
			reason: `Continuing train journey from ${journey.startStation} (slow speed, possibly at station)`,
			metadata: {
				startStation: journey.startStation,
				timeSinceStart: timeSinceStart,
				detectionType: 'continuing_from_start_slow',
				currentSpeed: context.currentSpeed
			}
		};
	}

	private hasRecentHighSpeed(context: DetectionContext): boolean {
		// Check if we had train-like speed in last 3 minutes
		const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
		const recentSpeeds = context.speedHistory.slice(-15); // Last 15 points
		const recentHighSpeeds = recentSpeeds.filter((s) => s >= 80);
		return recentHighSpeeds.length >= 3; // At least 3 high-speed points recently
	}

	private checkForSignificantSlowdown(context: DetectionContext): boolean {
		// Extended window: 5 minutes instead of 3
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const recentModes = context.modeHistory.filter((m) => m.timestamp >= fiveMinutesAgo);

		// Need more data points for reliable slowdown detection
		if (recentModes.length >= 3) {
			const recentSpeeds = recentModes.map((m) => m.speed);
			const avgRecentSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;

			// Higher threshold: 30 km/h instead of 20
			// This distinguishes "brief stop" from "journey ended"
			if (avgRecentSpeed < 30) {
				return true;
			}
		}

		// Also check for graduated slowdown pattern
		// Train ending: 120 → 80 → 60 → 40 → 20 (gradual)
		// Train stopping briefly: 120 → 0 → 120 (sharp stop/start)
		if (recentModes.length >= 4) {
			const speeds = recentModes.slice(-4).map((m) => m.speed);
			const isGradualSlowdown = this.checkGradualSlowdown(speeds);
			const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

			if (isGradualSlowdown && avgSpeed < 40) {
				return true;
			}
		}

		return false;
	}

	private checkGradualSlowdown(speeds: number[]): boolean {
		// Check if speeds are monotonically decreasing
		for (let i = 1; i < speeds.length; i++) {
			if (speeds[i] > speeds[i - 1] + 10) {
				// Allow 10 km/h tolerance
				return false; // Speed increased = not gradual slowdown
			}
		}
		return true;
	}
}

/**
 * Train speed without station context rule
 * DISABLED: Train mode now requires station detection to prevent false positives
 * when driving at highway speeds with navigation enabled.
 */
export class TrainSpeedWithoutStationRule implements DetectionRule {
	name = 'Train Speed Without Station';
	priority = 60;

	canApply(_context: DetectionContext): boolean {
		// DISABLED: Train mode now requires station detection.
		// Speed patterns alone are not sufficient to distinguish train from car.
		// Use TrainStationRule or FinalStationOnlyRule instead.
		return false;
	}

	detect(context: DetectionContext): DetectionResult | null {
		const lastMode = context.modeHistory[context.modeHistory.length - 1].mode;

		// Check historical context
		const recentlyAtStation = this.wasRecentlyAtTrainStation(context);
		const wasInTrainMode = lastMode === 'train';

		// Check minimum journey requirements (prevent short highway false positives)
		const journeyDistance = this.calculateJourneyDistance(context);
		const journeyDuration = this.calculateJourneyDuration(context);
		const MIN_DISTANCE_WITHOUT_STATION = 5000; // 5 km
		const MIN_DURATION_WITHOUT_STATION = 8 * 60 * 1000; // 8 minutes

		// If no recent station visit, require substantial journey length
		if (!recentlyAtStation && !wasInTrainMode) {
			if (
				journeyDistance < MIN_DISTANCE_WITHOUT_STATION &&
				journeyDuration < MIN_DURATION_WITHOUT_STATION
			) {
				// Too short without station context - likely highway, not train
				return null;
			}
		}

		// Check speed pattern
		const speedMetrics = calculateSpeedVariance(context.speedHistory);
		const hasTrainSpeed = hasTrainLikeSpeedPattern(context.speedHistory);

		// Check trajectory
		const points = context.pointHistory.map((p) => ({ lat: p.lat, lng: p.lng }));
		const isStraight = hasStraightTrajectory(points);

		// Calculate confidence based on multiple signals
		let confidence = 0.6; // Base confidence

		if (recentlyAtStation) confidence += 0.1;
		if (wasInTrainMode) confidence += 0.1;
		if (hasTrainSpeed) confidence += 0.15;
		if (isStraight) confidence += 0.15;

		// Determine required signals based on journey characteristics
		// - With station context: 2 signals sufficient
		// - Without station context but long journey (>5km OR >8min): 2 signals sufficient
		// - Without station context and short journey: 3 signals required (prevents false positives)
		const positiveSignals = [recentlyAtStation, wasInTrainMode, hasTrainSpeed, isStraight].filter(
			Boolean
		).length;

		const hasLongJourney =
			journeyDistance >= MIN_DISTANCE_WITHOUT_STATION ||
			journeyDuration >= MIN_DURATION_WITHOUT_STATION;
		const requiredSignals = recentlyAtStation || hasLongJourney ? 2 : 3;

		if (positiveSignals >= requiredSignals) {
			return {
				mode: 'train',
				confidence: Math.min(confidence, 0.95),
				reason: `Train-like speed and movement pattern (CV: ${speedMetrics.coefficientOfVariation.toFixed(3)})`,
				metadata: {
					recentlyAtStation,
					wasInTrainMode,
					hasTrainSpeed,
					isStraight,
					speedCV: speedMetrics.coefficientOfVariation,
					speed: context.currentSpeed,
					positiveSignals
				}
			};
		}

		return null;
	}

	private wasRecentlyAtTrainStation(context: DetectionContext): boolean {
		const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
		return context.modeHistory.some((m) => m.timestamp > thirtyMinutesAgo && m.mode === 'train');
	}

	private calculateJourneyDuration(context: DetectionContext): number {
		// Calculate duration from earliest to latest point in mode history
		if (context.modeHistory.length < 2) return 0;

		const oldest = context.modeHistory[0].timestamp;
		const newest = context.modeHistory[context.modeHistory.length - 1].timestamp;
		return newest - oldest;
	}

	private calculateJourneyDistance(context: DetectionContext): number {
		// Calculate total distance from point history using Haversine
		if (context.pointHistory.length < 2) return 0;

		let totalDistance = 0;
		for (let i = 1; i < context.pointHistory.length; i++) {
			const prev = context.pointHistory[i - 1];
			const curr = context.pointHistory[i];
			totalDistance += this.haversine(prev.lat, prev.lng, curr.lat, curr.lng);
		}
		return totalDistance;
	}

	private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
		const R = 6371e3; // Earth radius in meters
		const φ1 = (lat1 * Math.PI) / 180;
		const φ2 = (lat2 * Math.PI) / 180;
		const Δφ = ((lat2 - lat1) * Math.PI) / 180;
		const Δλ = ((lng2 - lng1) * Math.PI) / 180;

		const a =
			Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
			Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

		return R * c; // Distance in meters
	}
}

/**
 * Unrealistic train segment filter - prevents marking very short segments as train
 */
export class UnrealisticTrainSegmentRule implements DetectionRule {
	name = 'Unrealistic Train Segment Filter';
	priority = 66; // Higher than TrainJourneyEndRule to filter first

	canApply(context: DetectionContext): boolean {
		// Only apply when we're about to mark something as train
		// Check if the current detection would result in 'train' mode
		return context.currentSpeed >= 60 && context.currentSpeed <= 200;
	}

	detect(context: DetectionContext): DetectionResult | null {
		const journey = context.currentJourney;

		// If there's an active train journey, check its validity
		if (journey?.type === 'train') {
			const timeSinceStart = Date.now() - journey.startTime;
			const distance = journey.totalDistance || 0;

			// Filter unrealistic train segments:
			// - Less than 5km distance AND less than 10 minutes duration
			// - These are likely brief highway segments or speed spikes, not actual train travel
			// Increased from 2km/5min to prevent false positives on straight highways
			const MIN_TRAIN_DISTANCE = 5000; // 5 km in meters
			const MIN_TRAIN_TIME = 10 * 60 * 1000; // 10 minutes in ms

			if (distance < MIN_TRAIN_DISTANCE && timeSinceStart < MIN_TRAIN_TIME) {
				// Not enough distance/time to be a real train journey
				// Check mode history to use previous non-train mode
				const recentNonTrainModes = context.modeHistory
					.slice(-10)
					.filter((m) => m.mode !== 'train' && m.mode !== 'stationary');

				if (recentNonTrainModes.length > 0) {
					const previousMode = recentNonTrainModes[recentNonTrainModes.length - 1].mode;

					return {
						mode: previousMode,
						confidence: 0.75,
						reason: `Unrealistic train segment (${(distance / 1000).toFixed(1)}km, ${(timeSinceStart / 60000).toFixed(1)}min) - reverting to ${previousMode}`,
						metadata: {
							filteredMode: 'train',
							distance,
							timeSinceStart,
							revertedTo: previousMode,
							minDistanceRequired: MIN_TRAIN_DISTANCE,
							minTimeRequired: MIN_TRAIN_TIME
						}
					};
				}
			}
		}

		return null;
	}
}

/**
 * Train journey end rule - detect when train journey should end
 */
export class TrainJourneyEndRule implements DetectionRule {
	name = 'Train Journey End';
	priority = 65;

	canApply(context: DetectionContext): boolean {
		return context.currentJourney?.type === 'train' && context.currentSpeed < 30;
	}

	detect(context: DetectionContext): DetectionResult | null {
		const journey = context.currentJourney!;
		const timeSinceStart = Date.now() - journey.startTime;

		// Check if we're at a different station (journey end)
		const atDifferentStation =
			context.atTrainStation && context.stationName !== journey.startStation;

		// Check if we've been slow for extended period
		const hasExtendedSlowdown = this.hasExtendedLowSpeed(context);

		// End journey if:
		// 1. At a different station, OR
		// 2. Been slow for 5+ minutes (not just a brief stop), OR
		// 3. Journey exceeds max duration (2 hours)
		if (atDifferentStation || hasExtendedSlowdown || timeSinceStart > 2 * 60 * 60 * 1000) {
			return {
				mode: 'stationary', // Likely at destination
				confidence: 0.8,
				reason: `Train journey ended: ${atDifferentStation ? `arrived at ${context.stationName}` : hasExtendedSlowdown ? 'extended stop' : 'max duration exceeded'}`,
				metadata: {
					journeyEnd: true,
					timeSinceStart,
					atStation: context.atTrainStation,
					stationName: context.stationName,
					endReason: atDifferentStation ? 'station' : hasExtendedSlowdown ? 'slowdown' : 'timeout'
				}
			};
		}

		return null;
	}

	private hasExtendedLowSpeed(context: DetectionContext): boolean {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const recentModes = context.modeHistory.filter((m) => m.timestamp >= fiveMinutesAgo);

		if (recentModes.length < 3) return false;

		const avgSpeed = recentModes.reduce((sum, m) => sum + m.speed, 0) / recentModes.length;
		return avgSpeed < 30;
	}
}
