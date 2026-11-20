<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { fade, fly } from 'svelte/transition';
	import { ChevronDown, Crown, LogOut, Settings, User, UserRound, X } from 'lucide-svelte';

	import { translate } from '$lib/i18n';
	import { userStore } from '$lib/stores/auth';
	import { page } from '$app/state';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';

	let {
		isAdmin = false,
		onSignout
	}: {
		isAdmin?: boolean;
		onSignout?: () => void;
	} = $props();

	let t = $derived($translate);

	let open = $state(false);
	let panelEl = $state<HTMLDivElement | null>(null);
	let buttonEl = $state<HTMLButtonElement | null>(null);

	// Detect mobile for sheet vs. popover rendering.
	let isMobile = $state(false);
	function updateMobile() {
		isMobile = window.matchMedia('(max-width: 767px)').matches;
	}

	onMount(() => {
		updateMobile();
		window.addEventListener('resize', updateMobile);
		document.addEventListener('click', handleDocClick);
	});

	onDestroy(() => {
		if (!browser) return;
		window.removeEventListener('resize', updateMobile);
		document.removeEventListener('click', handleDocClick);
	});

	function handleDocClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (panelEl && panelEl.contains(target)) return;
		if (buttonEl && buttonEl.contains(target)) return;
		open = false;
	}

	function togglePanel() {
		open = !open;
	}

	function close() {
		open = false;
	}

	// Prefer first_name for the menu header; fall back to full_name, then email
	// local-part, so the open menu shows a name (not the raw email) when set.
	const displayName = $derived(
		$userStore?.first_name || $userStore?.full_name || $userStore?.email || 'User'
	);
	const displayEmail = $derived($userStore?.email || '');

	function isActive(href: string): boolean {
		return page.url.pathname === href;
	}
</script>

<div class="relative">
	<!-- Avatar button -->
	<button
		bind:this={buttonEl}
		onclick={togglePanel}
		class="hover:bg-muted flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-1 rounded-full p-1 transition-colors"
		title={displayName}
		aria-label={t('common.navigation.accountSettings')}
	>
		<UserAvatar user={$userStore} size="sm" />
		<ChevronDown class="text-muted-foreground h-4 w-4 shrink-0" />
	</button>
</div>

{#if open}
	<!-- Mobile: bottom sheet backdrop -->
	{#if isMobile}
		<button
			class="fixed inset-0 z-40 bg-black/50 md:hidden"
			aria-label="Close menu"
			onclick={close}
			transition:fade
		></button>

		<div
			class="bg-card fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t shadow-2xl md:hidden"
			transition:fly={{ y: 300, duration: 200 }}
		>
			<div class="bg-muted mx-auto mt-2 h-1.5 w-10 rounded-full"></div>
			{@render menuContent(true)}
		</div>
	{:else}
		<!-- Desktop: dropdown fixed to viewport top-right (never clipped) -->
		<div
			bind:this={panelEl}
			class="bg-card border-border fixed top-16 right-4 z-50 w-72 origin-top-right rounded-xl border shadow-2xl"
			transition:fly={{ y: -8, duration: 150 }}
		>
			{@render menuContent(false)}
		</div>
	{/if}
{/if}

{#snippet menuContent(isSheet: boolean)}
	<div class="flex items-center justify-between border-b p-4">
		<div class="flex min-w-0 items-center gap-3">
			<UserAvatar user={$userStore} size="sm" />
			<div class="min-w-0">
				<p class="text-foreground truncate text-sm font-semibold">{displayName}</p>
				{#if displayEmail && displayEmail !== displayName}
					<p class="text-muted-foreground truncate text-xs">{displayEmail}</p>
				{/if}
			</div>
		</div>
		{#if isSheet}
			<button
				onclick={close}
				class="text-muted-foreground hover:text-foreground rounded-md p-1"
				aria-label="Close"
			>
				<X class="h-5 w-5" />
			</button>
		{/if}
	</div>

	<div class="p-2">
		{#if $userStore?.username}
			<a
				href="/u/{$userStore.username}"
				onclick={close}
				class="hover:bg-muted flex items-center gap-3 rounded-lg p-2 text-sm {isActive(
					`/u/${$userStore.username}`
				)
					? 'bg-primary/10 text-primary'
					: 'text-foreground'}"
			>
				<UserRound class="h-4 w-4 shrink-0" />
				{t('common.navigation.profile')}
			</a>
		{/if}
		<a
			href="/dashboard/account-settings"
			onclick={close}
			class="hover:bg-muted flex items-center gap-3 rounded-lg p-2 text-sm {isActive(
				'/dashboard/account-settings'
			)
				? 'bg-primary/10 text-primary'
				: 'text-foreground'}"
		>
			<User class="h-4 w-4 shrink-0" />
			{t('common.navigation.accountSettings')}
		</a>
		{#if isAdmin}
			<a
				href="/dashboard/server-admin-settings"
				onclick={close}
				class="hover:bg-muted mt-1 flex items-center gap-3 rounded-lg p-2 text-sm {isActive(
					'/dashboard/server-admin-settings'
				)
					? 'bg-primary/10 text-primary'
					: 'text-foreground'}"
			>
				<Settings class="h-4 w-4 shrink-0" />
				<span class="flex items-center gap-1.5">
					{t('common.navigation.serverAdminSettings')}
					<Crown class="h-3.5 w-3.5 text-yellow-500" />
				</span>
			</a>
		{/if}
	</div>

	<div class="border-border border-t p-2">
		<button
			onclick={() => {
				close();
				onSignout?.();
			}}
			class="text-destructive hover:bg-destructive/10 flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm font-medium"
		>
			<LogOut class="h-4 w-4 shrink-0" />
			{t('common.navigation.signOut')}
		</button>
	</div>
{/snippet}
