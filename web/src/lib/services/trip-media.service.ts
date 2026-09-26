/**
 * TripMediaService — CRUD for trip photos.
 * Uploads go to Fluxbase Storage (trip-images bucket, public-read).
 * Metadata rows go to trip_media table (RLS owner-scoped).
 */

import { fluxbase } from '$lib/fluxbase';
import type { TripMedia, CreateTripMediaInput } from '$lib/types/media.types';
import { lazyBucketEnsure } from '$lib/services/bucket-ensure.service';

/**
 * Upload a blob to the trip-images bucket and return the raw bucket path.
 * DB columns store the PATH, never an absolute URL — the deployment hostname
 * changes (flux.hazen.nu → flux.int.hazen.nu) must not invalidate stored
 * rows. Renderers resolve paths to URLs via storageRefToUrl().
 * Path: {userId}/{tripId}/{filename}
 */
export async function uploadMedia(
	userId: string,
	tripId: string,
	blob: Blob,
	filename: string
): Promise<string> {
	const path = `${userId}/${tripId}/${filename}`;

	let { error } = await fluxbase.storage.from('trip-images').upload(path, blob, {
		contentType: blob.type || 'image/jpeg',
		upsert: false
	});

	// If bucket might not exist, ensure it and retry once
	if (error && /bucket|not found|404/i.test(error.message)) {
		await lazyBucketEnsure();
		const retry = await fluxbase.storage.from('trip-images').upload(path, blob, {
			contentType: blob.type || 'image/jpeg',
			upsert: false
		});
		error = retry.error;
	}

	if (error) throw new Error(error.message);

	return path;
}

/**
 * Delete a file from storage by its path.
 */
export async function deleteMediaFile(storagePath: string): Promise<void> {
	// Extract the path within the bucket from the public URL or raw path
	const bucketPath = storagePath.includes('/trip-images/')
		? storagePath.split('/trip-images/')[1]
		: storagePath;
	await fluxbase.storage.from('trip-images').remove([bucketPath]);
}

/**
 * List all media for a trip, ordered by sort_order then created_at.
 */
export async function listMedia(tripId: string): Promise<TripMedia[]> {
	const { data, error } = await fluxbase
		.from<TripMedia>('trip_media')
		.select('*')
		.eq('trip_id', tripId)
		.order('sort_order', { ascending: true })
		.order('created_at', { ascending: false });

	if (error) throw new Error(error.message);
	return (data as unknown as TripMedia[]) ?? [];
}

/**
 * Create a media metadata row.
 */
export async function createMedia(
	input: CreateTripMediaInput & { user_id: string }
): Promise<TripMedia> {
	const { data, error } = await fluxbase
		.from('trip_media')
		.insert({
			trip_id: input.trip_id,
			entry_id: input.entry_id ?? null,
			user_id: input.user_id,
			storage_path: input.storage_path,
			thumbnail_path: input.thumbnail_path ?? input.storage_path,
			media_type: input.media_type ?? 'image',
			caption: input.caption ?? '',
			width: input.width ?? null,
			height: input.height ?? null,
			taken_at: input.taken_at ?? null,
			exif: input.exif ?? null
		})
		.select('*')
		.single();

	if (error) throw new Error(error.message);
	return data as unknown as TripMedia;
}

/**
 * Delete a media row + its file from storage.
 */
export async function deleteMedia(media: TripMedia): Promise<void> {
	// Delete file(s) from storage
	const paths = [media.storage_path, media.thumbnail_path].filter(
		(p): p is string => p !== null && p !== media.storage_path
	);
	if (media.storage_path) {
		await deleteMediaFile(media.storage_path);
	}
	for (const p of paths) {
		await deleteMediaFile(p).catch(() => {});
	}

	// Delete the metadata row
	const { error } = await fluxbase.from('trip_media').delete().eq('id', media.id);
	if (error) throw new Error(error.message);
}

/**
 * Update caption.
 */
export async function updateMediaCaption(mediaId: string, caption: string): Promise<void> {
	const { error } = await fluxbase.from('trip_media').update({ caption }).eq('id', mediaId);
	if (error) throw new Error(error.message);
}

export async function reorderMedia(items: TripMedia[]): Promise<void> {
	for (let i = 0; i < items.length; i++) {
		const { error } = await fluxbase
			.from<TripMedia>('trip_media')
			.update({ sort_order: i })
			.eq('id', items[i].id);
		if (error) throw new Error(error.message);
	}
}

/**
 * Link media rows to an entry after it exists — photos uploaded inline while
 * composing a NEW entry are created with entry_id null and attached here once
 * the entry row is saved.
 */
export async function attachMediaToEntry(entryId: string, mediaIds: string[]): Promise<void> {
	if (mediaIds.length === 0) return;
	const { error } = await fluxbase
		.from<TripMedia>('trip_media')
		.update({ entry_id: entryId })
		.in('id', mediaIds);
	if (error) throw new Error(error.message);
}
