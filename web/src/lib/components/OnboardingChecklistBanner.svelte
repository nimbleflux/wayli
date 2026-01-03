<script lang="ts">
	import { Link, Import, Map, Settings, Rocket, X, Check } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { slide } from 'svelte/transition';

	import { translate } from '$lib/i18n';
	import { OnboardingChecklistService } from '$lib/services/onboarding-checklist.service';
	import { fluxbase } from '$lib/fluxbase';
	import type { ChecklistState } from '$lib/types/onboarding.types';

	import { page } from '$app/stores';

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
			route: '/dashboard/trips',
			titleKey: 'onboarding.generateTrips',
			descriptionKey: 'onboarding.generateTripsDesc',
			icon: Map,
			completed: checklistState?.completed_steps?.includes('trips') ?? false
		}
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

	// Listen for onboarding completion event
	$effect(() => {
		const handleOnboardingComplete = () => {
			checkOnboardingCompleted();
		};

		window.addEventListener('onboarding-completed', handleOnboardingComplete);

		return () => {
			window.removeEventListener('onboarding-completed', handleOnboardingComplete);
		};
	});

	// Track route changes
	$effect(() => {
		const pathname = $page.url.pathname;
		if (shouldShow && pathname) {
			trackPageVisit(pathname);
		}
	});

	async function checkOnboardingCompleted() {
		try {
			const { data, error } = await fluxbase
				.from('user_profiles')
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
					<h3 class="font-semibold text-gray-900 dark:text-gray-100">
						{t('onboarding.checklistTitle')}
					</h3>
				</div>
				<button
					onclick={handleDismiss}
					disabled={isDismissing}
					class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
					aria-label={t('common.actions.close')}
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Progress bar -->
			<div class="mb-4">
				<div class="mb-2 flex items-center justify-between text-sm">
					<span class="text-gray-600 dark:text-gray-400">
						{t('onboarding.checklistProgress', { completed: completedCount, total: totalSteps })}
					</span>
					<span class="font-medium text-blue-600 dark:text-blue-400">
						{Math.round((completedCount / totalSteps) * 100)}%
					</span>
				</div>
				<div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
					<div
						class="h-2 rounded-full bg-blue-600 transition-all duration-500 dark:bg-blue-500"
						style="width: {(completedCount / totalSteps) * 100}%"
					></div>
				</div>
			</div>

			<!-- Steps grid (responsive) -->
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-{totalSteps}">
				{#each steps as step (step.id)}
					{@const Icon = step.icon}
					<a
						href={step.route}
						class="flex items-start gap-3 rounded-lg border p-3 transition-all {step.completed
							? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
							: 'border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-600'}"
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
							<h4 class="mb-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
								{t(step.titleKey)}
							</h4>
							<p class="line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
								{t(step.descriptionKey)}
							</p>
						</div>
					</a>
				{/each}
			</div>
		</div>
	</div>
{/if}
