// web/src/lib/utils/job-cancellation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkJobCancellation } from './job-cancellation';

// Mutable stub to control worker return value without importing env/config
const workerStub = { status: 'running' } as { status: 'running' | 'cancelled' };

vi.mock('../../worker/fluxbase', () => ({
	fluxbase: {
		from: () => ({
			select: () => ({
				eq: () => ({
					single: async () => ({ data: { status: workerStub.status }, error: null })
				})
			})
		})
	}
}));

describe('checkJobCancellation', () => {
	beforeEach(() => {
		workerStub.status = 'running';
	});

	it('returns when jobId is missing', async () => {
		await expect(checkJobCancellation()).resolves.toBeUndefined();
	});

	it('does not throw when status is not cancelled', async () => {
		workerStub.status = 'running';
		await expect(checkJobCancellation('id')).resolves.toBeUndefined();
	});

	it('throws when status is cancelled', async () => {
		workerStub.status = 'cancelled';
		await expect(checkJobCancellation('id')).rejects.toThrow('Job was cancelled');
	});
});
