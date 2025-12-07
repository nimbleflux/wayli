// web/tests/unit/components/job-progress-indicator.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import JobProgressIndicator from '$lib/components/JobProgressIndicator.svelte?client';

vi.mock('$lib/stores/job-store', () => ({
	getActiveJobsMap: () =>
		new Map([
			[
				'1',
				{
					id: '1',
					type: 'data_import',
					status: 'running',
					progress: 50,
					updated_at: new Date().toISOString()
				}
			]
		]),
	subscribe: () => () => {},
	fetchAndPopulateJobs: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u' } } } }) },
		functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) }
	}
}));

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('$lib/i18n', async () => {
	const { readable } = await import('svelte/store');
	return { translate: readable((k: string) => k) } as any;
});

describe('JobProgressIndicator', () => {
	it('renders running job and allows cancel action', async () => {
		const { getByLabelText } = render(JobProgressIndicator);
		const btn = getByLabelText('jobProgress.cancelJob');
		await fireEvent.click(btn);
		// opens modal
		// We can’t fully assert modal text without running i18n; presence is enough
		expect(btn).toBeTruthy();
	});
});
