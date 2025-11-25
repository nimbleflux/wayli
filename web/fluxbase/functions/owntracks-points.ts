/**
 * OwnTracks Points Edge Function
 * Receives and processes GPS tracking data from OwnTracks devices
 * @fluxbase:allow-unauthenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

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
const NOMINATIM_ENDPOINT = Deno.env.get('NOMINATIM_ENDPOINT') || 'https://nominatim.openstreetmap.org';

// Helper function to perform reverse geocoding
async function reverseGeocode(lat: number, lon: number): Promise<any | null> {
	try {
		const nominatimUrl = new URL('/reverse', NOMINATIM_ENDPOINT);
		nominatimUrl.searchParams.set('lat', lat.toString());
		nominatimUrl.searchParams.set('lon', lon.toString());
		nominatimUrl.searchParams.set('format', 'jsonv2');
		nominatimUrl.searchParams.set('addressdetails', '1');
		nominatimUrl.searchParams.set('extratags', '1');
		nominatimUrl.searchParams.set('namedetails', '1');

		const response = await fetch(nominatimUrl.toString(), {
			headers: {
				'User-Agent': 'Wayli/1.0 (https://wayli.app)'
			}
		});

		if (!response.ok) {
			logError(`Nominatim API error: ${response.status}`, 'OWNTRACKS_REVERSE_GEOCODE');
			return null;
		}

		const result = await response.json();

		// Return geocode data in the format expected by tracker_data.geocode column
		return {
			type: 'Feature',
			geometry: {
				type: 'Point',
				coordinates: [lon, lat]
			},
			properties: {
				place_id: result.place_id,
				osm_type: result.osm_type,
				osm_id: result.osm_id,
				type: result.type,
				class: result.class,
				addresstype: result.addresstype,
				display_name: result.display_name,
				name: result.name,
				address: result.address || {},
				extratags: result.extratags || {},
				namedetails: result.namedetails || {},
				geocoded_at: new Date().toISOString(),
				geocoding_provider: 'nominatim'
			}
		};
	} catch (error) {
		logError(error, 'OWNTRACKS_REVERSE_GEOCODE');
		return null;
	}
}

async function handler(req: FluxbaseRequest): Promise<FluxbaseResponse> {
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

		// Create service role client to verify API key and insert data
		const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
		const fluxbaseServiceKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');

		if (!fluxbaseUrl || !fluxbaseServiceKey) {
			logError('Missing environment variables', 'OWNTRACKS_POINTS');
			return errorResponse('Server configuration error', 500);
		}

		// Verify API key by checking user preferences
		// The API key is stored in user_preferences.owntracks_api_key
		const userResponse = await fetch(
			`${fluxbaseUrl}/rest/v1/user_preferences?id=eq.${userId}&select=owntracks_api_key`,
			{
				headers: {
					'apikey': fluxbaseServiceKey,
					'Authorization': `Bearer ${fluxbaseServiceKey}`
				}
			}
		);

		if (!userResponse.ok) {
			logError('Failed to fetch user', 'OWNTRACKS_POINTS', { userId });
			return errorResponse('Invalid user ID', 401);
		}

		const userData = await userResponse.json();
		if (!userData || userData.length === 0) {
			logError('User not found', 'OWNTRACKS_POINTS', { userId });
			return errorResponse('Invalid user ID', 401);
		}

		const storedApiKey = userData[0]?.owntracks_api_key;
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

				// Always fetch reverse geocode from Nominatim for consistency
				try {
					logInfo('Fetching reverse geocode from Nominatim', 'OWNTRACKS_GEOCODE', {
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

		// Insert points with complete geocode data using REST API
		// Use upsert with ignoreDuplicates to handle cases where OwnTracks retries the same point
		const insertResponse = await fetch(`${fluxbaseUrl}/rest/v1/tracker_data`, {
			method: 'POST',
			headers: {
				'apikey': fluxbaseServiceKey,
				'Authorization': `Bearer ${fluxbaseServiceKey}`,
				'Content-Type': 'application/json',
				'Prefer': 'resolution=ignore-duplicates,return=representation'
			},
			body: JSON.stringify(processedPoints)
		});

		if (!insertResponse.ok) {
			const errorText = await insertResponse.text();
			logError(
				`Failed to insert ${processedPoints.length} points for user ${user.id}: ${errorText}`,
				'OWNTRACKS_POINTS'
			);
			return errorResponse('Failed to insert points', 500);
		}

		const insertedPoints = await insertResponse.json();
		const geocodedCount = processedPoints.filter((p) => p.geocode !== null).length;

		logSuccess('Points inserted successfully', 'OWNTRACKS_POINTS', {
			userId: user.id,
			totalCount: insertedPoints?.length || 0,
			geocodedCount,
			ungeocodedCount: (insertedPoints?.length || 0) - geocodedCount
		});

		return successResponse({
			message: 'Points inserted successfully',
			count: insertedPoints?.length || 0
		});
	} catch (error) {
		logError(error, 'OWNTRACKS_POINTS');
		return errorResponse('Internal server error', 500);
	}
}

export default handler;
