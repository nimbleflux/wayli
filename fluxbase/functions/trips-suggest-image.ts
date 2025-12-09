/**
 * Trip Image Suggestion Edge Function
 * Suggests images for trips based on travel data
 * Authentication required (enforced by platform)
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 * @fluxbase:timeout 30
 */

import type { FluxbaseClient } from '../jobs/types';

// ===== Type Definitions =====
interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

// ===== Utility Functions =====
function successResponse<T>(data: T, status = 200): Response {
	const response: ApiResponse<T> = {
		success: true,
		data
	};

	return new Response(JSON.stringify(response), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function errorResponse(message: string, status = 400): Response {
	const response: ApiResponse = {
		success: false,
		error: message
	};

	return new Response(JSON.stringify(response), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
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

// ISO 3166-1 alpha-2 country code to full name mapping
const COUNTRY_NAMES: Record<string, string> = {
	'AF': 'Afghanistan', 'AL': 'Albania', 'DZ': 'Algeria', 'AS': 'American Samoa', 'AD': 'Andorra',
	'AO': 'Angola', 'AI': 'Anguilla', 'AQ': 'Antarctica', 'AG': 'Antigua and Barbuda', 'AR': 'Argentina',
	'AM': 'Armenia', 'AW': 'Aruba', 'AU': 'Australia', 'AT': 'Austria', 'AZ': 'Azerbaijan',
	'BS': 'Bahamas', 'BH': 'Bahrain', 'BD': 'Bangladesh', 'BB': 'Barbados', 'BY': 'Belarus',
	'BE': 'Belgium', 'BZ': 'Belize', 'BJ': 'Benin', 'BM': 'Bermuda', 'BT': 'Bhutan',
	'BO': 'Bolivia', 'BQ': 'Bonaire, Sint Eustatius and Saba', 'BA': 'Bosnia and Herzegovina',
	'BW': 'Botswana', 'BV': 'Bouvet Island', 'BR': 'Brazil', 'IO': 'British Indian Ocean Territory',
	'BN': 'Brunei Darussalam', 'BG': 'Bulgaria', 'BF': 'Burkina Faso', 'BI': 'Burundi',
	'CV': 'Cabo Verde', 'KH': 'Cambodia', 'CM': 'Cameroon', 'CA': 'Canada', 'KY': 'Cayman Islands',
	'CF': 'Central African Republic', 'TD': 'Chad', 'CL': 'Chile', 'CN': 'China', 'CX': 'Christmas Island',
	'CC': 'Cocos (Keeling) Islands', 'CO': 'Colombia', 'KM': 'Comoros', 'CG': 'Congo',
	'CD': 'Congo, Democratic Republic of the', 'CK': 'Cook Islands', 'CR': 'Costa Rica',
	'CI': "Côte d'Ivoire", 'HR': 'Croatia', 'CU': 'Cuba', 'CW': 'Curaçao', 'CY': 'Cyprus',
	'CZ': 'Czech Republic', 'DK': 'Denmark', 'DJ': 'Djibouti', 'DM': 'Dominica', 'DO': 'Dominican Republic',
	'EC': 'Ecuador', 'EG': 'Egypt', 'SV': 'El Salvador', 'GQ': 'Equatorial Guinea', 'ER': 'Eritrea',
	'EE': 'Estonia', 'SZ': 'Eswatini', 'ET': 'Ethiopia', 'FK': 'Falkland Islands (Malvinas)',
	'FO': 'Faroe Islands', 'FJ': 'Fiji', 'FI': 'Finland', 'FR': 'France', 'GF': 'French Guiana',
	'PF': 'French Polynesia', 'TF': 'French Southern Territories', 'GA': 'Gabon', 'GM': 'Gambia',
	'GE': 'Georgia', 'DE': 'Germany', 'GH': 'Ghana', 'GI': 'Gibraltar', 'GR': 'Greece', 'GL': 'Greenland',
	'GD': 'Grenada', 'GP': 'Guadeloupe', 'GU': 'Guam', 'GT': 'Guatemala', 'GG': 'Guernsey', 'GN': 'Guinea',
	'GW': 'Guinea-Bissau', 'GY': 'Guyana', 'HT': 'Haiti', 'HM': 'Heard Island and McDonald Islands',
	'VA': 'Holy See (Vatican City State)', 'HN': 'Honduras', 'HK': 'Hong Kong', 'HU': 'Hungary',
	'IS': 'Iceland', 'IN': 'India', 'ID': 'Indonesia', 'IR': 'Iran, Islamic Republic of', 'IQ': 'Iraq',
	'IE': 'Ireland', 'IM': 'Isle of Man', 'IL': 'Israel', 'IT': 'Italy', 'JM': 'Jamaica', 'JP': 'Japan',
	'JE': 'Jersey', 'JO': 'Jordan', 'KZ': 'Kazakhstan', 'KE': 'Kenya', 'KI': 'Kiribati',
	'KP': "Korea, Democratic People's Republic of", 'KR': 'Korea, Republic of', 'KW': 'Kuwait',
	'KG': 'Kyrgyzstan', 'LA': "Lao People's Democratic Republic", 'LV': 'Latvia', 'LB': 'Lebanon',
	'LS': 'Lesotho', 'LR': 'Liberia', 'LY': 'Libya', 'LI': 'Liechtenstein', 'LT': 'Lithuania',
	'LU': 'Luxembourg', 'MO': 'Macao', 'MK': 'North Macedonia', 'MG': 'Madagascar', 'MW': 'Malawi',
	'MY': 'Malaysia', 'MV': 'Maldives', 'ML': 'Mali', 'MT': 'Malta', 'MH': 'Marshall Islands',
	'MQ': 'Martinique', 'MR': 'Mauritania', 'MU': 'Mauritius', 'YT': 'Mayotte', 'MX': 'Mexico',
	'FM': 'Micronesia, Federated States of', 'MD': 'Moldova, Republic of', 'MC': 'Monaco',
	'MN': 'Mongolia', 'ME': 'Montenegro', 'MS': 'Montserrat', 'MA': 'Morocco', 'MZ': 'Mozambique',
	'MM': 'Myanmar', 'NA': 'Namibia', 'NR': 'Nauru', 'NP': 'Nepal', 'NL': 'Netherlands',
	'NC': 'New Caledonia', 'NZ': 'New Zealand', 'NI': 'Nicaragua', 'NE': 'Niger', 'NG': 'Nigeria',
	'NU': 'Niue', 'NF': 'Norfolk Island', 'MP': 'Northern Mariana Islands', 'NO': 'Norway', 'OM': 'Oman',
	'PK': 'Pakistan', 'PW': 'Palau', 'PS': 'Palestine, State of', 'PA': 'Panama', 'PG': 'Papua New Guinea',
	'PY': 'Paraguay', 'PE': 'Peru', 'PH': 'Philippines', 'PN': 'Pitcairn', 'PL': 'Poland', 'PT': 'Portugal',
	'PR': 'Puerto Rico', 'QA': 'Qatar', 'RE': 'Réunion', 'RO': 'Romania', 'RU': 'Russian Federation',
	'RW': 'Rwanda', 'BL': 'Saint Barthélemy', 'SH': 'Saint Helena, Ascension and Tristan da Cunha',
	'KN': 'Saint Kitts and Nevis', 'LC': 'Saint Lucia', 'MF': 'Saint Martin (French part)',
	'PM': 'Saint Pierre and Miquelon', 'VC': 'Saint Vincent and the Grenadines', 'WS': 'Samoa',
	'SM': 'San Marino', 'ST': 'Sao Tome and Principe', 'SA': 'Saudi Arabia', 'SN': 'Senegal',
	'RS': 'Serbia', 'SC': 'Seychelles', 'SL': 'Sierra Leone', 'SG': 'Singapore', 'SK': 'Slovakia',
	'SI': 'Slovenia', 'SB': 'Solomon Islands', 'SO': 'Somalia', 'ZA': 'South Africa',
	'GS': 'South Georgia and the South Sandwich Islands', 'SS': 'South Sudan', 'ES': 'Spain',
	'LK': 'Sri Lanka', 'SD': 'Sudan', 'SR': 'Suriname', 'SJ': 'Svalbard and Jan Mayen', 'SE': 'Sweden',
	'CH': 'Switzerland', 'SY': 'Syrian Arab Republic', 'TW': 'Taiwan, Province of China',
	'TJ': 'Tajikistan', 'TZ': 'Tanzania, United Republic of', 'TH': 'Thailand', 'TL': 'Timor-Leste',
	'TG': 'Togo', 'TK': 'Tokelau', 'TO': 'Tonga', 'TT': 'Trinidad and Tobago', 'TN': 'Tunisia',
	'TR': 'Turkey', 'TM': 'Turkmenistan', 'TC': 'Turks and Caicos Islands', 'TV': 'Tuvalu',
	'UG': 'Uganda', 'UA': 'Ukraine', 'AE': 'United Arab Emirates', 'GB': 'United Kingdom',
	'US': 'United States', 'UM': 'United States Minor Outlying Islands', 'UY': 'Uruguay',
	'UZ': 'Uzbekistan', 'VU': 'Vanuatu', 'VE': 'Venezuela, Bolivarian Republic of', 'VN': 'Viet Nam',
	'VG': 'Virgin Islands, British', 'VI': 'Virgin Islands, U.S.', 'WF': 'Wallis and Futuna',
	'EH': 'Western Sahara', 'YE': 'Yemen', 'ZM': 'Zambia', 'ZW': 'Zimbabwe'
};

// Helper to get full country name from code
function getCountryName(code: string): string {
	return COUNTRY_NAMES[code.toUpperCase()] || code;
}

// Helper function to get the server-level Pexels API key via SDK
async function getPexelsApiKey(fluxbaseService: FluxbaseClient): Promise<string | null> {
	try {
		// Get server-level key using SDK settings API
		const result = await (fluxbaseService as any).admin?.settings?.app?.getSetting('wayli.server_pexels_api_key');

		// Extract the string value - SDK may return the value directly or wrapped in an object
		let pexelsKey: string | null = null;
		if (typeof result === 'string') {
			pexelsKey = result;
		} else if (result && typeof result === 'object') {
			pexelsKey = result.value || result.data || null;
		}

		if (pexelsKey && typeof pexelsKey === 'string') {
			return pexelsKey;
		}

		logError('No Pexels API key available', 'TRIPS-SUGGEST-IMAGE');
		return null;
	} catch (error) {
		logError(`Error getting Pexels API key: ${error}`, 'TRIPS-SUGGEST-IMAGE');
		return null;
	}
}

async function handler(
	req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	utils?: { getExecutionContext?: () => { user?: { id: string; email: string; role: string } } }
): Promise<Response> {
	try {
		// Get user from execution context (injected by Fluxbase platform)
		const executionContext = utils?.getExecutionContext?.();
		const userId = executionContext?.user?.id;

		// Platform authentication: user context is provided via utils.getExecutionContext()
		if (!userId) {
			return errorResponse('Unauthorized', 401);
		}

		if (req.method === 'POST') {
			logInfo('Suggesting trip image', 'TRIPS-SUGGEST-IMAGE', { userId });

			// Use standard Web API to parse JSON body
			const body = await req.json() as Record<string, unknown>;

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

				// Verify trip ownership using SDK
				const { data: trips, error: tripError } = await fluxbase
					.from('trips')
					.select('id,title,description,start_date,end_date,metadata,status')
					.eq('id', tripId)
					.eq('user_id', userId);

				if (tripError) {
					logError(tripError, 'TRIPS-SUGGEST-IMAGE', 'Error fetching trip');
					return errorResponse('Error fetching trip', 500);
				}

				const trip = trips && trips.length > 0 ? trips[0] : null;

				if (!trip) {
					logError('Trip not found', 'TRIPS-SUGGEST-IMAGE');
					return errorResponse('Trip not found', 404);
				}

				// Generate Pexels image for any trip with dates
				if (trip.start_date && trip.end_date) {
					const startDate = String(trip.start_date);
					const endDate = String(trip.end_date);

					// Extract metadata if available
					const tripMetadata =
						trip.metadata && typeof trip.metadata === 'object' ? (trip.metadata as any) : undefined;

					// Get the best available Pexels API key
					const apiKey = await getPexelsApiKey(fluxbaseService);
					if (!apiKey) {
						return errorResponse(
							'No Pexels API key available. Please configure your API key in preferences.',
							400
						);
					}

					// Check if trip metadata has primaryCity or primaryCountry for search
					// If so, use metadata directly; otherwise fall back to analyzing tracker_data
					let analysis: {
						primaryCountry: string;
						primaryCity?: string;
						allCountries: string[];
						allCities: string[];
						countryStats: Record<string, number>;
						cityStats: Record<string, number>;
						isMultiCity: boolean;
						distanceTraveled: number;
					};

					if (tripMetadata?.primaryCity || tripMetadata?.primaryCountry) {
						// Use metadata directly - more accurate since it's based on duration
						logInfo('Using trip metadata for image search', 'TRIPS-SUGGEST-IMAGE', {
							tripId,
							primaryCity: tripMetadata.primaryCity,
							primaryCountry: tripMetadata.primaryCountry
						});

						analysis = {
							primaryCountry: tripMetadata.primaryCountry
								? getCountryName(tripMetadata.primaryCountry)
								: '',
							primaryCity: tripMetadata.primaryCity,
							allCountries: tripMetadata.visitedCountries || [],
							allCities: tripMetadata.visitedCities || [],
							countryStats: {},
							cityStats: {},
							isMultiCity: tripMetadata.isMultiCityTrip || false,
							distanceTraveled: tripMetadata.distanceTraveled || 0
						};
					} else {
						// Fall back to analyzing tracker_data
						logInfo('Analyzing tracker data for image search', 'TRIPS-SUGGEST-IMAGE', {
							tripId,
							startDate,
							endDate
						});

						analysis = await analyzeTripLocations(userId, startDate, endDate, fluxbase);

						if (!analysis.primaryCountry) {
							return errorResponse('No travel data found for the specified date range', 404);
						}
					}

					// Generate image suggestion based on analysis and metadata
					const suggestion = await generateImageSuggestionFromAnalysis(
						analysis,
						apiKey,
						tripMetadata
					);

					logSuccess('Image suggestion generated for trip', 'TRIPS-SUGGEST-IMAGE', {
						userId,
						tripId,
						searchQuery: suggestion.searchQuery,
						primaryCountry: analysis.primaryCountry || 'Unknown',
						primaryCity: analysis.primaryCity || undefined,
						usedMetadata: !!(tripMetadata?.primaryCity || tripMetadata?.primaryCountry)
					});

					return successResponse({
						suggestedImageUrl: suggestion.imageUrl,
						searchQuery: suggestion.searchQuery,
						attribution: suggestion.attribution,
						analysis: analysis,
						message: 'Image suggestion generated successfully'
					});
				} else {
					return errorResponse('Trip must have start_date and end_date', 400);
				}
			} else if (startDate && endDate) {
				// Image suggestion based on date range
				logInfo('Suggesting image based on date range', 'TRIPS-SUGGEST-IMAGE', {
					userId,
					startDate,
					endDate
				});

				// Check if there's an existing trip with matching dates that has metadata
				let tripMetadata: any = undefined;
				const { data: existingTrips } = await fluxbase
					.from('trips')
					.select('id,metadata')
					.eq('user_id', userId)
					.eq('start_date', startDate)
					.eq('end_date', endDate)
					.limit(1);

				if (existingTrips && existingTrips.length > 0 && existingTrips[0].metadata) {
					tripMetadata = existingTrips[0].metadata;
					logInfo('Found existing trip with metadata for date range', 'TRIPS-SUGGEST-IMAGE', {
						tripId: existingTrips[0].id,
						hasVisitedCitiesDetailed: !!tripMetadata?.visitedCitiesDetailed
					});
				}

				// Analyze user's travel data for the date range
				const analysis = await analyzeTripLocations(userId, startDate, endDate, fluxbase);

				if (!analysis.primaryCountry) {
					return errorResponse('No travel data found for the specified date range', 404);
				}

				// Get the best available Pexels API key
				const apiKey = await getPexelsApiKey(fluxbaseService);
				if (!apiKey) {
					return errorResponse(
						'No Pexels API key available. Please configure your API key in preferences.',
						400
					);
				}

				// Generate image suggestion based on analysis and existing trip metadata (if available)
				const suggestion = await generateImageSuggestionFromAnalysis(analysis, apiKey, tripMetadata);

				logSuccess('Image suggestion generated', 'TRIPS-SUGGEST-IMAGE', {
					userId,
					searchQuery: suggestion.searchQuery,
					primaryCountry: analysis.primaryCountry || 'Unknown',
					primaryCity: analysis.primaryCity || undefined,
					usedExistingMetadata: !!tripMetadata
				});

				return successResponse({
					suggestedImageUrl: suggestion.imageUrl,
					searchQuery: suggestion.searchQuery,
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
	endDate: string,
	fluxbase: FluxbaseClient
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
	// Fetch tracker data for the date range using SDK
	const { data: trackerData, error } = await fluxbase
		.from('tracker_data')
		.select('country_code,geocode,recorded_at,distance')
		.eq('user_id', userId)
		.gte('recorded_at', `${startDate}T00:00:00Z`)
		.lte('recorded_at', `${endDate}T23:59:59Z`)
		.not('country_code', 'is', null)
		.order('recorded_at', { ascending: true });

	if (error) {
		logError(error, 'TRIPS-SUGGEST-IMAGE', 'Error fetching tracker data');
	}

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

				if (geocode && geocode.properties) {
					// Try multiple sources for city name:
					// 1. Standard address fields
					// 2. OSM addendum data (often has addr:city when address.city is null)
					const city =
						geocode.properties.address?.city ||
						geocode.properties.address?.town ||
						geocode.properties.address?.village ||
						geocode.properties.address?.suburb ||
						geocode.properties.address?.neighbourhood ||
						geocode.properties.addendum?.osm?.['addr:city'];

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

	// Map country codes to full names using the local mapping
	const countryCodes = Array.from(allCountries);

	// Replace codes with names in allCountries and countryStats
	const allCountriesFull = countryCodes.map((code) => getCountryName(code));
	const countryStatsFull: Record<string, number> = {};
	for (const code of Object.keys(countryStats)) {
		const name = getCountryName(code);
		countryStatsFull[name] = countryStats[code];
	}

	// Find primary country (most visited)
	const primaryCountryCode = Object.keys(countryStats).reduce(
		(a, b) => (countryStats[a] > countryStats[b] ? a : b),
		''
	);
	const primaryCountry = getCountryName(primaryCountryCode);

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
	searchQuery: string;
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

			// Map country code to full name using local mapping
			const countryName = getCountryName(dominantCountry.countryCode);

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
			// Single country trip - use local mapping to get full name
			const countryName = getCountryName(tripMetadata.visitedCountriesDetailed[0].countryCode);
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
			searchQuery: searchTerm,
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
		searchQuery: searchTerm,
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
