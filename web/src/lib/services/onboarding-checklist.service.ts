import { fluxbase } from '$lib/fluxbase';

export interface ChecklistState {
	dismissed: boolean;
	completed_steps: string[];
	dismissed_at?: string;
}

export class OnboardingChecklistService {
	static async getChecklistState(userId: string): Promise<ChecklistState | null> {
		const { data, error } = await fluxbase
			.from('user_preferences')
			.select('preferences')
			.eq('id', userId)
			.single();

		if (error || !data) return null;
		const preferences = (data as any).preferences;
		return preferences?.onboarding_checklist || null;
	}

	static async markStepCompleted(userId: string, stepId: string): Promise<void> {
		// Get current preferences
		const { data } = await fluxbase
			.from('user_preferences')
			.select('preferences')
			.eq('id', userId)
			.single();

		const preferences = ((data as any)?.preferences || {}) as any;
		const checklist = preferences.onboarding_checklist || {
			dismissed: false,
			completed_steps: []
		};

		// Add step if not already completed (idempotent)
		if (!checklist.completed_steps.includes(stepId)) {
			checklist.completed_steps.push(stepId);

			await fluxbase
				.from('user_preferences')
				.update({
					preferences: { ...preferences, onboarding_checklist: checklist }
				})
				.eq('id', userId);
		}
	}

	static async dismissChecklist(userId: string): Promise<void> {
		const { data } = await fluxbase
			.from('user_preferences')
			.select('preferences')
			.eq('id', userId)
			.single();

		const preferences = ((data as any)?.preferences || {}) as any;
		const checklist = preferences.onboarding_checklist || {
			dismissed: false,
			completed_steps: []
		};

		checklist.dismissed = true;
		checklist.dismissed_at = new Date().toISOString();

		await fluxbase
			.from('user_preferences')
			.update({
				preferences: { ...preferences, onboarding_checklist: checklist }
			})
			.eq('id', userId);
	}
}
