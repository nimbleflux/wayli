<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { Sun, Moon, ArrowLeft, BookOpen, Calendar, User, Loader2 } from 'lucide-svelte';
	import LanguageSelector from '$lib/components/ui/language-selector/index.svelte';
	import { translate } from '$lib/i18n';
	import { setTheme, initializeTheme } from '$lib/stores/app-state.svelte';
	import { loadPublicSettings, getSetting } from '$lib/stores/settings.svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { loadStories, type CommunityStory } from '$lib/services/community.service';
	import { userStore } from '$lib/stores/auth';

	let t = $derived($translate);
	let currentTheme = $state<'light' | 'dark'>('light');
	let stories = $state<CommunityStory[]>([]);
	let isLoading = $state(true);
	let isLoadingMore = $state(false);
	let hasMore = $state(false);
	let currentUserId = $state<string | null>(null);
	const PAGE_SIZE = 12;

	// Infinite scroll sentinel
	let scrollSentinel = $state<HTMLDivElement | null>(null);
	let observer: IntersectionObserver | null = null;

	onMount(() => {
		initializeTheme();
		if (browser) {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
			currentTheme =
				savedTheme ??
				(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
		}

		(async () => {
			try {
				const { data: session } = await fluxbase.auth.getSession();
				currentUserId = (session as any)?.session?.user?.id ?? null;
			} catch {
				currentUserId = null;
			}

			await loadPublicSettings();
			const setting = getSetting<unknown>('wayli.public_trips_require_auth', null);
			const requireAuth =
				setting === true ||
				setting === 'true' ||
				(typeof setting === 'object' && setting && (setting as any).value === true);
			if (requireAuth && !currentUserId) {
				goto(`/auth/signin?redirectTo=/stories`);
				return;
			}

			try {
				const result = await loadStories(currentUserId, PAGE_SIZE, 0);
				stories = result.stories;
				hasMore = result.hasMore;
				// Set up observer after initial data renders the sentinel.
				setTimeout(() => setupObserver(), 100);
			} catch (err) {
				console.error('Failed to load stories:', err);
			} finally {
				isLoading = false;
			}
		})();

		return () => observer?.disconnect();
	});

	function setupObserver() {
		if (!browser || !scrollSentinel) return;
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					loadMore();
				}
			},
			{ rootMargin: '300px' }
		);
		observer.observe(scrollSentinel);
	}

	async function loadMore() {
		if (isLoadingMore || !hasMore) return;
		isLoadingMore = true;
		try {
			const result = await loadStories(currentUserId, PAGE_SIZE, stories.length);
			stories = [...stories, ...result.stories];
			hasMore = result.hasMore;
		} catch (err) {
			console.error('Failed to load more stories:', err);
		} finally {
			isLoadingMore = false;
		}
	}

	function handleThemeChange(theme: 'light' | 'dark') {
		setTheme(theme);
		currentTheme = theme;
	}
</script>

<svelte:head>
	<title>{t('storiesPage.title')} · Wayli</title>
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
			<BookOpen class="mb-3 h-10 w-10 text-white/80" />
			<h1 class="text-3xl font-extrabold tracking-tight text-white drop-shadow-lg sm:text-4xl">
				{t('storiesPage.title')}
			</h1>
			<p class="mt-2 max-w-xl text-sm text-white/70 sm:text-base">
				{t('storiesPage.subtitle')}
			</p>
		</div>
	</div>

	<!-- Content -->
	<div class="mx-auto max-w-6xl px-4 py-8">
		{#if isLoading}
			<div class="flex items-center justify-center py-20">
				<div class="border-primary h-8 w-8 animate-spin rounded-full border-2"></div>
			</div>
		{:else if stories.length === 0}
			<div
				class="text-muted-foreground flex flex-col items-center justify-center py-20 text-center"
			>
				<BookOpen class="mb-3 h-10 w-10 opacity-40" />
				<p>{t('storiesPage.empty')}</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each stories as story (story.id)}
					<a
						href={story.username ? `/u/${story.username}/trips/${story.trip_id}` : '#'}
						class="group bg-card border-border overflow-hidden rounded-2xl border transition-all hover:shadow-xl"
					>
						{#if story.trip_image_url}
							<div class="h-32 overflow-hidden">
								<img
									src={storageRefToUrl(story.trip_image_url)}
									alt={story.trip_title || ''}
									class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
									loading="lazy"
								/>
							</div>
						{/if}
						<div class="p-4">
							<div class="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
								<Calendar class="h-3 w-3" />
								{new Date(story.entry_date).toLocaleDateString(undefined, {
									month: 'long',
									day: 'numeric',
									year: 'numeric'
								})}
							</div>
							<h3 class="text-foreground mb-1 font-bold">
								{story.title || story.trip_title || 'Untitled'}
							</h3>
							{#if story.body}
								<p class="text-muted-foreground line-clamp-3 text-sm">
									{story.body
										.replace(/[#*`>\-]/g, '')
										.trim()
										.slice(0, 150)}
								</p>
							{/if}
							{#if story.username}
								<div class="text-muted-foreground/70 mt-2 text-xs">
									{t('community.by')} @{story.username}
								</div>
							{/if}
						</div>
					</a>
				{/each}
			</div>

			<!-- Infinite scroll sentinel + status -->
			{#if hasMore}
				<div bind:this={scrollSentinel} class="flex justify-center py-8">
					{#if isLoadingMore}
						<Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
					{/if}
				</div>
			{:else}
				<p class="text-muted-foreground mt-8 text-center text-sm">
					{t('storiesPage.allLoaded')}
				</p>
			{/if}
		{/if}
	</div>
</div>
