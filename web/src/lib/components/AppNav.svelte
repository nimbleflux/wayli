<script lang="ts">
	import {
		BarChart,
		Import,
		Star,
		Link,
		Settings,
		User,
		Navigation,
		Map,
		X,
		Sun,
		Moon,
		Crown,
		LogOut,
		Menu,
		Sparkles
	} from 'lucide-svelte';

	import { translate } from '$lib/i18n';
	import { setTheme, initializeTheme } from '$lib/stores/app-state.svelte';
	import { userStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';

	import type { UserProfile } from '$lib/types/user.types';

	import JobProgressIndicator from './JobProgressIndicator.svelte';
	import RealtimeConnectionStatus from './RealtimeConnectionStatus.svelte';

	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let {
		isAdmin = false,
		children,
		onSignout,
		realtimeConnectionStatus = 'disconnected'
	} = $props<{
		isAdmin?: boolean;
		children?: unknown;
		onSignout?: () => void;
		realtimeConnectionStatus?: 'connecting' | 'connected' | 'disconnected' | 'error';
	}>();

	// Use the reactive translation function
	let t = $derived($translate);

	// User profile for completion indicator
	let userProfile = $state<UserProfile | null>(null);

	// Local state for SSR compatibility
	let currentTheme = $state<'light' | 'dark'>('light');
	let isSidebarOpen = $state(false);

	// Reactive navigation items that update with language changes
	let navMain = $derived([
		{ href: '/dashboard/statistics', label: t('common.navigation.statistics'), icon: BarChart },
		{ href: '/dashboard/trips', label: t('common.navigation.trips'), icon: Map },
		{ href: '/dashboard/ask', label: t('common.navigation.ask') || 'Ask AI', icon: Sparkles },
		{ href: '/dashboard/import-export', label: t('common.navigation.importExport'), icon: Import },
		// { href: '/dashboard/point-editor', label: 'GPS Point Editor', icon: Edit },
		// { href: '/dashboard/points-of-interest', label: 'Visited POIs', icon: Landmark },
		{ href: '/dashboard/want-to-visit', label: t('common.navigation.wantToVisit'), icon: Star },
		{ href: '/dashboard/connections', label: t('common.navigation.connections'), icon: Link }
	]);

	// Dynamic user navigation based on admin status - reactive to language changes
	let navUser = $derived([
		{ href: '/dashboard/account-settings', label: t('common.navigation.accountSettings'), icon: User },
		...(isAdmin
			? [
					{
						href: '/dashboard/server-admin-settings',
						label: t('common.navigation.serverAdminSettings'),
						icon: Settings
					}
				]
			: [])
	]);

	// Force reactive update after navigation
	afterNavigate(() => {
		// This will trigger a reactive update of the page store
	});

	// Load user profile for onboarding indicator
	onMount(async () => {
		// Initialize theme
		if (browser) {
			initializeTheme();
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
			if (savedTheme) {
				currentTheme = savedTheme;
			} else {
				const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
				currentTheme = prefersDark ? 'dark' : 'light';
			}
		}

		if ($userStore) {
			const { data } = await fluxbase
				.from('user_profiles')
				.select('home_address, home_address_skipped, onboarding_dismissed')
				.eq('id', $userStore.id)
				.single();

			userProfile = data;
		}
	});

	function handleSignOut() {
		if (onSignout) {
			onSignout();
		}
	}

	function handleThemeChange(theme: 'light' | 'dark') {
		setTheme(theme);
		currentTheme = theme;
	}

	function handleToggleSidebar() {
		isSidebarOpen = !isSidebarOpen;
	}

	function handleCloseSidebar() {
		isSidebarOpen = false;
	}

	// Handle window resize to properly manage sidebar state
	function handleResize() {
		if (window.innerWidth >= 768) {
			// md breakpoint
			isSidebarOpen = false;
		}
	}

	onMount(() => {
		// Initialize sidebar state based on screen size
		if (window.innerWidth >= 768) {
			isSidebarOpen = false;
		}

		window.addEventListener('resize', handleResize);
		return () => {
			window.removeEventListener('resize', handleResize);
		};
	});
</script>

<div class="flex h-screen bg-gray-100 dark:bg-gray-900">
	<!-- Sidebar -->
	<aside
		class="fixed inset-y-0 left-0 z-50 flex w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-300 ease-in-out md:static md:translate-x-0 dark:border-gray-700 dark:bg-gray-800 {isSidebarOpen
			? 'translate-x-0'
			: '-translate-x-full'}"
	>
		<!-- Sidebar Header - Fixed at top -->
		<div
			class="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700"
		>
			<a href="/dashboard/statistics" class="flex cursor-pointer items-center">
				<Navigation class="mr-2 h-8 w-8 text-[rgb(37,140,244)]" />
				<span class="text-xl font-bold text-gray-900 dark:text-gray-100">Wayli</span>
			</a>
			<button
				onclick={handleCloseSidebar}
				class="cursor-pointer rounded-md p-1 text-gray-400 hover:text-gray-600 md:hidden dark:hover:text-gray-300"
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		<!-- Scrollable Navigation - Takes remaining space -->
		<nav class="min-h-0 flex-1 overflow-y-auto">
			<div class="space-y-1 p-4">
				{#each navMain as item (item.href)}
					<a
						href={item.href}
						class="flex cursor-pointer items-center rounded-md px-3 py-2 text-sm font-medium transition-colors {$page
							.url.pathname === item.href
							? 'bg-[rgb(37,140,244)] text-white'
							: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
						onclick={handleCloseSidebar}
					>
						<item.icon class="mr-3 h-5 w-5" />
						{item.label}
					</a>
				{/each}
			</div>
		</nav>

		<!-- Fixed Footer - Always visible at bottom -->
		<div class="flex-shrink-0 border-t border-gray-200 p-4 dark:border-gray-700">
			<!-- Theme Toggle -->
			<div class="mb-4 flex justify-start gap-2">
				<button
					onclick={() => handleThemeChange('light')}
					class="cursor-pointer rounded-lg p-2 font-medium transition-colors {currentTheme ===
					'light'
						? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
						: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
					title={t('common.navigation.lightMode')}
				>
					<Sun class="h-5 w-5" />
				</button>
				<button
					onclick={() => handleThemeChange('dark')}
					class="cursor-pointer rounded-lg p-2 font-medium transition-colors {currentTheme === 'dark'
						? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
						: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
					title={t('common.navigation.darkMode')}
				>
					<Moon class="h-5 w-5" />
				</button>
			</div>

			<!-- Realtime Connection Status -->
			<div class="mb-3">
				<RealtimeConnectionStatus status={realtimeConnectionStatus} compact={false} />
			</div>

			<!-- Job Progress Indicator -->
			<JobProgressIndicator />

			<!-- User Navigation -->
			<div class="mb-4">
				<div class="space-y-1">
					{#each navUser as item (item.href)}
						<a
							href={item.href}
							class="relative flex cursor-pointer items-center rounded-md px-3 py-2 text-sm font-medium transition-colors {$page
								.url.pathname === item.href
								? 'bg-[rgb(37,140,244)] text-white'
								: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
							onclick={handleCloseSidebar}
						>
							<item.icon class="mr-3 h-5 w-5" />
							<span class="flex items-center">
								{item.label}
								{#if isAdmin && item.href === '/dashboard/account-settings'}
									<Crown class="ml-2 h-4 w-4 text-yellow-500" />
								{/if}
							</span>
						</a>
					{/each}
				</div>
			</div>

			<!-- Sign Out Button -->
			<button
				onclick={() => {
					handleSignOut();
					handleCloseSidebar();
				}}
				class="flex w-full cursor-pointer items-center rounded-md px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
			>
				<LogOut class="mr-3 h-5 w-5" />
				{t('common.navigation.signOut')}
			</button>
		</div>
	</aside>

	<!-- Mobile overlay -->
	{#if isSidebarOpen}
		<div
			class="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 md:hidden"
			onclick={handleCloseSidebar}
			role="presentation"
			aria-roledescription="Mobile overlay"
			aria-label="Mobile overlay"
		></div>
	{/if}

	<!-- Main Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<!-- Top bar for mobile -->
		<div
			class="border-b border-gray-200 bg-white p-4 md:hidden dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="flex items-center justify-between">
				<button
					onclick={handleToggleSidebar}
					class="cursor-pointer rounded-md p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				>
					<Menu class="h-6 w-6" />
				</button>
				<a href="/dashboard/trips" class="flex cursor-pointer items-center">
					<Navigation class="mr-2 h-6 w-6 text-[rgb(37,140,244)]" />
					<span class="text-lg font-bold text-gray-900 dark:text-gray-100">Wayli</span>
				</a>
				<div class="w-6"></div>
			</div>
		</div>

		<!-- Content Area -->
		<main class="flex-1 overflow-auto">
			{#if children}
				{@render children()}
			{/if}
		</main>
	</div>
</div>
