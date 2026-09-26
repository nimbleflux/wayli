<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { Sun, Moon, ArrowLeft, Users, User } from 'lucide-svelte';
	import LanguageSelector from '$lib/components/ui/language-selector/index.svelte';
	import { translate } from '$lib/i18n';
	import { setTheme, initializeTheme } from '$lib/stores/app-state.svelte';
	import { loadPublicSettings, getSetting } from '$lib/stores/settings.svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { loadTravelers, type CommunityTraveler } from '$lib/services/community.service';
	import { userStore } from '$lib/stores/auth';

	let t = $derived($translate);
	let currentTheme = $state<'light' | 'dark'>('light');
	let travelers = $state<CommunityTraveler[]>([]);
	let isLoading = $state(true);
	let currentUserId = $state<string | null>(null);

	onMount(() => {
		initializeTheme();
		if (browser) {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
			currentTheme =
				savedTheme ??
				(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		}

		(async () => {
			// Get current user (nullable — works for anon).
			try {
				const { data: session } = await fluxbase.auth.getSession();
				currentUserId = (session as any)?.session?.user?.id ?? null;
			} catch {
				currentUserId = null;
			}

			// Honor the public_trips_require_auth gate (from the bulk settings store).
			await loadPublicSettings();
			const setting = getSetting<unknown>('wayli.public_trips_require_auth', null);
			const requireAuth =
				setting === true ||
				setting === 'true' ||
				(typeof setting === 'object' && setting && (setting as any).value === true);
			if (requireAuth && !currentUserId) {
				goto(`/auth/signin?redirectTo=/travelers`);
				return;
			}

			try {
				travelers = await loadTravelers(currentUserId, 48);
			} catch (err) {
				console.error('Failed to load travelers:', err);
			} finally {
				isLoading = false;
			}
		})();
	});

	function handleThemeChange(theme: 'light' | 'dark') {
		setTheme(theme);
		currentTheme = theme;
	}
</script>

<svelte:head>
	<title>{t('travelersPage.title')} · Wayli</title>
</svelte:head>

<div class="bg-background min-h-screen">
	<!-- Floating top bar — matches landing page pill -->
	<div
		class="bg-background/80 border-border fixed top-4 right-4 z-40 flex items-center gap-2 rounded-full border px-2 py-1 shadow-sm backdrop-blur-md"
	>
		<a
			href="/"
			class="text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
		>
			<ArrowLeft class="h-4 w-4" />
			{t('profile.home')}
		</a>
		<div class="flex gap-1">
			<button
				onclick={() => handleThemeChange('light')}
				class="cursor-pointer rounded-lg p-2 transition-colors {currentTheme === 'light'
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground hover:bg-muted'}"
			>
				<Sun class="h-4 w-4" />
			</button>
			<button
				onclick={() => handleThemeChange('dark')}
				class="cursor-pointer rounded-lg p-2 transition-colors {currentTheme === 'dark'
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground hover:bg-muted'}"
			>
				<Moon class="h-4 w-4" />
			</button>
		</div>
		<LanguageSelector variant="minimal" size="sm" showLabel={false} position="bottom-left" />
		{#if $userStore}
			<a
				href="/dashboard/account-settings"
				class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex max-w-[10rem] items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
			>
				<User class="h-4 w-4 shrink-0" />
				<span class="truncate">{t('common.navigation.accountSettings')}</span>
			</a>
		{:else}
			<a
				href="/auth/signin"
				class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
			>
				<User class="h-4 w-4" />
				{t('auth.signIn')}
			</a>
		{/if}
	</div>

	<!-- Hero -->
	<div class="relative h-[280px] w-full overflow-hidden">
		<div
			class="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-500 dark:from-slate-900 dark:via-slate-800 dark:to-slate-600"
		></div>
		<div
			class="bg-primary/20 absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full blur-3xl"
		></div>
		<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/30"></div>
		<div
			class="relative mx-auto flex h-full max-w-6xl flex-col items-center justify-center px-4 text-center"
		>
			<Users class="mb-3 h-10 w-10 text-white/80" />
			<h1 class="text-3xl font-extrabold tracking-tight text-white drop-shadow-lg sm:text-4xl">
				{t('travelersPage.title')}
			</h1>
			<p class="mt-2 max-w-xl text-sm text-white/70 sm:text-base">
				{t('travelersPage.subtitle')}
			</p>
		</div>
	</div>

	<!-- Content -->
	<div class="mx-auto max-w-6xl px-4 py-8">
		{#if isLoading}
			<div class="flex items-center justify-center py-20">
				<div class="border-primary h-8 w-8 animate-spin rounded-full border-2"></div>
			</div>
		{:else if travelers.length === 0}
			<div
				class="text-muted-foreground flex flex-col items-center justify-center py-20 text-center"
			>
				<Users class="mb-3 h-10 w-10 opacity-40" />
				<p>{t('travelersPage.empty')}</p>
			</div>
		{:else}
			<div class="mb-6 flex items-center gap-2">
				<h2 class="text-foreground text-sm font-bold tracking-wide uppercase">
					{travelers.length}
					{travelers.length === 1 ? t('common.traveler') : t('common.travelers')}
				</h2>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each travelers as traveler (traveler.id)}
					<a
						href="/u/{traveler.username}"
						class="bg-card border-border flex items-center gap-3 rounded-2xl border p-4 transition-all hover:shadow-lg"
					>
						{#if traveler.avatar_url}
							<img
								src={storageRefToUrl(traveler.avatar_url)}
								alt=""
								class="h-12 w-12 rounded-full object-cover"
							/>
						{:else}
							<div
								class="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold"
							>
								{traveler.username[0]?.toUpperCase()}
							</div>
						{/if}
						<div>
							<p class="text-foreground font-medium">@{traveler.username}</p>
							<p class="text-muted-foreground text-xs">
								{traveler.full_name ?? ''}
							</p>
							<p class="text-muted-foreground text-xs">
								{traveler.trip_count}
								{traveler.trip_count === 1 ? t('common.trip') : t('common.trips')}
							</p>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
