import { fluxbase } from '$lib/fluxbase';

import type { Place, CreatePlaceData } from '$lib/types/want-to-visit.types';

export class WantToVisitService {
	/**
	 * Get all want-to-visit places for the current user
	 */
	static async getPlaces(): Promise<Place[]> {
		// Select all fields and extract coordinates from PostGIS location
		const { data, error } = await fluxbase
			.from('want_to_visit_places')
			.select('*, location')
			.order('created_at', { ascending: false });

		if (error) {
			console.error('Error fetching want-to-visit places:', error);
			throw new Error('Failed to fetch places');
		}

		// Map database column names to frontend property names and extract coordinates
		return ((data as any[]) || []).map((place) => {
			// Extract coordinates from PostGIS location
			let coordinates = '';
			if (place.location) {
				// location is returned as GeoJSON: {"type": "Point", "coordinates": [lng, lat]}
				try {
					const geojson =
						typeof place.location === 'string' ? JSON.parse(place.location) : place.location;
					if (geojson?.coordinates && Array.isArray(geojson.coordinates)) {
						const [lng, lat] = geojson.coordinates;
						coordinates = `${lat}, ${lng}`; // Convert to "lat, lng" text format
					}
				} catch (e) {
					console.error('Error parsing location GeoJSON:', e);
				}
			}

			return {
				...place,
				coordinates,
				markerType: place.marker_type,
				markerColor: place.marker_color
			};
		});
	}

	/**
	 * Add a new want-to-visit place
	 */
	static async addPlace(place: CreatePlaceData): Promise<Place> {
		// Get current user ID
		const {
			data: { user }
		} = await fluxbase.auth.getUser();
		if (!user) {
			throw new Error('User not authenticated');
		}

		// Parse coordinates from "lat, lng" text format
		const [lat, lng] = place.coordinates.split(',').map((s) => parseFloat(s.trim()));

		const { data, error } = await fluxbase
			.from('want_to_visit_places')
			.insert({
				user_id: user.id,
				title: place.title,
				type: place.type,
				location: `POINT(${lng} ${lat})`, // PostGIS WKT format
				description: place.description,
				address: place.address,
				marker_type: place.markerType,
				marker_color: place.markerColor,
				labels: place.labels,
				favorite: place.favorite
			})
			.select()
			.single();

		if (error) {
			console.error('Error adding want-to-visit place:', error);
			throw new Error('Failed to add place');
		}

		// Extract coordinates from returned location
		let coordinates = '';
		if (data.location) {
			try {
				const geojson = typeof data.location === 'string' ? JSON.parse(data.location) : data.location;
				if (geojson?.coordinates) {
					const [returnedLng, returnedLat] = geojson.coordinates;
					coordinates = `${returnedLat}, ${returnedLng}`;
				}
			} catch (e) {
				coordinates = place.coordinates; // Fallback to input
			}
		}

		// Map database column names to frontend property names
		return {
			...data,
			coordinates,
			markerType: data.marker_type,
			markerColor: data.marker_color
		};
	}

	/**
	 * Update an existing want-to-visit place
	 */
	static async updatePlace(id: string, updates: Partial<Place>): Promise<Place> {
		// Prepare update object
		const updateData: any = {
			title: updates.title,
			type: updates.type,
			description: updates.description,
			address: updates.address,
			marker_type: updates.markerType,
			marker_color: updates.markerColor,
			labels: updates.labels,
			favorite: updates.favorite
		};

		// If coordinates are being updated, convert to WKT format
		if (updates.coordinates) {
			const [lat, lng] = updates.coordinates.split(',').map((s) => parseFloat(s.trim()));
			updateData.location = `POINT(${lng} ${lat})`; // PostGIS WKT format
		}

		const { data, error } = await fluxbase
			.from('want_to_visit_places')
			.update(updateData)
			.eq('id', id)
			.select()
			.single();

		if (error) {
			console.error('Error updating want-to-visit place:', error);
			throw new Error('Failed to update place');
		}

		// Extract coordinates from returned location
		let coordinates = '';
		if (data.location) {
			try {
				const geojson = typeof data.location === 'string' ? JSON.parse(data.location) : data.location;
				if (geojson?.coordinates) {
					const [returnedLng, returnedLat] = geojson.coordinates;
					coordinates = `${returnedLat}, ${returnedLng}`;
				}
			} catch (e) {
				coordinates = updates.coordinates || ''; // Fallback to input
			}
		}

		// Map database column names to frontend property names
		return {
			...data,
			coordinates,
			markerType: data.marker_type,
			markerColor: data.marker_color
		};
	}

	/**
	 * Delete a want-to-visit place
	 */
	static async deletePlace(id: string): Promise<void> {
		const { error } = await fluxbase.from('want_to_visit_places').delete().eq('id', id);

		if (error) {
			console.error('Error deleting want-to-visit place:', error);
			throw new Error('Failed to delete place');
		}
	}

	/**
	 * Toggle favorite status of a place
	 */
	static async toggleFavorite(id: string, favorite: boolean): Promise<Place> {
		const { data, error } = await fluxbase
			.from('want_to_visit_places')
			.update({ favorite })
			.eq('id', id)
			.select()
			.single();

		if (error) {
			console.error('Error toggling favorite:', error);
			throw new Error('Failed to update favorite status');
		}

		// Map database column names to frontend property names
		return {
			...data,
			markerType: data.marker_type,
			markerColor: data.marker_color
		};
	}
}
