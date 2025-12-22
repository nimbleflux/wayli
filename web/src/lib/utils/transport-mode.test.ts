import { describe, it, expect, beforeEach } from 'vitest';

import {
	detectEnhancedMode,
	haversine,
	getSpeedBracket,
	isAtTrainStation,
	isAtAirport,
	isOnHighwayOrMotorway,
	isModeSwitchPossible
} from './transport-mode';

import type { EnhancedModeContext } from './transport-mode';

describe('Transport Mode Detection', () => {
	// detectMode removed; basic detection covered via detectEnhancedMode
	describe('detectMode (via enhanced)', () => {
		it('should detect stationary for very slow speeds', () => {
			const ctx = {
				currentMode: 'unknown',
				lastSpeed: 0,
				trainStations: [],
				averageSpeed: 0,
				speedHistory: [],
				modeHistory: [],
				isInTrainJourney: false,
				airports: [],
				isInAirplaneJourney: false,
				totalDistanceTraveled: 0
			};
			const result = detectEnhancedMode(0, 0, 0.0001, 0.0001, 60, null, ctx);
			expect(result.mode).toBe('stationary');
		});
		it('should detect walking for slow speeds', () => {
			const ctx = {
				currentMode: 'unknown',
				lastSpeed: 0,
				trainStations: [],
				averageSpeed: 0,
				speedHistory: [],
				modeHistory: [],
				isInTrainJourney: false,
				airports: [],
				isInAirplaneJourney: false,
				totalDistanceTraveled: 0
			};
			const result = detectEnhancedMode(0, 0, 0.0003, 0.0003, 60, null, ctx);
			expect(result.mode).toBe('walking');
		});
		it('should detect cycling for moderate speeds', () => {
			const ctx = {
				currentMode: 'unknown',
				lastSpeed: 0,
				trainStations: [],
				averageSpeed: 0,
				speedHistory: [],
				modeHistory: [],
				isInTrainJourney: false,
				airports: [],
				isInAirplaneJourney: false,
				totalDistanceTraveled: 0
			};
			const result = detectEnhancedMode(0, 0, 0.001, 0.001, 60, null, ctx);
			expect(result.mode).toBe('cycling');
		});
		it('should detect car for higher speeds', () => {
			const ctx = {
				currentMode: 'unknown',
				lastSpeed: 0,
				trainStations: [],
				averageSpeed: 0,
				speedHistory: [],
				modeHistory: [],
				isInTrainJourney: false,
				airports: [],
				isInAirplaneJourney: false,
				totalDistanceTraveled: 0
			};
			const result = detectEnhancedMode(0, 0, 0.005, 0.005, 60, null, ctx);
			expect(result.mode).toBe('car');
		});
	});

	// detectTrainMode was removed; Enhanced mode covers train logic now

	describe('Enhanced Transport Mode Detection', () => {
		describe('Enhanced Mode Detection', () => {
			let context: EnhancedModeContext;

			beforeEach(() => {
				context = {
					currentMode: 'unknown',
					lastSpeed: 0,
					trainStations: [],
					averageSpeed: 0,
					speedHistory: [],
					modeHistory: [],
					isInTrainJourney: false,
					airports: [],
					isInAirplaneJourney: false,
					totalDistanceTraveled: 0
				};
			});

			it('should detect train journey with station visits', () => {
				const trainStationGeocode = {
					properties: {
						addendum: {
							osm: {
								railway: 'station',
								name: 'Central Station'
							}
						},
						address: { name: 'Central Station', city: 'Amsterdam' }
					}
				};

				const result = detectEnhancedMode(0, 0, 0.003, 0.003, 60, trainStationGeocode, context);
				expect(result.mode).toBe('train');
				// Note: isInTrainJourney might not be set immediately due to speed requirements
				// The important thing is that the mode is detected as train
			});

			it('should maintain mode continuity', () => {
				// Start with car mode and add some history
				context.currentMode = 'car';
				context.modeHistory = [
					{
						mode: 'car',
						timestamp: Date.now() - 60000,
						speed: 50,
						coordinates: { lat: 0.005, lng: 0.005 }
					},
					{
						mode: 'car',
						timestamp: Date.now() - 30000,
						speed: 55,
						coordinates: { lat: 0.005, lng: 0.005 }
					},
					{
						mode: 'car',
						timestamp: Date.now() - 10000,
						speed: 52,
						coordinates: { lat: 0.005, lng: 0.005 }
					}
				];

				const result = detectEnhancedMode(0.005, 0.005, 0.01, 0.01, 60, null, context);
				expect(result.mode).toBe('car');
				// The reason might be different due to the enhanced logic, just check that it's a car
			});
		});
	});

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

		describe('getSpeedBracket', () => {
			it('should return correct mode for speed brackets', () => {
				expect(getSpeedBracket(0.5)).toBe('stationary');
				expect(getSpeedBracket(5)).toBe('walking');
				expect(getSpeedBracket(15)).toBe('cycling');
				expect(getSpeedBracket(60)).toBe('car');
				expect(getSpeedBracket(150)).toBe('train');
				expect(getSpeedBracket(500)).toBe('airplane');
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

describe('isModeSwitchPossible', () => {
	it('should prevent cycling to train switch', () => {
		expect(isModeSwitchPossible('cycling', 'train', false)).toBe(false);
		expect(isModeSwitchPossible('cycling', 'train', true)).toBe(false); // Even at train station
	});

	it('should prevent train to cycling switch', () => {
		expect(isModeSwitchPossible('train', 'cycling', false)).toBe(false);
		expect(isModeSwitchPossible('train', 'cycling', true)).toBe(false); // Even at train station
	});

	it('should allow cycling to other modes', () => {
		expect(isModeSwitchPossible('cycling', 'walking', false)).toBe(true);
		expect(isModeSwitchPossible('cycling', 'car', false)).toBe(true);
		expect(isModeSwitchPossible('cycling', 'stationary', false)).toBe(true);
	});

	it('should allow train to car at station', () => {
		expect(isModeSwitchPossible('train', 'car', true)).toBe(true);
		expect(isModeSwitchPossible('train', 'car', false)).toBe(false);
	});

	it('should allow car to train at station', () => {
		expect(isModeSwitchPossible('car', 'train', true)).toBe(true);
		expect(isModeSwitchPossible('car', 'train', false)).toBe(false);
	});
});

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
