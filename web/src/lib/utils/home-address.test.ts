import { describe, it, expect } from 'vitest';

import {
	normalizeHomeAddress,
	parseManualHomeCoordinates,
	buildManualHomeAddress,
	homeCoordinatesEqual
} from './home-address';

describe('normalizeHomeAddress', () => {
	it('accepts the adapter shape { address, location: { lat, lon } }', () => {
		const raw = {
			address: '11 Beecroft Street, Huskisson',
			location: { lat: -35.042, lon: 150.669 },
			display_name: '11 Beecroft Street, Huskisson'
		};
		const result = normalizeHomeAddress(raw);
		expect(result).not.toBeNull();
		expect(result?.address).toBe('11 Beecroft Street, Huskisson');
		expect(result?.location).toEqual({ lat: -35.042, lon: 150.669 });
	});

	it('accepts the raw Pelias suggestion shape { display_name, lat, lon }', () => {
		const raw = {
			display_name: '11 Beecroft Street, Huskisson, NSW, Australia',
			lat: -35.042,
			lon: 150.669,
			name: '11 Beecroft Street',
			layer: 'address',
			address: { city: 'Huskisson', state: 'New South Wales', country: 'Australia' }
		};
		const result = normalizeHomeAddress(raw);
		expect(result).not.toBeNull();
		expect(result?.location).toEqual({ lat: -35.042, lon: 150.669 });
		expect(result?.address).toBe('11 Beecroft Street, Huskisson, NSW, Australia');
		expect(result?.layer).toBe('address');
		expect(result?.name).toBe('11 Beecroft Street');
		expect(result?.city).toBe('Huskisson');
	});

	it('accepts the manual coordinates shape { display_name, coordinates: { lat, lng } } (#205)', () => {
		const raw = { display_name: '-35.042, 150.669', coordinates: { lat: -35.042, lng: 150.669 } };
		const result = normalizeHomeAddress(raw);
		expect(result).not.toBeNull();
		expect(result?.address).toBe('-35.042, 150.669');
		expect(result?.location).toEqual({ lat: -35.042, lon: 150.669 });
	});

	it('accepts the enriched manual shape with address and layer (#205)', () => {
		const raw = {
			display_name: '11 Beecroft Street, Huskisson, NSW, Australia',
			coordinates: { lat: -35.042, lng: 150.669 },
			address: { city: 'Huskisson', town: 'Huskisson' },
			layer: 'address'
		};
		const result = normalizeHomeAddress(raw);
		expect(result).not.toBeNull();
		expect(result?.location).toEqual({ lat: -35.042, lon: 150.669 });
		expect(result?.city).toBe('Huskisson');
		expect(result?.layer).toBe('address');
	});

	it('returns null for legacy plain-string values', () => {
		expect(normalizeHomeAddress('11 Beecroft Street, Huskisson')).toBeNull();
	});

	it('returns null for null, undefined and coordinate-less objects', () => {
		expect(normalizeHomeAddress(null)).toBeNull();
		expect(normalizeHomeAddress(undefined)).toBeNull();
		expect(normalizeHomeAddress({})).toBeNull();
		expect(normalizeHomeAddress({ display_name: 'Home' })).toBeNull();
		expect(normalizeHomeAddress({ location: { lat: -35.042 } })).toBeNull();
		expect(normalizeHomeAddress({ coordinates: { lng: 150.669 } })).toBeNull();
	});

	it('derives city from city/town/village address fields', () => {
		const raw = {
			display_name: 'Somewhere, Woolamia',
			lat: -35.0,
			lon: 150.6,
			address: { town: 'Woolamia' }
		};
		expect(normalizeHomeAddress(raw)?.city).toBe('Woolamia');
	});
});

describe('parseManualHomeCoordinates', () => {
	it('parses decimal coordinates and returns the stored manual shape', () => {
		expect(parseManualHomeCoordinates('-35.042', '150.669')).toEqual({
			display_name: '-35.042, 150.669',
			coordinates: { lat: -35.042, lng: 150.669 }
		});
	});

	it('trims whitespace around inputs', () => {
		expect(parseManualHomeCoordinates(' -35.042 ', ' 150.669 ')).toEqual({
			display_name: '-35.042, 150.669',
			coordinates: { lat: -35.042, lng: 150.669 }
		});
	});

	it('accepts comma as decimal separator', () => {
		expect(parseManualHomeCoordinates('-35,042', '150,669')).toEqual({
			display_name: '-35.042, 150.669',
			coordinates: { lat: -35.042, lng: 150.669 }
		});
	});

	it('rejects non-numeric input', () => {
		expect(parseManualHomeCoordinates('abc', '150')).toBeNull();
		expect(parseManualHomeCoordinates('-35', '')).toBeNull();
	});

	it('rejects out-of-range coordinates', () => {
		expect(parseManualHomeCoordinates('91', '0')).toBeNull();
		expect(parseManualHomeCoordinates('0', '181')).toBeNull();
	});

	it('rejects Null Island', () => {
		expect(parseManualHomeCoordinates('0', '0')).toBeNull();
	});
});

describe('buildManualHomeAddress', () => {
	it('builds the plain manual shape without reverse-geocode data', () => {
		expect(buildManualHomeAddress(-35.042, 150.669, null)).toEqual({
			display_name: '-35.042, 150.669',
			coordinates: { lat: -35.042, lng: 150.669 }
		});
	});

	it('enriches the manual shape with label, address and layer when available', () => {
		const reverse = {
			label: '11 Beecroft Street, Huskisson, NSW, Australia',
			address: { city: 'Huskisson', road: 'Beecroft Street' },
			layer: 'address'
		};
		expect(buildManualHomeAddress(-35.042, 150.669, reverse)).toEqual({
			display_name: '11 Beecroft Street, Huskisson, NSW, Australia',
			coordinates: { lat: -35.042, lng: 150.669 },
			address: { city: 'Huskisson', road: 'Beecroft Street' },
			layer: 'address'
		});
	});

	it('keeps the coordinate fallback label when the reverse result has no label', () => {
		const reverse = { label: '', address: { city: 'Huskisson' }, layer: undefined };
		const result = buildManualHomeAddress(-35.042, 150.669, reverse);
		expect(result.display_name).toBe('-35.042, 150.669');
		expect(result.address).toEqual({ city: 'Huskisson' });
		expect(result).not.toHaveProperty('layer');
	});
});

describe('homeCoordinatesEqual', () => {
	it('returns true when the stored value has the same manual coordinates', () => {
		const stored = {
			display_name: '-35.042, 150.669',
			coordinates: { lat: -35.042, lng: 150.669 }
		};
		expect(homeCoordinatesEqual(stored, -35.042, 150.669)).toBe(true);
	});

	it('returns true when the enriched manual shape has the same coordinates', () => {
		const stored = {
			display_name: 'Somewhere',
			coordinates: { lat: -35.042, lng: 150.669 },
			address: { city: 'Huskisson' }
		};
		expect(homeCoordinatesEqual(stored, -35.042, 150.669)).toBe(true);
	});

	it('compares the raw Pelias flat lat/lon shape', () => {
		const stored = { display_name: 'X', lat: -35.042, lon: 150.669 };
		expect(homeCoordinatesEqual(stored, -35.042, 150.669)).toBe(true);
	});

	it('compares the adapter location.{lat, lon} shape', () => {
		const stored = { address: 'Home', location: { lat: -35.042, lon: 150.669 } };
		expect(homeCoordinatesEqual(stored, -35.042, 150.669)).toBe(true);
	});

	it('returns false for different coordinates', () => {
		const stored = { coordinates: { lat: -35.042, lng: 150.669 } };
		expect(homeCoordinatesEqual(stored, -35.1, 150.669)).toBe(false);
	});

	it('returns false when there is nothing stored or no coordinates to compare (needs enrichment)', () => {
		expect(homeCoordinatesEqual(null, -35.042, 150.669)).toBe(false);
		expect(homeCoordinatesEqual(undefined, -35.042, 150.669)).toBe(false);
		expect(homeCoordinatesEqual('Huskisson, NSW', -35.042, 150.669)).toBe(false);
		expect(homeCoordinatesEqual({ display_name: 'Home' }, -35.042, 150.669)).toBe(false);
	});
});
