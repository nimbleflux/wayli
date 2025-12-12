<script lang="ts">
	import { onMount } from 'svelte';

	import { touchTargets, motionPreferences } from '$lib/accessibility/accessibility-utils';
	import { cn } from '$lib/utils';

	type ButtonVariants = {
		variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
		size?: 'default' | 'sm' | 'lg' | 'icon';
	};

	const buttonVariants = {
		variant: {
			default:
				'bg-primary text-white hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/80 focus-visible:ring-primary',
			destructive:
				'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 focus-visible:ring-red-500',
			outline:
				'border border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 focus-visible:ring-gray-500',
			secondary:
				'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 focus-visible:ring-gray-500',
			ghost: 'hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:ring-gray-500',
			link: 'text-primary underline-offset-4 hover:underline dark:text-gray-300 focus-visible:ring-primary'
		},
		size: {
			default: 'h-10 px-4 py-2',
			sm: 'h-9 rounded-md px-3 text-sm',
			lg: 'h-11 rounded-md px-8',
			icon: 'h-11 w-11'
		}
	};

	export let variant: ButtonVariants['variant'] = 'default';
	export let size: ButtonVariants['size'] = 'default';
	export let className: string = '';
	export let disabled = false;
	export let type: 'button' | 'submit' | 'reset' = 'button';
	export let loading = false;
	export let pressed = false;
	export let expanded = false;
	export let controls: string | undefined = undefined;
	export let describedBy: string | undefined = undefined;
	export let label: string | undefined = undefined;
	export let onClick: ((event: MouseEvent) => void) | undefined = undefined;
	export let onKeydown: ((event: KeyboardEvent) => void) | undefined = undefined;

	let buttonElement: HTMLButtonElement;

	// Ensure variant and size have valid values
	$: buttonVariant = variant || 'default';
	$: buttonSize = size || 'default';

	onMount(() => {
		if (buttonElement) {
			// Ensure minimum touch target size
			touchTargets.ensureMinSize(buttonElement);

			// Apply reduced motion preferences
			motionPreferences.applyReducedMotion(buttonElement);
		}
	});

	function handleClick(event: MouseEvent) {
		if (disabled || loading) {
			event.preventDefault();
			return;
		}
		if (onClick) {
			onClick(event);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled || loading) return;

		// Handle space and enter for activation
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			if (onClick) {
				// Create a synthetic mouse event for keyboard activation
				const syntheticEvent = new MouseEvent('click', {
					bubbles: true,
					cancelable: true,
					view: window
				});
				onClick(syntheticEvent);
			}
		}

		if (onKeydown) {
			onKeydown(event);
		}
	}
</script>

<button
	bind:this={buttonElement}
	{type}
	disabled={disabled || loading}
	aria-pressed={pressed ? 'true' : undefined}
	aria-expanded={expanded ? 'true' : undefined}
	aria-controls={controls}
	aria-describedby={describedBy}
	aria-label={label}
	onclick={handleClick}
	onkeydown={handleKeydown}
	class={cn(
		'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
		buttonVariants.variant[buttonVariant],
		buttonVariants.size[buttonSize],
		className
	)}
	{...$$restProps}
>
	{#if loading}
		<div
			class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
		></div>
	{/if}
	<slot />
</button>
