<script lang="ts">
	import { DatePicker } from '@svelte-plugins/datepicker';
	import { format } from 'date-fns';
	import { onMount } from 'svelte';

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

	function handleNativeStartDateChange(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.value) {
			startDate = new Date(target.value);
			handleChange();
		}
	}

	function handleNativeEndDateChange(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.value) {
			endDate = new Date(target.value);
			handleChange();
		}
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

<div class="date-filter">
	{#if useNativePicker}
		<!-- Native date inputs for mobile -->
		<div class="native-date-picker">
			<div class="date-inputs-container">
				<div class="date-input-group">
					<label for="start-date" class="date-label">From</label>
					<input
						id="start-date"
						type="date"
						value={formatDateForInput(startDate)}
						onchange={handleNativeStartDateChange}
						class="native-date-input"
					/>
				</div>
				<div class="date-input-group">
					<label for="end-date" class="date-label">To</label>
					<input
						id="end-date"
						type="date"
						value={formatDateForInput(endDate)}
						onchange={handleNativeEndDateChange}
						class="native-date-input"
					/>
				</div>
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
		</div>
	{:else}
		<!-- Custom date picker for desktop -->
		<DatePicker bind:isOpen bind:startDate bind:endDate isRange showPresets onchange={handleChange}>
			<button
				type="button"
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
	}

	.clear-button:hover {
		background-color: rgb(243 244 246);
	}

	/* Native date picker styles for mobile */
	.native-date-picker {
		width: 100%;
	}

	.date-inputs-container {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}

	.date-input-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
	}

	.date-label {
		font-size: 12px;
		font-weight: 500;
		color: rgb(55 65 81);
	}

	.native-date-input {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid rgb(229 231 235);
		border-radius: 0.5rem;
		background-color: rgb(255 255 255);
		font-size: 14px;
		color: rgb(17 24 39);
		transition: all 0.2s ease-in-out;
	}

	.native-date-input:focus {
		border-color: rgb(37 140 244);
		box-shadow: 0 0 0 3px rgb(37 140 244 / 0.1);
		outline: none;
	}

	.clear-button-native {
		align-self: flex-start;
		padding: 8px 12px;
		border-radius: 0.5rem;
		background-color: rgb(243 244 246);
		border: 1px solid rgb(229 231 235);
		cursor: pointer;
		transition: all 0.2s ease-in-out;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.clear-button-native:hover {
		background-color: rgb(229 231 235);
	}

	/* Dark mode styles for native date picker */
	:global(.dark) .date-label {
		color: rgb(209 213 219);
	}

	:global(.dark) .native-date-input {
		background-color: rgb(31 41 55);
		border-color: rgb(75 85 99);
		color: rgb(243 244 246);
	}

	:global(.dark) .native-date-input:focus {
		border-color: rgb(59 130 246);
		box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1);
	}

	:global(.dark) .clear-button-native {
		background-color: rgb(55 65 81);
		border-color: rgb(75 85 99);
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

	/* Global DatePicker dropdown styles for dark mode consistency */
	:global(.datepicker-dropdown) {
		background-color: rgb(255 255 255);
		border: 1px solid rgb(229 231 235);
		border-radius: 0.75rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
		z-index: 40 !important;
	}

	:global(.dark .datepicker-dropdown) {
		background-color: rgb(31 41 55);
		border-color: rgb(75 85 99);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

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
