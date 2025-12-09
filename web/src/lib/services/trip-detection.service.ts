import { translateServer, getCountryNameServer } from '../utils/server-translations';
import { getCountryForPoint } from '../services/external/country-reverse-geocoding.service';

// Use a flexible type that works with both SDK client and job runtime client
type FluxbaseClient = {
	from(table: string): any;
};

export interface ExcludedDateRange {
	startDate: string;
	endDate: string;
	reason: string; // 'approved_trip' | 'rejected_trip'
}

export interface Location {
	id?: string; // For trip exclusions
	name?: string; // For trip exclusions
	coordinates?: {
		lat: number;
		lng: number;
	};
	address?: {
		city?: string;
		country_code?: string;
		[key: string]: string | undefined;
	};
}

export interface DetectedTrip {
	id: string;
	user_id: string | null;
	start_date: string;
	end_date: string;
	title: string;
	description: string;
	status: 'pending';
	metadata: {
		totalDurationHours: number;
		visitedCities: string[];
		visitedCountries: string[];
		visitedCountryCodes: string[];
		visitedCitiesDetailed: Array<{
			city: string;
			countryCode: string;
			durationHours: number;
			dataPoints: number;
		}>;
		visitedCountriesDetailed: Array<{
			countryCode: string;
			durationHours: number;
			dataPoints: number;
		}>;
		isMultiCountryTrip: boolean;
		isMultiCityTrip: boolean;
		tripType: 'city' | 'country' | 'multi-city' | 'multi-country';
		primaryCity: string;
		primaryCountry: string;
		primaryCountryCode: string;
		cityName: string;
		dataPoints: number;
		tripDays: number;
		distanceFromHome: number;
	};
	created_at: string;
	updated_at: string;
}

export interface UserLocationState {
	currentState: 'home' | 'away';
	stateStartTime: string;
	dataPointsInState: number;
	lastHomeStateStartTime: string; // Track when user was last at home
	nextState?: 'home' | 'away';
	nextStateStartTime?: string;
	nextStateDataPoints: number;
	currentTripStart?: string;
	currentTripEnd?: string;
	visitedCities: {
		cityName: string;
		countryCode: string;
		coordinates: {
			lat: number;
			lng: number;
		};
		firstVisitTime: string;
		lastVisitTime: string;
		durationHours: number;
		dataPoints: number;
	}[];
}

// Progress tracking interface
export interface TripDetectionProgress {
	phase: 'initializing' | 'fetching_data' | 'processing_batches' | 'saving_trips' | 'completed';
	progress: number; // 0-100
	message: string;
	details?: {
		currentBatch?: number;
		processedPoints?: number;
		totalPoints?: number;
		detectedTrips?: number;
	};
}

export class TripDetectionService {
	private fluxbase: FluxbaseClient;
	private userState: UserLocationState | null = null;
	private userId: string | null = null;
	private homeLocationsCache: Map<string, { locations: Location[]; language: string }> = new Map();
	private customHomeAddress: Location | null = null; // Custom home address override (still fetches trip exclusions)
	private jobId: string | null = null;
	private progressCallback?: (progress: TripDetectionProgress) => void;

	constructor(fluxbaseClient: FluxbaseClient) {
		this.fluxbase = fluxbaseClient;
	}

	/**
	 * Set job ID and progress callback for progress tracking
	 */
	setProgressTracking(
		jobId: string,
		progressCallback: (progress: TripDetectionProgress) => void
	): void {
		this.jobId = jobId;
		this.progressCallback = progressCallback;
	}

	/**
	 * Update progress and call the progress callback if available
	 */
	private updateProgress(progress: TripDetectionProgress): void {
		if (this.progressCallback) {
			this.progressCallback(progress);
		}
	}

	/**
	 * 1. Fetch all approved or rejected trips and create a list of excluded date ranges
	 */
	async getExcludedDateRanges(userId: string): Promise<ExcludedDateRange[]> {
		try {
			const { data: trips, error } = await this.fluxbase
				.from('trips')
				.select('start_date, end_date, status')
				.eq('user_id', userId)
				.in('status', ['completed', 'rejected', 'pending']);

			if (error) {
				console.error('❌ Error fetching trips:', error);
				return [];
			}

			const excludedRanges: ExcludedDateRange[] = trips.map((trip: { start_date: string; end_date: string; status: string }) => ({
				startDate: trip.start_date,
				endDate: trip.end_date,
				reason: trip.status === 'completed' ? 'approved_trip' : 'rejected_trip'
			}));

			return excludedRanges;
		} catch (error) {
			console.error('❌ Exception in getExcludedDateRanges:', error);
			return [];
		}
	}

	/**
	 * 2. Get all locations that the user considers as "home" (home address + trip exclusions)
	 */
	async getUserHomeLocations(userId: string): Promise<{ locations: Location[]; language: string }> {
		try {
			// Check cache first
			const cached = this.homeLocationsCache.get(userId);
			if (cached) {
				return { locations: cached.locations, language: cached.language };
			}

			const homeLocations: Location[] = [];

			// Use custom home address if set, otherwise fetch from user_profiles
			if (this.customHomeAddress) {
				homeLocations.push(this.customHomeAddress);
				console.log(`🏠 Custom home address: ${this.customHomeAddress.address?.city || 'unknown city'}`);
			} else {
				// Fetch home address from user_profiles
				const { data: profile, error: profileError } = await this.fluxbase
					.from('user_profiles')
					.select('home_address')
					.eq('id', userId)
					.single();

				if (profileError) {
					console.warn('⚠️ Could not fetch home address:', profileError);
				} else if (profile?.home_address) {
					// Parse home address and add to home locations
					const homeAddress = this.parseLocation(profile.home_address);
					homeLocations.push(homeAddress);
					console.log(`🏠 Home address: ${homeAddress.address?.city || 'unknown city'}`);
				}
			}

			// Always fetch trip exclusions and language from user_preferences
			const { data: preferences, error: preferencesError } = await this.fluxbase
				.from('user_preferences')
				.select('trip_exclusions, language')
				.eq('id', userId)
				.single();

			if (preferencesError) {
				console.warn('⚠️ Could not fetch trip exclusions:', preferencesError);
			} else if (preferences?.trip_exclusions && preferences.trip_exclusions.length > 0) {
				// Parse trip exclusions and add to home locations
				const tripExclusions = preferences.trip_exclusions.map((exclusion: any) =>
					this.parseLocation(exclusion)
				);
				homeLocations.push(...tripExclusions);
				console.log(`🏢 Trip exclusions (${tripExclusions.length}): ${tripExclusions.map((e: Location) => e.name || e.address?.city || 'unknown').join(', ')}`);
			}

			const language = preferences?.language || 'en';

			// Cache the result
			this.homeLocationsCache.set(userId, {
				locations: homeLocations,
				language
			});

			return { locations: homeLocations, language };
		} catch (error) {
			console.error('❌ Exception in getUserHomeLocations:', error);
			return { locations: [], language: 'en' };
		}
	}

	/**
	 * Clear the home locations cache for a specific user or all users
	 */
	clearHomeLocationsCache(userId?: string): void {
		if (userId) {
			this.homeLocationsCache.delete(userId);
		} else {
			this.homeLocationsCache.clear();
		}
	}

	/**
	 * Set a custom home address override (will still fetch trip exclusions from database)
	 * Used when payload specifies useCustomHomeAddress with a customHomeAddress
	 */
	setCustomHomeAddress(homeAddress: Location): void {
		this.customHomeAddress = homeAddress;
		// Clear the cache so getUserHomeLocations will re-fetch with the custom address
		this.homeLocationsCache.clear();
	}

	/**
	 * Clear the custom home address override
	 */
	clearCustomHomeAddress(): void {
		this.customHomeAddress = null;
	}

	/**
	 * Main entry point: Detect trips for a user within a date range
	 * Uses single-loop architecture with database-level filtering via not.between
	 */
	async detectTrips(userId: string, startDate?: string, endDate?: string): Promise<DetectedTrip[]> {
		try {
			// 1. Initialize
			this.updateProgress({
				phase: 'initializing',
				progress: 0,
				message: 'Initializing trip detection...',
				details: {}
			});

			this.userId = userId;
			// Note: Don't clear home locations cache here - if setCustomHomeAddress was called
			// before detectTrips, we want to preserve the custom home address

			// 2. Get excluded ranges and home locations
			this.updateProgress({
				phase: 'fetching_data',
				progress: 0,
				message: 'Fetching configuration...',
				details: {}
			});

			const excludedRanges = await this.getExcludedDateRanges(userId);
			const { locations: homeLocations, language } = await this.getUserHomeLocations(userId);

			console.log(`📅 Found ${excludedRanges.length} excluded date ranges`);
			console.log(`🏠 Found ${homeLocations.length} home locations`);
			if (homeLocations.length > 0) {
				console.log(`🏠 Home locations:`, homeLocations.map(loc => loc.address?.city || loc.name || 'unknown').join(', '));
			} else {
				console.log(`⚠️ No home locations defined - trip detection may not work correctly`);
			}

			// 3. Determine date range
			const effectiveStartDate = startDate || (await this.getUserFirstDataPoint(userId));
			const effectiveEndDate = endDate || this.getTomorrowDate();

			// 4. Count total points (with exclusions applied at DB level)
			this.updateProgress({
				phase: 'fetching_data',
				progress: 0,
				message: 'Counting data points...',
				details: {}
			});

			let countQuery = this.fluxbase
				.from('tracker_data')
				.select('recorded_at', { count: 'exact', head: true })
				.eq('user_id', userId)
				.gte('recorded_at', effectiveStartDate)
				.lte('recorded_at', effectiveEndDate);

			// Apply not.between for each excluded range (filtered at DB level)
			for (const range of excludedRanges) {
				countQuery = countQuery.filter('recorded_at', 'not.between', [range.startDate, range.endDate]);
			}

			const { count: totalPoints, error: countError } = await countQuery;

			if (countError) {
				console.error(`❌ Error counting data points:`, countError);
			}

			if (!totalPoints || totalPoints === 0) {
				this.updateProgress({
					phase: 'completed',
					progress: 100,
					message: 'No data to process',
					details: { detectedTrips: 0 }
				});
				return [];
			}

			// 5. Initialize state machine
			this.userState = {
				currentState: 'home',
				stateStartTime: effectiveStartDate,
				dataPointsInState: 0,
				lastHomeStateStartTime: effectiveStartDate,
				nextStateDataPoints: 0,
				visitedCities: []
			};

			// 6. Process all points in single loop
			const trips: DetectedTrip[] = [];
			let processedPoints = 0;
			let batchNumber = 0;
			let lastRecordedAt: string | null = null;
			const batchSize = 1000;

			console.log(`🔍 Starting batch processing: ${effectiveStartDate} to ${effectiveEndDate}`);
			console.log(`📊 Total points to process: ${totalPoints}`);

			while (true) {
				// Build query with excluded ranges filtered at DB level
				let query = this.fluxbase
					.from('tracker_data')
					.select('recorded_at, geocode')
					.eq('user_id', userId)
					.gte('recorded_at', effectiveStartDate)
					.lte('recorded_at', effectiveEndDate);

				// Apply not.between for each excluded range (filtered at DB level)
				for (const range of excludedRanges) {
					query = query.filter('recorded_at', 'not.between', [range.startDate, range.endDate]);
				}

				// Apply cursor for pagination
				if (lastRecordedAt) {
					query = query.gt('recorded_at', lastRecordedAt);
				}

				const { data: batch, error } = await query
					.order('recorded_at', { ascending: true })
					.limit(batchSize);

				if (error) {
					console.error(`❌ Error fetching batch ${batchNumber}:`, error);
					break;
				}

				if (!batch || batch.length === 0) {
					console.log(`✅ No more data after batch ${batchNumber}, stopping`);
					break;
				}

				console.log(`📦 Batch ${batchNumber}: ${batch.length} records fetched, current state: ${this.userState?.currentState}, nextState: ${this.userState?.nextState || 'none'}, nextStateDataPoints: ${this.userState?.nextStateDataPoints || 0}`);

				// Filter by city presence (check Pelias addendum.osm path first, then fallback to Nominatim paths)
				const pointsWithCity = batch.filter((point: { recorded_at: string; geocode?: { properties?: { city?: string; address?: { city?: string }; addendum?: { osm?: { 'addr:city'?: string } } } } }) => {
					const city = point.geocode?.properties?.addendum?.osm?.['addr:city'] ||
						point.geocode?.properties?.city ||
						point.geocode?.properties?.address?.city;
					return city && city.trim() !== '';
				});

				// Process each valid point
				for (let i = 0; i < pointsWithCity.length; i++) {
					const point = pointsWithCity[i];
					const previousPoint = i > 0 ? pointsWithCity[i - 1] : null;
					const isPointAtHome = this.isPointAtHome(point, homeLocations);
					const pointState: 'home' | 'away' = isPointAtHome ? 'home' : 'away';

					const trip = await this.updateUserState(point, previousPoint, pointState, language);
					if (trip) {
						console.log(`🎯 Trip candidate: dataPoints=${trip.metadata.dataPoints}, visitedCities=${trip.metadata.visitedCities.length}, duration=${trip.metadata.totalDurationHours}h`);
					}
					if (trip && trip.metadata.dataPoints > 10 && trip.metadata.visitedCities.length > 0) {
						console.log(`✅ Trip accepted: ${trip.title}`);
						trips.push({ ...trip, user_id: userId } as DetectedTrip);
						// Reset userState after trip creation
						this.userState = {
							currentState: 'home',
							stateStartTime: this.userState!.nextStateStartTime!,
							dataPointsInState: this.userState!.nextStateDataPoints!,
							lastHomeStateStartTime: this.userState!.nextStateStartTime!,
							nextStateDataPoints: 0,
							visitedCities: []
						};
					}
				}

				processedPoints += batch.length;

				// Update progress (based solely on points processed)
				const progress = Math.round((processedPoints / totalPoints) * 100);
				this.updateProgress({
					phase: 'processing_batches',
					progress,
					message: `Processing: ${processedPoints.toLocaleString()} / ${totalPoints.toLocaleString()} points`,
					details: {
						processedPoints,
						totalPoints,
						detectedTrips: trips.length,
						currentBatch: batchNumber
					}
				});

				lastRecordedAt = batch[batch.length - 1].recorded_at;
				batchNumber++;
			}

			// 7. Finalize
			this.updateProgress({
				phase: 'completed',
				progress: 100,
				message: `Trip detection completed: ${trips.length} trips detected`,
				details: { detectedTrips: trips.length }
			});

			return trips;
		} catch (error) {
			console.error('❌ Exception in detectTrips:', error);
			return [];
		}
	}

	/**
	 * Get tomorrow's date as YYYY-MM-DD string
	 */
	private getTomorrowDate(): string {
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		return tomorrow.toISOString().split('T')[0];
	}

	/**
	 * Get the user's first tracker data point date
	 */
	private async getUserFirstDataPoint(userId: string): Promise<string> {
		try {
			const { data, error } = await this.fluxbase
				.from('tracker_data')
				.select('recorded_at, geocode')
				.eq('user_id', userId)
				.not('geocode->address->city', 'is', null)
				.not('geocode->address->city', 'eq', '')
				.order('recorded_at', { ascending: true })
				.limit(1)
				.single();

			if (error || !data) {
				console.warn('⚠️ Could not find first data point for user, using fallback date');
				return '2023-01-01'; // Fallback to a reasonable date
			}

			const firstDate = new Date(data.recorded_at);
			return firstDate.toISOString().split('T')[0];
		} catch (error) {
			console.error('❌ Error fetching user first data point:', error);
			return '2023-01-01'; // Fallback to a reasonable date
		}
	}

	/**
	 * Determine if a data point is at home based on home locations
	 * A point is considered "home" if it's in the same city as any home location,
	 * or if it's within a 50km radius of any home location
	 */
	private isPointAtHome(point: any, homeLocations: Location[]): boolean {
		if (homeLocations.length === 0) {
			return false; // No home locations defined
		}

		// Check if point is in any of the home locations
		for (const homeLocation of homeLocations) {
			if (this.isPointInLocation(point, homeLocation)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if a point is within a specific location (home or trip exclusion)
	 * Uses both city matching and radius-based detection
	 */
	private isPointInLocation(point: any, location: Location): boolean {
		// Method 1: City-based matching (most accurate)
		if (this.isPointInSameCity(point, location)) {
			return true;
		}

		// Method 2: Radius-based detection (fallback)
		if (location.coordinates && point.geocode?.geometry?.coordinates) {
			const [lon, lat] = point.geocode.geometry.coordinates;
			const distance = this.calculateDistance(
				location.coordinates.lat,
				location.coordinates.lng,
				lat,
				lon
			);
			return distance <= 50; // 50km radius as requested
		}

		return false;
	}

	/**
	 * Check if a point is in the same city as a home location
	 */
	private isPointInSameCity(point: any, location: Location): boolean {
		// Get city names from both point and location
		const pointCity = this.getCityFromPoint(point);
		const locationCity = this.getCityFromLocation(location);

		// If both have city names, compare them (case-insensitive)
		if (pointCity && locationCity) {
			return pointCity.toLowerCase() === locationCity.toLowerCase();
		}

		return false;
	}

	/**
	 * Extract city name from a data point
	 */
	private getCityFromPoint(point: any): string | null {
		// Try Pelias addendum.osm path first (most common with new geocoding)
		if (point.geocode?.properties?.addendum?.osm?.['addr:city']) {
			return point.geocode.properties.addendum.osm['addr:city'];
		}
		// Fallback to Nominatim paths
		if (point.geocode?.properties?.address?.city) {
			return point.geocode.properties.address.city;
		}
		if (point.geocode?.properties?.city) {
			return point.geocode.properties.city;
		}

		return null;
	}

	/**
	 * Extract city name from a home location
	 */
	private getCityFromLocation(location: Location): string | null {
		// Try different possible locations for city name
		if (location.address?.city) {
			return location.address.city;
		}
		return null;
	}

	/**
	 * Calculate distance between two coordinates using Haversine formula
	 */
	private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 6371; // Earth's radius in kilometers
		const dLat = this.toRadians(lat2 - lat1);
		const dLon = this.toRadians(lon2 - lon1);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(this.toRadians(lat1)) *
			Math.cos(this.toRadians(lat2)) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	/**
	 * Convert degrees to radians
	 */
	private toRadians(degrees: number): number {
		return degrees * (Math.PI / 180);
	}

	/**
	 * Calculate how long the user has been away from home
	 */
	private calculateAwayDuration(lastHomeTime: string, currentTime: string): number {
		const lastHome = new Date(lastHomeTime);
		const current = new Date(currentTime);
		const diffMs = current.getTime() - lastHome.getTime();
		return diffMs / (1000 * 60 * 60); // Convert to hours
	}

	/**
	 * Create a trip object from the away state
	 */
	private async createTripFromAwayState(
		awayDuration: number,
		endTime: string,
		language: string
	): Promise<DetectedTrip | null> {
		// Check if there are any locations after duration filtering
		const filteredLocations = this.filterLocationsByDuration(this.userState!.visitedCities);
		if (filteredLocations.length === 0) {
			return null; // Don't create trips with no meaningful locations
		}

		// Generate a unique UUID for the trip
		const tripId = crypto.randomUUID();

		// Determine trip title based on visited locations
		const title = await this.generateTripTitle(this.userState!.visitedCities, language);

		// Calculate detailed city and country data
		const visitedCitiesDetailed = filteredLocations.map((loc) => ({
			city: loc.cityName,
			countryCode: loc.countryCode,
			durationHours: Math.round(loc.durationHours),
			dataPoints: loc.dataPoints
		}));

		// Aggregate country data from cities
		const countryMap = new Map<string, { durationHours: number; dataPoints: number }>();
		filteredLocations.forEach((loc) => {
			const existing = countryMap.get(loc.countryCode);
			if (existing) {
				existing.durationHours += loc.durationHours;
				existing.dataPoints += loc.dataPoints;
			} else {
				countryMap.set(loc.countryCode, {
					durationHours: loc.durationHours,
					dataPoints: loc.dataPoints
				});
			}
		});

		const visitedCountriesDetailed = Array.from(countryMap.entries()).map(
			([countryCode, data]) => ({
				countryCode,
				durationHours: Math.round(data.durationHours),
				dataPoints: data.dataPoints
			})
		);

		// Get unique cities and filter out "Unknown"
		const uniqueCities = Array.from(
			new Set(filteredLocations.map((location) => location.cityName))
		).filter((city) => city !== 'Unknown');

		// Get unique countries and filter out "Unknown"
		const uniqueCountries = Array.from(countryMap.keys()).filter(
			(country) => country !== 'Unknown'
		);

		// Create the trip object
		const trip: DetectedTrip = {
			id: tripId,
			user_id: null, // Will be set by caller
			start_date: this.userState!.lastHomeStateStartTime,
			end_date: endTime,
			title: title,
			description: `Trip away from home for ${this.calculateTripDays(this.userState!.lastHomeStateStartTime, endTime)} days`,
			status: 'pending',
			metadata: {
				totalDurationHours: Math.round(awayDuration),
				visitedCities: uniqueCities,
				visitedCountries: uniqueCountries,
				visitedCountryCodes: uniqueCountries,
				visitedCitiesDetailed,
				visitedCountriesDetailed,
				isMultiCountryTrip: this.hasMultipleCountries(this.userState!.visitedCities),
				isMultiCityTrip: this.hasMultipleCities(this.userState!.visitedCities),
				tripType: this.determineTripType(this.userState!.visitedCities),
				primaryCity: this.getPrimaryCity(this.userState!.visitedCities),
				primaryCountry: this.getPrimaryCountry(this.userState!.visitedCities),
				primaryCountryCode: this.getPrimaryCountryCode(this.userState!.visitedCities),
				cityName: this.getPrimaryCity(this.userState!.visitedCities),
				dataPoints: this.userState!.visitedCities.reduce((sum, loc) => sum + loc.dataPoints, 0),
				tripDays: this.calculateTripDays(this.userState!.lastHomeStateStartTime, endTime),
				distanceFromHome: 0 // TODO: Calculate actual distance
			},
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		};

		return trip;
	}

	/**
	 * Generate trip title based on visited locations with 50% dominant location logic
	 */
	private async generateTripTitle(visitedCities: any[], language: string): Promise<string> {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);

		if (filteredLocations.length === 0) {
			return translateServer('tripDetection.tripAwayFromHome', {}, language);
		}

		// Get user's home country from preference
		if (!this.userId) {
			return translateServer('tripDetection.tripAwayFromHome', {}, language);
		}

		const { locations: homeLocations } = await this.getUserHomeLocations(this.userId);
		// The first location is the home address, others are trip exclusions
		const homeCountry =
			homeLocations.length > 0 ? homeLocations[0].address?.country_code || 'Unknown' : 'Unknown';

		// Calculate total duration first
		const totalDuration = filteredLocations.reduce((sum, loc) => sum + loc.durationHours, 0);

		// Check if this is a trip within the user's home country
		const isHomeCountryTrip =
			homeCountry !== 'Unknown' && filteredLocations.some((loc) => loc.countryCode === homeCountry);

		// For trips within home country, ALWAYS use city names, never country names
		if (isHomeCountryTrip) {
			// Get all cities from the home country
			const citiesInHomeCountry = filteredLocations.filter(
				(loc) => loc.countryCode === homeCountry
			);

			if (citiesInHomeCountry.length === 1) {
				// Single city in home country
				const cityName = citiesInHomeCountry[0].cityName;
				return translateServer('tripDetection.tripToCity', { city: cityName }, language);
			} else {
				// Multiple cities in home country - check for dominant city
				const cityDurations = new Map<string, number>();
				citiesInHomeCountry.forEach((loc) => {
					const city = loc.cityName;
					const currentDuration = cityDurations.get(city) || 0;
					cityDurations.set(city, currentDuration + loc.durationHours);
				});

				// Check for dominant city (≥50% of total time)
				for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
					(a, b) => b[1] - a[1]
				)) {
					if (cityDuration / totalDuration >= 0.5) {
						return translateServer('tripDetection.tripToCity', { city }, language);
					}
				}

				// No dominant city, show top 3 cities
				const sortedCities = citiesInHomeCountry
					.sort((a, b) => b.durationHours - a.durationHours)
					.slice(0, 3)
					.map((loc) => loc.cityName);
				const citiesString = sortedCities.join(', ');
				return translateServer(
					'tripDetection.tripToMultipleCities',
					{ cities: citiesString },
					language
				);
			}
		}

		// Continue with existing 50% dominant location logic for international trips

		// First check if there's a dominant country (≥50% of time)
		const countryDurations = new Map<string, number>();
		filteredLocations.forEach((loc) => {
			const country = loc.countryCode;
			const currentDuration = countryDurations.get(country) || 0;
			countryDurations.set(country, currentDuration + loc.durationHours);
		});

		// If only one country visited (and it's not home country)
		// Check if there's a single dominant city or multiple cities
		if (countryDurations.size === 1) {
			const countryCode = Array.from(countryDurations.keys())[0];
			const citiesInCountry = filteredLocations.filter((loc) => loc.countryCode === countryCode);

			// If single city, show city name
			if (citiesInCountry.length === 1) {
				const cityName = citiesInCountry[0].cityName;
				return translateServer('tripDetection.tripToCity', { city: cityName }, language);
			}

			// If more than 3 cities in one country, show country name
			if (citiesInCountry.length > 3) {
				const countryName = getCountryNameServer(countryCode, language);
				return translateServer('tripDetection.tripToCountry', { country: countryName }, language);
			}

			// If multiple cities (2-3), check for dominant city (≥50% of time)
			const cityDurations = new Map<string, number>();
			citiesInCountry.forEach((loc) => {
				const city = loc.cityName;
				const currentDuration = cityDurations.get(city) || 0;
				cityDurations.set(city, currentDuration + loc.durationHours);
			});

			// Check for dominant city
			for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
				(a, b) => b[1] - a[1]
			)) {
				if (cityDuration / totalDuration >= 0.5) {
					return translateServer('tripDetection.tripToCity', { city }, language);
				}
			}

			// No dominant city - show country name
			const countryName = getCountryNameServer(countryCode, language);
			return translateServer('tripDetection.tripToCountry', { country: countryName }, language);
		}

		// Check if we have multiple countries with significant time - prioritize this for multi-country trips
		const countriesWithSignificantTime = Array.from(countryDurations.entries())
			.filter(([countryCode, duration]) => countryCode !== 'Unknown' && duration >= 24) // Filter out Unknown and only countries meeting the 24h threshold
			.sort(([_, a], [__, b]) => b - a); // Sort by duration descending

		if (countriesWithSignificantTime.length > 1) {
			const countryNames = countriesWithSignificantTime
				.slice(0, 3) // Top 3 countries
				.map(([countryCode, _]) => getCountryNameServer(countryCode, language));

			// Remove duplicates and filter out 'Unknown' from country names
			const uniqueCountryNames = Array.from(new Set(countryNames)).filter(
				(name) => name !== 'Unknown'
			);

			const countriesString = uniqueCountryNames.join(', ');
			return translateServer(
				'tripDetection.tripToMultipleCountries',
				{ countries: countriesString },
				language
			);
		}

		// Check for dominant country (only if we don't have multiple countries above)
		for (const [country, duration] of countryDurations) {
			if (duration / totalDuration >= 0.5) {
				// Single dominant country - check if it's also a single city
				const citiesInCountry = filteredLocations.filter((loc) => loc.countryCode === country);

				if (citiesInCountry.length === 1) {
					const cityName = citiesInCountry[0].cityName;
					return translateServer('tripDetection.tripToCity', { city: cityName }, language);
				} else {
					// Multiple cities in dominant country - check for dominant city
					const cityDurations = new Map<string, number>();
					citiesInCountry.forEach((loc) => {
						const city = loc.cityName;
						const currentDuration = cityDurations.get(city) || 0;
						cityDurations.set(city, currentDuration + loc.durationHours);
					});

					// Check for dominant city within the dominant country
					for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
						(a, b) => b[1] - a[1]
					)) {
						if (cityDuration / duration >= 0.5) {
							return translateServer('tripDetection.tripToCity', { city }, language); // Single dominant city in dominant country
						}
					}

					// No dominant city, show top 3 cities from dominant country
					const cities = citiesInCountry
						.sort((a, b) => b.durationHours - a.durationHours)
						.slice(0, 3)
						.map((loc) => loc.cityName);

					// If there are multiple cities and no dominant city, use multiple cities format
					if (cities.length > 1) {
						const citiesString = cities.join(', ');
						return translateServer(
							'tripDetection.tripToMultipleCities',
							{ cities: citiesString },
							language
						);
					} else {
						return translateServer('tripDetection.tripToCity', { city: cities[0] }, language);
					}
				}
			}
		}

		// Find the country with the most time and show its dominant city, or show multiple countries
		let maxCountryDuration = 0;
		let maxCountry = '';

		for (const [country, duration] of countryDurations) {
			if (duration > maxCountryDuration) {
				maxCountryDuration = duration;
				maxCountry = country;
			}
		}

		// Check if the most visited country has a dominant city
		const citiesInMaxCountry = filteredLocations.filter((loc) => loc.countryCode === maxCountry);

		if (citiesInMaxCountry.length === 1) {
			const cityName = citiesInMaxCountry[0].cityName;
			return translateServer('tripDetection.tripToCity', { city: cityName }, language);
		} else {
			// Check for dominant city within the most visited country
			const cityDurations = new Map<string, number>();
			citiesInMaxCountry.forEach((loc) => {
				const city = loc.cityName;
				const currentDuration = cityDurations.get(city) || 0;
				cityDurations.set(city, currentDuration + loc.durationHours);
			});

			// Check for dominant city within the most visited country
			for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
				(a, b) => b[1] - a[1]
			)) {
				if (cityDuration / maxCountryDuration >= 0.5) {
					return translateServer('tripDetection.tripToCity', { city }, language); // Single dominant city in most visited country
				}
			}

			// No dominant city, show the most visited city from the most visited country
			const mostVisitedCity = citiesInMaxCountry.sort(
				(a, b) => b.durationHours - a.durationHours
			)[0];
			return translateServer(
				'tripDetection.tripToCity',
				{ city: mostVisitedCity.cityName },
				language
			);
		}
	}

	/**
	 * Filter visited locations by duration thresholds
	 * - Cities must be visited for at least 12 hours to be considered as a title candidate
	 * - But cities with less time can still be included if country total >= 24 hours
	 * - Countries must be visited for at least 24 hours (aggregated from cities)
	 */
	private filterLocationsByDuration(visitedCities: any[]): any[] {
		// First calculate country totals from ALL cities (before filtering)
		const countryDurations = new Map<string, number>();
		visitedCities.forEach((loc) => {
			const country = loc.countryCode;
			const currentDuration = countryDurations.get(country) || 0;
			countryDurations.set(country, currentDuration + loc.durationHours);
		});

		// Find countries that meet the 24-hour threshold
		const validCountries = new Set<string>();
		for (const [country, duration] of countryDurations) {
			if (duration >= 24) {
				validCountries.add(country);
			}
		}

		// Filter cities: keep cities from valid countries with at least 2 hours duration
		// (lower threshold allows showing multiple cities when no single city is dominant)
		const finalFiltered = visitedCities.filter((loc) => {
			const isFromValidCountry = validCountries.has(loc.countryCode);
			const hasReasonableDuration = loc.durationHours >= 2;

			return isFromValidCountry && hasReasonableDuration;
		});

		return finalFiltered;
	}

	/**
	 * Check if trip involves multiple countries (filtered by duration)
	 * If at least 50% of time is spent in one country, it's considered a single country trip
	 */
	private hasMultipleCountries(visitedCities: any[]): boolean {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return false;

		// Calculate total duration and duration per country
		const totalDuration = filteredLocations.reduce((sum, loc) => sum + loc.durationHours, 0);
		const countryDurations = new Map<string, number>();

		filteredLocations.forEach((loc) => {
			const country = loc.countryCode;
			const currentDuration = countryDurations.get(country) || 0;
			countryDurations.set(country, currentDuration + loc.durationHours);
		});

		// Check if any country has at least 50% of the total time
		for (const [country, duration] of countryDurations) {
			if (duration / totalDuration >= 0.5) {
				return false; // Single dominant country
			}
		}

		return countryDurations.size > 1;
	}

	/**
	 * Check if trip involves multiple cities (filtered by duration)
	 * If at least 50% of time is spent in one city, it's considered a single city trip
	 */
	private hasMultipleCities(visitedCities: any[]): boolean {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return false;

		// Calculate total duration and duration per city
		const totalDuration = filteredLocations.reduce((sum, loc) => sum + loc.durationHours, 0);
		const cityDurations = new Map<string, number>();

		filteredLocations.forEach((loc) => {
			const city = loc.cityName;
			const currentDuration = cityDurations.get(city) || 0;
			cityDurations.set(city, currentDuration + loc.durationHours);
		});

		// Check if any city has at least 50% of the total time
		for (const [city, duration] of cityDurations) {
			if (duration / totalDuration >= 0.5) {
				return false; // Single dominant city
			}
		}

		return cityDurations.size > 1;
	}

	/**
	 * Determine trip type based on visited locations (filtered by duration)
	 */
	private determineTripType(
		visitedCities: any[]
	): 'city' | 'country' | 'multi-city' | 'multi-country' {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		const hasMultipleCountries = this.hasMultipleCountries(visitedCities);
		const hasMultipleCities = this.hasMultipleCities(visitedCities);

		if (hasMultipleCountries) {
			return 'multi-country';
		} else if (hasMultipleCities) {
			return 'multi-city';
		} else if (filteredLocations.length > 0) {
			return 'city';
		} else {
			return 'country';
		}
	}

	/**
	 * Get primary city (city with longest duration)
	 */
	private getPrimaryCity(visitedCities: any[]): string {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return 'Unknown';

		// Sum duration hours by city
		const cityDurations = new Map<string, number>();
		filteredLocations.forEach((loc) => {
			const city = loc.cityName;
			const duration = loc.durationHours || 0;
			cityDurations.set(city, (cityDurations.get(city) || 0) + duration);
		});

		// Return city with longest duration
		let maxDuration = 0;
		let primaryCity = 'Unknown';
		for (const [city, duration] of cityDurations) {
			if (duration > maxDuration) {
				maxDuration = duration;
				primaryCity = city;
			}
		}

		return primaryCity;
	}

	/**
	 * Get primary country code (country with longest duration)
	 */
	private getPrimaryCountry(visitedCities: any[]): string {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return 'Unknown';

		// Sum duration hours by country
		const countryDurations = new Map<string, number>();
		filteredLocations.forEach((loc) => {
			const country = loc.countryCode;
			const duration = loc.durationHours || 0;
			countryDurations.set(country, (countryDurations.get(country) || 0) + duration);
		});

		// Return country with longest duration
		let maxDuration = 0;
		let primaryCountry = 'Unknown';
		for (const [country, duration] of countryDurations) {
			if (duration > maxDuration) {
				maxDuration = duration;
				primaryCountry = country;
			}
		}

		return primaryCountry;
	}

	/**
	 * Get primary country code
	 */
	private getPrimaryCountryCode(visitedCities: any[]): string {
		return this.getPrimaryCountry(visitedCities);
	}

	/**
	 * Calculate trip days (overnight stays + 1)
	 */
	private calculateTripDays(startDate: string, endDate: string): number {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const diffMs = end.getTime() - start.getTime();
		const diffDays = diffMs / (1000 * 60 * 60 * 24);

		// Trip days = overnight stays + 1
		// For same-day trips, this will be 1
		// For multi-day trips, this will be the actual number of days
		return Math.max(1, Math.ceil(diffDays));
	}

	/**
	 * Add a visited location to the user state (legacy method for backward compatibility)
	 * Duration is calculated as the time difference between the current point and the previous point
	 */
	private addVisitedLocation(point: any, previousPoint: any): void {
		const cityName = this.getCityFromPoint(point) || 'Unknown';

		// Get coordinates from the point
		const coordinates = point.geocode?.geometry?.coordinates
			? { lat: point.geocode.geometry.coordinates[1], lng: point.geocode.geometry.coordinates[0] }
			: { lat: 0, lng: 0 };

		// Determine country code from coordinates using countries.geojson
		let countryCode = 'Unknown';
		if (coordinates.lat !== 0 && coordinates.lng !== 0) {
			try {
				const detectedCountry = getCountryForPoint(coordinates.lat, coordinates.lng);
				if (detectedCountry) {
					countryCode = detectedCountry;
				} else {
					// Fallback to geocode data if coordinates don't match any country
					countryCode = point.geocode?.properties?.address?.country_code || 'Unknown';
				}
			} catch (error) {
				console.error('❌ Error calling country detection function:', error);
				// Fallback to geocode data if available
				countryCode = point.geocode?.properties?.address?.country_code || 'Unknown';
			}
		} else {
			// Fallback to geocode data if coordinates are not available
			countryCode = point.geocode?.properties?.address?.country_code || 'Unknown';
		}

		// Check if we already have this location
		const existingLocation = this.userState!.visitedCities.find(
			(loc) => loc.cityName === cityName && loc.countryCode === countryCode
		);

		if (existingLocation) {
			// Update existing location
			existingLocation.dataPoints++;

			// Calculate duration if we have a previous point
			if (previousPoint && previousPoint.recorded_at) {
				const durationHours = this.calculateAwayDuration(
					previousPoint.recorded_at,
					point.recorded_at
				);
				existingLocation.durationHours += durationHours;
			}

			// Update last visit time
			existingLocation.lastVisitTime = point.recorded_at;
		} else {
			// Add new location
			let durationHours = 0;
			if (previousPoint && previousPoint.recorded_at) {
				durationHours = this.calculateAwayDuration(previousPoint.recorded_at, point.recorded_at);
			}

			this.userState!.visitedCities.push({
				cityName,
				countryCode,
				coordinates,
				firstVisitTime: point.recorded_at,
				lastVisitTime: point.recorded_at,
				durationHours: durationHours,
				dataPoints: 1
			});
		}
	}

	/**
	 * Update user state based on a new data point
	 */
	private async updateUserState(
		point: any,
		previousPoint: any,
		pointState: 'home' | 'away',
		language: string = 'en'
	): Promise<DetectedTrip | null> {
		let trip: DetectedTrip | null = null;
		// If point state matches current state, increment data points
		if (pointState === this.userState!.currentState) {
			this.userState!.dataPointsInState++;

			// Keep track of when user was last at home
			if (this.userState!.currentState === 'home') {
				this.userState!.lastHomeStateStartTime = point.recorded_at;
			}

			// If user is away, track visited locations
			if (this.userState!.currentState === 'away') {
				// Use simpler method since nextPoint is not available in batch processing
				this.addVisitedLocation(point, previousPoint);
			}

			// Reset next state if we're back to current state
			if (this.userState!.nextState) {
				this.userState!.nextState = undefined;
				this.userState!.nextStateStartTime = undefined;
				this.userState!.nextStateDataPoints = 0;
			}
		} else {
			// Point state is different from current state
			if (this.userState!.nextState === pointState) {
				// Continue building next state
				this.userState!.nextStateDataPoints++;

				// Check if we have enough points to confirm state change
				if (this.userState!.nextStateDataPoints > 3) {
					// If we're transitioning to home, create a trip for the away duration
					if (this.userState!.nextState === 'home') {
						const awayDuration = this.calculateAwayDuration(
							this.userState!.lastHomeStateStartTime,
							this.userState!.nextStateStartTime!
						);

						// Only create a trip if the away duration is at least 24 hours
						if (awayDuration >= 24) {
							// Create trip with current state info before updating
							trip = await this.createTripFromAwayState(
								awayDuration,
								this.userState!.nextStateStartTime!,
								language
							);
							// If no trip was created (no meaningful locations), still transition to home
							// to avoid runaway long trips; we'll just skip persisting a trip.
						}
					}

					// Confirm state change
					this.userState!.currentState = this.userState!.nextState;
					this.userState!.stateStartTime = this.userState!.nextStateStartTime!;
					this.userState!.dataPointsInState = this.userState!.nextStateDataPoints;

					// Update lastHomeStateStartTime if transitioning to home
					if (this.userState!.nextState === 'home') {
						this.userState!.lastHomeStateStartTime = this.userState!.nextStateStartTime!;
					}

					// Reset next state
					this.userState!.nextState = undefined;
					this.userState!.nextStateStartTime = undefined;
					this.userState!.nextStateDataPoints = 0;
					this.userState!.visitedCities = [];
				}
			} else {
				// Start new next state
				this.userState!.nextState = pointState;
				this.userState!.nextStateStartTime = point.recorded_at;
				this.userState!.nextStateDataPoints = 1;
			}
		}

		return trip;
	}

	/**
	 * Parse and validate location data from database
	 */
	private parseLocation(data: any): Location {
		// Handle different possible data structures
		if (data.location && data.location.address) {
			// Trip exclusion format: { id, name, location: { address, coordinates } }
			return {
				id: data.id,
				name: data.name,
				coordinates: data.location.coordinates || undefined,
				address: data.location.address
			};
		} else if (data.address) {
			// Home address format: { address, coordinates }
			// Check if this is the direct home address format from database
			if (data.lat && data.lon) {
				// Direct home address format: { lat, lon, address, coordinates }
				return {
					coordinates: data.coordinates || { lat: data.lat, lng: data.lon },
					address: data.address
				};
			} else {
				// Standard home address format: { address, coordinates }
				return {
					coordinates: data.coordinates || undefined,
					address: data.address
				};
			}
		} else {
			// Fallback: assume it's already in the correct format
			return data;
		}
	}
}
