import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { onboardingState, onboardingActions } from '$lib/stores/onboarding';

describe('Onboarding Store', () => {
	beforeEach(() => {
		// Reset store to initial state before each test
		onboardingActions.reset();
	});

	it('should initialize with correct default values', () => {
		const state = get(onboardingState);

		expect(state.currentStep).toBe(0);
		expect(state.totalSteps).toBe(3);
		expect(state.isActive).toBe(false);
	});

	it('should start onboarding correctly', () => {
		onboardingActions.start();
		const state = get(onboardingState);

		expect(state.isActive).toBe(true);
		expect(state.currentStep).toBe(0);
	});

	it('should move to next step correctly', () => {
		onboardingActions.start();
		onboardingActions.nextStep();

		const state = get(onboardingState);
		expect(state.currentStep).toBe(1);
	});

	it('should not exceed total steps when going forward', () => {
		onboardingActions.start();
		onboardingActions.nextStep();
		onboardingActions.nextStep();
		onboardingActions.nextStep(); // Try to go beyond max

		const state = get(onboardingState);
		expect(state.currentStep).toBe(2); // Should stay at max (totalSteps - 1)
	});

	it('should move to previous step correctly', () => {
		onboardingActions.start();
		onboardingActions.nextStep();
		onboardingActions.previousStep();

		const state = get(onboardingState);
		expect(state.currentStep).toBe(0);
	});

	it('should not go below 0 when going backwards', () => {
		onboardingActions.start();
		onboardingActions.previousStep();
		onboardingActions.previousStep(); // Try to go below 0

		const state = get(onboardingState);
		expect(state.currentStep).toBe(0);
	});

	it('should complete onboarding and reset state', () => {
		onboardingActions.start();
		onboardingActions.nextStep();
		onboardingActions.complete();

		const state = get(onboardingState);
		expect(state.currentStep).toBe(0);
		expect(state.isActive).toBe(false);
	});

	it('should reset onboarding state', () => {
		onboardingActions.start();
		onboardingActions.nextStep();
		onboardingActions.reset();

		const state = get(onboardingState);
		expect(state.currentStep).toBe(0);
		expect(state.totalSteps).toBe(3);
		expect(state.isActive).toBe(false);
	});
});
