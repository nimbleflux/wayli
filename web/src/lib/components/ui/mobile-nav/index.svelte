<script lang="ts">
	import { onMount } from 'svelte';
	import { Menu, X, ChevronDown } from 'lucide-svelte';

	import { FocusManager, keyboardNavigation } from '$lib/accessibility/accessibility-utils';

	export let items: Array<{
		label: string;
		href?: string;
		icon?: any;
		children?: Array<{ label: string; href: string; icon?: any }>;
		action?: () => void;
	}> = [];
	export let className: string = '';
	export let onToggle: ((data: { isOpen: boolean }) => void) | undefined = undefined;
	export let onClose: (() => void) | undefined = undefined;

	let isOpen = false;
	let activeDropdown: number | null = null;
	let navElement: HTMLElement;
	let focusManager: FocusManager;

	onMount(() => {
		if (navElement) {
			focusManager = new FocusManager(navElement);
		}
	});

	function toggleMenu() {
		isOpen = !isOpen;
		if (isOpen) {
			// Focus first menu item when opening
			setTimeout(() => {
				focusManager?.focusFirst();
			}, 100);
		}
		if (onToggle) {
			onToggle({ isOpen });
		}
	}

	function closeMenu() {
		isOpen = false;
		activeDropdown = null;
		if (onClose) {
			onClose();
		}
	}

	function toggleDropdown(index: number) {
		activeDropdown = activeDropdown === index ? null : index;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen) return;

		keyboardNavigation.handleEscape(event, closeMenu);

		if (event.key === 'Tab' && !event.shiftKey) {
			// Allow normal tab navigation within menu
			return;
		}
	}

	function handleItemClick(item: {
		label: string;
		href?: string;
		icon?: any;
		children?: Array<{ label: string; href: string; icon?: any }>;
		action?: () => void;
	}) {
		if (item.action) {
			item.action();
		}
		closeMenu();
	}
</script>

<nav bind:this={navElement} class={className}>
	<!-- Mobile Menu Button -->
	<button
		class="min-h-[44px] min-w-[44px] rounded-md p-2 text-gray-400 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-[rgb(34,51,95)] focus-visible:ring-offset-2 focus-visible:outline-none md:hidden dark:hover:text-gray-300"
		onclick={toggleMenu}
		aria-expanded={isOpen}
		aria-controls="mobile-menu"
		aria-label="Toggle navigation menu"
	>
		{#if isOpen}
			<X class="h-6 w-6" />
		{:else}
			<Menu class="h-6 w-6" />
		{/if}
	</button>

	<!-- Mobile Menu Overlay -->
	{#if isOpen}
		<div
			class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden"
			onclick={closeMenu}
			role="presentation"
			aria-hidden="true"
		></div>
	{/if}

	<!-- Mobile Menu Content -->
	{#if isOpen}
		<div
			id="mobile-menu"
			class="fixed inset-y-0 right-0 z-50 w-80 transform bg-white shadow-xl transition-transform duration-300 ease-in-out md:hidden dark:bg-gray-800"
			role="dialog"
			aria-modal="true"
			aria-labelledby="mobile-menu-title"
		>
			<div class="flex h-full flex-col">
				<!-- Header -->
				<div
					class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700"
				>
					<h2 id="mobile-menu-title" class="text-lg font-semibold text-gray-900 dark:text-gray-100">
						Navigation
					</h2>
					<button
						class="min-h-[44px] min-w-[44px] rounded-md p-2 text-gray-400 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-[rgb(34,51,95)] focus-visible:ring-offset-2 focus-visible:outline-none dark:hover:text-gray-300"
						onclick={closeMenu}
						aria-label="Close navigation menu"
					>
						<X class="h-6 w-6" />
					</button>
				</div>

				<!-- Menu Items -->
				<div class="flex-1 space-y-2 overflow-y-auto p-4">
					{#each items as item, index (item.label + index)}
						<div class="space-y-1">
							{#if item.href}
								<a
									href={item.href}
									class="flex min-h-[44px] w-full items-center rounded-lg px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-[rgb(34,51,95)] focus-visible:ring-offset-2 focus-visible:outline-none dark:text-gray-300 dark:hover:bg-gray-700"
									onclick={closeMenu}
								>
									{#if item.icon}
										<svelte:component this={item.icon} class="mr-3 h-5 w-5" />
									{/if}
									{item.label}
								</a>
							{:else if item.children}
								<button
									class="flex min-h-[44px] w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-[rgb(34,51,95)] focus-visible:ring-offset-2 focus-visible:outline-none dark:text-gray-300 dark:hover:bg-gray-700"
									onclick={() => toggleDropdown(index)}
									aria-expanded={activeDropdown === index}
									aria-controls="dropdown-{index}"
								>
									<div class="flex items-center">
										{#if item.icon}
											<svelte:component this={item.icon} class="mr-3 h-5 w-5" />
										{/if}
										{item.label}
									</div>
									<ChevronDown
										class="h-4 w-4 transition-transform {activeDropdown === index
											? 'rotate-180'
											: ''}"
									/>
								</button>
								{#if activeDropdown === index}
									<div id="dropdown-{index}" class="ml-4 space-y-1">
										{#each item.children as child (child.label)}
											<a
												href={child.href}
												class="flex min-h-[44px] w-full items-center rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-[rgb(34,51,95)] focus-visible:ring-offset-2 focus-visible:outline-none dark:text-gray-400 dark:hover:bg-gray-700"
												onclick={closeMenu}
											>
												{#if child.icon}
													<svelte:component this={child.icon} class="mr-3 h-4 w-4" />
												{/if}
												{child.label}
											</a>
										{/each}
									</div>
								{/if}
							{:else if item.action}
								<button
									class="flex min-h-[44px] w-full items-center rounded-lg px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-[rgb(34,51,95)] focus-visible:ring-offset-2 focus-visible:outline-none dark:text-gray-300 dark:hover:bg-gray-700"
									onclick={() => handleItemClick(item)}
								>
									{#if item.icon}
										<svelte:component this={item.icon} class="mr-3 h-5 w-5" />
									{/if}
									{item.label}
								</button>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</nav>

<svelte:window onkeydown={handleKeydown} />
