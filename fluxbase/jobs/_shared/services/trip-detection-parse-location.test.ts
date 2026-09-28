// Characterization test: pins how TripDetectionService.parseLocation maps the
// persisted user_profiles.home_address shapes into the Location used for home
// matching. The manual-coordinates shapes (#205) rely on:
//   - plain manual shape  → coordinates preserved (50 m proximity check)
//   - enriched manual     → coordinates + address.city (50 m + city match)
// Run: deno test --no-lock fluxbase/jobs/_shared/services/trip-detection-parse-location.test.ts

import assert from 'node:assert/strict';
const { test } = await import('node:test');

const { TripDetectionService } = await import('./trip-detection.service.ts');

// parseLocation is private; the service only needs the client reference at
// construction time, so an empty stub is safe for this pure method.
function service(): InstanceType<typeof TripDetectionService> {
	return new TripDetectionService({} as any);
}

function parse(data: unknown): any {
	return (service() as any).parseLocation(data);
}

test('plain manual coordinates shape keeps coordinates, has no address (#205)', () => {
	const result = parse({
		display_name: '-35.042, 150.669',
		coordinates: { lat: -35.042, lng: 150.669 }
	});
	assert.deepEqual(result.coordinates, { lat: -35.042, lng: 150.669 });
	assert.equal(result.address, undefined);
});

test('enriched manual shape keeps coordinates and address for city matching (#205)', () => {
	const result = parse({
		display_name: '11 Beecroft Street, Huskisson, NSW, Australia',
		coordinates: { lat: -35.042, lng: 150.669 },
		address: { city: 'Huskisson', road: 'Beecroft Street' },
		layer: 'address'
	});
	assert.deepEqual(result.coordinates, { lat: -35.042, lng: 150.669 });
	assert.equal(result.address?.city, 'Huskisson');
});

test('raw Pelias shape maps flat lat/lon into coordinates and keeps address', () => {
	const result = parse({
		display_name: '11 Dent Street, Huskisson, NSW, Australia',
		lat: -35.0347,
		lon: 150.6739,
		name: '11 Dent Street',
		layer: 'address',
		address: { city: 'Huskisson' }
	});
	assert.deepEqual(result.coordinates, { lat: -35.0347, lng: 150.6739 });
	assert.equal(result.address?.city, 'Huskisson');
});

test('legacy adapter shape keeps its current mapping (address string, no coordinates)', () => {
	// Pre-existing quirk, pinned deliberately: { address, location: { lat, lon } }
	// does not carry location.address or flat lat/lon, so it maps to a string
	// address with no coordinates. See ledger A3 ruling before changing.
	const result = parse({
		address: '11 Beecroft Street, Huskisson',
		location: { lat: -35.042, lon: 150.669 },
		display_name: '11 Beecroft Street, Huskisson'
	});
	assert.equal(result.coordinates, undefined);
	assert.equal(result.address, '11 Beecroft Street, Huskisson');
});

test('legacy plain string passes through', () => {
	const result = parse('Huskisson, NSW');
	assert.equal(result, 'Huskisson, NSW');
});
