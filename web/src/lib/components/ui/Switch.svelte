<!-- src/lib/components/ui/Switch.svelte -->
<script lang="ts">
	interface Props {
		checked: boolean;
		onchange?: (checked: boolean) => void;
		disabled?: boolean;
		label?: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let {
		checked = $bindable(false),
		onchange,
		disabled = false,
		label,
		description,
		size = 'md'
	}: Props = $props();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		if (onchange) {
			onchange(checked);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			toggle();
		}
	}

	// Size classes
	const sizeClasses = {
		sm: {
			container: 'h-5 w-9',
			toggle: 'h-4 w-4',
			translate: 'translate-x-4'
		},
		md: {
			container: 'h-6 w-11',
			toggle: 'h-5 w-5',
			translate: 'translate-x-5'
		},
		lg: {
			container: 'h-7 w-14',
			toggle: 'h-6 w-6',
			translate: 'translate-x-7'
		}
	};

	const classes = $derived(sizeClasses[size]);
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	disabled={disabled}
	onclick={toggle}
	onkeydown={handleKeydown}
	class="relative inline-flex {classes.container} flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[rgb(34,51,95)] focus:ring-offset-2 dark:focus:ring-offset-gray-900 {checked
		? 'bg-[rgb(34,51,95)]'
		: 'bg-gray-200 dark:bg-gray-700'} {disabled ? 'cursor-not-allowed opacity-50' : ''}"
>
	<span class="sr-only">{label || 'Toggle'}</span>
	<span
		aria-hidden="true"
		class="pointer-events-none inline-block {classes.toggle} transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out {checked
			? classes.translate
			: 'translate-x-0'}"
	>
	</span>
</button>
