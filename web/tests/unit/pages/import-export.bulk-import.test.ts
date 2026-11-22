// Bulk import (issue #286): one job per selected file, queued sequentially.
// On partial failure the files whose job submission failed stay selected so
// they can be retried without re-picking; succeeded files are cleared.

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ImportExportPage from '$routes/(user)/dashboard/import-export/+page.svelte?client';

vi.mock('$env/static/public', () => ({
	FLUXBASE_PUBLIC_BASE_URL: 'http://localhost',
	PUBLIC_FLUXBASE_ANON_KEY: 'anon'
}));

vi.mock('$lib/i18n', async () => {
	const { readable } = await import('svelte/store');
	return { translate: readable((key: string) => key) } as any;
});

vi.mock('$lib/stores/auth', () => ({
	sessionStore: {
		subscribe: (fn: any) => {
			fn({ user: { id: 'test-user-id' } });
			return () => {};
		}
	}
}));

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: {
			getSession: vi.fn().mockResolvedValue({
				data: { session: { user: { id: 'test-user-id' } } }
			})
		},
		from: vi.fn()
	}
}));

vi.mock('$lib/services/api/service-adapter', () => ({
	ServiceAdapter: class {
		getJobs = vi.fn().mockResolvedValue([]);
		getExportJobs = vi.fn().mockResolvedValue([]);
	}
}));

const { createImportJob } = vi.hoisted(() => ({ createImportJob: vi.fn() }));
vi.mock('$lib/services/job-creation.service', () => ({
	jobCreationService: { createImportJob, createExportJob: vi.fn() }
}));

const file = (name: string) => new File(['data'], name, { type: 'application/octet-stream' });

function selectFiles(container: HTMLElement, files: File[]) {
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	expect(input).toBeTruthy();
	fireEvent.change(input, { target: { files } });
}

function clickImport(container: HTMLElement) {
	const button = [...container.querySelectorAll('button')].find(
		(b) =>
			b.textContent?.includes('importDataButton') || b.textContent?.includes('importNDataButton')
	);
	expect(button).toBeTruthy();
	expect((button as HTMLButtonElement).disabled).toBe(false);
	return fireEvent.click(button!);
}

describe('Import/Export bulk import', () => {
	beforeEach(() => {
		createImportJob.mockReset();
	});

	it('queues one job per selected file and clears the list on full success', async () => {
		const { container } = render(ImportExportPage);

		const a = file('day-one.gpx');
		const b = file('day-two.kml');
		selectFiles(container, [a, b]);
		createImportJob.mockResolvedValue({});

		await clickImport(container);

		await waitFor(() => {
			expect(createImportJob).toHaveBeenCalledTimes(2);
		});
		expect(createImportJob).toHaveBeenCalledWith(a, {
			format: 'GPX',
			includeLocationData: true,
			includeWantToVisit: true,
			includeTrips: true
		});
		expect(createImportJob).toHaveBeenCalledWith(b, {
			format: 'KML',
			includeLocationData: true,
			includeWantToVisit: true,
			includeTrips: true
		});

		// All succeeded — back to the empty dropzone
		await waitFor(() => {
			expect(container.textContent).not.toContain('day-one.gpx');
		});
		expect(container.textContent).toContain('importExport.selectFile');
	});

	it('keeps failed files selected for retry on partial failure', async () => {
		const { container } = render(ImportExportPage);

		const good = file('good.gpx');
		const bad = file('bad.kml');
		selectFiles(container, [good, bad]);
		createImportJob.mockImplementation((f: File) =>
			f.name === 'bad.kml' ? Promise.reject(new Error('queue unavailable')) : Promise.resolve({})
		);

		await clickImport(container);

		await waitFor(() => {
			expect(createImportJob).toHaveBeenCalledTimes(2);
		});

		// The succeeded file is cleared; the failed one stays for retry
		await waitFor(() => {
			expect(container.textContent).not.toContain('good.gpx');
		});
		expect(container.textContent).toContain('bad.kml');
	});

	it('keeps everything selected when every file fails', async () => {
		const { container } = render(ImportExportPage);

		const a = file('a.gpx');
		const b = file('b.kml');
		selectFiles(container, [a, b]);
		createImportJob.mockRejectedValue(new Error('offline'));

		await clickImport(container);

		await waitFor(() => {
			expect(createImportJob).toHaveBeenCalledTimes(2);
		});
		expect(container.textContent).toContain('a.gpx');
		expect(container.textContent).toContain('b.kml');
	});
});
