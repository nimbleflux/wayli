/**
 * Trip Image Suggestion Edge Function
 * Suggests images for trips based on travel data
 * Authentication required (enforced by platform)
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
	// Platform-injected authentication fields
	user_id?: string;
	user_email?: string;
	user_role?: string;
	session_id?: string;
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

function validateRequiredFields(obj: Record<string, unknown>, fields: string[]): string[] {
	const missing: string[] = [];

	for (const field of fields) {
		if (!obj || obj[field] === undefined || obj[field] === null || obj[field] === '') {
			missing.push(field);
		}
	}

	return missing;
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

// Helper function to make REST API calls
async function fluxbaseQuery(url: string, options: {
	method?: string;
	body?: any;
	select?: string;
	filter?: string;
} = {}) {
	const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
	const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');

	let apiUrl = `${fluxbaseUrl}/rest/v1/${url}`;
	const params = new URLSearchParams();
	if (options.select) params.set('select', options.select);
	if (options.filter) apiUrl += `?${options.filter}`;
	else if (params.toString()) apiUrl += `?${params.toString()}`;

	const response = await fetch(apiUrl, {
		method: options.method || 'GET',
		headers: {
			'apikey': fluxbaseKey!,
			'Authorization': `Bearer ${fluxbaseKey}`,
			'Content-Type': 'application/json'
		},
		body: options.body ? JSON.stringify(options.body) : undefined
	});

	if (!response.ok) {
		throw new Error(`API error: ${response.status}`);
	}

	return response.json();
}

// Helper function to get the best available Pexels API key
// Priority: User's personal key > Server key from database
async function getPexelsApiKey(userId: string): Promise<string | null> {
	try {
		// First try user's personal API key
		const preferences = await fluxbaseQuery('user_preferences', {
			select: 'pexels_api_key',
			filter: `id=eq.${userId}`
		});

		if (preferences && preferences[0]?.pexels_api_key) {
			logInfo('Using user personal Pexels API key', 'TRIPS-SUGGEST-IMAGE');
			return preferences[0].pexels_api_key;
		}

		// Fallback to server-level key from server_settings table
		const serverSettings = await fluxbaseQuery('server_settings', {
			select: 'server_pexels_api_key'
		});

		if (serverSettings && serverSettings[0]?.server_pexels_api_key) {
			logInfo('Using server-level Pexels API key from database', 'TRIPS-SUGGEST-IMAGE');
			return serverSettings[0].server_pexels_api_key;
		}

		logError('No Pexels API key available', 'TRIPS-SUGGEST-IMAGE');
		return null;
	} catch (error) {
		logError(`Error getting Pexels API key: ${error}`, 'TRIPS-SUGGEST-IMAGE');
		return null;
	}
}

async function handler(req: FluxbaseRequest): Promise<FluxbaseResponse> {
	try {
		// Platform authentication: req.user_id is automatically populated by Fluxbase
		// If user_id is missing, platform already returned 401
		if (!req.user_id) {
			return errorResponse('Unauthorized', 401);
		}

		const userId = req.user_id;

		if (req.method === 'POST') {
			logInfo('Suggesting trip image', 'TRIPS-SUGGEST-IMAGE', { userId });

			const body = await parseJsonBody<Record<string, unknown>>(req);

			// Check if this is a new trip suggestion (based on date range) or existing trip
			const tripId = body.trip_id as string;
			const startDate = body.start_date as string;
			const endDate = body.end_date as string;

			if (tripId && tripId !== 'temp') {
				// Existing trip image suggestion
				logInfo('Suggesting image for existing trip', 'TRIPS-SUGGEST-IMAGE', { tripId });

				// Validate required fields
				const requiredFields = ['trip_id'];
				const missingFields = validateRequiredFields(body, requiredFields);

				if (missingFields.length > 0) {
					return errorResponse(`Missing required fields: ${missingFields.join(', ')}`, 400);
				}

				// Verify trip ownership
				const trips = await fluxbaseQuery('trips', {
					select: 'id,title,description,start_date,end_date,metadata,status',
					filter: `id=eq.${tripId}&user_id=eq.${userId}`
				});

				const trip = trips && trips.length > 0 ? trips[0] : null;

				if (!trip) {
					logError('Trip not found', 'TRIPS-SUGGEST-IMAGE');
					return errorResponse('Trip not found', 404);
				}

				// Check if this is a suggested trip (status='pending') that needs image generation
				if (trip.status === 'pending' && trip.start_date && trip.end_date) {
					// Type guard to ensure dates are strings
					const startDate = String(trip.start_date);
					const endDate = String(trip.end_date);

					logInfo(
						'Generating image for suggested trip based on date range',
						'TRIPS-SUGGEST-IMAGE',
						{
							userId,
							tripId,
							startDate,
							endDate
						}
					);

					// Analyze user's travel data for the date range
					const analysis = await analyzeTripLocations(userId, startDate, endDate);

					if (!analysis.primaryCountry) {
						return errorResponse('No travel data found for the specified date range', 404);
					}

					// Get the best available Pexels API key
					const apiKey = await getPexelsApiKey(userId);
					if (!apiKey) {
						return errorResponse(
							'No Pexels API key available. Please configure your API key in preferences.',
							400
						);
					}

					// Extract metadata if available
					const tripMetadata =
						trip.metadata && typeof trip.metadata === 'object' ? (trip.metadata as any) : undefined;

					// Generate image suggestion based on analysis and metadata
					const suggestion = await generateImageSuggestionFromAnalysis(
						analysis,
						apiKey,
						tripMetadata
					);

					logSuccess('Image suggestion generated for suggested trip', 'TRIPS-SUGGEST-IMAGE', {
						userId,
						tripId,
						primaryCountry: analysis.primaryCountry || 'Unknown',
						primaryCity: analysis.primaryCity || undefined
					});

					return successResponse({
						suggestedImageUrl: suggestion.imageUrl,
						attribution: suggestion.attribution,
						analysis: analysis,
						message: 'Image suggestion generated successfully'
					});
				} else {
					// Regular trip - generate text suggestions
					const suggestions = await generateImageSuggestions(trip);

					logSuccess('Image suggestions generated successfully', 'TRIPS-SUGGEST-IMAGE', {
						userId,
						tripId,
						suggestionCount: suggestions.length
					});

					return successResponse({
						trip_id: tripId,
						suggestions,
						message: 'Image suggestions generated successfully'
					});
				}
			} else if (startDate && endDate) {
				// New trip image suggestion based on date range
				logInfo('Suggesting image for new trip based on date range', 'TRIPS-SUGGEST-IMAGE', {
					userId,
					startDate,
					endDate
				});

				// Analyze user's travel data for the date range
				const analysis = await analyzeTripLocations(userId, startDate, endDate);

				if (!analysis.primaryCountry) {
					return errorResponse('No travel data found for the specified date range', 404);
				}

				// Get the best available Pexels API key
				const apiKey = await getPexelsApiKey(userId);
				if (!apiKey) {
					return errorResponse(
						'No Pexels API key available. Please configure your API key in preferences.',
						400
					);
				}

				// Generate image suggestion based on analysis (no metadata available for new trips)
				const suggestion = await generateImageSuggestionFromAnalysis(analysis, apiKey);

				logSuccess('Image suggestion generated for new trip', 'TRIPS-SUGGEST-IMAGE', {
					userId,
					primaryCountry: analysis.primaryCountry || 'Unknown', // This is now the full name
					primaryCity: analysis.primaryCity || undefined
				});

				return successResponse({
					suggestedImageUrl: suggestion.imageUrl,
					attribution: suggestion.attribution,
					analysis: analysis,
					message: 'Image suggestion generated successfully'
				});
			} else {
				return errorResponse('Either trip_id or start_date/end_date must be provided', 400);
			}
		}

		return errorResponse('Method not allowed', 405);
	} catch (error) {
		logError(error, 'TRIPS-SUGGEST-IMAGE');
		return errorResponse('Internal server error', 500);
	}
}

// Helper function to analyze trip locations for a date range
async function analyzeTripLocations(
	userId: string,
	startDate: string,
	endDate: string
): Promise<{
	primaryCountry: string;
	primaryCity?: string;
	allCountries: string[];
	allCities: string[];
	countryStats: Record<string, number>;
	cityStats: Record<string, number>;
	isMultiCity: boolean;
	distanceTraveled: number;
}> {
	// Fetch tracker data for the date range
	const trackerData = await fluxbaseQuery('tracker_data', {
		select: 'country_code,geocode,recorded_at,distance',
		filter: `user_id=eq.${userId}&recorded_at=gte.${startDate}T00:00:00Z&recorded_at=lte.${endDate}T23:59:59Z&country_code=not.is.null&order=recorded_at.asc`
	});

	// Calculate total distance for the date range
	let distanceTraveled = 0;
	if (trackerData && trackerData.length > 0) {
		distanceTraveled = trackerData.reduce(
			(sum: number, row: any) => sum + (typeof row.distance === 'number' ? row.distance : 0),
			0
		);
	} else {
		return {
			primaryCountry: '',
			primaryCity: undefined,
			allCountries: [],
			allCities: [],
			countryStats: {},
			cityStats: {},
			isMultiCity: false,
			distanceTraveled
		};
	}

	// Count countries and cities
	const countryStats: Record<string, number> = {};
	const cityStats: Record<string, number> = {};
	const allCountries = new Set<string>();
	const allCities = new Set<string>();

	trackerData.forEach((point: any) => {
		// Count countries
		if (point.country_code) {
			const country = point.country_code.toUpperCase();
			countryStats[country] = (countryStats[country] || 0) + 1;
			allCountries.add(country);
		}

		// Count cities from geocode data
		if (point.geocode) {
			try {
				const geocode =
					typeof point.geocode === 'string' ? JSON.parse(point.geocode) : point.geocode;

				if (geocode && geocode.properties && geocode.properties.address) {
					const city =
						geocode.properties.address.city ||
						geocode.properties.address.town ||
						geocode.properties.address.village ||
						geocode.properties.address.suburb ||
						geocode.properties.address.neighbourhood;

					if (city) {
						const cityKey = city.toLowerCase().trim();
						cityStats[cityKey] = (cityStats[cityKey] || 0) + 1;
						allCities.add(city);
					}
				}
			} catch (parseError) {
				// Ignore geocode parsing errors - logged as info since it's not critical
				logInfo('Failed to parse geocode data, continuing with trip name', 'TRIPS_SUGGEST_IMAGE', {
					error: parseError
				});
			}
		}
	});

	// Map country codes to full names using the full_country SQL function
	const countryCodes = Array.from(allCountries);
	const codeToName: Record<string, string> = {};
	for (const code of countryCodes) {
		try {
			const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
			const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');
			const response = await fetch(`${fluxbaseUrl}/rest/v1/rpc/full_country`, {
				method: 'POST',
				headers: {
					'apikey': fluxbaseKey!,
					'Authorization': `Bearer ${fluxbaseKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ country: code })
			});
			const data = await response.json();
			codeToName[code] = (data && typeof data === 'string' && data) || code;
		} catch (error) {
			// If the full_country function doesn't exist, just use the code
			logInfo(
				`full_country function not available, using country code: ${code}`,
				'TRIPS-SUGGEST-IMAGE'
			);
			codeToName[code] = code;
		}
	}

	// Replace codes with names in allCountries and countryStats
	const allCountriesFull = countryCodes.map((code) => codeToName[code] || code);
	const countryStatsFull: Record<string, number> = {};
	for (const code of Object.keys(countryStats)) {
		const name = codeToName[code] || code;
		countryStatsFull[name] = countryStats[code];
	}

	// Find primary country (most visited)
	const primaryCountryCode = Object.keys(countryStats).reduce(
		(a, b) => (countryStats[a] > countryStats[b] ? a : b),
		''
	);
	const primaryCountry = codeToName[primaryCountryCode] || primaryCountryCode;

	// Find primary city (most visited)
	const primaryCity = Object.keys(cityStats).reduce(
		(a, b) => (cityStats[a] > cityStats[b] ? a : b),
		''
	);

	// Determine if this is a multi-city trip
	const isMultiCity = Object.keys(cityStats).length > 1;

	return {
		primaryCountry,
		primaryCity: primaryCity || undefined,
		allCountries: allCountriesFull,
		allCities: Array.from(allCities),
		countryStats: countryStatsFull,
		cityStats,
		isMultiCity,
		distanceTraveled
	};
}

// Helper function to clean country names for better search results
function cleanCountryNameForSearch(countryName: string): string {
	const politicalIndicators = [
		'Republic of the',
		'Republic of',
		'Democratic Republic of the',
		'Democratic Republic of',
		'Islamic Republic of',
		"People's Republic of",
		'United Republic of',
		'Federated States of',
		'Commonwealth of',
		'Kingdom of',
		'Principality of',
		'Grand Duchy of',
		'State of',
		'Territory of',
		'Province of China',
		'Federation',
		'Union'
	];

	const suffixIndicators = ['Islands', 'Island', 'Territories'];

	let cleaned = countryName.trim();

	// Remove political indicators from the beginning
	for (const indicator of politicalIndicators) {
		const regex = new RegExp(`^${indicator}\\s+`, 'i');
		if (regex.test(cleaned)) {
			cleaned = cleaned.replace(regex, '').trim();
			break;
		}
	}

	// Remove suffix indicators from the end
	for (const indicator of suffixIndicators) {
		const regex = new RegExp(`\\s+${indicator}$`, 'i');
		if (regex.test(cleaned)) {
			cleaned = cleaned.replace(regex, '').trim();
			break;
		}
	}

	// Handle special patterns
	cleaned = cleaned.replace(/,\s*Province of China$/i, '');

	// Remove leading "the" if it remains after removing political indicators
	cleaned = cleaned.replace(/^the\s+/i, '').trim();

	// Handle special cases
	const specialCases: Record<string, string> = {
		'United States': 'USA',
		'United Kingdom': 'UK',
		'Russian Federation': 'Russia',
		'Czech Republic': 'Czechia',
		'Timor-Leste': 'East Timor',
		"Côte d'Ivoire": 'Ivory Coast',
		Myanmar: 'Burma'
	};

	return specialCases[cleaned] || cleaned;
}

// Helper function to generate image suggestion from analysis
async function generateImageSuggestionFromAnalysis(
	analysis: { primaryCountry: string; primaryCity?: string; isMultiCity: boolean },
	apiKey: string,
	tripMetadata?: {
		visitedCitiesDetailed?: Array<{
			city: string;
			countryCode: string;
			durationHours: number;
			dataPoints: number;
		}>;
		visitedCountriesDetailed?: Array<{
			countryCode: string;
			durationHours: number;
			dataPoints: number;
		}>;
		isMultiCountryTrip?: boolean;
		isMultiCityTrip?: boolean;
	}
): Promise<{
	imageUrl: string;
	attribution?: {
		source: 'pexels' | 'picsum' | 'placeholder';
		photographer?: string;
		photographerUrl?: string;
		pexelsUrl?: string;
	};
}> {
	// Create a more specific search term for better results
	let searchTerm = 'landscape';

	// Prefer using metadata if available (duration-based, more accurate)
	if (tripMetadata) {
		if (tripMetadata.visitedCountriesDetailed && tripMetadata.visitedCountriesDetailed.length > 1) {
			// Multi-country trip: use country with longest duration
			const dominantCountry = tripMetadata.visitedCountriesDetailed.sort(
				(a, b) => b.durationHours - a.durationHours
			)[0];

			// Map country code to full name
			const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
			const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');
			const fullNameResponse = await fetch(`${fluxbaseUrl}/rest/v1/rpc/full_country`, {
				method: 'POST',
				headers: {
					'apikey': fluxbaseKey!,
					'Authorization': `Bearer ${fluxbaseKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ country: dominantCountry.countryCode })
			});
			const fullName = await fullNameResponse.json();
			const countryName =
				(fullName && typeof fullName === 'string' && fullName) || dominantCountry.countryCode;

			searchTerm = cleanCountryNameForSearch(countryName);
			logInfo(
				`Using dominant country from metadata: ${countryName} (${dominantCountry.durationHours}h)`,
				'TRIPS-SUGGEST-IMAGE'
			);
		} else if (
			tripMetadata.visitedCitiesDetailed &&
			tripMetadata.visitedCitiesDetailed.length > 1
		) {
			// Multi-city trip (same country): use city with longest duration
			const dominantCity = tripMetadata.visitedCitiesDetailed.sort(
				(a, b) => b.durationHours - a.durationHours
			)[0];
			searchTerm = `${dominantCity.city} city`;
			logInfo(
				`Using dominant city from metadata: ${dominantCity.city} (${dominantCity.durationHours}h)`,
				'TRIPS-SUGGEST-IMAGE'
			);
		} else if (
			tripMetadata.visitedCitiesDetailed &&
			tripMetadata.visitedCitiesDetailed.length === 1
		) {
			// Single city trip
			searchTerm = `${tripMetadata.visitedCitiesDetailed[0].city} city`;
			logInfo(
				`Using single city from metadata: ${tripMetadata.visitedCitiesDetailed[0].city}`,
				'TRIPS-SUGGEST-IMAGE'
			);
		} else if (
			tripMetadata.visitedCountriesDetailed &&
			tripMetadata.visitedCountriesDetailed.length === 1
		) {
			// Single country trip
			const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL');
			const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY');
			const fullNameResponse = await fetch(`${fluxbaseUrl}/rest/v1/rpc/full_country`, {
				method: 'POST',
				headers: {
					'apikey': fluxbaseKey!,
					'Authorization': `Bearer ${fluxbaseKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ country: tripMetadata.visitedCountriesDetailed[0].countryCode })
			});
			const fullName = await fullNameResponse.json();
			const countryName =
				(fullName && typeof fullName === 'string' && fullName) ||
				tripMetadata.visitedCountriesDetailed[0].countryCode;
			searchTerm = `${cleanCountryNameForSearch(countryName)} landscape`;
			logInfo(`Using single country from metadata: ${countryName}`, 'TRIPS-SUGGEST-IMAGE');
		}
	}

	// Fallback to analysis-based logic if no metadata was used
	if (searchTerm === 'landscape') {
		// Prefer city over country for better search results
		if (analysis.primaryCity) {
			searchTerm = `${analysis.primaryCity} city`;
			logInfo(
				`Fallback: Using primary city from analysis: ${analysis.primaryCity}`,
				'TRIPS-SUGGEST-IMAGE'
			);
		} else if (analysis.primaryCountry) {
			searchTerm = `${cleanCountryNameForSearch(analysis.primaryCountry)} landscape`;
			logInfo(
				`Fallback: Using primary country from analysis: ${analysis.primaryCountry}`,
				'TRIPS-SUGGEST-IMAGE'
			);
		}
	}

	// Search for images on Pexels
	logInfo(`Searching Pexels for: ${searchTerm}`, 'TRIPS-SUGGEST-IMAGE');
	const searchResult = await searchPexelsImages(searchTerm, apiKey);

	if (searchResult && searchResult.photos.length > 0) {
		// Randomly select a photo from the results
		const randomIndex = Math.floor(Math.random() * searchResult.photos.length);
		const photo = searchResult.photos[randomIndex];
		logSuccess(
			`Found Pexels image for: ${searchTerm} (selected ${randomIndex + 1} of ${searchResult.photos.length})`,
			'TRIPS-SUGGEST-IMAGE'
		);

		// Return the Pexels URL directly (no upload to storage)
		return {
			imageUrl: photo.src.large,
			attribution: {
				source: 'pexels',
				photographer: photo.photographer,
				photographerUrl: photo.photographer_url,
				pexelsUrl: photo.url
			}
		};
	} else {
		logError(`No Pexels images found for: ${searchTerm}`, 'TRIPS-SUGGEST-IMAGE');
	}

	// Fallback to placeholder if Pexels search fails
	logError(`No Pexels images found for: ${searchTerm}, using placeholder`, 'TRIPS-SUGGEST-IMAGE');
	return {
		imageUrl: `https://placehold.co/800x400/3b82f6/ffffff?text=${encodeURIComponent(searchTerm)}`,
		attribution: {
			source: 'placeholder'
		}
	};
}

// Helper function to generate image suggestions
async function generateImageSuggestions(trip: Record<string, unknown>): Promise<
	Array<{
		prompt: string;
		style: string;
		reasoning: string;
	}>
> {
	const title = String(trip.title || '');
	const description = String(trip.description || '');
	const startDate = String(trip.start_date || '');
	const endDate = String(trip.end_date || '');

	// Extract location information if available
	// Note: trips table doesn't have a locations column, so we'll use metadata or other available data
	const locationNames: string[] = [];

	// Try to get location info from metadata if available
	if (trip.metadata && typeof trip.metadata === 'object') {
		const metadata = trip.metadata as Record<string, unknown>;
		if (metadata.primaryCity && typeof metadata.primaryCity === 'string') {
			locationNames.push(metadata.primaryCity);
		}
		if (metadata.primaryCountry && typeof metadata.primaryCountry === 'string') {
			locationNames.push(metadata.primaryCountry);
		}
	}

	// Generate suggestions based on trip data
	const suggestions = [];

	// Suggestion 1: Based on trip title and description
	if (title || description) {
		suggestions.push({
			prompt: `${title} ${description}`.trim(),
			style: 'photorealistic',
			reasoning: 'Based on trip title and description'
		});
	}

	// Suggestion 2: Based on locations
	if (locationNames.length > 0) {
		suggestions.push({
			prompt: `${locationNames.join(', ')} travel destination`,
			style: 'landscape',
			reasoning: `Based on trip locations: ${locationNames.join(', ')}`
		});
	}

	// Suggestion 3: Based on time period
	if (startDate && endDate) {
		const start = new Date(startDate);
		const month = start.toLocaleString('default', { month: 'long' });

		suggestions.push({
			prompt: `${month} travel adventure`,
			style: 'artistic',
			reasoning: `Based on trip timing in ${month}`
		});
	}

	// Suggestion 4: Generic travel suggestion
	suggestions.push({
		prompt: 'travel adventure journey',
		style: 'minimalist',
		reasoning: 'Generic travel theme'
	});

	return suggestions;
}

/**
 * Search for images on Pexels
 */
async function searchPexelsImages(
	query: string,
	apiKey: string
): Promise<{
	total_results: number;
	page: number;
	per_page: number;
	photos: Array<{
		id: number;
		width: number;
		height: number;
		url: string;
		photographer: string;
		photographer_url: string;
		photographer_id: number;
		avg_color: string;
		src: {
			original: string;
			large2x: string;
			large: string;
			medium: string;
			small: string;
			portrait: string;
			landscape: string;
			tiny: string;
		};
		liked: boolean;
		alt: string;
	}>;
} | null> {
	if (!apiKey) {
		logError('No Pexels API key provided', 'TRIPS-SUGGEST-IMAGE');
		return null;
	}

	logInfo(`Searching Pexels with API key: ${apiKey.substring(0, 10)}...`, 'TRIPS-SUGGEST-IMAGE');

	const url = new URL('https://api.pexels.com/v1/search');
	url.searchParams.set('query', query);
	url.searchParams.set('page', '1');

	// Fetch multiple photos to choose from randomly
	url.searchParams.set('per_page', '15');
	url.searchParams.set('orientation', 'landscape');

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: apiKey,
			Accept: 'application/json'
		}
	});

	if (!response.ok) {
		logError(`Pexels API error: ${response.status} ${response.statusText}`, 'TRIPS-SUGGEST-IMAGE');
		return null;
	}

	const data = await response.json();
	logInfo(`Pexels API response: ${data.total_results} results found`, 'TRIPS-SUGGEST-IMAGE');
	return data;
}

export default handler;
