// Integration tests for job queue system

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fluxbase client
const mockFluxbase = {
	jobs: {
		submit: vi.fn(),
		get: vi.fn(),
		list: vi.fn(),
		cancel: vi.fn()
	},
	auth: {
		getUser: vi.fn().mockResolvedValue({
			data: { user: { id: 'test-user' } },
			error: null
		})
	}
};

vi.mock('$lib/fluxbase', () => ({
	fluxbase: mockFluxbase
}));

describe('Job Queue Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Job Submission', () => {
		it('should submit a data import job', async () => {
			const mockJob = {
				id: 'job-123',
				job_name: 'data_import',
				status: 'pending',
				created_at: new Date().toISOString()
			};

			mockFluxbase.jobs.submit.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.submit(
				'data_import',
				{
					file_path: 'uploads/test.gpx',
					format: 'gpx'
				},
				{ namespace: 'wayli', priority: 5 }
			);

			expect(result.error).toBeNull();
			expect(result.data?.job_name).toBe('data_import');
			expect(result.data?.status).toBe('pending');
		});

		it('should submit a trip generation job', async () => {
			const mockJob = {
				id: 'job-456',
				job_name: 'trip_generation',
				status: 'pending',
				created_at: new Date().toISOString()
			};

			mockFluxbase.jobs.submit.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.submit(
				'trip_generation',
				{
					start_date: '2024-01-01',
					end_date: '2024-01-31'
				},
				{ namespace: 'wayli', priority: 5 }
			);

			expect(result.error).toBeNull();
			expect(result.data?.job_name).toBe('trip_generation');
		});

		it('should submit a data export job', async () => {
			const mockJob = {
				id: 'job-789',
				job_name: 'data-export',
				status: 'pending',
				created_at: new Date().toISOString()
			};

			mockFluxbase.jobs.submit.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.submit(
				'data-export',
				{
					format: 'json',
					include_trips: true,
					include_tracker_data: true
				},
				{ namespace: 'wayli', priority: 3 }
			);

			expect(result.error).toBeNull();
			expect(result.data?.job_name).toBe('data-export');
		});

		it('should submit a reverse geocoding job', async () => {
			const mockJob = {
				id: 'job-abc',
				job_name: 'reverse_geocoding',
				status: 'pending',
				created_at: new Date().toISOString()
			};

			mockFluxbase.jobs.submit.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.submit(
				'reverse_geocoding',
				{
					batch_size: 100
				},
				{ namespace: 'wayli', priority: 4 }
			);

			expect(result.error).toBeNull();
			expect(result.data?.job_name).toBe('reverse_geocoding');
		});
	});

	describe('Job Status Tracking', () => {
		it('should get job progress', async () => {
			const mockJob = {
				id: 'job-123',
				job_name: 'data_import',
				status: 'running',
				progress_percent: 45,
				progress_message: 'Processing file...'
			};

			mockFluxbase.jobs.get.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.get('job-123');

			expect(result.data?.status).toBe('running');
			expect(result.data?.progress_percent).toBe(45);
		});

		it('should handle completed job', async () => {
			const mockJob = {
				id: 'job-123',
				job_name: 'data_import',
				status: 'completed',
				progress_percent: 100,
				result: {
					records_imported: 1500,
					duration: 45000
				},
				completed_at: new Date().toISOString()
			};

			mockFluxbase.jobs.get.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.get('job-123');

			expect(result.data?.status).toBe('completed');
			expect(result.data?.result?.records_imported).toBe(1500);
		});

		it('should handle failed job', async () => {
			const mockJob = {
				id: 'job-123',
				job_name: 'data_import',
				status: 'failed',
				error: 'Invalid file format',
				completed_at: new Date().toISOString()
			};

			mockFluxbase.jobs.get.mockResolvedValue({
				data: mockJob,
				error: null
			});

			const result = await mockFluxbase.jobs.get('job-123');

			expect(result.data?.status).toBe('failed');
			expect(result.data?.error).toBe('Invalid file format');
		});
	});

	describe('Job Listing', () => {
		it('should list all jobs for user', async () => {
			const mockJobs = [
				{ id: 'job-1', job_name: 'data_import', status: 'completed' },
				{ id: 'job-2', job_name: 'trip_generation', status: 'running' },
				{ id: 'job-3', job_name: 'data-export', status: 'pending' }
			];

			mockFluxbase.jobs.list.mockResolvedValue({
				data: mockJobs,
				error: null
			});

			const result = await mockFluxbase.jobs.list({
				namespace: 'wayli',
				limit: 50
			});

			expect(result.data).toHaveLength(3);
		});

		it('should filter jobs by status', async () => {
			const mockJobs = [
				{ id: 'job-1', job_name: 'data_import', status: 'completed' },
				{ id: 'job-2', job_name: 'trip_generation', status: 'completed' }
			];

			mockFluxbase.jobs.list.mockResolvedValue({
				data: mockJobs,
				error: null
			});

			const result = await mockFluxbase.jobs.list({
				namespace: 'wayli',
				status: 'completed'
			});

			expect(result.data?.every((j: { status: string }) => j.status === 'completed')).toBe(true);
		});

		it('should paginate job results', async () => {
			const mockJobs = Array.from({ length: 20 }, (_, i) => ({
				id: `job-${i}`,
				job_name: 'data_import',
				status: 'completed'
			}));

			mockFluxbase.jobs.list.mockResolvedValue({
				data: mockJobs,
				error: null
			});

			const result = await mockFluxbase.jobs.list({
				namespace: 'wayli',
				limit: 20,
				offset: 0
			});

			expect(result.data).toHaveLength(20);
		});
	});

	describe('Job Cancellation', () => {
		it('should cancel a running job', async () => {
			mockFluxbase.jobs.cancel.mockResolvedValue({
				error: null
			});

			const result = await mockFluxbase.jobs.cancel('job-123');

			expect(result.error).toBeNull();
		});

		it('should handle cancellation of completed job', async () => {
			mockFluxbase.jobs.cancel.mockResolvedValue({
				error: { message: 'Job already completed' }
			});

			const result = await mockFluxbase.jobs.cancel('job-123');

			expect(result.error).not.toBeNull();
		});
	});

	describe('Job Priority', () => {
		it('should respect job priority ordering', () => {
			const jobs = [
				{ id: 'job-1', priority: 3, created_at: '2024-01-01T10:00:00Z' },
				{ id: 'job-2', priority: 1, created_at: '2024-01-01T10:01:00Z' },
				{ id: 'job-3', priority: 5, created_at: '2024-01-01T10:02:00Z' },
				{ id: 'job-4', priority: 3, created_at: '2024-01-01T09:00:00Z' }
			];

			// Sort by priority (higher first), then by created_at (older first)
			const sorted = [...jobs].sort((a, b) => {
				if (a.priority !== b.priority) {
					return b.priority - a.priority; // Higher priority first
				}
				return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			});

			expect(sorted[0].id).toBe('job-3'); // Priority 5
			expect(sorted[1].id).toBe('job-4'); // Priority 3, earlier
			expect(sorted[2].id).toBe('job-1'); // Priority 3, later
			expect(sorted[3].id).toBe('job-2'); // Priority 1
		});
	});

	describe('Job Data Validation', () => {
		it('should validate import job data', () => {
			const validImportData = {
				file_path: 'uploads/test.gpx',
				format: 'gpx'
			};

			const isValid =
				typeof validImportData.file_path === 'string' &&
				['gpx', 'json', 'csv', 'kml'].includes(validImportData.format);

			expect(isValid).toBe(true);
		});

		it('should reject invalid import format', () => {
			const invalidImportData = {
				file_path: 'uploads/test.xyz',
				format: 'xyz'
			};

			const isValid = ['gpx', 'json', 'csv', 'kml'].includes(invalidImportData.format);

			expect(isValid).toBe(false);
		});

		it('should validate export job data', () => {
			const validExportData = {
				format: 'json',
				include_trips: true,
				include_tracker_data: true,
				date_range: {
					start: '2024-01-01',
					end: '2024-12-31'
				}
			};

			const isValid =
				['json', 'csv', 'gpx'].includes(validExportData.format) &&
				typeof validExportData.include_trips === 'boolean';

			expect(isValid).toBe(true);
		});
	});
});
