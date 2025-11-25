// src/lib/services/api/service-adapter.ts
// Service adapter that uses Fluxbase SDK edge functions

import type { AuthSession } from '@fluxbase/sdk';
import type { PublicServerSettings, AdminSettingsResponse } from '$lib/types/settings.types';

export interface ServiceAdapterConfig {
	session: AuthSession;
}

export class ServiceAdapter {
	private session: AuthSession;

	constructor(config: ServiceAdapterConfig) {
		this.session = config.session;
	}

	/**
	 * Generic method to call edge functions using Fluxbase SDK
	 */
	async callApi<T = unknown>(
		endpoint: string,
		options: {
			method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
			body?: unknown;
			params?: Record<string, string>;
		} = {}
	): Promise<T> {
		const { method = 'GET', body, params } = options;

		// Convert slash-separated endpoints to hyphen-separated for Edge Functions
		// e.g., 'trips/locations' → 'trips-locations'
		const edgeFunctionName = endpoint.replace(/\//g, '-');

		// Build URL with query parameters if provided
		let url = edgeFunctionName;
		if (params && Object.keys(params).length > 0) {
			const queryString = new URLSearchParams(params).toString();
			url = `${edgeFunctionName}?${queryString}`;
		}

		// Get Fluxbase client
		const { fluxbase } = await import('$lib/fluxbase');

		// Invoke the edge function
		const { data, error } = await fluxbase.functions.invoke(url, {
			method,
			...(body && { body })
		});

		if (error) {
			throw new Error(error.message || 'Edge function call failed');
		}

		// Unwrap nested data structure
		// Edge functions return: { success: true, data: { ... } }
		if (data && typeof data === 'object' && 'data' in data) {
			return (data as any).data as T;
		}

		return data as T;
	}

	// Convenience methods for common operations

	/**
	 * Auth Profile Operations - Direct SDK Access
	 */
	async getProfile() {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user email from auth
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Get profile data from user_profiles table
		const { data: profile, error } = await fluxbase
			.from('user_profiles')
			.select('*')
			.eq('id', userData.user.id)
			.single();

		if (error) {
			throw new Error(error.message || 'Failed to fetch profile');
		}

		// Combine auth and profile data
		return {
			...profile,
			email: userData.user.email
		};
	}

	async updateProfile(profile: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Separate email from profile fields
		const { email, ...profileFields } = profile;

		// Update email in auth if provided
		if (email && typeof email === 'string') {
			const { error: emailError } = await fluxbase.auth.updateUser({ email });
			if (emailError) {
				throw new Error(`Failed to update email: ${emailError.message}`);
			}
		}

		// Update profile fields in user_profiles table
		if (Object.keys(profileFields).length > 0) {
			const { error: profileError } = await fluxbase
				.from('user_profiles')
				.eq('id', userData.user.id)
				.update(profileFields);

			if (profileError) {
				throw new Error(`Failed to update profile: ${profileError.message}`);
			}
		}

		return { message: 'Profile updated successfully' };
	}

	async getPreferences() {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Get preferences from user_preferences table
		const { data: preferences, error } = await fluxbase
			.from('user_preferences')
			.select('*')
			.eq('id', userData.user.id)
			.single();

		if (error) {
			throw new Error(error.message || 'Failed to fetch preferences');
		}

		return preferences;
	}

	async updatePreferences(preferences: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Update preferences in user_preferences table
		const { error } = await fluxbase
			.from('user_preferences')
			.eq('id', userData.user.id)
			.update({
				...preferences,
				updated_at: new Date().toISOString()
			});

		if (error) {
			throw new Error(error.message || 'Failed to update preferences');
		}

		return { message: 'Preferences updated successfully' };
	}

	async updatePassword(password: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Update password using SDK (runtime accepts password even if types don't show it)
		const { error } = await fluxbase.auth.updateUser({ password } as any);

		if (error) {
			throw new Error(error.message || 'Failed to update password');
		}

		return { message: 'Password updated successfully' };
	}

	/**
	 * Two-Factor Authentication Operations - Fluxbase SDK
	 */
	async setup2FA() {
		const { fluxbase } = await import('$lib/fluxbase');
		const QRCode = await import('qrcode');

		const { data, error } = await fluxbase.auth.setup2FA();

		if (error) {
			throw new Error(error.message || 'Failed to setup 2FA');
		}

		if (!data) {
			throw new Error('No setup data returned');
		}

		// SDK returns: { id: string, type: 'totp', totp: { qr_code, secret, uri } }
		// Components expect: { qr_code, secret, uri }

		// Replace "Fluxbase" with "Wayli" in the TOTP URI
		const originalUri = data.totp.uri;
		const customUri = originalUri.replace(/Fluxbase/g, 'Wayli');

		// Generate a new QR code with the custom issuer name
		const customQrCode = await QRCode.default.toDataURL(customUri);

		return {
			qr_code: customQrCode,
			secret: data.totp.secret,
			uri: customUri
		};
	}

	async enable2FA(code: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.enable2FA(code);

		if (error) {
			throw new Error(error.message || 'Failed to enable 2FA');
		}

		if (!data) {
			throw new Error('No response data returned');
		}

		// SDK returns: { success: boolean, backup_codes: string[], message: string }
		// Components expect: { backup_codes: string[], message?: string }
		if (!data.success) {
			throw new Error(data.message || 'Failed to enable 2FA');
		}

		return {
			backup_codes: data.backup_codes,
			message: data.message
		};
	}

	async disable2FA(password: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.disable2FA(password);

		if (error) {
			throw new Error(error.message || 'Failed to disable 2FA');
		}

		if (!data) {
			throw new Error('No response data returned');
		}

		// SDK returns: { id: string }
		// Components expect: { success: boolean, message?: string }
		return {
			success: true,
			message: 'Two-factor authentication disabled successfully'
		};
	}

	async get2FAStatus() {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.get2FAStatus();

		if (error) {
			throw new Error(error.message || 'Failed to get 2FA status');
		}

		if (!data) {
			throw new Error('No status data returned');
		}

		// SDK returns: { all: Factor[], totp: Factor[] }
		// Components expect: { totp_enabled: boolean }
		return {
			totp_enabled: data.totp && data.totp.length > 0
		};
	}

	async verify2FA(request: { user_id: string; code: string }) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.verify2FA(request);

		if (error) {
			throw new Error(error.message || 'Failed to verify 2FA code');
		}

		if (!data) {
			throw new Error('No verification response returned');
		}

		// SDK returns: { access_token, refresh_token, user, ... }
		return data;
	}

	/**
	 * Trips Operations - Direct SDK Access
	 */
	private async calculateTripDistance(
		userId: string,
		startDate: string,
		endDate: string
	): Promise<number> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase
			.from('tracker_data')
			.select('distance')
			.eq('user_id', userId)
			.gte('recorded_at', `${startDate}T00:00:00Z`)
			.lte('recorded_at', `${endDate}T23:59:59Z`)
			.not('country_code', 'is', null); // Ignore NULL country codes

		if (error || !data) return 0;

		// Sum up all distances, treating null/undefined as 0
		return data.reduce((sum, row) => sum + (typeof row.distance === 'number' ? row.distance : 0), 0);
	}

	async getTrips(options?: { limit?: number; offset?: number; search?: string }) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const limit = options?.limit || 50;
		const offset = options?.offset || 0;
		const search = options?.search || '';

		let query = fluxbase
			.from('trips')
			.select('*')
			.eq('user_id', userData.user.id)
			.eq('status', 'active') // Only show active trips by default
			.order('created_at', { ascending: false });

		// Add search filter if provided
		if (search) {
			query = query.or(
				`title.ilike.%${search}%,description.ilike.%${search}%,labels.cs.{${search}}`
			);
		}

		// Add pagination
		query = query.range(offset, offset + limit - 1);

		const { data: trips, error } = await query;

		if (error) {
			throw new Error(error.message || 'Failed to fetch trips');
		}

		return trips || [];
	}

	async createTrip(trip: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Validate required fields
		if (!trip.title) {
			throw new Error('Missing required field: title');
		}

		// Create trip
		const { data: newTrip, error: createError } = await fluxbase
			.from('trips')
			.insert({
				user_id: userData.user.id,
				title: trip.title,
				description: trip.description || '',
				start_date: trip.start_date || null,
				end_date: trip.end_date || null,
				status: trip.status || 'planned',
				tags: trip.tags || [],
				metadata: trip.metadata || {}
			})
			.select()
			.single();

		if (createError) {
			throw new Error(createError.message || 'Failed to create trip');
		}

		// Calculate distance if dates provided
		if (newTrip.start_date && newTrip.end_date) {
			const distanceTraveled = await this.calculateTripDistance(
				userData.user.id,
				newTrip.start_date,
				newTrip.end_date
			);

			const { error: updateError } = await fluxbase
				.from('trips')
				.update({
					metadata: {
						...(newTrip.metadata || {}),
						distanceTraveled
					}
				})
				.eq('id', newTrip.id);

			if (!updateError) {
				newTrip.metadata = { ...(newTrip.metadata || {}), distanceTraveled };
			}
		}

		return newTrip;
	}

	async updateTrip(trip: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Validate required fields
		if (!trip.id) {
			throw new Error('Missing required field: id');
		}

		// Verify trip belongs to user
		const { data: existingTrip, error: fetchError } = await fluxbase
			.from('trips')
			.select('id')
			.eq('id', trip.id)
			.eq('user_id', userData.user.id)
			.single();

		if (fetchError || !existingTrip) {
			throw new Error('Trip not found');
		}

		// Update trip
		const { data: updatedTrip, error: updateError } = await fluxbase
			.from('trips')
			.update({
				title: trip.title,
				description: trip.description,
				start_date: trip.start_date,
				end_date: trip.end_date,
				status: trip.status,
				tags: trip.tags,
				metadata: trip.metadata,
				updated_at: new Date().toISOString()
			})
			.eq('id', trip.id)
			.eq('user_id', userData.user.id)
			.select()
			.single();

		if (updateError) {
			throw new Error(updateError.message || 'Failed to update trip');
		}

		// Calculate distance if dates provided
		if (updatedTrip.start_date && updatedTrip.end_date) {
			const distanceTraveled = await this.calculateTripDistance(
				userData.user.id,
				updatedTrip.start_date,
				updatedTrip.end_date
			);

			const { error: distanceUpdateError } = await fluxbase
				.from('trips')
				.update({
					metadata: {
						...(updatedTrip.metadata || {}),
						distanceTraveled
					}
				})
				.eq('id', updatedTrip.id);

			if (!distanceUpdateError) {
				updatedTrip.metadata = { ...(updatedTrip.metadata || {}), distanceTraveled };
			}
		}

		return updatedTrip;
	}

	async getTripsLocations(options?: {
		startDate?: string;
		endDate?: string;
		limit?: number;
		offset?: number;
		includeTrackerData?: boolean;
		includeLocations?: boolean;
		includePOIs?: boolean;
	}) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const result: Record<string, any> = {};
		const limit = options?.limit || 1000;
		const offset = options?.offset || 0;

		// Fetch tracker data if requested
		if (options?.includeTrackerData) {
			let query = fluxbase
				.from('tracker_data')
				.select('*')
				.eq('user_id', userData.user.id)
				.order('recorded_at', { ascending: false })
				.range(offset, offset + limit - 1);

			if (options?.startDate) {
				query = query.gte('recorded_at', `${options.startDate}T00:00:00Z`);
			}
			if (options?.endDate) {
				query = query.lte('recorded_at', `${options.endDate}T23:59:59Z`);
			}

			const { data: trackerData } = await query;
			result.tracker_data = trackerData || [];
		}

		// Fetch locations if requested (assuming there's a locations table)
		if (options?.includeLocations) {
			let query = fluxbase
				.from('locations')
				.select('*')
				.eq('user_id', userData.user.id)
				.order('created_at', { ascending: false })
				.range(offset, offset + limit - 1);

			if (options?.startDate) {
				query = query.gte('created_at', `${options.startDate}T00:00:00Z`);
			}
			if (options?.endDate) {
				query = query.lte('created_at', `${options.endDate}T23:59:59Z`);
			}

			const { data: locations } = await query;
			result.locations = locations || [];
		}

		// Fetch POIs if requested (assuming there's a poi_visits table)
		if (options?.includePOIs) {
			let query = fluxbase
				.from('poi_visits')
				.select('*')
				.eq('user_id', userData.user.id)
				.order('visited_at', { ascending: false })
				.range(offset, offset + limit - 1);

			if (options?.startDate) {
				query = query.gte('visited_at', `${options.startDate}T00:00:00Z`);
			}
			if (options?.endDate) {
				query = query.lte('visited_at', `${options.endDate}T23:59:59Z`);
			}

			const { data: pois } = await query;
			result.pois = pois || [];
		}

		return result;
	}

	async getSuggestedTrips(options?: { limit?: number; offset?: number }) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const limit = options?.limit || 50;
		const offset = options?.offset || 0;

		// Query trips with status='pending' (suggested trips)
		const { data: trips, error } = await fluxbase
			.from('trips')
			.select('*')
			.eq('user_id', userData.user.id)
			.eq('status', 'pending')
			.order('created_at', { ascending: false })
			.range(offset, offset + limit - 1);

		if (error) {
			throw new Error(error.message || 'Failed to fetch suggested trips');
		}

		return trips || [];
	}

	async clearAllSuggestedTrips() {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Delete all pending and rejected trips
		const { error } = await fluxbase
			.from('trips')
			.delete()
			.eq('user_id', userData.user.id)
			.in('status', ['pending', 'rejected']);

		if (error) {
			throw new Error(error.message || 'Failed to clear suggested trips');
		}

		return { message: 'Suggested trips cleared successfully' };
	}

	async approveSuggestedTrips(
		tripIds: string[],
		preGeneratedImages?: Record<string, { image_url: string; attribution?: unknown }>
	) {
		console.log('📤 [SERVICE] Calling approveSuggestedTrips with:', tripIds);
		console.log('📤 [SERVICE] Pre-generated images data:', preGeneratedImages);

		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Fetch trips to approve
		const { data: trips, error: fetchError } = await fluxbase
			.from('trips')
			.select('*')
			.eq('user_id', userData.user.id)
			.in('id', tripIds);

		if (fetchError) {
			throw new Error(fetchError.message || 'Failed to fetch trips');
		}

		if (!trips || trips.length === 0) {
			throw new Error('No trips found to approve');
		}

		// Update each trip
		const approvedTrips = [];
		for (const trip of trips) {
			// Calculate distance if dates are available
			let distanceTraveled = 0;
			if (trip.start_date && trip.end_date) {
				distanceTraveled = await this.calculateTripDistance(
					userData.user.id,
					trip.start_date,
					trip.end_date
				);
			}

			// Prepare metadata update
			const updatedMetadata = {
				...(trip.metadata || {}),
				distanceTraveled
			};

			// Add pre-generated image if available
			if (preGeneratedImages && preGeneratedImages[trip.id]) {
				updatedMetadata.image_url = preGeneratedImages[trip.id].image_url;
				updatedMetadata.attribution = preGeneratedImages[trip.id].attribution;
			}

			// Update trip status to 'active' and metadata
			const { data: updatedTrip, error: updateError } = await fluxbase
				.from('trips')
				.update({
					status: 'active',
					metadata: updatedMetadata,
					updated_at: new Date().toISOString()
				})
				.eq('id', trip.id)
				.eq('user_id', userData.user.id)
				.select()
				.single();

			if (updateError) {
				console.error(`Failed to approve trip ${trip.id}:`, updateError);
				continue;
			}

			approvedTrips.push(updatedTrip);
		}

		const result = { approved: approvedTrips };
		console.log('📥 [SERVICE] approveSuggestedTrips result:', result);
		return result;
	}

	async generateSuggestedTripImages(
		suggestedTripIds: string[]
	): Promise<{ results: SuggestedImageResult[] }> {
		console.log('📤 [SERVICE] Calling generateSuggestedTripImages with:', suggestedTripIds);
		const results: SuggestedImageResult[] = [];
		for (const tripId of suggestedTripIds) {
			try {
				const result = await this.suggestTripImages(tripId);
				// The Edge Function returns { success: true, data: { ... } }
				const data =
					result && typeof result === 'object' && 'data' in result ? (result as any).data : result;

				// Type guard for data
				const imageUrl =
					data && typeof data === 'object' && 'suggestedImageUrl' in data
						? (data as { suggestedImageUrl?: string }).suggestedImageUrl
						: undefined;
				const attribution =
					data && typeof data === 'object' && 'attribution' in data
						? (data as { attribution?: unknown }).attribution
						: undefined;
				const analysis =
					data && typeof data === 'object' && 'analysis' in data
						? (data as { analysis?: unknown }).analysis
						: undefined;
				results.push({
					suggested_trip_id: tripId,
					success: !!imageUrl,
					image_url: imageUrl,
					attribution,
					analysis
				});
			} catch (error) {
				results.push({
					suggested_trip_id: tripId,
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
		const aggregated = { results };
		console.log('📥 [SERVICE] generateSuggestedTripImages aggregated results:', aggregated);
		return aggregated;
	}

	async rejectSuggestedTrips(tripIds: string[]) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Update trips status to 'rejected'
		const { data: rejectedTrips, error } = await fluxbase
			.from('trips')
			.update({
				status: 'rejected',
				updated_at: new Date().toISOString()
			})
			.eq('user_id', userData.user.id)
			.in('id', tripIds)
			.select();

		if (error) {
			throw new Error(error.message || 'Failed to reject trips');
		}

		return { rejected: rejectedTrips || [] };
	}

	async createTripFromSuggestion(suggestedTripId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Fetch the suggested trip
		const { data: trip, error: fetchError } = await fluxbase
			.from('trips')
			.select('*')
			.eq('id', suggestedTripId)
			.eq('user_id', userData.user.id)
			.eq('status', 'pending')
			.single();

		if (fetchError || !trip) {
			throw new Error('Suggested trip not found');
		}

		// Calculate distance if dates are available
		let distanceTraveled = 0;
		if (trip.start_date && trip.end_date) {
			distanceTraveled = await this.calculateTripDistance(
				userData.user.id,
				trip.start_date,
				trip.end_date
			);
		}

		// Update trip status to 'active' and add distance
		const { data: activeTrip, error: updateError } = await fluxbase
			.from('trips')
			.update({
				status: 'active',
				metadata: {
					...(trip.metadata || {}),
					distanceTraveled
				},
				updated_at: new Date().toISOString()
			})
			.eq('id', suggestedTripId)
			.eq('user_id', userData.user.id)
			.select()
			.single();

		if (updateError) {
			throw new Error(updateError.message || 'Failed to create trip from suggestion');
		}

		return activeTrip;
	}

	// Note: Removed generateTripImages method since images are now generated during trip approval

	async suggestTripImages(tripIdOrDateRange: string | { start_date: string; end_date: string }) {
		const body =
			typeof tripIdOrDateRange === 'string' ? { trip_id: tripIdOrDateRange } : tripIdOrDateRange;

		return this.callApi('trips-suggest-image', {
			method: 'POST',
			body
		});
	}

	/**
	 * Export Operations (now using centralized jobs system)
	 */
	async getExportJobs(options?: { limit?: number; offset?: number }) {
		// Use getJobs with type filter
		return this.getJobs({
			limit: options?.limit,
			offset: options?.offset,
			type: 'data_export'
		});
	}

	async createExportJob(exportData: Record<string, unknown>) {
		// Use createJob with export type
		return this.createJob({
			type: 'data_export',
			data: exportData
		});
	}

	async createImportJob(
		file: File,
		format: string,
		onUploadProgress?: (progress: number) => void
	): Promise<{ jobId: string }> {
		try {
			const fileSizeMB = file.size / (1024 * 1024);
			console.log(`📁 [SERVICE] Uploading file: ${fileSizeMB.toFixed(2)}MB`);

			// Generate unique filename
			const timestamp = Date.now();
			const fileName = `${this.session?.user?.id}/${timestamp}-${file.name}`;

			console.log(`📤 [SERVICE] Uploading to storage: ${fileName}`);

			// Get Fluxbase client
			const { fluxbase } = await import('$lib/fluxbase');

			// Convert File to Blob to ensure correct Content-Type and metadata
			console.log('🔍 [SERVICE] Converting File to Blob for upload');
			const arrayBuffer = await file.arrayBuffer();
			const fileBlob = new Blob([arrayBuffer], { type: file.type });

			console.log('🔍 [SERVICE] Upload options:', {
				storagePath: fileName,
				fileType: file.type,
				fileSize: file.size,
				blobType: fileBlob.type,
				metadata: {
					mimetype: file.type,
					size: file.size.toString()
				}
			});

			// Upload directly to Fluxbase storage with proper metadata
			// This ensures the RLS policy can validate the upload correctly
			const { data, error: uploadError } = await fluxbase.storage
				.from('temp-files')
				.upload(fileName, fileBlob, {
					contentType: file.type,
					upsert: false,
					metadata: {
						mimetype: file.type,
						size: file.size.toString()
					}
				});

			if (uploadError) {
				console.error('❌ [SERVICE] File upload failed:', uploadError);
				const message =
					typeof uploadError === 'object' && uploadError && 'message' in uploadError
						? (uploadError as { message: string }).message
						: String(uploadError);
				throw new Error(`File upload failed: ${message}`);
			}

			console.log('✅ [SERVICE] File uploaded successfully');

			// Create import job via edge function
			const response = await fluxbase.functions.invoke('import', {
				body: {
					storage_path: fileName,
					file_name: file.name,
					file_size: file.size,
					format: format
				}
			});

			if (response.error) {
				console.error('❌ [SERVICE] Import job creation failed:', response.error);
				throw new Error(`Import job creation failed: ${response.error.message}`);
			}

			const result = response.data as {
				success: boolean;
				data: { success: boolean; data: { jobId: string }; message: string };
				message: string;
			};

			if (!result.success) {
				throw new Error(`Import job creation failed: ${result.message || 'Unknown error'}`);
			}

			// The Edge Function response is nested: { success: true, data: { success: true, data: { jobId: string } } }
			const jobData = result.data;
			if (!jobData.success || !jobData.data?.jobId) {
				throw new Error(`Import job creation failed: Invalid response structure`);
			}

			console.log('✅ [SERVICE] Import job created successfully:', jobData.data.jobId);
			return { jobId: jobData.data.jobId };
		} catch (error) {
			console.error('❌ [SERVICE] Error in createImportJob:', error);
			throw error;
		}
	}

	async getImportProgress() {
		// Get all import jobs for the current user
		return this.getJobs({ type: 'data_import' });
	}

	/**
	 * Geocoding Operations - Direct Nominatim API Call
	 */
	async searchGeocode(query: string) {
		// Call Nominatim API directly from client
		const url = new URL('https://nominatim.openstreetmap.org/search');
		url.searchParams.set('q', query);
		url.searchParams.set('format', 'json');
		url.searchParams.set('addressdetails', '1');
		url.searchParams.set('limit', '10');

		const response = await fetch(url.toString(), {
			headers: {
				'User-Agent': 'Wayli Location Tracker'
			}
		});

		if (!response.ok) {
			throw new Error('Geocoding search failed');
		}

		const data = await response.json();
		return data;
	}

	async getExportDownloadUrl(jobId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Fetch the job to get the file path
		const { data: job, error: jobError } = await fluxbase
			.from('jobs')
			.select('*')
			.eq('id', jobId)
			.eq('created_by', userData.user.id)
			.eq('type', 'data_export')
			.single();

		if (jobError || !job) {
			throw new Error('Export job not found');
		}

		// Check if job has completed and has a file path
		if (job.status !== 'completed' || !job.metadata?.file_path) {
			throw new Error('Export file not ready');
		}

		// Generate signed URL for the export file
		const { data: signedUrl, error: urlError } = await fluxbase.storage
			.from('exports')
			.createSignedUrl(job.metadata.file_path, 3600); // 1 hour expiry

		if (urlError) {
			throw new Error(urlError.message || 'Failed to generate download URL');
		}

		return { url: signedUrl.signedUrl };
	}

	/**
	 * Jobs Operations - Direct SDK Access
	 */
	async getJobs(options?: { limit?: number; offset?: number; type?: string }) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		const limit = options?.limit || 50;
		const offset = options?.offset || 0;

		let query = fluxbase
			.from('jobs')
			.select('*')
			.eq('created_by', userData.user.id)
			.order('created_at', { ascending: false });

		// Filter by type if provided
		if (options?.type) {
			query = query.eq('type', options.type);
		}

		// Add pagination
		query = query.range(offset, offset + limit - 1);

		const { data: jobs, error } = await query;

		if (error) {
			throw new Error(error.message || 'Failed to fetch jobs');
		}

		return jobs || [];
	}

	async createJob(job: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Validate required fields
		if (!job.type) {
			throw new Error('Job type is required');
		}

		// Create job
		const { data: newJob, error } = await fluxbase
			.from('jobs')
			.insert({
				created_by: userData.user.id,
				type: job.type,
				status: job.status || 'pending',
				data: job.data || {},
				metadata: job.metadata || {},
				created_at: new Date().toISOString()
			})
			.select()
			.single();

		if (error) {
			throw new Error(error.message || 'Failed to create job');
		}

		return newJob;
	}

	async getJobProgress(jobId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Fetch the job
		const { data: job, error } = await fluxbase
			.from('jobs')
			.select('*')
			.eq('id', jobId)
			.eq('created_by', userData.user.id)
			.single();

		if (error || !job) {
			throw new Error('Job not found');
		}

		return job;
	}

	async cancelJob(jobId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Fetch the job to check if it exists and get its type
		const { data: job, error: fetchError } = await fluxbase
			.from('jobs')
			.select('*')
			.eq('id', jobId)
			.eq('created_by', userData.user.id)
			.single();

		if (fetchError || !job) {
			throw new Error('Job not found');
		}

		// Update job status to 'cancelled'
		const { error: updateError } = await fluxbase
			.from('jobs')
			.update({
				status: 'cancelled',
				updated_at: new Date().toISOString()
			})
			.eq('id', jobId)
			.eq('created_by', userData.user.id);

		if (updateError) {
			throw new Error(updateError.message || 'Failed to cancel job');
		}

		// Business logic: If this was an import job, auto-create reverse geocoding job
		if (job.type === 'data_import') {
			try {
				await this.createJob({
					type: 'reverse_geocoding',
					status: 'pending',
					data: {
						auto_created: true,
						triggered_by: 'import_cancellation',
						original_job_id: jobId
					}
				});
			} catch (error) {
				console.warn('Failed to auto-create reverse geocoding job:', error);
				// Don't fail the cancellation if reverse geocoding job creation fails
			}
		}

		return { message: 'Job cancelled successfully', jobId };
	}

	async getJobStream() {
		// SSE requires raw Response object, so we use fetch directly
		const { fluxbase } = await import('$lib/fluxbase');
		const { data, error } = await fluxbase.functions.invoke('jobs-stream', {
			method: 'GET'
		});

		if (error) {
			throw new Error(error.message || 'Failed to get job stream');
		}

		return data;
	}

	/**
	 * POI Visits Operations - Direct SDK Access
	 */
	async detectPOIVisits(options: {
		startDate: string;
		endDate: string;
		radius?: number;
		minDuration?: number;
		minInterval?: number;
	}) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// POI detection logic would be implemented here
		// For now, create a job for POI detection
		return this.createJob({
			type: 'poi_detection',
			data: {
				start_date: options.startDate,
				end_date: options.endDate,
				radius: options.radius || 300,
				min_duration: options.minDuration || 3600,
				min_interval: options.minInterval || 3600
			}
		});
	}

	async getPOIVisits() {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Query POI visits from database
		const { data: poiVisits, error } = await fluxbase
			.from('poi_visits')
			.select('*')
			.eq('user_id', userData.user.id)
			.order('visited_at', { ascending: false });

		if (error) {
			throw new Error(error.message || 'Failed to fetch POI visits');
		}

		return poiVisits || [];
	}

	/**
	 * Statistics Operations
	 * Note: getGeocodingStats method removed - now using client-side processing
	 */

	/**
	 * Admin Operations - Direct SDK Access
	 */

	/**
	 * Get all settings using Fluxbase SDK's AppSettingsManager directly
	 */
	async getAllSettings(): Promise<AdminSettingsResponse> {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get app settings via SDK
		const appSettings = await fluxbase.admin.settings.app.get();

		// Get custom Wayli settings from system settings
		const { settings } = await fluxbase.admin.settings.system.list();
		const wayliSettings = settings
			.filter((s: any) => s.key.startsWith('wayli.'))
			.reduce((acc: any, s: any) => ({ ...acc, [s.key]: s.value }), {});

		return {
			app: appSettings,
			custom: wayliSettings
		};
	}

	/**
	 * Update app setting using AppSettingsManager methods directly
	 */
	async updateAppSetting(action: string, params?: any) {
		const { fluxbase } = await import('$lib/fluxbase');
		const settings = fluxbase.admin.settings.app;

		switch (action) {
			case 'configureSMTP':
				return await settings.configureSMTP(params);
			case 'enableSignup':
				return await settings.enableSignup();
			case 'disableSignup':
				return await settings.disableSignup();
			case 'setEmailEnabled':
				return await settings.setEmailEnabled(params.enabled);
			case 'setEmailVerificationRequired':
				return await settings.setEmailVerificationRequired(params.required);
			case 'setPasswordMinLength':
				return await settings.setPasswordMinLength(params.length);
			case 'setPasswordComplexity':
				return await settings.setPasswordComplexity(params);
			case 'setSessionSettings':
				return await settings.setSessionSettings(params.timeoutMinutes, params.maxSessionsPerUser);
			case 'setFeature':
				return await settings.setFeature(params.feature, params.enabled);
			case 'setRateLimiting':
				return await settings.setRateLimiting(params.enabled);
			default:
				throw new Error(`Unknown action: ${action}`);
		}
	}

	/**
	 * Update custom Wayli setting using system settings directly
	 */
	async updateCustomSetting(key: string, value: any, description?: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		if (!key.startsWith('wayli.')) {
			throw new Error('Custom setting keys must start with "wayli."');
		}

		await fluxbase.admin.settings.system.update(key, {
			value: { value },
			description: description || `Wayli custom setting: ${key}`
		});

		return { updated: key };
	}


	async getAdminWorkers() {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID and verify admin role
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Check if user is admin
		const { data: profile } = await fluxbase
			.from('user_profiles')
			.select('role')
			.eq('id', userData.user.id)
			.single();

		if (profile?.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}

		// Fetch all workers (RLS policy will enforce admin access)
		const { data: workers, error } = await fluxbase
			.from('workers')
			.select('*')
			.order('created_at', { ascending: false });

		if (error) {
			throw new Error(error.message || 'Failed to fetch workers');
		}

		return workers || [];
	}

	async manageWorkers(action: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID and verify admin role
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Check if user is admin
		const { data: profile } = await fluxbase
			.from('user_profiles')
			.select('role')
			.eq('id', userData.user.id)
			.single();

		if (profile?.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}

		// Handle different worker actions
		const actionType = action.action as string;

		switch (actionType) {
			case 'create': {
				const { data: newWorker, error } = await fluxbase
					.from('workers')
					.insert({
						name: action.name,
						type: action.type || 'general',
						status: 'active',
						metadata: action.metadata || {}
					})
					.select()
					.single();

				if (error) {
					throw new Error(error.message || 'Failed to create worker');
				}

				return newWorker;
			}

			case 'update': {
				const { data: updatedWorker, error } = await fluxbase
					.from('workers')
					.update({
						name: action.name,
						type: action.type,
						status: action.status,
						metadata: action.metadata,
						updated_at: new Date().toISOString()
					})
					.eq('id', action.id)
					.select()
					.single();

				if (error) {
					throw new Error(error.message || 'Failed to update worker');
				}

				return updatedWorker;
			}

			case 'delete': {
				const { error } = await fluxbase
					.from('workers')
					.delete()
					.eq('id', action.id);

				if (error) {
					throw new Error(error.message || 'Failed to delete worker');
				}

				return { message: 'Worker deleted successfully' };
			}

			default:
				throw new Error(`Unknown action: ${actionType}`);
		}
	}

	async getAdminUsers(options?: { page?: number; limit?: number }) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID and verify admin role
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Check if user is admin
		const { data: profile } = await fluxbase
			.from('user_profiles')
			.select('role')
			.eq('id', userData.user.id)
			.single();

		if (profile?.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}

		const page = options?.page || 1;
		const limit = options?.limit || 50;
		const offset = (page - 1) * limit;

		// Fetch users with pagination
		const { data: users, error } = await fluxbase
			.from('user_profiles')
			.select('*')
			.order('created_at', { ascending: false })
			.range(offset, offset + limit - 1);

		if (error) {
			throw new Error(error.message || 'Failed to fetch users');
		}

		// Get total count for pagination
		const { count } = await fluxbase
			.from('user_profiles')
			.select('*', { count: 'exact', head: true });

		return {
			users: users || [],
			total: count || 0,
			page,
			limit
		};
	}

	/**
	 * Trip Exclusions Operations - Direct SDK Access
	 */
	async getTripExclusions() {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		// Get user preferences
		const { data: userPreferences, error } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		if (error) {
			// Return empty array if preferences not found
			return { exclusions: [] };
		}

		return { exclusions: userPreferences?.trip_exclusions || [] };
	}

	async createTripExclusion(exclusion: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!exclusion.name || !exclusion.location) {
			throw new Error('Name and location are required');
		}

		// Get current exclusions
		const { data: userPreferences } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		const currentExclusions = userPreferences?.trip_exclusions || [];
		const newExclusion = {
			id: crypto.randomUUID(),
			name: exclusion.name,
			location: exclusion.location,
			created_at: new Date().toISOString()
		};

		const updatedExclusions = [...currentExclusions, newExclusion];

		// Upsert user preferences with new exclusions
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

	async updateTripExclusion(exclusion: Record<string, unknown>) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!exclusion.id || !exclusion.name || !exclusion.location) {
			throw new Error('ID, name and location are required');
		}

		// Get current exclusions
		const { data: userPreferences } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		const currentExclusions = userPreferences?.trip_exclusions || [];
		const updatedExclusions = currentExclusions.map((ex: any) =>
			ex.id === exclusion.id
				? { ...ex, name: exclusion.name, location: exclusion.location, updated_at: new Date().toISOString() }
				: ex
		);

		// Update user preferences
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

		return { exclusion: updatedExclusions.find((e: any) => e.id === exclusion.id) };
	}

	async deleteTripExclusion(exclusionId: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		// Get user ID
		const { data: userData } = await fluxbase.auth.getUser();
		if (!userData.user) {
			throw new Error('User not authenticated');
		}

		if (!exclusionId) {
			throw new Error('Exclusion ID is required');
		}

		// Get current exclusions
		const { data: userPreferences } = await fluxbase
			.from('user_preferences')
			.select('trip_exclusions')
			.eq('id', userData.user.id)
			.maybeSingle();

		const currentExclusions = userPreferences?.trip_exclusions || [];
		const updatedExclusions = currentExclusions.filter((ex: any) => ex.id !== exclusionId);

		// Update user preferences
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

// Add a type for the image suggestion result
interface SuggestedImageResult {
	suggested_trip_id: string;
	success: boolean;
	image_url?: string;
	attribution?: unknown;
	analysis?: unknown;
	error?: string;
}
