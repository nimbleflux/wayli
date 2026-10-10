import { describe, it, expect } from 'vitest';

import {
	haversine,
	isAtTrainStation,
	isAtAirport,
	isOnHighwayOrMotorway,
	isOnWaterGeocode
} from './transport-mode';

import type { GeocodeGeoJSONFeature } from './geojson-converter';

function geocode(properties: Record<string, unknown>): GeocodeGeoJSONFeature {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [150.67, -35.04] },
		properties: properties as never
	};
}

describe('isOnWaterGeocode (#220)', () => {
	it('treats a permanent no-result geocode failure as open water', () => {
		expect(
			isOnWaterGeocode(geocode({ geocoding_status: 'failed', geocode_error: 'No results found' }))
		).toBe(true);
	});

	it('does not treat retryable failures (rate limits) as water', () => {
		expect(isOnWaterGeocode(geocode({ geocoding_status: 'failed', retryable: true }))).toBe(false);
	});

	it('does not treat Pelias outage errors as water (non-retryable but not no-result)', () => {
		expect(
			isOnWaterGeocode(
				geocode({ geocoding_status: 'failed', geocode_error: 'All Pelias endpoints failed' })
			)
		).toBe(false);
		expect(
			isOnWaterGeocode(
				geocode({ geocoding_status: 'failed', geocode_error: 'Pelias error: 503 - upstream' })
			)
		).toBe(false);
	});

	it('treats the no-result error string as water', () => {
		expect(
			isOnWaterGeocode(
				geocode({ geocoding_status: 'failed', geocode_error: 'Pelias returned no results' })
			)
		).toBe(true);
	});

	it('treats the marine layer as water', () => {
		expect(isOnWaterGeocode(geocode({ layer: 'marine', name: 'Jervis Bay' }))).toBe(true);
	});

	it('treats water-related Pelias categories as water', () => {
		expect(isOnWaterGeocode(geocode({ category: ['water:bay'] }))).toBe(true);
	});

	it('treats OSM waterway/natural/man_made/seamark addendum tags as water', () => {
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { waterway: 'river' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { natural: 'water' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { natural: 'coastline' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { natural: 'bay' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { man_made: 'pier' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { man_made: 'breakwater' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { man_made: 'groyne' } } }))).toBe(true);
		expect(isOnWaterGeocode(geocode({ addendum: { osm: { 'seamark:type': 'buoy' } } }))).toBe(true);
	});

	it('returns false for ordinary land geocodes', () => {
		expect(
			isOnWaterGeocode(
				geocode({ layer: 'venue', name: 'Cafe', addendum: { osm: { amenity: 'cafe' } } })
			)
		).toBe(false);
		expect(isOnWaterGeocode(geocode({ layer: 'address', locality: 'Huskisson' }))).toBe(false);
	});

	it('returns false for missing, empty or non-attempted geocodes', () => {
		expect(isOnWaterGeocode(null)).toBe(false);
		expect(isOnWaterGeocode(undefined)).toBe(false);
		expect(isOnWaterGeocode({} as GeocodeGeoJSONFeature)).toBe(false);
	});
});

describe('Transport Mode Detection', () => {
	describe('Utility Functions', () => {
		describe('haversine', () => {
			it('should calculate distance between two points', () => {
				const distance = haversine(0, 0, 0, 1);
				expect(distance).toBeGreaterThan(0);
			});

			it('should return 0 for same point', () => {
				const distance = haversine(0, 0, 0, 0);
				expect(distance).toBe(0);
			});
		});

		describe('isAtTrainStation', () => {
			it('should detect railway station from OSM addendum', () => {
				const geocode = {
					properties: {
						addendum: {
							osm: {
								railway: 'station'
							}
						}
					}
				};
				expect(isAtTrainStation(geocode)).toBe(true);
			});

			it('should detect railway platform from OSM addendum', () => {
				const geocode = {
					properties: {
						addendum: {
							osm: {
								railway: 'platform'
							}
						}
					}
				};
				expect(isAtTrainStation(geocode)).toBe(true);
			});

			it('should detect public transport station from OSM addendum', () => {
				const geocode = {
					properties: {
						addendum: {
							osm: {
								public_transport: 'station'
							}
						}
					}
				};
				expect(isAtTrainStation(geocode)).toBe(true);
			});

			it('should return false for non-railway geocode', () => {
				const geocode = { properties: { type: 'restaurant' } };
				expect(isAtTrainStation(geocode)).toBe(false);
			});
		});
	});
});

// Train detection scenarios now covered by enhanced mode tests

describe('Pelias Geocode Format Detection', () => {
	describe('isAtTrainStation with Pelias OSM data', () => {
		it('should detect train station from OSM railway tag', () => {
			const geocode = {
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [4.9, 52.37] },
				properties: {
					label: 'Amsterdam Centraal',
					layer: 'venue',
					addendum: {
						osm: {
							railway: 'station',
							name: 'Amsterdam Centraal'
						}
					}
				}
			};
			expect(isAtTrainStation(geocode)).toBe(true);
		});

		it('should detect train station from OSM public_transport tag', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Platform 1',
					addendum: {
						osm: {
							public_transport: 'platform'
						}
					}
				}
			};
			expect(isAtTrainStation(geocode)).toBe(true);
		});

		it('should detect train station from Pelias category', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Central Station',
					category: ['transport:rail', 'transport:station']
				}
			};
			expect(isAtTrainStation(geocode)).toBe(true);
		});
	});

	describe('isAtAirport with Pelias OSM data', () => {
		it('should detect airport from OSM aeroway tag', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Schiphol Airport',
					addendum: {
						osm: {
							aeroway: 'aerodrome',
							name: 'Amsterdam Airport Schiphol'
						}
					}
				}
			};
			expect(isAtAirport(geocode)).toBe(true);
		});

		it('should detect airport terminal from OSM data', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Terminal 1',
					addendum: {
						osm: {
							aeroway: 'terminal'
						}
					}
				}
			};
			expect(isAtAirport(geocode)).toBe(true);
		});

		it('should detect airport from Pelias category', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Schiphol',
					category: ['transport:air']
				}
			};
			expect(isAtAirport(geocode)).toBe(true);
		});
	});

	describe('isOnHighwayOrMotorway with Pelias OSM data', () => {
		it('should detect motorway from OSM highway tag', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'A10',
					layer: 'street',
					addendum: {
						osm: {
							highway: 'motorway',
							ref: 'A10'
						}
					}
				}
			};
			expect(isOnHighwayOrMotorway(geocode)).toBe(true);
		});

		it('should detect trunk road from OSM highway tag', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'N200',
					addendum: {
						osm: {
							highway: 'trunk'
						}
					}
				}
			};
			expect(isOnHighwayOrMotorway(geocode)).toBe(true);
		});

		it('should detect primary road from OSM highway tag', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Main Road',
					addendum: {
						osm: {
							highway: 'primary'
						}
					}
				}
			};
			expect(isOnHighwayOrMotorway(geocode)).toBe(true);
		});

		it('should NOT detect residential street as highway', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					label: 'Residential Street',
					layer: 'street',
					addendum: {
						osm: {
							highway: 'residential'
						}
					}
				}
			};
			expect(isOnHighwayOrMotorway(geocode)).toBe(false);
		});

		it('should NOT detect regular address as highway', () => {
			// This is the exact format from the user's example
			const geocode = {
				type: 'Feature',
				geometry: { coordinates: [4.851864, 52.38353], type: 'Point' },
				properties: {
					addendum: {
						osm: {
							'addr:city': 'Amsterdam',
							'addr:housenumber': '47-1',
							'addr:postcode': '1055NJ',
							'addr:street': 'Gibraltarstraat',
							source: 'BAG',
							'source:date': '2014-03-24'
						}
					},
					address: { house_number: '47-1', postcode: '1055NJ', road: 'Gibraltarstraat' },
					city: null,
					confidence: 0.9,
					country: null,
					display_name: '47-1 Gibraltarstraat',
					geocoded_at: '2025-12-02T08:37:19.490Z',
					geocoding_provider: 'pelias',
					import_source: 'geojson',
					imported_at: '2025-12-01T20:52:15.801Z',
					label: '47-1 Gibraltarstraat',
					layer: 'address'
				}
			};
			expect(isOnHighwayOrMotorway(geocode)).toBe(false);
		});
	});

	describe('Regular address should not trigger special detection', () => {
		it('should NOT detect regular address as train station', () => {
			const geocode = {
				type: 'Feature',
				geometry: { coordinates: [4.851864, 52.38353], type: 'Point' },
				properties: {
					addendum: {
						osm: {
							'addr:city': 'Amsterdam',
							'addr:housenumber': '47-1',
							'addr:postcode': '1055NJ',
							'addr:street': 'Gibraltarstraat'
						}
					},
					address: { house_number: '47-1', postcode: '1055NJ', road: 'Gibraltarstraat' },
					label: '47-1 Gibraltarstraat',
					layer: 'address'
				}
			};
			expect(isAtTrainStation(geocode)).toBe(false);
		});

		it('should NOT detect regular address as airport', () => {
			const geocode = {
				type: 'Feature',
				properties: {
					addendum: {
						osm: {
							'addr:city': 'Amsterdam',
							'addr:street': 'Some Street'
						}
					},
					label: '123 Some Street',
					layer: 'address'
				}
			};
			expect(isAtAirport(geocode)).toBe(false);
		});
	});
});
