/**
 * TripEntryService — CRUD for trip journal entries.
 * Follows the existing service pattern (export functions, Fluxbase SDK, RLS-scoped).
 */

import { fluxbase } from '$lib/fluxbase';
import { storageRefToUrl } from '$lib/utils/inline-media';
import type {
	TripEntry,
	CreateTripEntryInput,
	UpdateTripEntryInput
} from '$lib/types/journal.types';

/**
 * List all entries for a trip, ordered by entry_date.
 */
export async function listEntries(tripId: string): Promise<TripEntry[]> {
	const { data, error } = await fluxbase
		.from<TripEntry>('trip_entries')
		.select('*')
		.eq('trip_id', tripId)
		.order('entry_date', { ascending: true });

	if (error) throw new Error(error.message);
	return (data as unknown as TripEntry[]) ?? [];
}

/**
 * List ALL entries for a user across ALL trips, with trip context joined.
 * Ordered by entry_date DESC (most recent first) — for the journal feed.
 */
export async function listAllEntries(): Promise<
	Array<
		TripEntry & {
			trip_title: string;
			trip_start_date: string;
			trip_end_date: string;
			trip_image_url: string | null;
			cover_image_url: string | null;
		}
	>
> {
	// Fetch entries
	const { data: entryData, error: entryError } = await fluxbase
		.from<Record<string, any>>('trip_entries')
		.select('*')
		.order('entry_date', { ascending: false });

	if (entryError) throw new Error(entryError.message);

	const entries = (entryData as any[]) ?? [];
	if (entries.length === 0) return [];

	// Batch-fetch trip data for all entries' trip_ids
	const tripIds = [...new Set(entries.map((e) => e.trip_id))];
	const { data: tripData } = await fluxbase
		.from<Record<string, any>>('trips')
		.select('id, title, start_date, end_date, image_url')
		.in('id', tripIds);

	const tripMap = new Map<string, any>();
	for (const t of (tripData as any[]) ?? []) {
		tripMap.set(t.id, t);
	}

	// Batch-fetch media for all entries to resolve cover photos
	const { data: mediaData } = await fluxbase
		.from<Record<string, any>>('trip_media')
		.select('id, entry_id, storage_path, thumbnail_path')
		.in('entry_id', entries.map((e) => e.id).filter(Boolean))
		.order('sort_order', { ascending: true });

	const mediaByEntry = new Map<string, any[]>();
	for (const m of (mediaData as any[]) ?? []) {
		const list = mediaByEntry.get(m.entry_id) ?? [];
		list.push(m);
		mediaByEntry.set(m.entry_id, list);
	}

	return entries.map((row) => {
		const trip = tripMap.get(row.trip_id);
		const entryMedia = mediaByEntry.get(row.id) ?? [];

		// Resolve cover: explicit cover_media_id → first media → null
		let coverImageUrl: string | null = null;
		if (row.cover_media_id) {
			const coverMedia = entryMedia.find((m) => m.id === row.cover_media_id);
			coverImageUrl =
				storageRefToUrl(coverMedia?.thumbnail_path ?? coverMedia?.storage_path ?? '') || null;
		}
		if (!coverImageUrl && entryMedia.length > 0) {
			coverImageUrl =
				storageRefToUrl(entryMedia[0].thumbnail_path ?? entryMedia[0].storage_path ?? '') || null;
		}

		return {
			id: row.id,
			trip_id: row.trip_id,
			user_id: row.user_id,
			title: row.title || '',
			body: row.body || '',
			entry_date: row.entry_date,
			end_date: row.end_date ?? null,
			cover_media_id: row.cover_media_id ?? null,
			created_at: row.created_at,
			updated_at: row.updated_at,
			trip_title: trip?.title ?? 'Unknown trip',
			trip_start_date: trip?.start_date ?? '',
			trip_end_date: trip?.end_date ?? '',
			trip_image_url: trip?.image_url ?? null,
			cover_image_url: coverImageUrl
		};
	});
}

/**
 * Get a single entry by ID.
 */
export async function getEntry(entryId: string): Promise<TripEntry | null> {
	const { data, error } = await fluxbase
		.from<TripEntry>('trip_entries')
		.select('*')
		.eq('id', entryId)
		.single();

	if (error) return null;
	return data as unknown as TripEntry;
}

/**
 * Create a new journal entry. RLS ensures the user owns the parent trip.
 */
export async function createEntry(userId: string, input: CreateTripEntryInput): Promise<TripEntry> {
	const { data, error } = await fluxbase
		.from('trip_entries')
		.insert({
			trip_id: input.trip_id,
			user_id: userId,
			title: input.title,
			body: input.body,
			entry_date: input.entry_date,
			end_date: input.end_date ?? null,
			status: input.status ?? 'published',
			cover_media_id: input.cover_media_id ?? null,
			highlight_start: input.highlight_start ?? null,
			highlight_end: input.highlight_end ?? null
		})
		.select('*')
		.single();

	if (error) throw new Error(error.message);
	return data as unknown as TripEntry;
}

/**
 * Update an existing entry. RLS ensures ownership.
 */
export async function updateEntry(
	entryId: string,
	updates: UpdateTripEntryInput
): Promise<TripEntry> {
	const { data, error } = await fluxbase
		.from('trip_entries')
		.update({ ...updates, updated_at: new Date().toISOString() })
		.eq('id', entryId)
		.select('*')
		.single();

	if (error) throw new Error(error.message);
	return data as unknown as TripEntry;
}

/**
 * Delete an entry. RLS ensures ownership.
 */
export async function deleteEntry(entryId: string): Promise<void> {
	const { error } = await fluxbase.from('trip_entries').delete().eq('id', entryId);
	if (error) throw new Error(error.message);
}
