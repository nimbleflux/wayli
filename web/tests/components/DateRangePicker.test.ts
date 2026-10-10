import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';

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
});
