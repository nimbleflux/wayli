// tests/unit/utils/speed-pattern-analysis.test.ts

import { describe, it, expect } from 'vitest';
import {
	calculateSpeedVariance,
	hasTrainLikeSpeedPattern,
	hasCarLikeSpeedPattern,
	hasSustainedSpeed,
	calculateBearing,
	calculateBearingVariance,
	hasStraightTrajectory,
	hasFrequentTurns,
	isPhysicallyPossible,
	filterPhysicallyPossibleModes,
	analyzeGPSFrequency,
	analyzeSpeedTransitions,
	PHYSICAL_CONSTRAINTS
} from '../../../src/lib/utils/speed-pattern-analysis';

describe('Speed Pattern Analysis', () => {
	describe('calculateSpeedVariance', () => {
		it('should calculate variance metrics correctly', () => {
			const speeds = [100, 105, 100, 110, 105];
			const metrics = calculateSpeedVariance(speeds);

			expect(metrics.mean).toBeCloseTo(104, 0);
			expect(metrics.min).toBe(100);
			expect(metrics.max).toBe(110);
			expect(metrics.range).toBe(10);
			expect(metrics.stdDev).toBeGreaterThan(0);
			expect(metrics.coefficientOfVariation).toBeGreaterThan(0);
		});

		it('should handle empty array', () => {
			const metrics = calculateSpeedVariance([]);
			expect(metrics.mean).toBe(0);
			expect(metrics.stdDev).toBe(0);
			expect(metrics.coefficientOfVariation).toBe(0);
		});

		it('should calculate low variance for train-like speeds', () => {
			const trainSpeeds = [120, 122, 118, 121, 119, 120, 121];
			const metrics = calculateSpeedVariance(trainSpeeds);

			expect(metrics.coefficientOfVariation).toBeLessThan(0.02); // Very low variance
		});

		it('should calculate high variance for car-like speeds', () => {
			const carSpeeds = [80, 120, 95, 110, 70, 100, 85];
			const metrics = calculateSpeedVariance(carSpeeds);

			expect(metrics.coefficientOfVariation).toBeGreaterThan(0.15); // High variance
		});
	});

	describe('hasTrainLikeSpeedPattern', () => {
		it('should detect train-like pattern with consistent speeds', () => {
			const speeds = [120, 118, 122, 119, 121, 120, 119, 122, 120, 121];
			expect(hasTrainLikeSpeedPattern(speeds)).toBe(true);
		});

		it('should reject speeds below 80 km/h', () => {
			const speeds = [60, 62, 61, 63, 60, 61, 62, 60];
			expect(hasTrainLikeSpeedPattern(speeds)).toBe(false);
		});

		it('should reject variable car speeds', () => {
			const speeds = [80, 120, 95, 110, 70, 100, 85, 90];
			expect(hasTrainLikeSpeedPattern(speeds)).toBe(false);
		});

		it('should require minimum data points', () => {
			const speeds = [120, 121, 122];
			expect(hasTrainLikeSpeedPattern(speeds)).toBe(false);
		});
	});

	describe('hasCarLikeSpeedPattern', () => {
		it('should detect car-like pattern with variable speeds', () => {
			const speeds = [50, 120, 70, 110, 40, 100, 60, 115]; // Higher variance
			expect(hasCarLikeSpeedPattern(speeds)).toBe(true);
		});

		it('should reject consistent train speeds', () => {
			const speeds = [120, 118, 122, 119, 121, 120, 119];
			expect(hasCarLikeSpeedPattern(speeds)).toBe(false);
		});
	});

	describe('hasSustainedSpeed', () => {
		it('should detect sustained speed over duration', () => {
			const now = Date.now();
			const modeHistory = [
				{ speed: 100, timestamp: now - 12 * 60 * 1000 },
				{ speed: 105, timestamp: now - 10 * 60 * 1000 },
				{ speed: 110, timestamp: now - 8 * 60 * 1000 },
				{ speed: 108, timestamp: now - 6 * 60 * 1000 },
				{ speed: 112, timestamp: now - 4 * 60 * 1000 },
				{ speed: 110, timestamp: now - 2 * 60 * 1000 }
			];

			expect(hasSustainedSpeed(modeHistory, 90, 10 * 60 * 1000)).toBe(true);
		});

		it('should reject if speed drops below minimum', () => {
			const now = Date.now();
			const modeHistory = [
				{ speed: 100, timestamp: now - 12 * 60 * 1000 },
				{ speed: 80, timestamp: now - 8 * 60 * 1000 }, // Below minimum, within window
				{ speed: 110, timestamp: now - 4 * 60 * 1000 }
			];

			expect(hasSustainedSpeed(modeHistory, 90, 10 * 60 * 1000)).toBe(false);
		});

		it('should reject if insufficient history', () => {
			const modeHistory = [{ speed: 100, timestamp: Date.now() }];
			expect(hasSustainedSpeed(modeHistory, 90, 10 * 60 * 1000)).toBe(false);
		});
	});

	describe('Bearing calculations', () => {
		describe('calculateBearing', () => {
			it('should calculate bearing from north to south', () => {
				const bearing = calculateBearing(52.0, 4.0, 51.0, 4.0);
				expect(bearing).toBeCloseTo(180, 0); // South
			});

			it('should calculate bearing from west to east', () => {
				const bearing = calculateBearing(52.0, 4.0, 52.0, 5.0);
				expect(bearing).toBeCloseTo(90, 0); // East
			});

			it('should return value between 0 and 360', () => {
				const bearing = calculateBearing(52.3676, 4.9041, 52.0893, 5.1106);
				expect(bearing).toBeGreaterThanOrEqual(0);
				expect(bearing).toBeLessThan(360);
			});
		});

		describe('calculateBearingVariance', () => {
			it('should calculate low variance for straight trajectory', () => {
				// Points moving in a straight line (north to south)
				const points = [
					{ lat: 52.5, lng: 4.0 },
					{ lat: 52.4, lng: 4.0 },
					{ lat: 52.3, lng: 4.0 },
					{ lat: 52.2, lng: 4.0 },
					{ lat: 52.1, lng: 4.0 }
				];
				const variance = calculateBearingVariance(points);
				expect(variance).toBeLessThan(5); // Very straight
			});

			it('should calculate high variance for turning trajectory', () => {
				// Points with frequent direction changes
				const points = [
					{ lat: 52.0, lng: 4.0 },
					{ lat: 52.1, lng: 4.0 }, // North
					{ lat: 52.1, lng: 4.1 }, // East
					{ lat: 52.0, lng: 4.1 }, // South
					{ lat: 52.0, lng: 4.2 } // East again
				];
				const variance = calculateBearingVariance(points);
				expect(variance).toBeGreaterThan(20);
			});
		});

		describe('hasStraightTrajectory', () => {
			it('should detect straight train-like trajectory', () => {
				const points = [
					{ lat: 52.5, lng: 4.0 },
					{ lat: 52.4, lng: 4.0 },
					{ lat: 52.3, lng: 4.0 },
					{ lat: 52.2, lng: 4.0 },
					{ lat: 52.1, lng: 4.0 }
				];
				expect(hasStraightTrajectory(points)).toBe(true);
			});

			it('should reject turning car-like trajectory', () => {
				const points = [
					{ lat: 52.0, lng: 4.0 },
					{ lat: 52.1, lng: 4.0 },
					{ lat: 52.1, lng: 4.1 },
					{ lat: 52.0, lng: 4.1 },
					{ lat: 52.0, lng: 4.2 }
				];
				expect(hasStraightTrajectory(points)).toBe(false);
			});

			it('should require minimum points', () => {
				const points = [
					{ lat: 52.0, lng: 4.0 },
					{ lat: 52.1, lng: 4.0 }
				];
				expect(hasStraightTrajectory(points)).toBe(false);
			});
		});

		describe('hasFrequentTurns', () => {
			it('should detect frequent turns', () => {
				const points = [
					{ lat: 52.0, lng: 4.0 },
					{ lat: 52.1, lng: 4.0 },
					{ lat: 52.1, lng: 4.1 },
					{ lat: 52.0, lng: 4.1 },
					{ lat: 52.0, lng: 4.2 }
				];
				expect(hasFrequentTurns(points)).toBe(true);
			});
		});
	});

	describe('Physical constraints', () => {
		describe('PHYSICAL_CONSTRAINTS', () => {
			it('should have constraints for all modes', () => {
				expect(PHYSICAL_CONSTRAINTS.walking).toBeDefined();
				expect(PHYSICAL_CONSTRAINTS.cycling).toBeDefined();
				expect(PHYSICAL_CONSTRAINTS.car).toBeDefined();
				expect(PHYSICAL_CONSTRAINTS.train).toBeDefined();
				expect(PHYSICAL_CONSTRAINTS.airplane).toBeDefined();
				expect(PHYSICAL_CONSTRAINTS.stationary).toBeDefined();
			});

			it('should have realistic max speeds', () => {
				expect(PHYSICAL_CONSTRAINTS.walking.maxSpeed).toBe(8);
				expect(PHYSICAL_CONSTRAINTS.cycling.maxSpeed).toBe(35);
				expect(PHYSICAL_CONSTRAINTS.car.maxSpeed).toBe(180);
				expect(PHYSICAL_CONSTRAINTS.train.maxSpeed).toBe(320);
				expect(PHYSICAL_CONSTRAINTS.airplane.maxSpeed).toBe(1000);
			});
		});

		describe('isPhysicallyPossible', () => {
			it('should allow walking at 5 km/h', () => {
				expect(isPhysicallyPossible('walking', 5)).toBe(true);
			});

			it('should reject walking at 50 km/h', () => {
				expect(isPhysicallyPossible('walking', 50)).toBe(false);
			});

			it('should allow car at 100 km/h', () => {
				expect(isPhysicallyPossible('car', 100)).toBe(true);
			});

			it('should reject car at 300 km/h', () => {
				expect(isPhysicallyPossible('car', 300)).toBe(false);
			});

			it('should allow train at 200 km/h', () => {
				expect(isPhysicallyPossible('train', 200)).toBe(true);
			});

			it('should reject cycling at 100 km/h', () => {
				expect(isPhysicallyPossible('cycling', 100)).toBe(false);
			});

			it('should allow unknown modes', () => {
				expect(isPhysicallyPossible('unknown', 1000)).toBe(true);
			});
		});

		describe('filterPhysicallyPossibleModes', () => {
			it('should filter out impossible modes', () => {
				const candidates = ['walking', 'cycling', 'car', 'train'];
				const possible = filterPhysicallyPossibleModes(100, candidates);

				expect(possible).toContain('car');
				expect(possible).toContain('train');
				expect(possible).not.toContain('walking');
				expect(possible).not.toContain('cycling');
			});

			it('should allow all slow modes for low speed', () => {
				const candidates = ['walking', 'cycling', 'car', 'stationary'];
				const possible = filterPhysicallyPossibleModes(5, candidates);

				expect(possible).toContain('walking');
				expect(possible).toContain('cycling');
				expect(possible).toContain('car');
				// stationary mode doesn't need physical constraints check
			});
		});
	});

	describe('GPS frequency analysis', () => {
		describe('analyzeGPSFrequency', () => {
			it('should detect active navigation (high frequency)', () => {
				const now = Date.now();
				const modeHistory = [
					{ timestamp: now - 20000 }, // 20s ago
					{ timestamp: now - 15000 }, // 5s interval
					{ timestamp: now - 10000 }, // 5s interval
					{ timestamp: now - 5000 }, // 5s interval
					{ timestamp: now }
				];

				const analysis = analyzeGPSFrequency(modeHistory);
				expect(analysis.frequencyType).toBe('active_navigation');
				expect(analysis.likelyMode).toBe('car');
			});

			it('should detect background tracking (low frequency)', () => {
				const now = Date.now();
				const modeHistory = [
					{ timestamp: now - 180000 }, // 3 min ago
					{ timestamp: now - 120000 }, // 60s interval
					{ timestamp: now - 60000 }, // 60s interval
					{ timestamp: now }
				];

				const analysis = analyzeGPSFrequency(modeHistory);
				expect(analysis.frequencyType).toBe('background_tracking');
				expect(analysis.likelyMode).toBe('unknown');
			});

			it('should detect mixed frequency', () => {
				const now = Date.now();
				const modeHistory = [
					{ timestamp: now - 60000 },
					{ timestamp: now - 40000 }, // 20s interval
					{ timestamp: now - 20000 }, // 20s interval
					{ timestamp: now }
				];

				const analysis = analyzeGPSFrequency(modeHistory);
				expect(analysis.frequencyType).toBe('mixed');
			});

			it('should handle insufficient data', () => {
				const modeHistory = [{ timestamp: Date.now() }];
				const analysis = analyzeGPSFrequency(modeHistory);

				expect(analysis.frequencyType).toBe('mixed');
				expect(analysis.likelyMode).toBe('unknown');
			});
		});
	});

	describe('Speed transition analysis', () => {
		describe('analyzeSpeedTransitions', () => {
			it('should detect smooth train-like transitions', () => {
				const speeds = [120, 118, 122, 119, 121, 120];
				const analysis = analyzeSpeedTransitions(speeds);

				expect(analysis.smoothness).toBe('smooth');
				expect(analysis.likelyMode).toBe('train');
				expect(analysis.averageChange).toBeLessThan(10);
			});

			it('should detect erratic car-like transitions', () => {
				const speeds = [80, 120, 95, 110, 70, 100];
				const analysis = analyzeSpeedTransitions(speeds);

				expect(analysis.smoothness).toBe('erratic');
				expect(analysis.likelyMode).toBe('car');
				expect(analysis.averageChange).toBeGreaterThan(20);
			});

			it('should detect moderate transitions', () => {
				const speeds = [80, 95, 85, 100, 82, 98, 87, 92];
				const analysis = analyzeSpeedTransitions(speeds);

				expect(analysis.smoothness).toBe('moderate');
			});

			it('should handle insufficient data', () => {
				const speeds = [100];
				const analysis = analyzeSpeedTransitions(speeds);

				expect(analysis.smoothness).toBe('moderate');
				expect(analysis.likelyMode).toBe('unknown');
			});

			it('should calculate max change correctly', () => {
				const speeds = [100, 110, 80, 100]; // 30 km/h jump
				const analysis = analyzeSpeedTransitions(speeds);

				expect(analysis.maxChange).toBe(30);
			});
		});
	});
});
