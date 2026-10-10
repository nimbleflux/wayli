import { describe, it, expect, beforeEach } from 'vitest';
import { TransportModeDetector } from '../../../src/lib/services/transport-mode-detector.service';
import type {
	DetectionContext,
	DetectionRule,
	PointData
} from '../../../src/lib/types/transport-detection.types';

// Mock rule for testing
class TestRule implements DetectionRule {
	name = 'Test Rule';
	priority = 50;
	canApplyResult = true;
	detectResult: any = null;

	canApply(context: DetectionContext): boolean {
		return this.canApplyResult;
	}

	detect(context: DetectionContext): any {
		return this.detectResult;
	}
}

describe('TransportModeDetector', () => {
	let detector: TransportModeDetector;
	let testRule: TestRule;

	beforeEach(() => {
		detector = new TransportModeDetector();
		testRule = new TestRule();
	});

	describe('Rule Management', () => {
		it('should add rules and sort by priority', () => {
			const highPriorityRule = new TestRule();
			highPriorityRule.name = 'High Priority';
			highPriorityRule.priority = 100;

			const lowPriorityRule = new TestRule();
			lowPriorityRule.name = 'Low Priority';
			lowPriorityRule.priority = 10;

			detector.addRule(lowPriorityRule);
			detector.addRule(highPriorityRule);

			const rules = detector.getRules();
			expect(rules[0].priority).toBe(100);
			expect(rules[1].priority).toBe(10);
		});

		it('should remove rules by name', () => {
			detector.addRule(testRule);
			expect(detector.getRules()).toHaveLength(1);

			detector.removeRule('Test Rule');
			expect(detector.getRules()).toHaveLength(0);
		});

		it('should get applicable rules for context', () => {
			const applicableRule = new TestRule();
			applicableRule.name = 'Applicable';
			applicableRule.canApplyResult = true;

			const nonApplicableRule = new TestRule();
			nonApplicableRule.name = 'Non-Applicable';
			nonApplicableRule.canApplyResult = false;

			detector.addRule(applicableRule);
			detector.addRule(nonApplicableRule);

			const mockContext = createMockContext();
			const applicableRules = detector.getApplicableRules(mockContext);

			expect(applicableRules).toHaveLength(1);
			expect(applicableRules[0].name).toBe('Applicable');
		});
	});

	describe('Detection', () => {
		it('should return rule result when rule applies', () => {
			testRule.detectResult = {
				mode: 'car',
				confidence: 0.8,
				reason: 'Test detection'
			};

			detector.addRule(testRule);

			const mockContext = createMockContext();
			const result = detector.detect(mockContext);

			expect(result.mode).toBe('car');
			expect(result.confidence).toBe(0.8);
			expect(result.reason).toBe('Test detection');
		});

		it('should skip rules with low confidence', () => {
			const lowConfidenceRule = new TestRule();
			lowConfidenceRule.name = 'Low Confidence';
			lowConfidenceRule.detectResult = {
				mode: 'car',
				confidence: 0.3, // Below threshold
				reason: 'Low confidence'
			};

			const highConfidenceRule = new TestRule();
			highConfidenceRule.name = 'High Confidence';
			highConfidenceRule.priority = 60;
			highConfidenceRule.detectResult = {
				mode: 'train',
				confidence: 0.8,
				reason: 'High confidence'
			};

			detector.addRule(lowConfidenceRule);
			detector.addRule(highConfidenceRule);

			const mockContext = createMockContext();
			const result = detector.detect(mockContext);

			expect(result.mode).toBe('train');
		});

		it('should return fallback when no rules apply', () => {
			testRule.canApplyResult = false;
			detector.addRule(testRule);

			const mockContext = createMockContext();
			const result = detector.detect(mockContext);

			expect(result.mode).toBe('unknown');
			expect(result.confidence).toBe(0.1);
		});
	});

	describe('Context Creation', () => {
		it('should create detection context from point data', () => {
			const current: PointData = {
				lat: 52.3676,
				lng: 4.9041,
				timestamp: Date.now(),
				speed: 50
			};

			const previous: PointData = {
				lat: 52.3675,
				lng: 4.904,
				timestamp: Date.now() - 1000,
				speed: 45
			};

			const pointHistory = [previous, current];
			const modeHistory: any[] = [];

			const context = detector.createDetectionContext(
				current,
				previous,
				pointHistory,
				modeHistory,
				{
					atTrainStation: false,
					atAirport: false,
					onHighway: true,
					stationName: undefined,
					airportName: undefined
				}
			);

			expect(context.current).toBe(current);
			expect(context.previous).toBe(previous);
			expect(context.onHighway).toBe(true);
			expect(context.currentSpeed).toBeGreaterThan(0);
		});
	});
});

function createMockContext(): DetectionContext {
	return {
		current: { lat: 0, lng: 0, timestamp: Date.now() },
		previous: { lat: 0, lng: 0, timestamp: Date.now() - 1000 },
		pointHistory: [],
		modeHistory: [],
		atTrainStation: false,
		atAirport: false,
		onHighway: false,
		currentSpeed: 0,
		averageSpeed: 0,
		speedHistory: [],
		rollingAverageSpeed: 0,
		speedCalculationWindow: 5
	};
}
