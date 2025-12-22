/**
 * OwnTracks Points Edge Function
 * Receives and processes GPS tracking data from OwnTracks devices
 * @fluxbase:allow-unauthenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

import type { FluxbaseClient } from '../jobs/types';

// ===== Type Definitions =====
interface FluxbaseRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string;
	params: Record<string, string>;
}

interface FluxbaseResponse {
	status: number;
	headers?: Record<string, string>;
	body?: string;
}

interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

// ===== Utility Functions =====
function successResponse<T>(data: T, status = 200): FluxbaseResponse {
	const response: ApiResponse<T> = {
		success: true,
		data
	};

	return {
		status,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(response)
	};
}

function errorResponse(message: string, status = 400): FluxbaseResponse {
	const response: ApiResponse = {
		success: false,
		error: message
	};

	return {
		status,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(response)
	};
}

async function parseJsonBody<T>(req: FluxbaseRequest): Promise<T> {
	try {
		return JSON.parse(req.body);
	} catch {
		throw new Error('Invalid JSON body');
	}
}

function logError(error: unknown, context: string, data?: unknown): void {
	console.error(`❌ [${context}] Error:`, error, data || '');
}

function logInfo(message: string, context: string, data?: unknown): void {
	console.log(`ℹ️ [${context}] ${message}`, data || '');
}

function logSuccess(message: string, context: string, data?: unknown): void {
	console.log(`✅ [${context}] ${message}`, data || '');
}

// ===== Configuration =====
const PELIAS_ENDPOINT = Deno.env.get('PELIAS_ENDPOINT') || 'https://pelias.wayli.app';

// Country code conversion (3-letter to 2-letter ISO)
const COUNTRY_CODE_3TO2: Record<string, string> = {
	'USA': 'US', 'GBR': 'GB', 'DEU': 'DE', 'FRA': 'FR', 'ITA': 'IT', 'ESP': 'ES', 'NLD': 'NL', 'BEL': 'BE',
	'AUT': 'AT', 'CHE': 'CH', 'POL': 'PL', 'CZE': 'CZ', 'DNK': 'DK', 'SWE': 'SE', 'NOR': 'NO', 'FIN': 'FI',
	'PRT': 'PT', 'GRC': 'GR', 'IRL': 'IE', 'HUN': 'HU', 'ROU': 'RO', 'BGR': 'BG', 'HRV': 'HR', 'SVN': 'SI',
	'SVK': 'SK', 'LUX': 'LU', 'EST': 'EE', 'LVA': 'LV', 'LTU': 'LT', 'CAN': 'CA', 'MEX': 'MX', 'BRA': 'BR',
	'ARG': 'AR', 'AUS': 'AU', 'NZL': 'NZ', 'JPN': 'JP', 'KOR': 'KR', 'CHN': 'CN', 'IND': 'IN', 'RUS': 'RU',
	'ZAF': 'ZA', 'TUR': 'TR', 'ISR': 'IL', 'ARE': 'AE', 'SGP': 'SG', 'MYS': 'MY', 'THA': 'TH', 'IDN': 'ID',
	'PHL': 'PH', 'VNM': 'VN', 'TWN': 'TW', 'HKG': 'HK', 'MAC': 'MO'
};

function convertCountryCode3to2(code3: string): string {
	return COUNTRY_CODE_3TO2[code3?.toUpperCase()] || code3?.toLowerCase() || '';
}

// Helper function to perform reverse geocoding using Pelias
async function reverseGeocode(lat: number, lon: number): Promise<any | null> {
	try {
		const peliasUrl = `${PELIAS_ENDPOINT}/v1/reverse?point.lat=${lat}&point.lon=${lon}&size=1`;

		const response = await fetch(peliasUrl, {
			headers: {
				'User-Agent': 'Wayli/1.0 (https://wayli.app)',
				'Accept': 'application/json'
			}
		});

		if (!response.ok) {
			logError(`Pelias API error: ${response.status}`, 'OWNTRACKS_REVERSE_GEOCODE');
			return null;
		}

		const result = await response.json();

		// Check if Pelias returned any results
		if (!result.features || result.features.length === 0) {
			logError('Pelias returned no results', 'OWNTRACKS_REVERSE_GEOCODE');
			return null;
		}

		const feature = result.features[0];
		const props = feature.properties;

		// Build normalized address
		const address: Record<string, string> = {};
		if (props.locality) address.city = props.locality;
		if (props.region) address.state = props.region;
		if (props.country) address.country = props.country;
		if (props.neighbourhood) address.neighbourhood = props.neighbourhood;
		if (props.street) address.road = props.street;
		if (props.housenumber) address.house_number = props.housenumber;
		if (props.postalcode) address.postcode = props.postalcode;
		if (props.country_a) address.country_code = convertCountryCode3to2(props.country_a);

		// Return geocode data in the format expected by tracker_data.geocode column
		return {
			type: 'Feature',
			geometry: {
				type: 'Point',
				coordinates: [lon, lat]
			},
			properties: {
				display_name: props.label || '',
				label: props.label,
				name: props.name,
				layer: props.layer,
				category: props.category,
				confidence: props.confidence,
				address: address,
				locality: props.locality,
				region: props.region,
				country: props.country,
				neighbourhood: props.neighbourhood,
				borough: props.borough,
				geocoded_at: new Date().toISOString(),
				geocoding_provider: 'pelias',
				import_source: 'owntracks',
				imported_at: new Date().toISOString()
			}
		};
	} catch (error) {
		logError(error, 'OWNTRACKS_REVERSE_GEOCODE');
		return null;
	}
}

async function handler(
	req: FluxbaseRequest,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient
): Promise<FluxbaseResponse> {
	try {
		// This endpoint uses API key authentication instead of JWT
		// We check for query parameters first to allow OwnTracks devices to connect
		// without JWT tokens.
		const apiKey = req.params.api_key;
		const userId = req.params.user_id;

		if (!userId || !apiKey) {
			logError('Missing api_key or user_id in query parameters', 'OWNTRACKS_POINTS');
			return errorResponse('api_key and user_id required in query parameters', 400);
		}

		// Validate UUID format for user ID
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(userId)) {
			logError('Invalid user ID format', 'OWNTRACKS_POINTS');
			return errorResponse('Invalid user ID format', 400);
		}

		// Verify API key by checking user preferences
		// The API key is stored in user_preferences.owntracks_api_key
		const { data: userData, error: userError } = await fluxbaseService
			.from('user_preferences')
			.select('owntracks_api_key')
			.eq('id', userId)
			.single();

		if (userError || !userData) {
			logError('User not found', 'OWNTRACKS_POINTS', { userId });
			return errorResponse('Invalid user ID', 401);
		}

		const storedApiKey = userData.owntracks_api_key;
		if (!storedApiKey || storedApiKey !== apiKey) {
			logError('Invalid API key', 'OWNTRACKS_POINTS', { userId });
			return errorResponse('Invalid or inactive API key', 401);
		}

		const user = { id: userId };
		logInfo('API key authentication successful', 'OWNTRACKS_POINTS', { userId });

		// Only allow POST requests (OwnTracks sends location data in POST body)
		if (req.method !== 'POST') {
			return errorResponse('Method not allowed', 405);
		}

		logInfo('Processing OwnTracks points', 'OWNTRACKS_POINTS', { userId: user.id });

		// Parse request body for location data
		const body = await parseJsonBody<Record<string, unknown>>(req);

		// Handle both single location objects and arrays of points
		// OwnTracks sends single location objects, but we also support batch imports
		let points: any[];
		if (body._type === 'location') {
			// Single OwnTracks location object
			points = [body];
		} else if (Array.isArray(body.points)) {
			// Array of points (for batch import)
			points = body.points;
		} else if (Array.isArray(body)) {
			// Direct array of points
			points = body;
		} else {
			points = [];
		}

		if (!Array.isArray(points) || points.length === 0) {
			logError('No valid points data found', 'OWNTRACKS_POINTS');
			return errorResponse('No valid points data found', 400);
		}

		logInfo('Processing points', 'OWNTRACKS_POINTS', {
			userId: user.id,
			pointCount: points.length
		});

		// Process points and perform reverse geocoding synchronously
		// This ensures data is complete when inserted (takes longer but better data quality)
		const processedPoints = await Promise.all(
			points.map(async (point: any) => {
				let geocodeData = null;
				let countryCode = null;

				// Always fetch reverse geocode from Pelias for consistency
				try {
					logInfo('Fetching reverse geocode from Pelias', 'OWNTRACKS_GEOCODE', {
						userId: user.id,
						lat: point.lat,
						lon: point.lon
					});

					geocodeData = await reverseGeocode(point.lat, point.lon);

					if (geocodeData) {
						countryCode = geocodeData.properties?.address?.country_code?.toUpperCase() || null;
						logSuccess('Point geocoded successfully', 'OWNTRACKS_GEOCODE', {
							userId: user.id,
							timestamp: point.tst,
							countryCode
						});
					} else {
						logError(
							`Geocoding returned null for user ${user.id} at lat=${point.lat}, lon=${point.lon}`,
							'OWNTRACKS_GEOCODE'
						);
					}
				} catch (error) {
					// Log the error with full details but continue - we'll insert the point without geocode data
					const errorMsg = error instanceof Error ? error.message : String(error);
					const errorStack = error instanceof Error ? error.stack : '';
					logError(
						`Geocoding failed for user ${user.id} at lat=${point.lat}, lon=${point.lon}: ${errorMsg}\n${errorStack}`,
						'OWNTRACKS_GEOCODE'
					);
				}

				// Return processed point with geocode data (if available)
				return {
					user_id: user.id,
					tracker_type: 'owntracks',
					device_id: point.tid || 'owntracks',
					recorded_at: new Date(point.tst * 1000).toISOString(),
					location: `POINT(${point.lon} ${point.lat})`,
					altitude: point.alt || null,
					accuracy: point.acc || null,
					speed: point.vel || null,
					heading: point.cog || null,
					battery_level: point.batt || null,
					geocode: geocodeData,
					country_code: countryCode
				};
			})
		);

		// Insert points with complete geocode data using SDK
		// Use upsert with ignoreDuplicates to handle cases where OwnTracks retries the same point
		const { data: insertedPoints, error: insertError } = await fluxbaseService
			.from('tracker_data')
			.upsert(processedPoints, { ignoreDuplicates: true });

		if (insertError) {
			logError(
				`Failed to insert ${processedPoints.length} points for user ${user.id}: ${insertError.message}`,
				'OWNTRACKS_POINTS'
			);
			return errorResponse('Failed to insert points', 500);
		}
		const geocodedCount = processedPoints.filter((p) => p.geocode !== null).length;
		const insertedCount = insertedPoints?.length || processedPoints.length;

		logSuccess('Points inserted successfully', 'OWNTRACKS_POINTS', {
			userId: user.id,
			totalCount: insertedCount,
			geocodedCount,
			ungeocodedCount: insertedCount - geocodedCount
		});

		return successResponse({
			message: 'Points inserted successfully',
			count: insertedCount
		});
	} catch (error) {
		logError(error, 'OWNTRACKS_POINTS');
		return errorResponse('Internal server error', 500);
	}
}

export default handler;
