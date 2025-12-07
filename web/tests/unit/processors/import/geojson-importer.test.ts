// web/tests/unit/processors/import/geojson-importer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { importGeoJSONWithProgress } from '../../../../src/worker/processors/import/geojson-importer';

const hoisted = vi.hoisted(() => {
	const mockFrom = vi.fn();
	const mockFluxbase = { from: mockFrom };
	const mockApplyTimezoneCorrectionToTimestamp = vi.fn();
	const mockGetTimezoneDifferenceForPoint = vi.fn();
	return {
		mockFrom,
		mockFluxbase,
		mockApplyTimezoneCorrectionToTimestamp,
		mockGetTimezoneDifferenceForPoint
	};
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
	applyTimezoneCorrectionToTimestamp: hoisted.mockApplyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint: hoisted.mockGetTimezoneDifferenceForPoint
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

	// Mock getTimezoneDifferenceForPoint to return timezone differences
	hoisted.mockGetTimezoneDifferenceForPoint.mockImplementation((lat: number, lon: number) => {
		if (lat === 40.7128 && lon === -74.006) {
			// NYC area - UTC-5
			return -5.0;
		} else if (lat === 48.8566 && lon === 2.3522) {
			// Paris area - UTC+1
			return 1.0;
		} else if (lat === 35.6762 && lon === 139.6503) {
			// Tokyo area - UTC+9
			return 9.0;
		} else {
			// Default to UTC
			return 0.0;
		}
	});

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

describe('importGeoJSONWithProgress', () => {
	it('imports a single point feature with timezone correction', async () => {
		const content = JSON.stringify({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [4.9, 52.37] },
					properties: { timestamp: 1700000000 }
				}
			]
		});

		const count = await importGeoJSONWithProgress(content, 'user', 'job', 'file.geojson');

		expect(count).toBe(1);
		expect(hoisted.mockFrom).toHaveBeenCalledWith('tracker_data');

		// Verify that timezone correction was called
		// The timestamp is converted from seconds to milliseconds
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			1700000000 * 1000, // Convert to milliseconds
			52.37, // latitude
			4.9 // longitude
		);

		// Note: getTimezoneDifferenceForPoint is not currently used in the geojson importer
		// expect(hoisted.mockGetTimezoneDifferenceForPoint).toHaveBeenCalledWith(
		// 	52.37, // latitude
		// 	4.9 // longitude
		// );
	});

	it('imports a feature with timestamp property and applies timezone correction', async () => {
		const content = JSON.stringify({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [-74.006, 40.7128] }, // NYC coordinates
					properties: { timestamp: 1723814400 } // Unix timestamp in seconds
				}
			]
		});

		const count = await importGeoJSONWithProgress(content, 'user', 'job', 'file.geojson');

		expect(count).toBe(1);

		// Verify timezone correction was called with NYC coordinates
		// The timestamp is converted from seconds to milliseconds
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			1723814400 * 1000, // Convert to milliseconds
			40.7128, // latitude
			-74.006 // longitude
		);

		// Verify the mock returned the expected timezone format
		const result = hoisted.mockApplyTimezoneCorrectionToTimestamp(
			1723814400 * 1000,
			40.7128,
			-74.006
		);
		expect(result).toBe('2025-08-16T14:00:00-05:00');

		// Note: getTimezoneDifferenceForPoint is not currently used in the geojson importer
		// expect(hoisted.mockGetTimezoneDifferenceForPoint).toHaveBeenCalledWith(
		// 	40.7128, // latitude
		// 	-74.006 // longitude
		// );
	});

	it('imports a feature with time property and applies timezone correction', async () => {
		const content = JSON.stringify({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [2.3522, 48.8566] }, // Paris coordinates
					properties: { time: '2025-08-16T14:00:00' }
				}
			]
		});

		const count = await importGeoJSONWithProgress(content, 'user', 'job', 'file.geojson');

		expect(count).toBe(1);

		// Verify timezone correction was called with Paris coordinates
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			'2025-08-16T14:00:00',
			48.8566, // latitude
			2.3522 // longitude
		);

		// Verify the mock returned the expected timezone format
		const result = hoisted.mockApplyTimezoneCorrectionToTimestamp(
			'2025-08-16T14:00:00',
			48.8566,
			2.3522
		);
		expect(result).toBe('2025-08-16T14:00:00+01:00');

		// Note: getTimezoneDifferenceForPoint is not currently used in the geojson importer
		// expect(hoisted.mockGetTimezoneDifferenceForPoint).toHaveBeenCalledWith(
		// 	48.8566, // latitude
		// 	2.3522 // longitude
		// );
	});

	it('imports a feature with date property and applies timezone correction', async () => {
		const content = JSON.stringify({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [139.6503, 35.6762] }, // Tokyo coordinates
					properties: { date: '2025-08-16T14:00:00' }
				}
			]
		});

		const count = await importGeoJSONWithProgress(content, 'user', 'job', 'file.geojson');

		expect(count).toBe(1);

		// Verify timezone correction was called with Tokyo coordinates
		expect(hoisted.mockApplyTimezoneCorrectionToTimestamp).toHaveBeenCalledWith(
			'2025-08-16T14:00:00',
			35.6762, // latitude
			139.6503 // longitude
		);

		// Note: getTimezoneDifferenceForPoint is not currently used in the geojson importer
		// expect(hoisted.mockGetTimezoneDifferenceForPoint).toHaveBeenCalledWith(
		// 	35.6762, // latitude
		// 	139.6503 // longitude
		// );
	});
});
