import { writable } from 'svelte/store';
import type { OnboardingState } from '$lib/types/onboarding.types';

const initialState: OnboardingState = {
	currentStep: 0,
	totalSteps: 3,
	isActive: false
};

export const onboardingState = writable<OnboardingState>(initialState);

export const onboardingActions = {
	start: () => {
		onboardingState.update((state) => ({
			...state,
			isActive: true,
			currentStep: 0
		}));
	},

	nextStep: () => {
		onboardingState.update((state) => ({
			...state,
			currentStep: Math.min(state.currentStep + 1, state.totalSteps - 1)
		}));
	},

	previousStep: () => {
		onboardingState.update((state) => ({
			...state,
			currentStep: Math.max(state.currentStep - 1, 0)
		}));
	},

	complete: () => {
		onboardingState.set(initialState);
	},

	reset: () => {
		onboardingState.set(initialState);
	}
};
