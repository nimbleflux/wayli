<script lang="ts">
	import { Link, Import, Map, Settings, Rocket, X, Check, Sparkles } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { slide } from 'svelte/transition';

	import { translate } from '$lib/i18n';
	import { OnboardingChecklistService } from '$lib/services/onboarding-checklist.service';
	import { fluxbase } from '$lib/fluxbase';
	import { aiDrawer } from '$lib/stores/ai-drawer';
	import type { ChecklistState } from '$lib/types/onboarding.types';

	import { page } from '$app/state';

	let {
		userId,
		isAdmin = false,
		aiEnabled = false
	}: {
		userId: string;
		isAdmin?: boolean;
		aiEnabled?: boolean;
	} = $props();

	let t = $derived($translate);

	// State
	let checklistState = $state<ChecklistState | null>(null);
	let isLoading = $state(true);
	let isDismissing = $state(false);
	let onboardingCompleted = $state(false);

	// Define steps
	let steps = $derived([
		{
			id: 'connections',
			route: '/dashboard/connections',
			titleKey: 'onboarding.configureOwnTracks',
			descriptionKey: 'onboarding.configureOwnTracksDesc',
			icon: Link,
			completed: checklistState?.completed_steps?.includes('connections') ?? false
		},
		{
			id: 'import-export',
			route: '/dashboard/import-export',
			titleKey: 'onboarding.importData',
			descriptionKey: 'onboarding.importDataDesc',
			icon: Import,
			completed: checklistState?.completed_steps?.includes('import-export') ?? false
		},
		// For admins, show AI configuration before trip generation (only if AI not enabled yet)
		...(isAdmin && !aiEnabled
			? [
					{
						id: 'server-admin',
						route: '/dashboard/server-admin-settings',
						titleKey: 'onboarding.configureAI',
						descriptionKey: 'onboarding.configureAIDesc',
						icon: Settings,
						completed: checklistState?.completed_steps?.includes('server-admin') ?? false
					}
				]
			: []),
		{
			id: 'trips',
			route: '/dashboard/travel',
			titleKey: 'onboarding.generateTrips',
			descriptionKey: 'onboarding.generateTripsDesc',
			icon: Map,
			completed: checklistState?.completed_steps?.includes('trips') ?? false
		},
		// Suggest trying the AI assistant once it's enabled. Completed on first
		// message sent (handled in AiDrawer.send), not on page visit.
		...(aiEnabled
			? [
					{
						id: 'ai-assistant',
						route: '#ai',
						titleKey: 'onboarding.tryAi',
						descriptionKey: 'onboarding.tryAiDesc',
						icon: Sparkles,
						completed: checklistState?.completed_steps?.includes('ai-assistant') ?? false
					}
				]
			: [])
	]);

	let completedCount = $derived(steps.filter((s) => s.completed).length);
	let totalSteps = $derived(steps.length);
	let allCompleted = $derived(completedCount === totalSteps);
	let shouldShow = $derived(
		!isLoading &&
			onboardingCompleted &&
			(!checklistState || !checklistState.dismissed) &&
			!allCompleted
	);

	// Load checklist state on mount
	$effect(() => {
		if (userId) {
			loadChecklistState();
			checkOnboardingCompleted();
		}
	});

	// Listen for onboarding completion event, and for the user's first AI
	// message (marks the "Try the AI assistant" step complete).
	$effect(() => {
		const handleOnboardingComplete = () => {
			checkOnboardingCompleted();
		};
		const handleAiFirstMessage = async () => {
			try {
				await OnboardingChecklistService.markStepCompleted(userId, 'ai-assistant');
				await loadChecklistState();
			} catch (error) {
				console.error('Error marking AI step complete:', error);
			}
		};

		window.addEventListener('onboarding-completed', handleOnboardingComplete);
		window.addEventListener('ai-first-message', handleAiFirstMessage);

		return () => {
			window.removeEventListener('onboarding-completed', handleOnboardingComplete);
			window.removeEventListener('ai-first-message', handleAiFirstMessage);
		};
	});

	// Track route changes — only mark "visit" steps, not action steps
	$effect(() => {
		const pathname = page.url.pathname;
		if (shouldShow && pathname) {
			// Only auto-complete steps that are genuinely "visit" actions.
			// Steps like import-export and connections require actual user actions
			// (uploading data, configuring a tracker) and should not be marked
			// complete just by visiting the page.
			const visitOnlySteps = ['trips'];
			const step = steps.find((s) => s.route === pathname);
			if (step && visitOnlySteps.includes(step.id) && !step.completed) {
				trackPageVisit(pathname);
			}
		}
	});

	async function checkOnboardingCompleted() {
		try {
			const { data, error } = await fluxbase
				.from<Record<string, any>>('user_profiles')
				.select('onboarding_completed')
				.eq('id', userId)
				.single();

			if (!error && data) {
				const profile = data as any;
				onboardingCompleted = profile.onboarding_completed ?? false;
			}
		} catch (error) {
			console.error('Error checking onboarding status:', error);
		}
	}

	async function loadChecklistState() {
		isLoading = true;
		try {
			const state = await OnboardingChecklistService.getChecklistState(userId);
			checklistState = state || { dismissed: false, completed_steps: [] };
		} catch (error) {
			console.error('Error loading checklist state:', error);
			checklistState = { dismissed: false, completed_steps: [] };
		} finally {
			isLoading = false;
		}
	}

	async function trackPageVisit(pathname: string) {
		const step = steps.find((s) => s.route === pathname);
		if (step && !step.completed) {
			try {
				await OnboardingChecklistService.markStepCompleted(userId, step.id);
				// Reload state to update UI
				await loadChecklistState();
			} catch (error) {
				console.error('Error tracking step:', error);
			}
		}
	}

	async function handleDismiss() {
		isDismissing = true;
		try {
			await OnboardingChecklistService.dismissChecklist(userId);
			checklistState = {
				...checklistState!,
				dismissed: true,
				dismissed_at: new Date().toISOString()
			};
			toast.success(t('onboarding.checklistDismissed'));
		} catch (error) {
			console.error('Error dismissing checklist:', error);
			toast.error(t('onboarding.checklistDismissError'));
		} finally {
			isDismissing = false;
		}
	}
</script>

{#if shouldShow}
	<div
		class="border-b border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
		transition:slide={{ duration: 300 }}
	>
		<div class="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
			<!-- Header with dismiss button -->
			<div class="mb-3 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Rocket class="h-5 w-5 text-blue-600 dark:text-blue-400" />
					<h3 class="text-foreground font-semibold">
						{t('onboarding.checklistTitle')}
					</h3>
				</div>
				<button
					onclick={handleDismiss}
					disabled={isDismissing}
					class="text-muted-foreground hover:text-muted-foreground"
					aria-label={t('common.actions.close')}
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Progress bar -->
			<div class="mb-4">
				<div class="mb-2 flex items-center justify-between text-sm">
					<span class="text-muted-foreground">
						{t('onboarding.checklistProgress', { completed: completedCount, total: totalSteps })}
					</span>
					<span class="font-medium text-blue-600 dark:text-blue-400">
						{Math.round((completedCount / totalSteps) * 100)}%
					</span>
				</div>
				<div class="dark:bg-muted h-2 w-full rounded-full bg-gray-200">
					<div
						class="h-2 rounded-full bg-blue-600 transition-all duration-500 dark:bg-blue-500"
						style="width: {(completedCount / totalSteps) * 100}%"
					></div>
				</div>
			</div>

			<!-- Steps grid (responsive) -->
			<div
				class="grid grid-cols-1 gap-3 sm:grid-cols-2 {totalSteps >= 4
					? 'lg:grid-cols-4'
					: 'lg:grid-cols-3'}"
			>
				{#each steps as step (step.id)}
					{@const Icon = step.icon}
					<a
						href={step.route === '#ai' ? undefined : step.route}
						role={step.route === '#ai' ? 'button' : undefined}
						tabindex="0"
						onclick={(e) => {
							if (step.route === '#ai') {
								e.preventDefault();
								aiDrawer.open();
							}
						}}
						onkeydown={(e) => {
							if (step.route === '#ai' && (e.key === 'Enter' || e.key === ' ')) {
								e.preventDefault();
								aiDrawer.open();
							}
						}}
						class="flex items-start gap-3 rounded-lg border p-3 transition-all {step.completed
							? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
							: ' hover:border-blue-300 dark:hover:border-blue-600'} bg-card border-border"
					>
						<!-- Icon with checkmark overlay -->
						<div class="relative shrink-0">
							<div
								class="flex h-10 w-10 items-center justify-center rounded-lg {step.completed
									? 'bg-green-100 dark:bg-green-900/30'
									: 'bg-blue-100 dark:bg-blue-900/30'}"
							>
								<Icon
									class="h-5 w-5 {step.completed
										? 'text-green-600 dark:text-green-400'
										: 'text-blue-600 dark:text-blue-400'}"
								/>
							</div>
							{#if step.completed}
								<div class="absolute -top-1 -right-1 rounded-full bg-green-500 p-0.5">
									<Check class="h-3 w-3 text-white" />
								</div>
							{/if}
						</div>

						<!-- Text content -->
						<div class="min-w-0 flex-1">
							<h4 class="text-foreground mb-0.5 text-sm font-medium">
								{t(step.titleKey)}
							</h4>
							<p class="text-muted-foreground line-clamp-2 text-xs">
								{t(step.descriptionKey)}
							</p>
						</div>
					</a>
				{/each}
			</div>
		</div>
	</div>
{/if}
