export interface OnboardingStep {
	id: string;
	title: string;
	description: string;
	optional: boolean;
	completed: boolean;
}

export interface OnboardingState {
	currentStep: number;
	totalSteps: number;
	isActive: boolean;
}

export interface OnboardingCallbacks {
	onComplete: (homeAddress?: any) => Promise<void>;
	onSkip: () => Promise<void>;
}

export interface ChecklistStep {
	id: string;
	route: string;
	titleKey: string;
	descriptionKey: string;
	icon: any;
	completed: boolean;
}

export interface ChecklistState {
	dismissed: boolean;
	completed_steps: string[];
	dismissed_at?: string;
}
