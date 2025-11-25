<script lang="ts">
	import {
		MapPin,
		Globe,
		BarChart,
		ArrowRight,
		LogIn,
		Sun,
		Moon,
		User,
		LogOut,
		Shield,
		Users,
		Navigation
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	import LanguageSelector from '$lib/components/ui/language-selector/index.svelte';
	import { translate, messages, currentLocale } from '$lib/i18n';
	import { setTheme, initializeTheme } from '$lib/stores/app-state.svelte';
	import { userStore, sessionStore } from '$lib/stores/auth';
	import { fluxbase } from '$lib/fluxbase';

	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	// Use the reactive translation function
	let t = $derived($translate);

	// Check if messages are loaded
	let messagesLoaded = $derived(Object.keys($messages).length > 0);

	// Track if checking user count
	let checkingUserCount = $state(true);

	// Local theme state for SSR compatibility
	let currentTheme = $state<'light' | 'dark'>('light');

	async function handleLogin() {
		goto('/auth/signin');
	}

	async function handleSignOut() {
		console.log('🏠 [LANDING] Signout initiated');
		try {
			// Ensure client session/localStorage are cleared first
			await fluxbase.auth.signOut();
		} catch (e) {
			console.warn('🏠 [LANDING] Client signout warning:', e);
		}
		// Force navigation to server-side signout to clear SSR cookies and reload UI
		window.location.href = '/auth/signout';
	}

	async function checkSetupStatus() {
		try {
			// Read setup status from app.settings (RLS allows anonymous read for public settings)
			const isSetupComplete = await fluxbase.settings.get('wayli.is_setup_complete');

			console.log('🏠 [LANDING] Setup status check:', { isSetupComplete });

			// Only redirect if setup is explicitly marked as incomplete
			// If the setting doesn't exist or is undefined, assume setup is complete
			// (landing page should be accessible by default)
			const setupValue = isSetupComplete?.value;
			if (setupValue === false || setupValue === 'false') {
				console.log('🏠 [LANDING] Setup explicitly incomplete, redirecting to initial setup');
				goto('/auth/signup');
				return;
			}
		} catch (error) {
			console.error('🏠 [LANDING] Error checking setup status:', error);
			// On error, don't redirect - let the user access the landing page
		} finally {
			checkingUserCount = false;
		}
	}

	onMount(() => {
		console.log('🏠 [LANDING] Page mounted');

		// Initialize theme
		initializeTheme();

		// Get current theme from localStorage or system preference
		if (browser) {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
			if (savedTheme) {
				currentTheme = savedTheme;
			} else {
				const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
				currentTheme = prefersDark ? 'dark' : 'light';
			}
		}

		// Check setup status first to see if initial setup is needed
		checkSetupStatus();

		// Subscribe to user store for real-time updates
		const unsubscribe = userStore.subscribe((user) => {
			console.log('🏠 [LANDING] User state:', user ? `Logged in - ${user.email}` : 'Not logged in');
			console.log('🏠 [LANDING] User store value:', user);
		});

		// Also subscribe to session store for additional auth state tracking
		const sessionUnsubscribe = sessionStore.subscribe((session) => {
			console.log('🏠 [LANDING] Session state:', session ? 'session present' : 'no session');
			console.log('🏠 [LANDING] Session store value:', session);
		});

		return () => {
			unsubscribe();
			sessionUnsubscribe();
		};
	});

	function handleThemeChange(theme: 'light' | 'dark') {
		setTheme(theme);
		currentTheme = theme;
	}
</script>

<svelte:head>
	<title>{t('wayli')} - {t('wayliSubtitle')}</title>
</svelte:head>

<!-- Loading State -->
{#if !messagesLoaded || checkingUserCount}
	<div
		class="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900"
	>
		<div class="text-center">
			<div
				class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"
			></div>
			<p class="text-gray-600 dark:text-gray-300">
				{checkingUserCount ? 'Checking system status...' : 'Loading translations...'}
			</p>
		</div>
	</div>
{:else}
	<!-- Theme Toggle, Language Selector, and User/Login Button in Top Right -->
	<div class="fixed top-4 right-4 z-50 flex items-center gap-3">
		<!-- Language Selector -->
		<LanguageSelector variant="minimal" size="sm" showLabel={false} position="bottom-right" />

		<!-- Theme Toggle -->
		<div class="flex gap-2">
			<button
				onclick={() => handleThemeChange('light')}
				class="cursor-pointer rounded-lg p-2 font-medium transition-colors {currentTheme === 'light'
					? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
				title={t('landing.lightMode')}
			>
				<Sun class="h-4 w-4" />
			</button>
			<button
				onclick={() => handleThemeChange('dark')}
				class="cursor-pointer rounded-lg p-2 font-medium transition-colors {currentTheme === 'dark'
					? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
				title={t('landing.darkMode')}
			>
				<Moon class="h-4 w-4" />
			</button>
		</div>

		{#if $userStore && $userStore.email}
			<!-- User Menu -->
			<div class="group relative">
				<a
					href="/dashboard/statistics"
					class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-gray-700 shadow-lg transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					<User class="h-4 w-4" />
					{($userStore.email?.split('@')[0] || 'User').charAt(0).toUpperCase() +
						($userStore.email?.split('@')[0] || 'User').slice(1)}
				</a>

				<!-- Dropdown Menu -->
				<div
					class="invisible absolute top-full right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white opacity-0 shadow-lg transition-all duration-200 group-hover:visible group-hover:opacity-100 dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="py-2">
						<a
							href="/dashboard/statistics"
							class="block cursor-pointer px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							{t('common.navigation.dashboard')}
						</a>
						<a
							href="/dashboard/account-settings"
							class="block cursor-pointer px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							{t('common.navigation.accountSettings')}
						</a>
						<hr class="my-2 border-gray-200 dark:border-gray-700" />
						<button
							onclick={handleSignOut}
							class="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-gray-50 dark:text-red-400 dark:hover:bg-gray-700"
						>
							<LogOut class="h-4 w-4" />
							{t('common.navigation.signOut')}
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Login Button -->
			<button
				onclick={handleLogin}
				class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[rgb(37,140,244)] px-4 py-2 font-medium text-white shadow-lg transition-colors hover:bg-[rgb(37,140,244)]/90"
			>
				<LogIn class="h-4 w-4" />
				{t('landing.login')}
			</button>
		{/if}
	</div>

	<!-- Hero Section -->
	<div
		class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 transition-colors duration-300 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900"
	>
		<div class="container mx-auto px-4 py-16">
			<!-- Hero Content -->
			<div class="mx-auto mb-16 max-w-4xl text-center">
				<!-- Logo Icon -->
				<div class="mx-auto mb-6 flex justify-center">
					<Navigation class="h-24 w-24 text-[rgb(37,140,244)] md:h-32 md:w-32" />
				</div>
				<h1
					class="mb-6 text-5xl font-bold text-gray-900 transition-colors duration-300 md:text-7xl dark:text-gray-100"
				>
					<span class="text-[rgb(37,140,244)]">Wayli</span>
				</h1>
				<p
					class="mb-4 text-2xl font-semibold text-gray-800 transition-colors duration-300 md:text-3xl dark:text-gray-200"
				>
					{t('landing.yourPersonalTracker')}
				</p>
				<p
					class="mb-8 text-lg leading-relaxed text-gray-600 transition-colors duration-300 md:text-xl dark:text-gray-400"
				>
					{t('landing.selfHostedTagline')}
				</p>
				<div class="flex flex-col justify-center gap-4 sm:flex-row">
					<a
						href="/auth/signup"
						class="inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 border-gray-300 px-8 py-4 font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						{t('landing.getStarted')}
						<ArrowRight class="h-5 w-5" />
					</a>
					<a
						href="/auth/signin"
						class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[rgb(37,140,244)] px-8 py-4 font-semibold text-white shadow-lg transition-colors hover:bg-[rgb(37,140,244)]/90"
					>
						{t('landing.signIn')}
					</a>
				</div>
			</div>

			<!-- Features Grid -->
			<div class="mb-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
				<!-- Feature 1: Privacy First -->
				<div
					class="rounded-xl border border-gray-200/50 bg-white/50 p-6 text-center backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg dark:border-gray-700/50 dark:bg-gray-800/50"
				>
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 transition-colors duration-300 dark:bg-blue-900/20"
					>
						<Shield class="h-8 w-8 text-blue-600 dark:text-blue-400" />
					</div>
					<h3
						class="mb-2 text-xl font-semibold text-gray-900 transition-colors duration-300 dark:text-gray-100"
					>
						{t('landing.privacyFirst')}
					</h3>
					<p class="text-sm text-gray-600 transition-colors duration-300 dark:text-gray-400">
						{t('landing.privacyFirstDescription')}
					</p>
				</div>

				<!-- Feature 2: Automatic Trip Detection -->
				<div
					class="rounded-xl border border-gray-200/50 bg-white/50 p-6 text-center backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg dark:border-gray-700/50 dark:bg-gray-800/50"
				>
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 transition-colors duration-300 dark:bg-green-900/20"
					>
						<MapPin class="h-8 w-8 text-green-600 dark:text-green-400" />
					</div>
					<h3
						class="mb-2 text-xl font-semibold text-gray-900 transition-colors duration-300 dark:text-gray-100"
					>
						{t('landing.automaticTripDetection')}
					</h3>
					<p class="text-sm text-gray-600 transition-colors duration-300 dark:text-gray-400">
						{t('landing.automaticTripDescription')}
					</p>
				</div>

				<!-- Feature 3: Beautiful Analytics -->
				<div
					class="rounded-xl border border-gray-200/50 bg-white/50 p-6 text-center backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg dark:border-gray-700/50 dark:bg-gray-800/50"
				>
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-100 transition-colors duration-300 dark:bg-purple-900/20"
					>
						<BarChart class="h-8 w-8 text-purple-600 dark:text-purple-400" />
					</div>
					<h3
						class="mb-2 text-xl font-semibold text-gray-900 transition-colors duration-300 dark:text-gray-100"
					>
						{t('landing.beautifulAnalytics')}
					</h3>
					<p class="text-sm text-gray-600 transition-colors duration-300 dark:text-gray-400">
						{t('landing.beautifulAnalyticsDescription')}
					</p>
				</div>

				<!-- Feature 4: Multi-User Support -->
				<div
					class="rounded-xl border border-gray-200/50 bg-white/50 p-6 text-center backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg dark:border-gray-700/50 dark:bg-gray-800/50"
				>
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 transition-colors duration-300 dark:bg-orange-900/20"
					>
						<Users class="h-8 w-8 text-orange-600 dark:text-orange-400" />
					</div>
					<h3
						class="mb-2 text-xl font-semibold text-gray-900 transition-colors duration-300 dark:text-gray-100"
					>
						{t('landing.multiUserSupport')}
					</h3>
					<p class="text-sm text-gray-600 transition-colors duration-300 dark:text-gray-400">
						{t('landing.multiUserDescription')}
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}
