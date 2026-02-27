/**
 * Home address management adapter.
 * Manages user-provided home address with geocoding.
 * @module adapters/home-address-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';
import { forwardGeocode } from '$lib/services/external/pelias.service';

/**
 * User-provided home address structure.
 */
export interface HomeAddress {
	/** Full formatted address string */
	address: string;
	/** Geocoded location coordinates */
	location: {
		/** Latitude coordinate */
		lat: number;
		/** Longitude coordinate */
		lon: number;
	};
	/** Pelias display name (full formatted address) */
	display_name?: string;
}

/**
 * Adapter for managing user-provided home address.
 * Allows users to set their actual home address which is then
 * used for place visit exclusion zones.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const adapter = new HomeAddressAdapter({ session });
 *
 * // Set home address
 * await adapter.setHomeAddress({
 *   address: "123 Main St, Amsterdam, Netherlands"
 * });
 * ```
 */
export class HomeAddressAdapter extends BaseAdapter {
	/**
	 * Creates a new HomeAddressAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Retrieves the user's home address.
	 *
	 * @returns Promise resolving to object with home_address or null
	 * @throws Error if user is not authenticated
	 *
	 * @example
	 * ```typescript
	 * const { home_address } = await adapter.getHomeAddress();
	 * if (home_address) {
	 *   console.log(home_address.address, home_address.location);
	 * }
	 * ```
	 */
	async getHomeAddress(): Promise<{ home_address: HomeAddress | null }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { data: userProfile, error } = await fluxbase
			.from('user_profiles')
			.select('home_address')
			.eq('id', userData.user.id)
			.maybeSingle();

		if (error) {
			return { home_address: null };
		}

		return { home_address: userProfile?.home_address || null };
	}

	/**
	 * Sets the user's home address by geocoding the provided address string.
	 *
	 * @param addressData - Address data to geocode and store
	 * @param addressData.address - Full address string to geocode
	 * @returns Promise resolving to object with the geocoded home address
	 * @throws Error if user is not authenticated, address is missing, or geocoding fails
	 *
	 * @example
	 * ```typescript
	 * const { home_address } = await adapter.setHomeAddress({
	 *   address: "123 Main St, Amsterdam, Netherlands"
	 * });
	 * console.log(`Geocoded to: ${home_address.location.lat}, ${home_address.location.lon}`);
	 * ```
	 */
	async setHomeAddress(addressData: { address?: string }): Promise<{ home_address: HomeAddress }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!addressData.address || addressData.address.trim().length === 0) {
			throw new Error('Address is required');
		}

		// Geocode the address using Pelias
		const geocoded = await forwardGeocode(addressData.address.trim());
		if (!geocoded) {
			throw new Error('Failed to geocode address');
		}

		const homeAddress: HomeAddress = {
			address: addressData.address.trim(),
			location: {
				lat: geocoded.lat,
				lon: geocoded.lon
			},
			display_name: geocoded.display_name
		};

		// Store in user_profiles
		const { error: upsertError } = await fluxbase
			.from('user_profiles')
			.upsert(
				{
					id: userData.user.id,
					home_address: homeAddress as unknown as Record<string, unknown>,
					updated_at: new Date().toISOString()
				},
				{
					onConflict: 'id'
				}
			);

		if (upsertError) {
			throw new Error(upsertError.message || 'Failed to save home address');
		}

		return { home_address: homeAddress };
	}

	/**
	 * Clears the user's home address.
	 *
	 * @returns Promise resolving to success message
	 * @throws Error if deletion fails
	 *
	 * @example
	 * ```typescript
	 * await adapter.clearHomeAddress();
	 * console.log('Home address cleared');
	 * ```
	 */
	async clearHomeAddress(): Promise<{ message: string }> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const { error: updateError } = await fluxbase
			.from('user_profiles')
			.update({
				home_address: null,
				updated_at: new Date().toISOString()
			})
			.eq('id', userData.user.id);

		if (updateError) {
			throw new Error(updateError.message || 'Failed to clear home address');
		}

		return { message: 'Home address cleared successfully' };
	}
}
