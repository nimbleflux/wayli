// web/tests/unit/processors/import/gpx-importer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { importGPXWithProgress } from '../../../../src/worker/processors/import/gpx-importer';

const hoisted = vi.hoisted(() => {
	const mockFrom = vi.fn();
	const mockFluxbase = { from: mockFrom };
	const mockApplyTimezoneCorrectionToTimestamp = vi.fn();
	return { mockFrom, mockFluxbase, mockApplyTimezoneCorrectionToTimestamp };
});

vi.mock('../../../../src/worker/fluxbase', () => ({ fluxbase: hoisted.mockFluxbase }));
vi.mock('../../../../src/worker/job-queue.service.worker', () => ({
	JobQueueService: { updateJobProgress: vi.fn() }
}));
vi.mock('../../../../src/lib/utils/job-cancellation', () => ({
	checkJobCancellation: vi.fn().mockResolvedValue(undefined)
}));

// Mock the timezone correction function with proper return values
vi.mock('../../../../src/lib/services/external/country-reverse-geocoding.service', () => ({
	getCountryForPoint: () => 'XX',
	normalizeCountryCode: (c: string | null) => c,
	getTimezoneDifferenceForPoint: (lat: number, lon: number) => {
		// Mock timezone difference based on coordinates
		if (lat === 40.7128 && lon === -74.006) {
			// NYC area - UTC-5
			return -5;
		} else if (lat === 48.8566 && lon === 2.3522) {
			// Paris area - UTC+1
			return 1;
		} else {
			// Default to UTC
			return 0;
		}
	},
	applyTimezoneCorrectionToTimestamp: hoisted.mockApplyTimezoneCorrectionToTimestamp
}));

beforeEach(() => {
	vi.clearAllMocks();

	// Reset the mock to return proper timezone-formatted timestamps
	hoisted.mockApplyTimezoneCorrectionToTimestamp.mockImplementation(
		(timestamp: string | number | Date, lat: number, lon: number) => {
			// Simulate timezone correction for testing
			if (lat === 40.7128 && lon === -74.006) {
				// NYC area - UTC-5
				return '2025-08-16T14:00:00-05:00';
			} else if (lat === 48.8566 && lon === 2.3522) {
				// Paris area - UTC+1
				return '2025-08-16T14:00:00+01:00';
			} else {
				// Default to UTC
				return '2025-08-16T14:00:00Z';
			}
		}
	);

	hoisted.mockFrom.mockImplementation((table: string) => {
		if (table === 'tracker_data') {
			return {
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
				upsert: vi.fn().mockResolvedValue({ data: null, error: null })
			};
		}
		return {};
	});
});

describe('importGPXWithProgress', () => {
	it('imports a waypoint with timezone correction', async () => {
		const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
  <wpt lat="40.7128" lon="-74.0060">
    <time>2025-08-16T14:00:00Z</time>
  </wpt>
</gpx>`;

		const result = await importGPXWithProgress(content, 'user', 'job', 'file.gpx');

		expect(result.importedCount).toBe(1);
		expect(hoisted.mockFrom).toHaveBeenCalledWith('tracker_data');

		// Verify that timezone correction was called with NYC coordinates
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			'2025-08-16T14:00:00Z',
			40.7128, // latitude
			-74.006 // longitude
		);

		// Verify the mock returned the expected timezone format
		const timezoneResult = hoisted.mockApplyTimezoneCorrectionToTimestamp(
			'2025-08-16T14:00:00Z',
			40.7128,
			-74.006
		);
		expect(timezoneResult).toBe('2025-08-16T14:00:00-05:00');
	});

	it('imports a track point with timezone correction', async () => {
		const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
  <trk>
    <trkseg>
      <trkpt lat="48.8566" lon="2.3522">
        <time>2025-08-16T14:00:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

		const result = await importGPXWithProgress(content, 'user', 'job', 'file.gpx');

		expect(result.importedCount).toBe(1);

		// Verify that timezone correction was called with Paris coordinates
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			'2025-08-16T14:00:00Z',
			48.8566, // latitude
			2.3522 // longitude
		);

		// Verify the mock returned the expected timezone format
		const timezoneResult = hoisted.mockApplyTimezoneCorrectionToTimestamp(
			'2025-08-16T14:00:00Z',
			48.8566,
			2.3522
		);
		expect(timezoneResult).toBe('2025-08-16T14:00:00+01:00');
	});

	it('imports multiple track points with timezone correction', async () => {
		const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
  <trk>
    <trkseg>
      <trkpt lat="40.7128" lon="-74.0060">
        <time>2025-08-16T14:00:00Z</time>
      </trkpt>
      <trkpt lat="40.7129" lon="-74.0061">
        <time>2025-08-16T14:01:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

		const result = await importGPXWithProgress(content, 'user', 'job', 'file.gpx');

		expect(result.importedCount).toBe(2);

		// Verify that timezone correction was called for both points
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledTimes(2);
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			'2025-08-16T14:00:00Z',
			40.7128, // latitude
			-74.006 // longitude
		);
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			'2025-08-16T14:01:00Z',
			40.7129, // latitude
			-74.0061 // longitude
		);
	});
});
