// Trip detection service for Deno runtime

import { translateServer, getCountryNameServer } from '../utils/server-translations';

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
	lastHomeStateStartTime: string;
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
	private customHomeAddress: Location | null = null;
	private jobId: string | null = null;
	private progressCallback?: (progress: TripDetectionProgress) => void;
	// Last language resolved for the processed user, so getOngoingTrip() can
	// generate a correctly-localized title without re-loading preferences.
	private lastLanguage: string = 'en';

	constructor(fluxbaseClient: FluxbaseClient) {
		this.fluxbase = fluxbaseClient;
	}

	setProgressTracking(
		jobId: string,
		progressCallback: (progress: TripDetectionProgress) => void
	): void {
		this.jobId = jobId;
		this.progressCallback = progressCallback;
	}

	private updateProgress(progress: TripDetectionProgress): void {
		if (this.progressCallback) {
			this.progressCallback(progress);
		}
	}

	/**
	 * Date ranges of existing trips whose points must not be re-detected.
	 *
	 * 'active' trips are excluded too (default) so a re-detection run doesn't
	 * suggest a pending duplicate of the user's ongoing trip. The scheduled
	 * generator passes excludeActiveTrips:false because it owns the ongoing
	 * trip lifecycle itself (rolling it forward, closing it on return) and
	 * needs the away data inside the active trip's range to do that; the
	 * unique index on trips (user_id, start_date, end_date) guards the overlap.
	 */
	async getExcludedDateRanges(
		userId: string,
		options?: { excludeActiveTrips?: boolean }
	): Promise<ExcludedDateRange[]> {
		const excludeActive = options?.excludeActiveTrips !== false;
		try {
			const statuses = excludeActive
				? ['completed', 'rejected', 'pending', 'active']
				: ['completed', 'rejected', 'pending'];
			const { data: trips, error } = await this.fluxbase
				.from('trips')
				.select('start_date, end_date, status')
				.eq('user_id', userId)
				.in('status', statuses);

			if (error) {
				console.error('❌ Error fetching trips:', error);
				return [];
			}

			const excludedRanges: ExcludedDateRange[] = trips.map((trip: { start_date: string; end_date: string; status: string }) => ({
				startDate: trip.start_date,
				endDate: trip.end_date,
				reason:
					trip.status === 'completed'
						? 'approved_trip'
						: trip.status === 'active'
							? 'active_trip'
							: 'rejected_trip'
			}));

			return excludedRanges;
		} catch (error) {
			console.error('❌ Exception in getExcludedDateRanges:', error);
			return [];
		}
	}

	async getUserHomeLocations(userId: string): Promise<{ locations: Location[]; language: string }> {
		try {
			const cached = this.homeLocationsCache.get(userId);
			if (cached) {
				return { locations: cached.locations, language: cached.language };
			}

			const homeLocations: Location[] = [];

			if (this.customHomeAddress) {
				homeLocations.push(this.customHomeAddress);
				console.log(`🏠 Custom home address: ${this.customHomeAddress.address?.city || 'unknown city'}`);
			} else {
				const { data: profile, error: profileError } = await this.fluxbase
					.from('user_profiles')
					.select('home_address')
					.eq('id', userId)
					.single();

				if (profileError) {
					console.warn('⚠️ Could not fetch home address:', profileError);
				} else if (profile?.home_address) {
					const homeAddress = this.parseLocation(profile.home_address);
					homeLocations.push(homeAddress);
					console.log(`🏠 Home address: ${homeAddress.address?.city || 'unknown city'}`);
				}
			}

			const { data: preferences, error: preferencesError } = await this.fluxbase
				.from('user_preferences')
				.select('trip_exclusions, language')
				.eq('id', userId)
				.single();

			if (preferencesError) {
				console.warn('⚠️ Could not fetch trip exclusions:', preferencesError);
			} else if (preferences?.trip_exclusions && preferences.trip_exclusions.length > 0) {
				const tripExclusions = preferences.trip_exclusions.map((exclusion: any) =>
					this.parseLocation(exclusion)
				);
				homeLocations.push(...tripExclusions);
				console.log(`🏢 Trip exclusions (${tripExclusions.length}): ${tripExclusions.map((e: Location) => e.name || e.address?.city || 'unknown').join(', ')}`);
			}

			const language = preferences?.language || 'en';

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

	clearHomeLocationsCache(userId?: string): void {
		if (userId) {
			this.homeLocationsCache.delete(userId);
		} else {
			this.homeLocationsCache.clear();
		}
	}

	setCustomHomeAddress(homeAddress: Location): void {
		this.customHomeAddress = homeAddress;
		this.homeLocationsCache.clear();
	}

	clearCustomHomeAddress(): void {
		this.customHomeAddress = null;
	}

	async detectTrips(
		userId: string,
		startDate?: string,
		endDate?: string,
		options?: { excludeActiveTrips?: boolean }
	): Promise<DetectedTrip[]> {
		try {
			this.updateProgress({
				phase: 'initializing',
				progress: 0,
				message: 'Initializing trip detection...',
				details: {}
			});

			this.userId = userId;

			this.updateProgress({
				phase: 'fetching_data',
				progress: 0,
				message: 'Fetching configuration...',
				details: {}
			});

			const excludedRanges = await this.getExcludedDateRanges(userId, options);
			const { locations: homeLocations, language } = await this.getUserHomeLocations(userId);
			this.lastLanguage = language;

			console.log(`📅 Found ${excludedRanges.length} excluded date ranges`);
			console.log(`🏠 Found ${homeLocations.length} home locations`);
			if (homeLocations.length > 0) {
				console.log(`🏠 Home locations:`, homeLocations.map(loc => loc.address?.city || loc.name || 'unknown').join(', '));
			} else {
				console.log(`⚠️ No home locations defined - trip detection may not work correctly`);
			}

			const effectiveStartDate = startDate || (await this.getUserFirstDataPoint(userId));
			const effectiveEndDate = endDate || this.getTomorrowDate();

			this.updateProgress({
				phase: 'fetching_data',
				progress: 0,
				message: 'Counting data points...',
				details: {}
			});

			// Exclusion of already-tripped date ranges is computed arithmetically:
			// count ALL points in the window once, count the points INSIDE each
			// excluded range with plain gte/lte filters, and subtract.
			//
			// History: `not.between` was never part of the server filter grammar
			// and silently degraded to a match-all equality (Fluxbase
			// #code-review-2026-09 added proper between/not.between support in
			// 2026.9.3, plus loud failures on unknown operators). We keep the
			// count-and-subtract approach anyway: per-range gte/lte counts are
			// server-side ANDed with the window bounds (or-groups with between
			// leaves remain unreliable), and pre-merging the ranges keeps
			// overlapping trips from double-counting. The batch query further
			// down skips in-range points client-side for the same reason.
			const { count: windowPointCount, error: countError } = await this.fluxbase
				.from('tracker_data')
				.select('recorded_at', { count: 'exact', head: true })
				.eq('user_id', userId)
				.gte('recorded_at', effectiveStartDate)
				.lte('recorded_at', effectiveEndDate);

			if (countError) {
				console.error(`❌ Error counting data points:`, countError);
			}

			const excludedMergedRanges = this.mergeDateRanges(excludedRanges);
			let excludedCount = 0;
			for (const range of excludedMergedRanges) {
				const { count, error } = await this.fluxbase
					.from('tracker_data')
					.select('recorded_at', { count: 'exact', head: true })
					.eq('user_id', userId)
					.gte('recorded_at', effectiveStartDate)
					.lte('recorded_at', effectiveEndDate)
					.gte('recorded_at', range.start)
					.lte('recorded_at', range.end);
				if (error) {
					console.warn(`⚠️ Error counting excluded range ${range.start}..${range.end}:`, error);
					continue;
				}
				excludedCount += count || 0;
			}

			const totalPoints = Math.max(0, (windowPointCount || 0) - excludedCount);

			if (totalPoints === 0) {
				this.updateProgress({
					phase: 'completed',
					progress: 100,
					message: 'No data to process',
					details: { detectedTrips: 0 }
				});
				return [];
			}

			this.userState = {
				currentState: 'home',
				stateStartTime: effectiveStartDate,
				dataPointsInState: 0,
				lastHomeStateStartTime: effectiveStartDate,
				nextStateDataPoints: 0,
				visitedCities: []
			};

			const trips: DetectedTrip[] = [];
			let processedPoints = 0;
			let batchNumber = 0;
			let lastRecordedAt: string | null = null;
			const batchSize = 1000;

			console.log(`🔍 Starting batch processing: ${effectiveStartDate} to ${effectiveEndDate}`);
			console.log(`📊 Total points to process: ${totalPoints}`);

			while (true) {
				let query = this.fluxbase
					.from('tracker_data')
					.select('recorded_at, geocode')
					.eq('user_id', userId)
					.gte('recorded_at', effectiveStartDate)
					.lte('recorded_at', effectiveEndDate);

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

				// Skip points inside an existing trip's date range client-side
				// (query-level exclusion isn't possible — see the counting
				// comment above for the grammar limitation).
				const outsideBatch = excludedMergedRanges.length
					? batch.filter(
							(point: { recorded_at: string }) =>
								!this.isRecordedInExcludedRanges(point.recorded_at, excludedMergedRanges)
						)
					: batch;

				const pointsWithCity = outsideBatch.filter((point: { recorded_at: string; geocode?: { properties?: { city?: string; address?: { city?: string }; addendum?: { osm?: { 'addr:city'?: string } } } } }) => {
					const city = point.geocode?.properties?.addendum?.osm?.['addr:city'] ||
						point.geocode?.properties?.city ||
						point.geocode?.properties?.address?.city;
					return city && city.trim() !== '';
				});

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

				processedPoints += outsideBatch.length;

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

	private getTomorrowDate(): string {
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		return tomorrow.toISOString().split('T')[0];
	}

	/**
	 * Merge overlapping/adjacent excluded date ranges so per-range counts and
	 * client-side skipping never double-count a shared day. ISO dates compare
	 * correctly as strings ('YYYY-MM-DD' vs timestamps).
	 */
	private mergeDateRanges(ranges: ExcludedDateRange[]): Array<{ start: string; end: string }> {
		if (ranges.length === 0) return [];
		const sorted = ranges
			.map((r) => ({ start: r.startDate, end: r.endDate }))
			.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
		const merged: Array<{ start: string; end: string }> = [{ ...sorted[0]! }];
		for (const range of sorted.slice(1)) {
			const last = merged[merged.length - 1]!;
			if (range.start <= last.end) {
				if (range.end > last.end) last.end = range.end;
			} else {
				merged.push({ ...range });
			}
		}
		return merged;
	}

	private isRecordedInExcludedRanges(
		recordedAt: string,
		ranges: Array<{ start: string; end: string }>
	): boolean {
		return ranges.some((range) => recordedAt >= range.start && recordedAt <= range.end);
	}

	private async getUserFirstDataPoint(userId: string): Promise<string> {
		try {
			const { data, error } = await this.fluxbase
				.from('tracker_data')
				.select('recorded_at')
				.eq('user_id', userId)
				.not('geocode', 'is', null)
				.order('recorded_at', { ascending: true })
				.limit(1)
				.single();

			if (error || !data) {
				console.warn('⚠️ Could not find first data point for user, using fallback date');
				return '2023-01-01';
			}

			const firstDate = new Date(data.recorded_at);
			return firstDate.toISOString().split('T')[0];
		} catch (error) {
			console.error('❌ Error fetching user first data point:', error);
			return '2023-01-01';
		}
	}

	private isPointAtHome(point: any, homeLocations: Location[]): boolean {
		if (homeLocations.length === 0) {
			return false;
		}

		for (const homeLocation of homeLocations) {
			if (this.isPointInLocation(point, homeLocation)) {
				return true;
			}
		}

		return false;
	}

	private isPointInLocation(point: any, location: Location): boolean {
		if (this.isPointInSameCity(point, location)) {
			return true;
		}

		if (location.coordinates && point.geocode?.geometry?.coordinates) {
			const [lon, lat] = point.geocode.geometry.coordinates;
			const distance = this.calculateDistance(
				location.coordinates.lat,
				location.coordinates.lng,
				lat,
				lon
			);
			return distance <= 50;
		}

		return false;
	}

	private isPointInSameCity(point: any, location: Location): boolean {
		const pointCity = this.getCityFromPoint(point);
		const locationCity = this.getCityFromLocation(location);

		if (pointCity && locationCity) {
			return pointCity.toLowerCase() === locationCity.toLowerCase();
		}

		return false;
	}

	private getCityFromPoint(point: any): string | null {
		if (point.geocode?.properties?.addendum?.osm?.['addr:city']) {
			return point.geocode.properties.addendum.osm['addr:city'];
		}
		if (point.geocode?.properties?.address?.city) {
			return point.geocode.properties.address.city;
		}
		if (point.geocode?.properties?.city) {
			return point.geocode.properties.city;
		}
		// Fallback: check locality field (Pelias stores city here directly)
		if (point.geocode?.properties?.locality) {
			return point.geocode.properties.locality;
		}

		return null;
	}

	private getCityFromLocation(location: Location): string | null {
		if (location.address?.city) {
			return location.address.city;
		}
		return null;
	}

	private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 6371;
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

	private toRadians(degrees: number): number {
		return degrees * (Math.PI / 180);
	}

	private calculateAwayDuration(lastHomeTime: string, currentTime: string): number {
		const lastHome = new Date(lastHomeTime);
		const current = new Date(currentTime);
		const diffMs = current.getTime() - lastHome.getTime();
		return diffMs / (1000 * 60 * 60);
	}

	/**
	 * After `detectTrips()` has run, inspect the trailing home/away state.
	 *
	 * Normally, a trip is only emitted when the user RETURNS home (the away
	 * span closes). If the data ends while the user is still away — i.e. they
	 * are CURRENTLY on a trip — that open span is dropped. This accessor
	 * surfaces it as a DetectedTrip (status 'pending') so the caller can decide
	 * what to do (e.g. persist as 'active').
	 *
	 * Returns null if the user is currently home, hasn't been away long enough
	 * (< 24h), or has no visited cities in the open span. Must be called after
	 * detectTrips() for the same userId; requires a language hint for the title.
	 */
	async getOngoingTrip(language?: string): Promise<DetectedTrip | null> {
		const lang = language ?? this.lastLanguage;
		if (!this.userState || this.userState.currentState !== 'away') {
			return null;
		}
		const nowIso = new Date().toISOString();
		const awayDuration = this.calculateAwayDuration(
			this.userState.lastHomeStateStartTime,
			nowIso
		);
		// Same 24h minimum and city gate as a closed trip.
		if (awayDuration < 24) return null;
		return this.createTripFromAwayState(awayDuration, nowIso, lang);
	}

	/**
	 * Whether the last-processed point placed the user away from home. Cheaper
	 * than getOngoingTrip() if the caller only needs the boolean.
	 */
	isCurrentlyAway(): boolean {
		return this.userState?.currentState === 'away';
	}

	/**
	 * Timestamp at which the user (re)entered the current 'home' state during
	 * the last detectTrips() run — i.e. the return-home time that closed the
	 * last away span. Null while the user is currently away or before any
	 * detection has run.
	 */
	getHomeReturnTime(): string | null {
		if (!this.userState || this.userState.currentState !== 'home') {
			return null;
		}
		return this.userState.stateStartTime;
	}

	private async createTripFromAwayState(
		awayDuration: number,
		endTime: string,
		language: string
	): Promise<DetectedTrip | null> {
		const filteredLocations = this.filterLocationsByDuration(this.userState!.visitedCities);
		if (filteredLocations.length === 0) {
			return null;
		}

		const tripId = crypto.randomUUID();
		const title = await this.generateTripTitle(this.userState!.visitedCities, language);

		const visitedCitiesDetailed = filteredLocations.map((loc) => ({
			city: loc.cityName,
			countryCode: loc.countryCode,
			durationHours: Math.round(loc.durationHours),
			dataPoints: loc.dataPoints
		}));

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

		const uniqueCities = Array.from(
			new Set(filteredLocations.map((location) => location.cityName))
		).filter((city) => city !== 'Unknown');

		const uniqueCountries = Array.from(countryMap.keys()).filter(
			(country) => country !== 'Unknown'
		);

		const trip: DetectedTrip = {
			id: tripId,
			user_id: null,
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
				distanceFromHome: 0
			},
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		};

		return trip;
	}

	private async generateTripTitle(visitedCities: any[], language: string): Promise<string> {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);

		if (filteredLocations.length === 0) {
			return translateServer('tripDetection.tripAwayFromHome', {}, language);
		}

		if (!this.userId) {
			return translateServer('tripDetection.tripAwayFromHome', {}, language);
		}

		const { locations: homeLocations } = await this.getUserHomeLocations(this.userId);
		const homeCountry =
			homeLocations.length > 0 ? homeLocations[0].address?.country_code || 'Unknown' : 'Unknown';

		const totalDuration = filteredLocations.reduce((sum, loc) => sum + loc.durationHours, 0);

		const isHomeCountryTrip =
			homeCountry !== 'Unknown' && filteredLocations.some((loc) => loc.countryCode === homeCountry);

		if (isHomeCountryTrip) {
			const citiesInHomeCountry = filteredLocations.filter(
				(loc) => loc.countryCode === homeCountry
			);

			if (citiesInHomeCountry.length === 1) {
				const cityName = citiesInHomeCountry[0].cityName;
				return translateServer('tripDetection.tripToCity', { city: cityName }, language);
			} else {
				const cityDurations = new Map<string, number>();
				citiesInHomeCountry.forEach((loc) => {
					const city = loc.cityName;
					const currentDuration = cityDurations.get(city) || 0;
					cityDurations.set(city, currentDuration + loc.durationHours);
				});

				for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
					(a, b) => b[1] - a[1]
				)) {
					if (cityDuration / totalDuration >= 0.5) {
						return translateServer('tripDetection.tripToCity', { city }, language);
					}
				}

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

		const countryDurations = new Map<string, number>();
		filteredLocations.forEach((loc) => {
			const country = loc.countryCode;
			const currentDuration = countryDurations.get(country) || 0;
			countryDurations.set(country, currentDuration + loc.durationHours);
		});

		if (countryDurations.size === 1) {
			const countryCode = Array.from(countryDurations.keys())[0];
			const citiesInCountry = filteredLocations.filter((loc) => loc.countryCode === countryCode);

			if (citiesInCountry.length === 1) {
				const cityName = citiesInCountry[0].cityName;
				return translateServer('tripDetection.tripToCity', { city: cityName }, language);
			}

			if (citiesInCountry.length > 3) {
				const countryName = getCountryNameServer(countryCode, language);
				return translateServer('tripDetection.tripToCountry', { country: countryName }, language);
			}

			const cityDurations = new Map<string, number>();
			citiesInCountry.forEach((loc) => {
				const city = loc.cityName;
				const currentDuration = cityDurations.get(city) || 0;
				cityDurations.set(city, currentDuration + loc.durationHours);
			});

			for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
				(a, b) => b[1] - a[1]
			)) {
				if (cityDuration / totalDuration >= 0.5) {
					return translateServer('tripDetection.tripToCity', { city }, language);
				}
			}

			const countryName = getCountryNameServer(countryCode, language);
			return translateServer('tripDetection.tripToCountry', { country: countryName }, language);
		}

		const countriesWithSignificantTime = Array.from(countryDurations.entries())
			.filter(([countryCode, duration]) => countryCode !== 'Unknown' && duration >= 24)
			.sort(([_, a], [__, b]) => b - a);

		if (countriesWithSignificantTime.length > 1) {
			const countryNames = countriesWithSignificantTime
				.slice(0, 3)
				.map(([countryCode, _]) => getCountryNameServer(countryCode, language));

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

		for (const [country, duration] of countryDurations) {
			if (duration / totalDuration >= 0.5) {
				const citiesInCountry = filteredLocations.filter((loc) => loc.countryCode === country);

				if (citiesInCountry.length === 1) {
					const cityName = citiesInCountry[0].cityName;
					return translateServer('tripDetection.tripToCity', { city: cityName }, language);
				} else {
					const cityDurations = new Map<string, number>();
					citiesInCountry.forEach((loc) => {
						const city = loc.cityName;
						const currentDuration = cityDurations.get(city) || 0;
						cityDurations.set(city, currentDuration + loc.durationHours);
					});

					for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
						(a, b) => b[1] - a[1]
					)) {
						if (cityDuration / duration >= 0.5) {
							return translateServer('tripDetection.tripToCity', { city }, language);
						}
					}

					const cities = citiesInCountry
						.sort((a, b) => b.durationHours - a.durationHours)
						.slice(0, 3)
						.map((loc) => loc.cityName);

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

		let maxCountryDuration = 0;
		let maxCountry = '';

		for (const [country, duration] of countryDurations) {
			if (duration > maxCountryDuration) {
				maxCountryDuration = duration;
				maxCountry = country;
			}
		}

		const citiesInMaxCountry = filteredLocations.filter((loc) => loc.countryCode === maxCountry);

		if (citiesInMaxCountry.length === 1) {
			const cityName = citiesInMaxCountry[0].cityName;
			return translateServer('tripDetection.tripToCity', { city: cityName }, language);
		} else {
			const cityDurations = new Map<string, number>();
			citiesInMaxCountry.forEach((loc) => {
				const city = loc.cityName;
				const currentDuration = cityDurations.get(city) || 0;
				cityDurations.set(city, currentDuration + loc.durationHours);
			});

			for (const [city, cityDuration] of Array.from(cityDurations.entries()).sort(
				(a, b) => b[1] - a[1]
			)) {
				if (cityDuration / maxCountryDuration >= 0.5) {
					return translateServer('tripDetection.tripToCity', { city }, language);
				}
			}

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

	private filterLocationsByDuration(visitedCities: any[]): any[] {
		const countryDurations = new Map<string, number>();
		visitedCities.forEach((loc) => {
			const country = loc.countryCode;
			const currentDuration = countryDurations.get(country) || 0;
			countryDurations.set(country, currentDuration + loc.durationHours);
		});

		const validCountries = new Set<string>();
		for (const [country, duration] of countryDurations) {
			if (duration >= 24) {
				validCountries.add(country);
			}
		}

		const finalFiltered = visitedCities.filter((loc) => {
			const isFromValidCountry = validCountries.has(loc.countryCode);
			const hasReasonableDuration = loc.durationHours >= 2;

			return isFromValidCountry && hasReasonableDuration;
		});

		return finalFiltered;
	}

	private hasMultipleCountries(visitedCities: any[]): boolean {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return false;

		const totalDuration = filteredLocations.reduce((sum, loc) => sum + loc.durationHours, 0);
		const countryDurations = new Map<string, number>();

		filteredLocations.forEach((loc) => {
			const country = loc.countryCode;
			const currentDuration = countryDurations.get(country) || 0;
			countryDurations.set(country, currentDuration + loc.durationHours);
		});

		for (const [country, duration] of countryDurations) {
			if (duration / totalDuration >= 0.5) {
				return false;
			}
		}

		return countryDurations.size > 1;
	}

	private hasMultipleCities(visitedCities: any[]): boolean {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return false;

		const totalDuration = filteredLocations.reduce((sum, loc) => sum + loc.durationHours, 0);
		const cityDurations = new Map<string, number>();

		filteredLocations.forEach((loc) => {
			const city = loc.cityName;
			const currentDuration = cityDurations.get(city) || 0;
			cityDurations.set(city, currentDuration + loc.durationHours);
		});

		for (const [city, duration] of cityDurations) {
			if (duration / totalDuration >= 0.5) {
				return false;
			}
		}

		return cityDurations.size > 1;
	}

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

	private getPrimaryCity(visitedCities: any[]): string {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return 'Unknown';

		const cityDurations = new Map<string, number>();
		filteredLocations.forEach((loc) => {
			const city = loc.cityName;
			const duration = loc.durationHours || 0;
			cityDurations.set(city, (cityDurations.get(city) || 0) + duration);
		});

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

	private getPrimaryCountry(visitedCities: any[]): string {
		const filteredLocations = this.filterLocationsByDuration(visitedCities);
		if (filteredLocations.length === 0) return 'Unknown';

		const countryDurations = new Map<string, number>();
		filteredLocations.forEach((loc) => {
			const country = loc.countryCode;
			const duration = loc.durationHours || 0;
			countryDurations.set(country, (countryDurations.get(country) || 0) + duration);
		});

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

	private getPrimaryCountryCode(visitedCities: any[]): string {
		return this.getPrimaryCountry(visitedCities);
	}

	private calculateTripDays(startDate: string, endDate: string): number {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const diffMs = end.getTime() - start.getTime();
		const diffDays = diffMs / (1000 * 60 * 60 * 24);

		return Math.max(1, Math.ceil(diffDays));
	}

	private addVisitedLocation(point: any, previousPoint: any): void {
		const cityName = this.getCityFromPoint(point) || 'Unknown';

		const coordinates = point.geocode?.geometry?.coordinates
			? { lat: point.geocode.geometry.coordinates[1], lng: point.geocode.geometry.coordinates[0] }
			: { lat: 0, lng: 0 };

		// Use existing country code from geocoded data (set by reverse-geocoding job)
		const countryCode = point.geocode?.properties?.address?.country_code || 'Unknown';

		const existingLocation = this.userState!.visitedCities.find(
			(loc) => loc.cityName === cityName && loc.countryCode === countryCode
		);

		if (existingLocation) {
			existingLocation.dataPoints++;

			if (previousPoint && previousPoint.recorded_at) {
				const durationHours = this.calculateAwayDuration(
					previousPoint.recorded_at,
					point.recorded_at
				);
				existingLocation.durationHours += durationHours;
			}

			existingLocation.lastVisitTime = point.recorded_at;
		} else {
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

	private async updateUserState(
		point: any,
		previousPoint: any,
		pointState: 'home' | 'away',
		language: string = 'en'
	): Promise<DetectedTrip | null> {
		let trip: DetectedTrip | null = null;

		if (pointState === this.userState!.currentState) {
			this.userState!.dataPointsInState++;

			if (this.userState!.currentState === 'home') {
				this.userState!.lastHomeStateStartTime = point.recorded_at;
			}

			if (this.userState!.currentState === 'away') {
				this.addVisitedLocation(point, previousPoint);
			}

			if (this.userState!.nextState) {
				this.userState!.nextState = undefined;
				this.userState!.nextStateStartTime = undefined;
				this.userState!.nextStateDataPoints = 0;
			}
		} else {
			if (this.userState!.nextState === pointState) {
				this.userState!.nextStateDataPoints++;

				if (this.userState!.nextStateDataPoints > 3) {
					if (this.userState!.nextState === 'home') {
						const awayDuration = this.calculateAwayDuration(
							this.userState!.lastHomeStateStartTime,
							this.userState!.nextStateStartTime!
						);

						if (awayDuration >= 24) {
							trip = await this.createTripFromAwayState(
								awayDuration,
								this.userState!.nextStateStartTime!,
								language
							);
						}
					}

					this.userState!.currentState = this.userState!.nextState;
					this.userState!.stateStartTime = this.userState!.nextStateStartTime!;
					this.userState!.dataPointsInState = this.userState!.nextStateDataPoints;

					if (this.userState!.nextState === 'home') {
						this.userState!.lastHomeStateStartTime = this.userState!.nextStateStartTime!;
					}

					this.userState!.nextState = undefined;
					this.userState!.nextStateStartTime = undefined;
					this.userState!.nextStateDataPoints = 0;
					this.userState!.visitedCities = [];
				}
			} else {
				this.userState!.nextState = pointState;
				this.userState!.nextStateStartTime = point.recorded_at;
				this.userState!.nextStateDataPoints = 1;
			}
		}

		return trip;
	}

	private parseLocation(data: any): Location {
		if (data.location && data.location.address) {
			return {
				id: data.id,
				name: data.name,
				coordinates: data.location.coordinates || undefined,
				address: data.location.address
			};
		} else if (data.address) {
			if (data.lat && data.lon) {
				return {
					coordinates: data.coordinates || { lat: data.lat, lng: data.lon },
					address: data.address
				};
			} else {
				return {
					coordinates: data.coordinates || undefined,
					address: data.address
				};
			}
		} else {
			return data;
		}
	}
}
