import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

interface Trip {
	id: string;
	user_id: string;
	title: string;
	description?: string;
	start_date: string;
	end_date: string;
	metadata?: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

interface CreateTripData {
	title: string;
	description?: string;
	start_date: string;
	end_date: string;
	metadata?: Record<string, unknown>;
}

interface UpdateTripData extends Partial<CreateTripData> {
	id: string;
}

export class TripsService {
	private fluxbase: FluxbaseClient;

	constructor(client: FluxbaseClient) {
		this.fluxbase = client;
	}

	private async getCurrentUserId(): Promise<string> {
		const { data } = await this.fluxbase.auth.getSession();
		if (!data?.session?.user?.id) {
			throw new Error('User not authenticated');
		}
		return data.session.user.id;
	}

	private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 6371; // Earth's radius in kilometers
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLon = ((lon2 - lon1) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos((lat1 * Math.PI) / 180) *
				Math.cos((lat2 * Math.PI) / 180) *
				Math.sin(dLon / 2) *
				Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	async getTrips(userId?: string): Promise<Trip[]> {
		try {
			// Get current user if userId is not provided
			let currentUserId = userId;
			if (!currentUserId) {
				const {
					data: { user },
					error: userError
				} = await this.fluxbase.auth.getUser();
				if (userError || !user) {
					throw new Error('User not authenticated');
				}
				currentUserId = user.id;
			}

			const query = this.fluxbase
				.from('trips')
				.select('*')
				.eq('user_id', currentUserId)
				.order('created_at', { ascending: false });

			const { data: trips, error } = await query;
			if (error) {
				console.error('❌ [TripsService] Database error fetching trips:', error);
				throw error;
			}
			return (trips || []) as unknown as Trip[];
		} catch (error) {
			console.error('❌ Error fetching trips:', error);
			throw error;
		}
	}

	async getTrip(id: string): Promise<Trip | null> {
		try {
			const { data: trip, error } = await this.fluxbase
				.from('trips')
				.select('*')
				.eq('id', id)
				.single();

			if (error) throw error;

			return trip as unknown as Trip;
		} catch (error) {
			console.error('❌ Error fetching trip:', error);
			throw error;
		}
	}

	async createTrip(tripData: CreateTripData): Promise<Trip> {
		try {
			const insertData = {
				...tripData,
				user_id: await this.getCurrentUserId()
			};

			const { data: trip, error } = await this.fluxbase
				.from('trips')
				.insert(insertData)
				.select()
				.single();

			if (error) {
				console.error('❌ [TripsService] Database error:', error);
				throw error;
			}

			return trip as unknown as Trip;
		} catch (error) {
			console.error('❌ Error creating trip:', error);
			throw error;
		}
	}

	async updateTrip(tripData: UpdateTripData): Promise<Trip> {
		try {
			const { id, ...updateData } = tripData;
			const updatePayload = {
				...updateData,
				metadata: updateData.metadata ?? {}
			};
			const { data: trip, error } = await this.fluxbase
				.from('trips')
				.update(updatePayload)
				.eq('id', id)
				.select()
				.single();

			if (error) throw error;

			// --- Calculate geopoints and distance, then update metadata ---
			if (trip && trip.id) {
				await this.updateTripMetadata(trip.id);
			}

			return trip as unknown as Trip;
		} catch (error) {
			console.error('❌ Error updating trip:', error);
			throw error;
		}
	}

	async deleteTrip(id: string): Promise<void> {
		try {
			const { error } = await this.fluxbase.from('trips').delete().eq('id', id);

			if (error) throw error;
		} catch (error) {
			console.error('❌ Error deleting trip:', error);
			throw error;
		}
	}

	async searchTrips(query: string): Promise<Trip[]> {
		try {
			const { data: trips, error } = await this.fluxbase
				.from('trips')
				.select('*')
				.or(`title.ilike.%${query}%,description.ilike.%${query}%,labels.cs.{${query}}`)
				.order('created_at', { ascending: false });

			if (error) throw error;

			return (trips || []) as unknown as Trip[];
		} catch (error) {
			console.error('❌ Error searching trips:', error);
			throw error;
		}
	}

	// Helper to update trip metadata with geopoint count and distance
	async updateTripMetadata(tripId: string): Promise<void> {
		try {
			// Fetch the trip to get user_id and date range
			const { data: trip, error: tripError } = await this.fluxbase
				.from('trips')
				.select('user_id, start_date, end_date, metadata')
				.eq('id', tripId)
				.single();
			if (tripError || !trip) throw tripError || new Error('Trip not found');

			// Calculate distanceTraveled using a direct SUM query
			let distanceTraveled = 0;
			if (trip.start_date && trip.end_date) {
				const { data, error } = await this.fluxbase
					.from('tracker_data')
					.select('distance')
					.eq('user_id', trip.user_id)
					.gte('recorded_at', `${trip.start_date}T00:00:00Z`)
					.lte('recorded_at', `${trip.end_date}T23:59:59Z`)
					.not('country_code', 'is', null); // Ignore records with NULL country codes when calculating trip distance
				if (!error && data) {
					// Sum up all distances, treating null/undefined as 0
					distanceTraveled = data.reduce(
						(sum, row) => sum + (typeof row.distance === 'number' ? row.distance : 0),
						0
					);
				}
			}
			// Update the trip's metadata.distanceTraveled
			await this.fluxbase
				.from('trips')
				.update({ metadata: { ...trip.metadata, distanceTraveled } })
				.eq('id', tripId);
		} catch (error) {
			console.error('❌ Error updating trip metadata:', error);
			throw error;
		}
	}
}
