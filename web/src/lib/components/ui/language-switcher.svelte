<!-- src/lib/components/ui/language-switcher.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { ChevronDown, Globe } from 'lucide-svelte';

	import { currentLocale, SUPPORTED_LOCALES, type SupportedLocale } from '$lib/i18n';

	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let showLabel = true;
	export let onChange: ((data: { locale: SupportedLocale }) => void) | undefined = undefined;

	let isOpen = false;
	let buttonElement: HTMLButtonElement;
	let dropdownElement: HTMLDivElement;

	const localeNames: Record<SupportedLocale, string> = {
		en: 'English',
		nl: 'Nederlands',
		es: 'Español'
	};

	const localeFlags: Record<SupportedLocale, string> = {
		en: '🇺🇸',
		nl: '🇳🇱',
		es: '🇪🇸'
	};

	function toggleDropdown() {
		isOpen = !isOpen;
	}

	function selectLocale(locale: SupportedLocale) {
		currentLocale.set(locale);
		isOpen = false;
		if (onChange) {
			onChange({ locale });
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			isOpen = false;
		}
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if (
			buttonElement &&
			dropdownElement &&
			!buttonElement.contains(event.target as Node) &&
			!dropdownElement.contains(event.target as Node)
		) {
			isOpen = false;
		}
	}

	// Add click listener on mount and remove on destroy to prevent memory leaks
	onMount(() => {
		window.addEventListener('click', handleClickOutside);
	});

	onDestroy(() => {
		window.removeEventListener('click', handleClickOutside);
	});
</script>

<svelte:head>
	<style>
		.language-switcher {
			position: relative;
			display: inline-block;
		}

		.language-button {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			padding: 0.5rem 0.75rem;
			border: 1px solid var(--border-color, #e5e7eb);
			border-radius: 0.375rem;
			background: var(--bg-color, #ffffff);
			color: var(--text-color, #374151);
			font-size: 0.875rem;
			font-weight: 500;
			cursor: pointer;
			transition: all 0.2s ease;
		}

		.language-button:hover {
			background: var(--hover-bg-color, #f9fafb);
			border-color: var(--hover-border-color, #d1d5db);
		}

		.language-button:focus {
			outline: 2px solid var(--focus-color, #3b82f6);
			outline-offset: 2px;
		}

		.language-button:active {
			background: var(--active-bg-color, #f3f4f6);
			border-color: var(--active-border-color, #9ca3af);
		}

		.dropdown {
			position: absolute;
			top: 100%;
			left: 0;
			right: 0;
			margin-top: 0.25rem;
			background: var(--dropdown-bg-color, #ffffff);
			border: 1px solid var(--dropdown-border-color, #e5e7eb);
			border-radius: 0.375rem;
			box-shadow:
				0 10px 15px -3px rgba(0, 0, 0, 0.1),
				0 4px 6px -2px rgba(0, 0, 0, 0.05);
			z-index: 50;
			display: none;
		}

		.dropdown[data-visible='true'] {
			display: block;
		}

		.locale-option {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			width: 100%;
			padding: 0.5rem 0.75rem;
			border: none;
			background: transparent;
			color: var(--option-text-color, #374151);
			font-size: 0.875rem;
			cursor: pointer;
			transition: background-color 0.15s ease;
		}

		.locale-option:hover {
			background: var(--option-hover-bg-color, #f9fafb);
		}

		.locale-option[aria-selected='true'] {
			background: var(--option-selected-bg-color, #dbeafe);
			color: var(--option-selected-text-color, #1e40af);
		}

		.locale-flag {
			font-size: 1rem;
			line-height: 1;
		}

		.locale-name {
			flex: 1;
			text-align: left;
		}

		.chevron {
			transition: transform 0.2s ease;
		}

		.chevron[data-expanded='true'] {
			transform: rotate(180deg);
		}

		/* Size variants */
		.size-sm .language-button {
			padding: 0.375rem 0.5rem;
			font-size: 0.75rem;
		}

		.size-lg .language-button {
			padding: 0.75rem 1rem;
			font-size: 1rem;
		}

		/* Dark mode support */
		@media (prefers-color-scheme: dark) {
			.language-button {
				--border-color: #374151;
				--bg-color: #1f2937;
				--text-color: #f9fafb;
				--hover-bg-color: #374151;
				--hover-border-color: #4b5563;
				--active-bg-color: #4b5563;
				--active-border-color: #6b7280;
				--focus-color: #60a5fa;
			}

			.dropdown {
				--dropdown-bg-color: #1f2937;
				--dropdown-border-color: #374151;
			}

			.locale-option {
				--option-text-color: #f9fafb;
				--option-hover-bg-color: #374151;
				--option-selected-bg-color: #1e40af;
				--option-selected-text-color: #93c5fd;
			}
		}
	</style>
</svelte:head>

<div class="language-switcher size-{size}" role="application">
	<button
		bind:this={buttonElement}
		class="language-button"
		onclick={toggleDropdown}
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		aria-controls="language-dropdown"
	>
		<Globe size={size === 'sm' ? 16 : size === 'lg' ? 20 : 18} />
		{#if showLabel}
			<span class="locale-name">
				{localeNames[$currentLocale]}
			</span>
		{/if}
		<ChevronDown
			size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16}
			class="chevron"
			data-expanded={isOpen}
		/>
	</button>

	<div
		bind:this={dropdownElement}
		id="language-dropdown"
		class="dropdown"
		data-visible={isOpen}
		role="listbox"
		aria-label="Select language"
	>
		{#each SUPPORTED_LOCALES as locale (locale)}
			<button
				class="locale-option"
				role="option"
				aria-selected={locale === $currentLocale}
				onclick={() => selectLocale(locale)}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						selectLocale(locale);
					}
				}}
			>
				<span class="locale-flag" aria-hidden="true">
					{localeFlags[locale]}
				</span>
				<span class="locale-name">
					{localeNames[locale]}
				</span>
			</button>
		{/each}
	</div>
</div>
