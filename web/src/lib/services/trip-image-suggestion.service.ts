import { fluxbase } from '$lib/fluxbase';
import { getTripBannerImageWithAttribution } from './external/pexels.service';

export interface TripLocationAnalysis {
	primaryCountry: string;
	primaryCity?: string;
	allCountries: string[];
	allCities: string[];
	countryStats: Record<string, number>;
	cityStats: Record<string, number>;
}

export interface TripImageSuggestion {
	imageUrl: string;
	attribution?: {
		source: 'pexels' | 'picsum' | 'placeholder';
		photographer?: string;
		photographerUrl?: string;
		pexelsUrl?: string;
	};
}

export class TripImageSuggestionService {
	/**
	 * Analyze tracker data for a specific date range to determine the most visited country and city
	 */
	async analyzeTripLocations(
		userId: string,
		startDate: string,
		endDate: string
	): Promise<TripLocationAnalysis> {
		try {
			// Fetch tracker data for the date range
			const { data: trackerData, error } = await fluxbase
				.from('tracker_data')
				.select('country_code, geocode, recorded_at')
				.eq('user_id', userId)
				.gte('recorded_at', `${startDate}T00:00:00Z`)
				.lte('recorded_at', `${endDate}T23:59:59Z`)
				.not('country_code', 'is', null)
				.order('recorded_at', { ascending: true });

			if (error) {
				console.error('Error fetching tracker data for analysis:', error);
				throw error;
			}

			if (!trackerData || trackerData.length === 0) {
				return {
					primaryCountry: '',
					primaryCity: undefined,
					allCountries: [],
					allCities: [],
					countryStats: {},
					cityStats: {}
				};
			}

			// Count countries and cities
			const countryStats: Record<string, number> = {};
			const cityStats: Record<string, number> = {};
			const allCountries = new Set<string>();
			const allCities = new Set<string>();

			trackerData.forEach((point) => {
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
							const city =
								geocode.properties.city ||
								geocode.properties.address?.city ||
								geocode.properties.address?.town ||
								geocode.properties.address?.village ||
								geocode.properties.address?.suburb ||
								geocode.properties.address?.neighbourhood;

							if (city) {
								const cityKey = city.toLowerCase().trim();
								cityStats[cityKey] = (cityStats[cityKey] || 0) + 1;
								allCities.add(city);
							}
						}
					} catch (parseError) {
						// Ignore geocode parsing errors
						console.warn('Failed to parse geocode data:', parseError);
					}
				}
			});

			// Find primary country (most visited)
			const primaryCountry = Object.keys(countryStats).reduce(
				(a, b) => (countryStats[a] > countryStats[b] ? a : b),
				''
			);

			// Find primary city (most visited)
			const primaryCity =
				Object.keys(cityStats).length > 0
					? Object.keys(cityStats).reduce((a, b) => (cityStats[a] > cityStats[b] ? a : b), '')
					: undefined;

			// Log city dominance for debugging
			if (primaryCity && trackerData.length > 0) {
				const primaryCityCount = cityStats[primaryCity] || 0;
				const cityDominance = (primaryCityCount / trackerData.length) * 100;

				console.log(
					`🏙️ Primary city: ${primaryCity} (${primaryCityCount}/${trackerData.length} points, ${cityDominance.toFixed(1)}% dominance)`
				);
			}

			return {
				primaryCountry,
				primaryCity: primaryCity,
				allCountries: Array.from(allCountries),
				allCities: Array.from(allCities),
				countryStats,
				cityStats
			};
		} catch (error) {
			console.error('Error analyzing trip locations:', error);
			throw error;
		}
	}

	/**
	 * Suggest an image for a trip based on the analysis
	 */
	async suggestTripImage(
		userId: string,
		startDate: string,
		endDate: string,
		userApiKey?: string,
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
	): Promise<TripImageSuggestion | null> {
		try {
			// Prefer using metadata if available (duration-based, more accurate)
			if (tripMetadata) {
				if (
					tripMetadata.visitedCountriesDetailed &&
					tripMetadata.visitedCountriesDetailed.length > 1
				) {
					// Multi-country trip: use country with longest duration
					const dominantCountry = tripMetadata.visitedCountriesDetailed.sort(
						(a, b) => b.durationHours - a.durationHours
					)[0];

					console.log(
						`🌍 Using dominant country from metadata: ${dominantCountry.countryCode} (${dominantCountry.durationHours}h)`
					);

					const countryImage = await getTripBannerImageWithAttribution(
						dominantCountry.countryCode,
						userApiKey,
						dominantCountry.countryCode,
						false
					);
					if (countryImage) {
						console.log(`✅ Successfully got country image: ${countryImage.imageUrl}`);
						return countryImage;
					}
				} else if (
					tripMetadata.visitedCitiesDetailed &&
					tripMetadata.visitedCitiesDetailed.length > 1
				) {
					// Multi-city trip (same country): use city with longest duration
					const dominantCity = tripMetadata.visitedCitiesDetailed.sort(
						(a, b) => b.durationHours - a.durationHours
					)[0];

					console.log(
						`🏙️ Using dominant city from metadata: ${dominantCity.city} (${dominantCity.durationHours}h)`
					);

					const cityImage = await getTripBannerImageWithAttribution(
						dominantCity.city,
						userApiKey,
						dominantCity.countryCode,
						true
					);
					if (cityImage) {
						console.log(`✅ Successfully got city image: ${cityImage.imageUrl}`);
						return cityImage;
					}
				} else if (
					tripMetadata.visitedCitiesDetailed &&
					tripMetadata.visitedCitiesDetailed.length === 1
				) {
					// Single city trip
					const singleCity = tripMetadata.visitedCitiesDetailed[0];
					console.log(`🏙️ Using single city from metadata: ${singleCity.city}`);

					const cityImage = await getTripBannerImageWithAttribution(
						singleCity.city,
						userApiKey,
						singleCity.countryCode,
						true
					);
					if (cityImage) {
						console.log(`✅ Successfully got city image: ${cityImage.imageUrl}`);
						return cityImage;
					}
				} else if (
					tripMetadata.visitedCountriesDetailed &&
					tripMetadata.visitedCountriesDetailed.length === 1
				) {
					// Single country trip
					const singleCountry = tripMetadata.visitedCountriesDetailed[0];
					console.log(`🌍 Using single country from metadata: ${singleCountry.countryCode}`);

					const countryImage = await getTripBannerImageWithAttribution(
						singleCountry.countryCode,
						userApiKey,
						singleCountry.countryCode,
						false
					);
					if (countryImage) {
						console.log(`✅ Successfully got country image: ${countryImage.imageUrl}`);
						return countryImage;
					}
				}
			}

			// Fallback to analysis-based logic if no metadata or metadata search failed
			console.log('⚠️ Falling back to analysis-based search...');
			const analysis = await this.analyzeTripLocations(userId, startDate, endDate);

			if (!analysis.primaryCountry) {
				console.log('No country data available for trip image suggestion');
				return null;
			}

			console.log('Trip analysis:', analysis);

			// Always use city search if primaryCity exists
			if (analysis.primaryCity) {
				console.log(`🏙️ Using city-focused search for ${analysis.primaryCity}`);

				const cityImage = await getTripBannerImageWithAttribution(
					analysis.primaryCity,
					userApiKey,
					analysis.primaryCountry,
					true // isCityFocused = true
				);
				if (cityImage) {
					console.log(`✅ Successfully got city image: ${cityImage.imageUrl}`);
					return cityImage;
				}
				console.log('⚠️ City image suggestion failed, falling back to country search...');
			}

			// Country-focused search: Either no primaryCity or city search failed
			console.log(`🌍 Using country-focused search for ${analysis.primaryCountry}`);
			const countryImage = await getTripBannerImageWithAttribution(
				analysis.primaryCountry,
				userApiKey,
				analysis.primaryCountry,
				false // isCityFocused = false
			);
			if (countryImage) {
				console.log(`Successfully got country image: ${countryImage.imageUrl}`);
				return countryImage;
			}

			// Final fallback to generic travel image
			console.log('Using generic travel image as fallback');
			const travelImage = await getTripBannerImageWithAttribution(
				'travel',
				userApiKey,
				undefined,
				false
			);
			if (travelImage) {
				console.log(`Successfully got travel image: ${travelImage.imageUrl}`);
				return travelImage;
			}

			console.log('All image suggestions failed');
			return null;
		} catch (error) {
			console.error('Error suggesting trip image:', error);
			return null;
		}
	}

	/**
	 * Get analysis data for display purposes
	 */
	async getTripAnalysis(
		userId: string,
		startDate: string,
		endDate: string
	): Promise<TripLocationAnalysis> {
		return this.analyzeTripLocations(userId, startDate, endDate);
	}
}
