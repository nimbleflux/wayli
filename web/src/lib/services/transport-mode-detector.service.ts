import type {
	DetectionContext,
	DetectionResult,
	DetectionRule,
	PointData
} from '../types/transport-detection.types';
import {
	calculateMultiPointSpeed,
	getAdaptiveWindowSize,
	setSpeedCalculationWindow
} from '../utils/multi-point-speed';
import { analyzeGPSFrequency } from '../utils/speed-pattern-analysis';

/**
 * Enhanced transport mode detector using rule-based system
 */
export class TransportModeDetector {
	private rules: DetectionRule[] = [];
	private initialized = false;

	constructor() {
		this.initializeRules();
	}

	/**
	 * Initialize all detection rules in priority order
	 */
	private initializeRules(): void {
		// Rules will be added by importing from rule modules
		// This keeps the detector clean and allows for modular rule development
		this.initialized = true;
	}

	/**
	 * Add a detection rule to the system
	 */
	addRule(rule: DetectionRule): void {
		this.rules.push(rule);
		this.rules.sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Remove a rule by name
	 */
	removeRule(ruleName: string): void {
		this.rules = this.rules.filter((rule) => rule.name !== ruleName);
	}

	/**
	 * Get all rules (for debugging)
	 */
	getRules(): DetectionRule[] {
		return [...this.rules];
	}

	/**
	 * Get applicable rules for a context (for debugging)
	 */
	getApplicableRules(context: DetectionContext): DetectionRule[] {
		return this.rules.filter((rule) => rule.canApply(context));
	}

	/**
	 * Main detection method
	 *
	 * Collects results from every applicable rule and returns the highest-confidence one,
	 * breaking ties by rule priority. This lets the multi-signal combiner and confidence
	 * math actually decide outcomes, instead of a strict priority-first-wins where a
	 * high-priority rule at 0.55 always beats a lower-priority rule at 0.95.
	 */
	detect(context: DetectionContext): DetectionResult {
		if (!this.initialized) {
			throw new Error('🚨 TransportModeDetector not initialized');
		}

		let best: { result: DetectionResult; priority: number } | null = null;

		for (const rule of this.rules) {
			if (!rule.canApply(context)) continue;
			const result = rule.detect(context);
			if (!result || result.confidence <= 0.5) continue;

			if (
				!best ||
				result.confidence > best.result.confidence ||
				(result.confidence === best.result.confidence && rule.priority > best.priority)
			) {
				best = { result, priority: rule.priority };
			}
		}

		if (best) return best.result;

		// Fallback if no rules apply - use previous mode if available
		if (context.modeHistory.length > 0) {
			const lastMode = context.modeHistory[context.modeHistory.length - 1].mode;
			return {
				mode: lastMode,
				confidence: 0.2,
				reason: `Using previous mode (${lastMode}) as final fallback when no rules apply`
			};
		}

		return {
			mode: 'unknown',
			confidence: 0.1,
			reason: 'No applicable rules found and no previous mode available'
		};
	}

	/**
	 * Create detection context from point data
	 */
	createDetectionContext(
		current: PointData,
		previous: PointData,
		pointHistory: PointData[],
		modeHistory: any[],
		geographicContext: {
			atTrainStation: boolean;
			atAirport: boolean;
			onHighway: boolean;
			stationName?: string;
			airportName?: string;
		},
		currentJourney?: any
	): DetectionContext {
		// Calculate multi-point speed
		const allPoints = [...pointHistory, current];
		const windowSize = getAdaptiveWindowSize(allPoints);
		const stableSpeed = calculateMultiPointSpeed(allPoints, windowSize);

		// Calculate average speed from history
		const speedHistory = allPoints.filter((p) => p.speed !== undefined).map((p) => p.speed!);

		const averageSpeed =
			speedHistory.length > 0 ? speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length : 0;

		// Calculate rolling average speed
		const rollingAverageSpeed = calculateMultiPointSpeed(allPoints, 5);

		// Analyze GPS sampling frequency for confidence modifiers
		const gpsFrequency = analyzeGPSFrequency(allPoints);

		return {
			current,
			previous,
			pointHistory: allPoints,
			modeHistory,
			atTrainStation: geographicContext.atTrainStation,
			atAirport: geographicContext.atAirport,
			onHighway: geographicContext.onHighway,
			stationName: geographicContext.stationName,
			airportName: geographicContext.airportName,
			currentSpeed: stableSpeed,
			averageSpeed,
			speedHistory,
			rollingAverageSpeed,
			gpsFrequency,
			currentJourney,
			speedCalculationWindow: windowSize
		};
	}

	/**
	 * Update journey context based on detection result
	 */
	updateJourneyContext(context: DetectionContext, result: DetectionResult): any {
		const now = context.current.timestamp;
		const currentJourney = context.currentJourney;

		// Distance traveled since the previous point: speed (km/h) * time (h) * 1000 m/km.
		const dtSeconds = Math.max(0, (context.current.timestamp - context.previous.timestamp) / 1000);
		const stepDistanceMeters = context.currentSpeed * (dtSeconds / 3600) * 1000;

		// Start new journey if mode changed significantly
		if (!currentJourney || currentJourney.type !== result.mode) {
			return {
				type: result.mode,
				startTime: now,
				startStation: context.atTrainStation ? context.stationName : undefined,
				startAirport: context.atAirport ? context.airportName : undefined,
				startCoordinates: { lat: context.current.lat, lng: context.current.lng },
				totalDistance: 0,
				averageSpeed: context.currentSpeed
			};
		}

		// Update existing journey
		return {
			...currentJourney,
			endStation: context.atTrainStation ? context.stationName : currentJourney.endStation,
			endAirport: context.atAirport ? context.airportName : currentJourney.endAirport,
			endCoordinates: { lat: context.current.lat, lng: context.current.lng },
			totalDistance: (currentJourney.totalDistance || 0) + stepDistanceMeters,
			averageSpeed: (currentJourney.averageSpeed + context.currentSpeed) / 2
		};
	}
}
