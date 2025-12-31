/**
 * Trip exclusions management adapter.
 * Manages locations to exclude from trip detection (e.g., home, work).
 * @module adapters/trip-exclusions-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * A location to exclude from trip detection.
 */
export interface TripExclusion {
	/** Unique identifier for the exclusion */
	id: string;
	/** Human-readable name (e.g., "Home", "Office") */
	name: string;
	/** Geographic coordinates of the exclusion zone */
	location: {
		/** Latitude coordinate */
		lat: number;
		/** Longitude coordinate */
		lon: number;
	};
	/** ISO timestamp when exclusion was created */
	created_at?: string;
	/** ISO timestamp of last update */
	updated_at?: string;
}

/**
 * Adapter for managing trip exclusion zones.
 * Exclusions prevent the trip detection algorithm from counting
 * time spent at certain locations (like home or work) as part of trips.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const exclusionsAdapter = new TripExclusionsAdapter({ session });
 *
 * // Add home as an exclusion
 * await exclusionsAdapter.createTripExclusion({
 *   name: 'Home',
 *   location: { lat: 52.3676, lon: 4.9041 }
 * });
 * ```
 */
export class TripExclusionsAdapter extends BaseAdapter {
	/**
	 * Creates a new TripExclusionsAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Retrieves all trip exclusions for the authenticated user.
	 *
	 * @returns Promise resolving to object with exclusions array
	 * @throws Error if user is not authenticated
	 *
	 * @example
	 * ```typescript
	 * const { exclusions } = await exclusionsAdapter.getTripExclusions();
	 * exclusions.forEach(e => console.log(`${e.name}: ${e.location.lat}, ${e.location.lon}`));
	 * ```
	 */
	async getTripExclusions(): Promise<{ exclusions: TripExclusion[] }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: userPreferences, error } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		if (error) {
			return { exclusions: [] };
		}

		return { exclusions: userPreferences?.trip_exclusions || [] };
	}

	/**
	 * Creates a new trip exclusion zone.
	 *
	 * @param exclusion - Exclusion data
	 * @param exclusion.name - Name for the exclusion (e.g., "Home", "Work")
	 * @param exclusion.location - Geographic coordinates
	 * @returns Promise resolving to object with the created exclusion
	 * @throws Error if name or location is missing, or save fails
	 *
	 * @example
	 * ```typescript
	 * const { exclusion } = await exclusionsAdapter.createTripExclusion({
	 *   name: 'Office',
	 *   location: { lat: 52.3702, lon: 4.8952 }
	 * });
	 * console.log(`Created exclusion: ${exclusion.id}`);
	 * ```
	 */
	async createTripExclusion(exclusion: {
		name?: string;
		location?: { lat: number; lon: number };
	}): Promise<{ exclusion: TripExclusion }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!exclusion.name || !exclusion.location) {
			throw new Error('Name and location are required');
		}

		const { data: userPreferences } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		const currentExclusions = userPreferences?.trip_exclusions || [];
		const newExclusion: TripExclusion = {
			id: crypto.randomUUID(),
			name: exclusion.name,
			location: exclusion.location,
			created_at: new Date().toISOString()
		};

		const updatedExclusions = [...currentExclusions, newExclusion];

		const { error: upsertError } = await fluxbase.from('user_preferences').upsert(
			{
				id: userData.user.id,
				trip_exclusions: updatedExclusions,
				updated_at: new Date().toISOString()
			},
			{
				onConflict: 'id'
			}
		);

		if (upsertError) {
			throw new Error(upsertError.message || 'Failed to save exclusion');
		}

		return { exclusion: newExclusion };
	}

	/**
	 * Updates an existing trip exclusion.
	 *
	 * @param exclusion - Updated exclusion data (must include id)
	 * @param exclusion.id - ID of the exclusion to update
	 * @param exclusion.name - New name
	 * @param exclusion.location - New coordinates
	 * @returns Promise resolving to object with the updated exclusion
	 * @throws Error if required fields missing, exclusion not found, or update fails
	 *
	 * @example
	 * ```typescript
	 * const { exclusion } = await exclusionsAdapter.updateTripExclusion({
	 *   id: 'exclusion-uuid',
	 *   name: 'New Office',
	 *   location: { lat: 52.3750, lon: 4.8980 }
	 * });
	 * ```
	 */
	async updateTripExclusion(exclusion: {
		id?: string;
		name?: string;
		location?: { lat: number; lon: number };
	}): Promise<{ exclusion: TripExclusion }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!exclusion.id || !exclusion.name || !exclusion.location) {
			throw new Error('ID, name and location are required');
		}

		const { data: userPreferences } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		const currentExclusions: TripExclusion[] = userPreferences?.trip_exclusions || [];
		const updatedExclusions = currentExclusions.map((ex) =>
			ex.id === exclusion.id
				? {
						...ex,
						name: exclusion.name!,
						location: exclusion.location!,
						updated_at: new Date().toISOString()
					}
				: ex
		);

		const { error: upsertError } = await fluxbase.from('user_preferences').upsert(
			{
				id: userData.user.id,
				trip_exclusions: updatedExclusions,
				updated_at: new Date().toISOString()
			},
			{
				onConflict: 'id'
			}
		);

		if (upsertError) {
			throw new Error(upsertError.message || 'Failed to update exclusion');
		}

		const updated = updatedExclusions.find((e) => e.id === exclusion.id);
		if (!updated) {
			throw new Error('Exclusion not found');
		}

		return { exclusion: updated };
	}

	/**
	 * Deletes a trip exclusion.
	 *
	 * @param exclusionId - ID of the exclusion to delete
	 * @returns Promise resolving to success message
	 * @throws Error if ID missing, or deletion fails
	 *
	 * @example
	 * ```typescript
	 * await exclusionsAdapter.deleteTripExclusion('exclusion-uuid');
	 * console.log('Exclusion deleted');
	 * ```
	 */
	async deleteTripExclusion(exclusionId: string): Promise<{ message: string }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!exclusionId) {
			throw new Error('Exclusion ID is required');
		}

		const { data: userPreferences } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		const currentExclusions: TripExclusion[] = userPreferences?.trip_exclusions || [];
		const updatedExclusions = currentExclusions.filter((ex) => ex.id !== exclusionId);

		const { error: upsertError } = await fluxbase.from('user_preferences').upsert(
			{
				id: userData.user.id,
				trip_exclusions: updatedExclusions,
				updated_at: new Date().toISOString()
			},
			{
				onConflict: 'id'
			}
		);

		if (upsertError) {
			throw new Error(upsertError.message || 'Failed to delete exclusion');
		}

		return { message: 'Exclusion deleted successfully' };
	}
}
