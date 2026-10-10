import { describe, it, expect } from 'vitest';
import {
	calculateMultiPointSpeed,
	getAdaptiveWindowSize,
	setSpeedCalculationWindow,
	SPEED_CALCULATION_CONFIG
} from '../../../src/lib/utils/multi-point-speed';
import type { PointData } from '../../../src/lib/types/transport-detection.types';

describe('Multi-Point Speed Calculation', () => {
	describe('calculateMultiPointSpeed', () => {
		it('should return 0 for insufficient points', () => {
			const points: PointData[] = [{ lat: 0, lng: 0, timestamp: Date.now() }];

			const speed = calculateMultiPointSpeed(points);
			expect(speed).toBe(0);
		});

		it('should calculate speed for multiple points', () => {
			const now = Date.now();
			const points: PointData[] = [
				{ lat: 0, lng: 0, timestamp: now },
				{ lat: 0.001, lng: 0, timestamp: now + 1000 }, // ~111m in 1 second = ~400 km/h
				{ lat: 0.002, lng: 0, timestamp: now + 2000 }
			];

			const speed = calculateMultiPointSpeed(points);
			expect(speed).toBeGreaterThan(0);
			expect(speed).toBeLessThan(SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD);
		});

		it('should filter out outliers', () => {
			const now = Date.now();
			const points: PointData[] = [
				{ lat: 0, lng: 0, timestamp: now },
				{ lat: 0.001, lng: 0, timestamp: now + 1000 }, // Normal speed
				{ lat: 0.1, lng: 0, timestamp: now + 2000 }, // Extreme outlier
				{ lat: 0.002, lng: 0, timestamp: now + 3000 } // Back to normal
			];

			const speed = calculateMultiPointSpeed(points);
			expect(speed).toBeGreaterThan(0);
			expect(speed).toBeLessThan(1000); // Should not be affected by outlier
		});

		it('should use configurable window size', () => {
			const now = Date.now();
			const points: PointData[] = [
				{ lat: 0, lng: 0, timestamp: now },
				{ lat: 0.001, lng: 0, timestamp: now + 1000 },
				{ lat: 0.002, lng: 0, timestamp: now + 2000 },
				{ lat: 0.003, lng: 0, timestamp: now + 3000 },
				{ lat: 0.004, lng: 0, timestamp: now + 4000 },
				{ lat: 0.005, lng: 0, timestamp: now + 5000 }
			];

			const speed3 = calculateMultiPointSpeed(points, 3);
			const speed5 = calculateMultiPointSpeed(points, 5);

			expect(speed3).toBeGreaterThan(0);
			expect(speed5).toBeGreaterThan(0);
			// Both should be reasonable speeds
			expect(speed3).toBeLessThan(SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD);
			expect(speed5).toBeLessThan(SPEED_CALCULATION_CONFIG.MAX_SPEED_THRESHOLD);
		});
	});

	describe('getAdaptiveWindowSize', () => {
		it('should return minimum window size for insufficient points', () => {
			const points: PointData[] = [{ lat: 0, lng: 0, timestamp: Date.now() }];

			const windowSize = getAdaptiveWindowSize(points);
			expect(windowSize).toBe(SPEED_CALCULATION_CONFIG.MIN_WINDOW_SIZE);
		});

		it('should return larger window for noisy GPS data', () => {
			const now = Date.now();
			const noisyPoints: PointData[] = [
				{ lat: 0, lng: 0, timestamp: now },
				{ lat: 0.1, lng: 0.1, timestamp: now + 1000 }, // Large jump
				{ lat: 0.2, lng: 0.2, timestamp: now + 2000 }, // Another large jump
				{ lat: 0.3, lng: 0.3, timestamp: now + 3000 }
			];

			const windowSize = getAdaptiveWindowSize(noisyPoints);
			expect(windowSize).toBeGreaterThan(3); // Should use larger window for noise
		});

		it('should return appropriate window for clean GPS data', () => {
			const now = Date.now();
			const cleanPoints: PointData[] = [
				{ lat: 0, lng: 0, timestamp: now },
				{ lat: 0.001, lng: 0, timestamp: now + 1000 }, // Small movement
				{ lat: 0.002, lng: 0, timestamp: now + 2000 }, // Small movement
				{ lat: 0.003, lng: 0, timestamp: now + 3000 }
			];

			const windowSize = getAdaptiveWindowSize(cleanPoints);
			expect(windowSize).toBeGreaterThanOrEqual(3); // Should be at least minimum
			expect(windowSize).toBeLessThanOrEqual(10); // Should not exceed maximum
		});
	});

	describe('setSpeedCalculationWindow', () => {
		it('should enforce minimum window size', () => {
			const windowSize = setSpeedCalculationWindow(1);
			expect(windowSize).toBe(SPEED_CALCULATION_CONFIG.MIN_WINDOW_SIZE);
		});

		it('should enforce maximum window size', () => {
			const windowSize = setSpeedCalculationWindow(20);
			expect(windowSize).toBe(SPEED_CALCULATION_CONFIG.MAX_WINDOW_SIZE);
		});

		it('should return valid window size within bounds', () => {
			const windowSize = setSpeedCalculationWindow(5);
			expect(windowSize).toBe(5);
		});
	});
});
