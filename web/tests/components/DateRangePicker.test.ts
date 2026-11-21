import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
import BindHarness from './DateRangePickerBindHarness.svelte';

// #244: the calendar dropdown used to render position:absolute below the
// trigger, so inside modals (overflow-y-auto panels) it was clipped. It must
// be flipped to position:fixed at viewport coordinates from the trigger.
describe('DateRangePicker dropdown positioning', () => {
	it('positions the open dropdown fixed to the viewport', async () => {
		const { container } = render(DateRangePicker, {
			props: { pickLabel: 'Pick a date' }
		});

		const wrapper = container.querySelector<HTMLElement>('.date-filter');
		expect(wrapper).toBeTruthy();

		const trigger = wrapper!.querySelector<HTMLButtonElement>('.date-field');
		expect(trigger).toBeTruthy();

		await fireEvent.click(trigger!);
		// positionDropdown runs after tick() in the open effect.
		await new Promise((r) => setTimeout(r, 0));

		const dropdown = wrapper!.querySelector<HTMLElement>('.calendars-container');
		expect(dropdown).toBeTruthy();

		const vars = wrapper!.getAttribute('style') ?? '';
		expect(vars).toContain('--datepicker-container-position: fixed');
		expect(vars).toContain('--datepicker-container-top:');
		expect(vars).toContain('--datepicker-container-left:');
	});

	it('keeps the dropdown anchored on scroll', async () => {
		const { container } = render(DateRangePicker, {
			props: { pickLabel: 'Pick a date' }
		});

		const trigger = container.querySelector<HTMLButtonElement>('.date-field')!;
		await fireEvent.click(trigger);
		await new Promise((r) => setTimeout(r, 0));

		await fireEvent.scroll(window);
		const vars = container.querySelector<HTMLElement>('.date-filter')!.getAttribute('style') ?? '';
		expect(vars).toContain('--datepicker-container-position: fixed');
	});

	// #245: the library applies the start on the first click; in
	// complete-the-range mode parents must not observe a start-only range.
	it('holds the selection until the range is complete', async () => {
		const onChange = vi.fn();
		const { container } = render(DateRangePicker, {
			props: { pickLabel: 'Pick a date', requireCompleteRange: true, onChange }
		});

		const wrapper = container.querySelector<HTMLElement>('.date-filter')!;
		const trigger = wrapper.querySelector<HTMLButtonElement>('.date-field')!;
		await fireEvent.click(trigger);
		await new Promise((r) => setTimeout(r, 0));

		// First click: the library has a start picked, but the parent must not.
		const days = wrapper.querySelectorAll<HTMLElement>('button.date:not(.disabled)');
		expect(days.length).toBeGreaterThan(10);
		await fireEvent.click(days[4]);
		await new Promise((r) => setTimeout(r, 0));
		expect(onChange).not.toHaveBeenCalled();
		expect(trigger.textContent).toContain('…'); // open end is visible in the trigger

		// Second click completes the range and only then propagates.
		await fireEvent.click(days[9]);
		await new Promise((r) => setTimeout(r, 0));
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(trigger.textContent).not.toContain('…');
	});

	// #280: the library's callback is onDateChange — `onchange` was silently
	// ignored, so parents watching onChange (e.g. the Data Editor's reload)
	// never heard about calendar picks and kept showing the previous range.
	it('fires onChange when a calendar range is picked', async () => {
		const onChange = vi.fn();
		const { container } = render(DateRangePicker, {
			props: { pickLabel: 'Pick a date', showClear: false, onChange }
		});

		const wrapper = container.querySelector<HTMLElement>('.date-filter')!;
		const trigger = wrapper.querySelector<HTMLButtonElement>('.date-field')!;
		await fireEvent.click(trigger);
		await new Promise((r) => setTimeout(r, 0));

		const days = wrapper.querySelectorAll<HTMLElement>('button.date:not(.disabled)');
		expect(days.length).toBeGreaterThan(10);

		// First click only arms the start; no complete range, no onChange yet.
		await fireEvent.click(days[3]);
		await new Promise((r) => setTimeout(r, 0));
		expect(onChange).not.toHaveBeenCalled();

		// Second click completes the range and notifies the parent.
		await fireEvent.click(days[9]);
		await new Promise((r) => setTimeout(r, 0));
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	// Calendar presets must notify too — they go through the same
	// onDateChange path as two-click ranges (#280).
	it('fires onChange when a calendar preset is clicked', async () => {
		const onChange = vi.fn();
		const { container } = render(DateRangePicker, {
			props: { pickLabel: 'Pick a date', showClear: false, onChange }
		});

		const wrapper = container.querySelector<HTMLElement>('.date-filter')!;
		const trigger = wrapper.querySelector<HTMLButtonElement>('.date-field')!;
		await fireEvent.click(trigger);
		await new Promise((r) => setTimeout(r, 0));

		const presets = wrapper.querySelectorAll<HTMLElement>('.calendar-presets button');
		expect(presets.length).toBeGreaterThan(0);
		await fireEvent.click(presets[0]);
		await new Promise((r) => setTimeout(r, 0));
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});

// The datepicker library normalizes its two-way bound props to epoch-millis
// numbers; those used to propagate into parents and from there into the
// trip-generation job payload, where raw millis in a recorded_at filter fail
// with SQLSTATE 22008 (fluxbase PGRST000). Parents must only ever see
// YYYY-MM-DD strings.
describe('DateRangePicker bound values', () => {
	it('hands parents YYYY-MM-DD strings in complete-the-range mode', async () => {
		const { container, getByTestId } = render(BindHarness, {
			props: { requireCompleteRange: true }
		});

		const wrapper = container.querySelector<HTMLElement>('.date-filter')!;
		const trigger = wrapper.querySelector<HTMLButtonElement>('.date-field')!;
		await fireEvent.click(trigger);
		await new Promise((r) => setTimeout(r, 0));

		const days = wrapper.querySelectorAll<HTMLElement>('button.date:not(.disabled)');
		expect(days.length).toBeGreaterThan(10);
		await fireEvent.click(days[4]);
		await new Promise((r) => setTimeout(r, 0));
		await fireEvent.click(days[9]);
		await new Promise((r) => setTimeout(r, 0));

		expect(getByTestId('bound-start').textContent).toMatch(/^str:\d{4}-\d{2}-\d{2}$/);
		expect(getByTestId('bound-end').textContent).toMatch(/^str:\d{4}-\d{2}-\d{2}$/);
	});

	it('hands parents YYYY-MM-DD strings in immediate mode', async () => {
		const { container, getByTestId } = render(BindHarness, { props: {} });

		const wrapper = container.querySelector<HTMLElement>('.date-filter')!;
		const trigger = wrapper.querySelector<HTMLButtonElement>('.date-field')!;
		await fireEvent.click(trigger);
		await new Promise((r) => setTimeout(r, 0));

		const days = wrapper.querySelectorAll<HTMLElement>('button.date:not(.disabled)');
		expect(days.length).toBeGreaterThan(10);
		await fireEvent.click(days[4]);
		await new Promise((r) => setTimeout(r, 0));
		await fireEvent.click(days[9]);
		await new Promise((r) => setTimeout(r, 0));

		expect(getByTestId('bound-start').textContent).toMatch(/^str:\d{4}-\d{2}-\d{2}$/);
		expect(getByTestId('bound-end').textContent).toMatch(/^str:\d{4}-\d{2}-\d{2}$/);
	});
});
