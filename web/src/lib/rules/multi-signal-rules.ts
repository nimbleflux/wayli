// /Users/bart/Dev/wayli/web/src/lib/rules/multi-signal-rules.ts

import type {
	DetectionContext,
	DetectionResult,
	DetectionRule
} from '../types/transport-detection.types';
import { analyzeStopPattern, calculateSpeedVariance } from '../utils/speed-pattern-analysis';

/**
 * Represents a detection signal from a specific analysis source
 */
interface Signal {
	mode: string;
	confidence: number;
	source: string;
}

/**
 * Multi-Signal Combination Rule
 * Combines multiple weak signals (60-75% confidence) into a stronger signal (85-95%)
 *
 * Signals analyzed:
 * - GPS sampling frequency
 * - Stop pattern analysis
 * - Speed variance pattern
 * - Speed bracket
 *
 * Requires at least 2 signals agreeing on the same mode
 */
export class MultiSignalCombinationRule implements DetectionRule {
	name = 'Multi-Signal Combination';
	priority = 72; // Between journey continuation and pattern rules

	canApply(context: DetectionContext): boolean {
		// Need enough data to analyze patterns
		return (
			context.pointHistory.length >= 10 &&
			context.speedHistory.length >= 10 &&
			context.currentSpeed >= 40 && // Only for ambiguous speeds
			context.currentSpeed <= 130
		);
	}

	detect(context: DetectionContext): DetectionResult | null {
		const signals: Signal[] = [];

		// Signal 1: GPS frequency analysis
		const gpsSignal = this.deriveFromGPSFrequency(context);
		if (gpsSignal && gpsSignal.confidence >= 0.6) {
			signals.push(gpsSignal);
		}

		// Signal 2: Stop pattern analysis
		const stopSignal = this.deriveFromStopPattern(context);
		if (stopSignal && stopSignal.confidence >= 0.6) {
			signals.push(stopSignal);
		}

		// Signal 3: Speed variance analysis
		const speedVarianceSignal = this.deriveFromSpeedVariance(context);
		if (speedVarianceSignal && speedVarianceSignal.confidence >= 0.6) {
			signals.push(speedVarianceSignal);
		}

		// Signal 4: Speed bracket (basic fallback)
		const speedBracketSignal = this.deriveFromSpeedBracket(context);
		if (speedBracketSignal && speedBracketSignal.confidence >= 0.5) {
			signals.push(speedBracketSignal);
		}

		// Need at least 2 signals
		if (signals.length < 2) {
			return null;
		}

		// Find mode consensus (most common mode among signals)
		const modeCounts = new Map<string, number>();
		signals.forEach((s) => {
			modeCounts.set(s.mode, (modeCounts.get(s.mode) || 0) + 1);
		});

		const sortedModes = Array.from(modeCounts.entries()).sort((a, b) => b[1] - a[1]);
		const [consensusMode, count] = sortedModes[0];

		// Need at least 2 signals agreeing
		if (count < 2) {
			return null;
		}

		// Calculate combined confidence from agreeing signals
		const agreeingSignals = signals.filter((s) => s.mode === consensusMode);
		const avgConfidence =
			agreeingSignals.reduce((sum, s) => sum + s.confidence, 0) / agreeingSignals.length;

		// Bonus for having multiple agreeing signals (Bayesian-style combination)
		const signalBonus = Math.min(0.15, agreeingSignals.length * 0.05);
		const combinedConfidence = Math.min(0.95, avgConfidence + signalBonus);

		// Only return if combined confidence is significantly better than individual signals
		if (combinedConfidence < 0.75) {
			return null;
		}

		const sources = agreeingSignals.map((s) => s.source).join(', ');

		return {
			mode: consensusMode,
			confidence: combinedConfidence,
			reason: `Multi-signal consensus (${agreeingSignals.length}/${signals.length} signals): ${sources}`,
			metadata: {
				totalSignals: signals.length,
				agreeingSignals: agreeingSignals.length,
				avgConfidence,
				signalBonus,
				sources: agreeingSignals.map((s) => ({
					source: s.source,
					confidence: s.confidence
				})),
				allSignals: signals.map((s) => ({
					mode: s.mode,
					source: s.source,
					confidence: s.confidence
				}))
			}
		};
	}

	private deriveFromGPSFrequency(context: DetectionContext): Signal | null {
		const gpsFreq = context.gpsFrequency;

		if (gpsFreq.frequencyType === 'active_navigation' && gpsFreq.likelyMode === 'car') {
			return {
				mode: 'car',
				confidence: 0.75,
				source: 'GPS frequency (active nav)'
			};
		} else if (gpsFreq.frequencyType === 'background_tracking' && context.currentSpeed >= 70) {
			return {
				mode: 'train',
				confidence: 0.7,
				source: 'GPS frequency (background)'
			};
		}

		return null;
	}

	private deriveFromStopPattern(context: DetectionContext): Signal | null {
		// Only analyze if we have enough distance
		const totalDistance = this.calculateTotalDistance(context.pointHistory);
		if (totalDistance < 2000) return null; // < 2km

		const stopAnalysis = analyzeStopPattern(context.pointHistory);

		if (stopAnalysis.confidence >= 0.6) {
			return {
				mode: stopAnalysis.likelyMode,
				confidence: stopAnalysis.confidence,
				source: `Stop pattern (${stopAnalysis.pattern})`
			};
		}

		return null;
	}

	private deriveFromSpeedVariance(context: DetectionContext): Signal | null {
		if (context.speedHistory.length < 5) return null;

		const speedMetrics = calculateSpeedVariance(context.speedHistory);

		// Train: Low variance (CV < 0.20)
		if (speedMetrics.coefficientOfVariation < 0.2 && context.currentSpeed >= 70) {
			return {
				mode: 'train',
				confidence: 0.7,
				source: `Speed variance (CV=${speedMetrics.coefficientOfVariation.toFixed(3)})`
			};
		}

		// Car: High variance (CV > 0.30)
		if (speedMetrics.coefficientOfVariation > 0.3) {
			return {
				mode: 'car',
				confidence: 0.75,
				source: `Speed variance (CV=${speedMetrics.coefficientOfVariation.toFixed(3)})`
			};
		}

		return null;
	}

	private deriveFromSpeedBracket(context: DetectionContext): Signal | null {
		const speed = context.currentSpeed;

		if (speed >= 35 && speed < 60) {
			return { mode: 'car', confidence: 0.55, source: 'Speed bracket (35-60 km/h)' };
		} else if (speed >= 60 && speed < 110) {
			// Ambiguous range - don't use bracket alone
			return null;
		} else if (speed >= 110 && speed <= 130) {
			return { mode: 'train', confidence: 0.6, source: 'Speed bracket (110-130 km/h)' };
		}

		return null;
	}

	private calculateTotalDistance(points: Array<{ lat: number; lng: number }>): number {
		let totalDistance = 0;
		for (let i = 1; i < points.length; i++) {
			totalDistance += this.haversine(
				points[i - 1].lat,
				points[i - 1].lng,
				points[i].lat,
				points[i].lng
			);
		}
		return totalDistance;
	}

	private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
		const toRad = (x: number) => (x * Math.PI) / 180;
		const R = 6371e3; // Earth radius in meters
		const φ1 = toRad(lat1);
		const φ2 = toRad(lat2);
		const Δφ = toRad(lat2 - lat1);
		const Δλ = toRad(lng2 - lng1);
		const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}
}
