<script lang="ts">
	import { DatePicker } from '@svelte-plugins/datepicker';
	import { format } from 'date-fns';
	import { onMount, tick } from 'svelte';

	let {
		startDate = $bindable(),
		endDate = $bindable(),
		isOpen = $bindable(false),
		dateFormat = $bindable('MMM d, yyyy'),
		pickLabel = $bindable('Pick a date'),
		showClear = $bindable(true),
		onChange
	} = $props<{
		startDate?: string | Date;
		endDate?: string | Date;
		isOpen?: boolean;
		dateFormat?: string;
		pickLabel?: string;
		showClear?: boolean;
		onChange?: () => void;
	}>();

	// Detect if we should use native date picker (mobile devices)
	let useNativePicker = $state(false);

	onMount(() => {
		// Detect mobile devices
		const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		const isSmallScreen = window.innerWidth < 768;
		useNativePicker = isTouchDevice && isSmallScreen;
	});

	const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

	export function getDateFromToday(days: number) {
		return new Date(Date.now() - days * MILLISECONDS_IN_DAY);
	}

	function formatDate(date: string | Date) {
		if (!date || isNaN(new Date(date).getTime())) return '';
		return format(new Date(date), dateFormat);
	}

	function formatDateForInput(date: string | Date) {
		if (!date || isNaN(new Date(date).getTime())) return '';
		const d = new Date(date);
		return d.toISOString().split('T')[0];
	}

	const onClearDates = () => {
		startDate = '';
		endDate = '';
		if (onChange) {
			onChange();
		}
	};

	const toggleDatePicker = () => (isOpen = !isOpen);

	// The library renders its calendar as `position: absolute` right below the
	// trigger — inside modals (overflow-y-auto panels) it gets clipped or spills
	// past the dialog (#244). Flip it to `position: fixed` at viewport
	// coordinates computed from the trigger, via the library's CSS custom
	// properties. Elements with backdrop-filter/transform (modal backdrops,
	// fly transitions) become the containing block, but those boxes span the
	// viewport anyway, so fixed coordinates remain correct.
	let wrapperEl = $state<HTMLElement | undefined>(undefined);
	let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
	let dropdownVars = $state('');

	const VIEWPORT_MARGIN = 8;
	const TRIGGER_GAP = 6;
	// Rough size of the two-pane + presets calendar, used until the real
	// dropdown is measurable (first frame after open).
	const FALLBACK_WIDTH = 560;
	const FALLBACK_HEIGHT = 420;

	function positionDropdown() {
		if (!isOpen || !triggerEl || !wrapperEl) return;
		const container = wrapperEl.querySelector<HTMLElement>('.calendars-container');
		const rect = triggerEl.getBoundingClientRect();
		const width = container?.offsetWidth || FALLBACK_WIDTH;
		const height = container?.offsetHeight || FALLBACK_HEIGHT;
		let top = rect.bottom + TRIGGER_GAP;
		// Flip above the trigger when opening would push the calendar off-screen.
		if (
			top + height > window.innerHeight - VIEWPORT_MARGIN &&
			rect.top - height - TRIGGER_GAP >= VIEWPORT_MARGIN
		) {
			top = rect.top - height - TRIGGER_GAP;
		}
		top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN));
		const left = Math.max(
			VIEWPORT_MARGIN,
			Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)
		);
		dropdownVars =
			`--datepicker-container-position: fixed; ` +
			`--datepicker-container-top: ${top}px; ` +
			`--datepicker-container-left: ${left}px;`;
	}

	// Track open state: measure + position right after the calendar renders,
	// then keep it anchored while the page or the modal scrolls.
	$effect(() => {
		if (!isOpen) return;
		void tick().then(positionDropdown);
		const reposition = () => positionDropdown();
		window.addEventListener('scroll', reposition, true);
		window.addEventListener('resize', reposition);
		return () => {
			window.removeEventListener('scroll', reposition, true);
			window.removeEventListener('resize', reposition);
		};
	});

	// Native (mobile) range handling. On touch devices the date range is a
	// single bordered box containing two native <input type="date"> fields
	// (From / To). Each opens the OS date picker on a genuine tap — the only
	// reliable trigger, since HTMLInputElement.showPicker() requires transient
	// user activation and cannot be chained across fields, and is unreliable
	// for date inputs on iOS Safari (see WebKit bug 261703).
	function handleNativeStartDateChange(event: Event) {
		const target = event.target as HTMLInputElement;
		startDate = target.value ? new Date(target.value) : '';
		handleChange();
	}

	function handleNativeEndDateChange(event: Event) {
		const target = event.target as HTMLInputElement;
		endDate = target.value ? new Date(target.value) : '';
		handleChange();
	}

	let formattedStartDate = $derived(() => formatDate(startDate));
	let formattedEndDate = $derived(() => formatDate(endDate));

	function handleChange() {
		if (onChange) {
			onChange();
		}
	}

	function handleClearClick(event: MouseEvent) {
		event.stopPropagation();
		onClearDates();
	}

	function handleClearKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			onClearDates();
		}
	}
</script>

<div class="date-filter" bind:this={wrapperEl} style={dropdownVars}>
	{#if useNativePicker}
		<!-- One bordered box containing two native date inputs (From / To).
		     Each opens the OS picker on a real tap — reliable on iOS & Android. -->
		<div class="native-date-box">
			<div class="native-box-header">
				<i class="icon-calendar"></i>
				<span class="native-box-label">{pickLabel}</span>
				{#if showClear && startDate}
					<button
						type="button"
						class="clear-button-native"
						aria-label="Clear dates"
						onclick={onClearDates}
					>
						<i class="os-icon-x"></i>
					</button>
				{/if}
			</div>
			<div class="native-fields">
				<label class="native-field-group">
					<span class="date-label">From</span>
					<input
						type="date"
						value={formatDateForInput(startDate)}
						onchange={handleNativeStartDateChange}
						class="native-date-input"
					/>
				</label>
				<label class="native-field-group">
					<span class="date-label">To</span>
					<input
						type="date"
						value={formatDateForInput(endDate)}
						onchange={handleNativeEndDateChange}
						class="native-date-input"
					/>
				</label>
			</div>
		</div>
	{:else}
		<!-- Custom date picker for desktop -->
		<DatePicker bind:isOpen bind:startDate bind:endDate isRange showPresets onchange={handleChange}>
			<button
				type="button"
				bind:this={triggerEl}
				class="date-field"
				aria-label={pickLabel}
				onclick={toggleDatePicker}
				class:open={isOpen}
			>
				<i class="icon-calendar"></i>
				<div class="date">
					{#if startDate}
						{formattedStartDate()} - {formattedEndDate()}
					{:else}
						{pickLabel}
					{/if}
				</div>
				{#if showClear && startDate}
					<span
						class="clear-button"
						aria-label="Clear dates"
						onclick={handleClearClick}
						onkeydown={handleClearKeydown}
						role="button"
						tabindex="0"
					>
						<i class="os-icon-x"></i>
					</span>
				{/if}
			</button>
		</DatePicker>
	{/if}
</div>

<style>
	.date-field {
		align-items: center;
		background-color: rgb(255 255 255);
		border: 1px solid rgb(229 231 235);
		border-radius: 0.5rem;
		display: inline-flex;
		gap: 8px;
		min-width: 100px;
		padding: 8px 12px;
		transition: all 0.2s ease-in-out;
		cursor: pointer;
		height: fit-content;
	}

	.date-field:hover {
		border-color: rgb(156 163 175);
	}

	.date-field.open {
		border-color: rgb(37 140 244);
		box-shadow: 0 0 0 3px rgb(37 140 244 / 0.1);
	}

	.date-field .icon-calendar {
		background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAEmSURBVHgB7ZcPzcIwEMUfXz4BSCgKwAGgACRMAg6YBBxsOMABOAAHFAXgAK5Z2Y6lHbfQ8SfpL3lZaY/1rb01N+BHUKSMNBfEJjZWISA56Uo6C2KvVpkgFn9oRx9vICFtUT1JKO3tvRtZdjBxXQs+YY+1FenIfuesPUGVVLzfRWKvmrSzbbN19wS+kAb2+sCEuUxrYzkbe4YvCVM2Vr5NPAkVa+van7Wn38U95uTpN5TJ/A8ZKemAakmbmJJGpI0gVmwA0huieFItjG19DgTHtwIZhCfZq3ztCuzQYh+FKBSvusjAGs8PnLYkLgMf34JoIBqIBqKBaIAb0Kw9RlhMCTbzzPWAqYq7LsuPaGDUsYmznaOk5zChUJTNQ4TFVMkrOL4HPsoNn26PxROHCggAAAAASUVORK5CYII=)
			no-repeat center center;
		background-size: 14px 14px;
		height: 14px;
		width: 14px;
		filter: brightness(0) saturate(100%) invert(45%) sepia(0%) saturate(0%) hue-rotate(0deg)
			brightness(0%) contrast(0%);
	}

	.clear-button {
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: background-color 0.2s ease-in-out;
		/* Vertically centre the X icon regardless of the host wrapper's layout
		   (fixes misalignment in pages like Import/Export where the picker sits
		   in a non-flex container). */
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
	}

	.clear-button:hover {
		background-color: rgb(243 244 246);
	}

	/* Native date range box for mobile: one bordered control, two date inputs */
	.native-date-box {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
		border: 1px solid rgb(229 231 235);
		border-radius: 0.5rem;
		background-color: rgb(255 255 255);
		padding: 8px 12px;
	}

	.native-box-header {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 20px;
	}

	.native-box-label {
		font-size: 12px;
		font-weight: 500;
		color: rgb(107 114 128);
		flex: 1;
	}

	.native-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.native-field-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.date-label {
		font-size: 12px;
		font-weight: 500;
		color: rgb(55 65 81);
	}

	.native-date-input {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid rgb(229 231 235);
		border-radius: 0.375rem;
		background-color: rgb(249 250 251);
		font-size: 14px;
		color: rgb(17 24 39);
		min-height: 40px;
		transition: all 0.2s ease-in-out;
	}

	.native-date-input:focus {
		border-color: rgb(37 140 244);
		box-shadow: 0 0 0 3px rgb(37 140 244 / 0.1);
		outline: none;
	}

	.clear-button-native {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 4px;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background-color 0.2s ease-in-out;
	}

	.clear-button-native:hover {
		background-color: rgb(243 244 246);
	}

	:global(.dark) .native-date-box {
		background-color: rgb(31 41 55);
		border-color: rgb(75 85 99);
	}

	:global(.dark) .native-box-label {
		color: rgb(156 163 175);
	}

	:global(.dark) .date-label {
		color: rgb(209 213 219);
	}

	:global(.dark) .native-date-input {
		background-color: rgb(55 65 81);
		border-color: rgb(75 85 99);
		color: rgb(243 244 246);
	}

	:global(.dark) .native-date-input:focus {
		border-color: rgb(59 130 246);
		box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1);
	}

	:global(.dark) .clear-button-native:hover {
		background-color: rgb(75 85 99);
	}

	/* Icon styling */
	.os-icon-x {
		display: inline-block;
		width: 16px;
		height: 16px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 18L18 6M6 6l12 12'/%3E%3C/svg%3E")
			no-repeat center center;
		background-size: 16px 16px;
		color: rgb(107 114 128);
	}

	/* Dark mode styles */
	:global(.dark) .date-field {
		background-color: rgb(31 41 55);
		border-color: rgb(75 85 99);
		color: rgb(243 244 246);
	}

	:global(.dark) .date-field:hover {
		border-color: rgb(107 114 128);
	}

	:global(.dark) .date-field.open {
		border-color: rgb(59 130 246);
		box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1);
	}

	:global(.dark) .date-field .icon-calendar {
		filter: brightness(0) saturate(100%) invert(100%) sepia(0%) saturate(0%) hue-rotate(0deg)
			brightness(100%) contrast(100%);
	}

	:global(.dark) .clear-button:hover {
		background-color: rgb(55 65 81);
	}

	:global(.dark) .os-icon-x {
		filter: brightness(0) saturate(100%) invert(100%) sepia(0%) saturate(0%) hue-rotate(0deg)
			brightness(100%) contrast(100%);
	}

	/* Focus styles for accessibility */
	.date-field:focus-visible {
		outline: 2px solid rgb(37 140 244);
		outline-offset: 2px;
	}

	:global(.dark) .date-field:focus-visible {
		outline-color: rgb(59 130 246);
	}

	/* Global DatePicker dropdown styles for dark mode consistency.
	   (The dropdown itself is positioned via the --datepicker-container-*
	   custom properties set from script — see positionDropdown above.) */
	:global(.calendars-container) {
		background-color: rgb(255 255 255);
		border-radius: 0.75rem;
	}

	:global(.dark .calendars-container) {
		background-color: rgb(31 41 55);
	}

	/* Calendar header and navigation styles */
	:global(.calendar-header) {
		background-color: rgb(249 250 251);
		border-bottom: 1px solid rgb(229 231 235);
		color: rgb(17 24 39);
	}

	:global(.dark .calendar-header) {
		background-color: rgb(55 65 81);
		border-bottom-color: rgb(75 85 99);
		color: rgb(243 244 246);
	}

	/* Calendar day styles */
	:global(.calendar-day) {
		color: rgb(17 24 39);
	}

	:global(.dark .calendar-day) {
		color: rgb(243 244 246);
	}

	:global(.calendar-day:hover) {
		background-color: rgb(243 244 246);
	}

	:global(.dark .calendar-day:hover) {
		background-color: rgb(55 65 81);
	}

	:global(.calendar-day.selected) {
		background-color: rgb(37 140 244);
		color: rgb(255 255 255);
	}

	:global(.dark .calendar-day.selected) {
		background-color: rgb(59 130 246);
		color: rgb(255 255 255);
	}

	:global(.calendar-day.in-range) {
		background-color: rgb(219 234 254);
		color: rgb(17 24 39);
	}

	:global(.dark .calendar-day.in-range) {
		background-color: rgb(30 58 138);
		color: rgb(243 244 246);
	}

	/* Preset button styles */
	:global(.preset-button) {
		background-color: rgb(249 250 251);
		border: 1px solid rgb(229 231 235);
		color: rgb(17 24 39);
	}

	:global(.dark .preset-button) {
		background-color: rgb(55 65 81);
		border-color: rgb(75 85 99);
		color: rgb(243 244 246);
	}

	:global(.preset-button:hover) {
		background-color: rgb(243 244 246);
		border-color: rgb(156 163 175);
	}

	:global(.dark .preset-button:hover) {
		background-color: rgb(75 85 99);
		border-color: rgb(107 114 128);
	}

	/* Month/Year navigation styles */
	:global(.month-navigation),
	:global(.year-navigation) {
		background-color: rgb(249 250 251);
		color: rgb(17 24 39);
	}

	:global(.dark .month-navigation),
	:global(.dark .year-navigation) {
		background-color: rgb(55 65 81);
		color: rgb(243 244 246);
	}

	:global(.month-navigation:hover),
	:global(.year-navigation:hover) {
		background-color: rgb(243 244 246);
	}

	:global(.dark .month-navigation:hover),
	:global(.dark .year-navigation:hover) {
		background-color: rgb(75 85 99);
	}

	/* Week day header styles */
	:global(.weekday-header) {
		background-color: rgb(249 250 251);
		color: rgb(107 114 128);
		font-weight: 600;
	}

	:global(.dark .weekday-header) {
		background-color: rgb(55 65 81);
		color: rgb(156 163 175);
	}

	/* Today indicator styles */
	:global(.calendar-day.today) {
		border: 2px solid rgb(37 140 244);
		font-weight: 600;
	}

	:global(.dark .calendar-day.today) {
		border-color: rgb(59 130 246);
	}

	/* Disabled day styles */
	:global(.calendar-day.disabled) {
		color: rgb(156 163 175);
		opacity: 0.5;
	}

	:global(.dark .calendar-day.disabled) {
		color: rgb(107 114 128);
	}

	/* Range start/end indicators */
	:global(.calendar-day.range-start) {
		background-color: rgb(37 140 244);
		color: rgb(255 255 255);
		border-radius: 0.375rem 0 0 0.375rem;
	}

	:global(.dark .calendar-day.range-start) {
		background-color: rgb(59 130 246);
	}

	:global(.calendar-day.range-end) {
		background-color: rgb(37 140 244);
		color: rgb(255 255 255);
		border-radius: 0 0.375rem 0.375rem 0;
	}

	:global(.dark .calendar-day.range-end) {
		background-color: rgb(59 130 246);
	}
</style>
