<!-- src/lib/components/ui/language-selector/index.svelte -->
<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';

	import { currentLocale, changeLocale, type SupportedLocale } from '$lib/i18n';

	// Props
	interface Props {
		size?: 'sm' | 'md' | 'lg';
		variant?: 'default' | 'minimal' | 'button';
		showLabel?: boolean;
		position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
		onChange?: (data: { locale: SupportedLocale }) => void;
	}

	let {
		size = 'md',
		variant = 'default',
		showLabel = true,
		position = 'bottom-left',
		onChange
	}: Props = $props();

	// Dropdown state
	let isOpen = $state(false);
	let dropdownElement: HTMLDivElement | undefined;

	// Language configuration with flags and names
	const languages = [
		{
			code: 'en' as SupportedLocale,
			name: 'English',
			flag: '🇺🇸'
		},
		{
			code: 'nl' as SupportedLocale,
			name: 'Nederlands',
			flag: '🇳🇱'
		},
		{
			code: 'es' as SupportedLocale,
			name: 'Español',
			flag: '🇪🇸'
		},
		{
			code: 'de' as SupportedLocale,
			name: 'Deutsch',
			flag: '🇩🇪'
		},
		{
			code: 'fr' as SupportedLocale,
			name: 'Français',
			flag: '🇫🇷'
		},
		{
			code: 'it' as SupportedLocale,
			name: 'Italiano',
			flag: '🇮🇹'
		},
		{
			code: 'ja' as SupportedLocale,
			name: '日本語',
			flag: '🇯🇵'
		},
		{
			code: 'ko' as SupportedLocale,
			name: '한국어',
			flag: '🇰🇷'
		},
		{
			code: 'pt' as SupportedLocale,
			name: 'Português',
			flag: '🇧🇷'
		},
		{
			code: 'ru' as SupportedLocale,
			name: 'Русский',
			flag: '🇷🇺'
		},
		{
			code: 'zh' as SupportedLocale,
			name: '中文',
			flag: '🇨🇳'
		}
	] as const;

	// Get current language info
	let currentLanguage = $derived(
		languages.find((lang) => lang.code === $currentLocale) || languages[0]
	);

	// Handle language change
	async function handleLanguageChange(locale: SupportedLocale) {
		try {
			await changeLocale(locale);
			if (onChange) {
				onChange({ locale });
			}
			isOpen = false;
		} catch (error) {
			console.error('❌ [LanguageSelector] Failed to change language:', error);
		}
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	// Close on escape key
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			isOpen = false;
		}
	}

	// Size classes
	const sizeClasses = {
		sm: 'px-2 py-1 text-sm',
		md: 'px-3 py-2 text-sm',
		lg: 'px-4 py-3 text-base'
	};

	// Variant classes
	const variantClasses = {
		default:
			'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700',
		minimal: 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
		button: 'bg-primary hover:bg-primary/90 text-white border-0'
	};

	// Position classes for dropdown
	const positionClasses = {
		'bottom-left': 'top-full left-0 mt-1',
		'bottom-right': 'top-full right-0 mt-1',
		'top-left': 'bottom-full left-0 mb-1',
		'top-right': 'bottom-full right-0 mb-1'
	};
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="relative inline-block" bind:this={dropdownElement}>
	<!-- Trigger Button -->
	<button
		type="button"
		onclick={() => (isOpen = !isOpen)}
		class="flex items-center gap-2 rounded-lg font-medium transition-all duration-200 focus:ring-2 focus:ring-[rgb(34,51,95)] focus:ring-offset-1 focus:outline-none {sizeClasses[
			size
		]} {variantClasses[variant]} {variant === 'button'
			? 'text-white'
			: 'text-gray-700 dark:text-gray-200'}"
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		aria-label="Select language"
	>
		<!-- Flag -->
		<span class="text-lg leading-none">{currentLanguage.flag}</span>

		<!-- Language name (optional) -->
		{#if showLabel}
			<span class="hidden sm:inline">{currentLanguage.name}</span>
		{/if}

		<!-- Chevron -->
		<ChevronDown
			class="h-4 w-4 transition-transform duration-200 {isOpen ? 'rotate-180' : ''} {variant ===
			'button'
				? 'text-white'
				: 'text-gray-500 dark:text-gray-400'}"
		/>
	</button>

	<!-- Dropdown Menu -->
	{#if isOpen}
		<div
			class="absolute z-50 w-48 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 {positionClasses[
				position
			]}"
			role="listbox"
			aria-label="Language options"
		>
			<div class="py-1">
				{#each languages as language (language.code)}
					<button
						type="button"
						onclick={() => handleLanguageChange(language.code)}
						class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 {language.code ===
						$currentLocale
							? 'bg-primary/5 text-primary dark:bg-primary/20 dark:text-gray-300'
							: 'text-gray-700 dark:text-gray-200'}"
						role="option"
						aria-selected={language.code === $currentLocale}
					>
						<!-- Flag -->
						<span class="text-lg leading-none">{language.flag}</span>

						<!-- Language name -->
						<span class="flex-1">{language.name}</span>

						<!-- Check mark for current language -->
						{#if language.code === $currentLocale}
							<span class="text-primary dark:text-gray-300">✓</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
