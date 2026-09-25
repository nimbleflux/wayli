/**
 * Scheduled trip-suggestion generation for all users.
 *
 * Runs daily to keep trip suggestions fresh and to detect when a user is
 * CURRENTLY on a trip. For each user with tracker_data:
 *
 *   1. Detect trips from the last RECENT_WINDOW_DAYS of GPS data (closed
 *      home→away→home cycles → 'pending' suggestions, deduped against
 *      existing pending trips).
 *   2. If the user is currently away from home (open away span ≥ 24h), upsert
 *      an 'active' trip covering [last-home-departure → today], rolling the
 *      end_date forward each run while the trip continues. This is the
 *      "currently on a trip" detection.
 *
 * This is the keep-fresh + ongoing-trip path; users can still trigger
 * trip-generation.ts on-demand for a full history scan.
 *
 * @fluxbase:require-role admin, service_role
 * @fluxbase:timeout 7200
 * @fluxbase:progress-timeout 7200
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 6 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';
import { TripDetectionService } from '_shared/services/trip-detection.service';
import { UserProfileService } from '_shared/services/user-profile.service';
import type { Location } from '_shared/services/trip-detection.service';
import type { HomeAddress } from '_shared/types/trip-generation.types';

const USERS_RANGE = 1000;
// How far back to scan each run. Keep suggestions fresh without reprocessing
// the user's entire history every day. Must be long enough to capture a trip
// that is just ending (so it becomes a 'pending' suggestion the user can
// review) but bounded to keep the job fast.
const RECENT_WINDOW_DAYS = 45;

function dateNDaysAgo(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}
function todayDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Load a user's stored home address into the HomeAddress shape (mirrors
 * trip-generation.ts, but without the custom-address / geocoding path which
 * is a UI concern).
 */
async function loadHomeAddress(db: FluxbaseClient, userId: string): Promise<HomeAddress | null> {
	try {
		const profile = await UserProfileService.getUserProfileBasic(userId);
		const raw = (profile as any)?.home_address;
		if (!raw) return null;
		if (typeof raw === 'string') {
			return { display_name: raw, coordinates: undefined };
		}
		return {
			display_name: raw.display_name,
			coordinates: raw.coordinates,
			address: raw.address
		};
	} catch {
		return null;
	}
}

/**
 * Upsert an "active" ongoing trip: if an active trip already exists for this
 * user whose window overlaps the ongoing trip, update its end_date + metadata
 * (rolling it forward); otherwise insert a new 'active' trip.
 */
// Label applied to auto-detected ongoing trips so we can distinguish them
// from user-created 'active' trips and avoid clobbering manual edits.
const ONGOING_LABEL = 'auto-ongoing';

async function upsertOngoingTrip(
	db: FluxbaseClient,
	userId: string,
	trip: any
): Promise<'created' | 'updated' | 'skipped'> {
	const start = trip.start_date.slice(0, 10);
	const today = todayDate();

	// Look for an existing AUTO ongoing trip for this user that overlaps the
	// detected window. Scoped to the 'auto-ongoing' label so we never touch a
	// trip the user created/edited themselves. Uses idx_trips_date_range.
	const { data: existing, error: findErr } = await db
		.from('trips')
		.select('id, start_date, end_date, status')
		.eq('user_id', userId)
		.eq('status', 'active')
		.contains('labels', [ONGOING_LABEL])
		.lte('start_date', today)
		.gte('end_date', start)
		.order('start_date', { ascending: false })
		.limit(1);

	if (findErr) {
		console.warn(`[scheduled-trip-gen] find active trip failed for ${userId}:`, findErr);
		return 'skipped';
	}

	if (existing && (existing as any[]).length > 0) {
		const row = (existing as any[])[0];
		// Roll the end_date forward + refresh metadata while the trip continues.
		const { error: updErr } = await db
			.from('trips')
			.update({
				end_date: today,
				metadata: trip.metadata,
				description: trip.description,
				updated_at: new Date().toISOString()
			})
			.eq('id', row.id);
		if (updErr) {
			console.warn(`[scheduled-trip-gen] update active trip failed for ${userId}:`, updErr);
			return 'skipped';
		}
		return 'updated';
	}

	// No overlapping auto-ongoing trip → insert as active. Tag it so future
	// runs recognize it (and so the UI can style/identify auto-trips). Override
	// status + user_id + labels.
	const { error: insErr } = await db.from('trips').insert({
		...trip,
		user_id: userId,
		status: 'active',
		labels: [ONGOING_LABEL]
	});
	if (insErr) {
		console.warn(`[scheduled-trip-gen] insert active trip failed for ${userId}:`, insErr);
		return 'skipped';
	}
	return 'created';
}

/**
 * Close a stale auto-ongoing trip: the scheduled run's state machine saw the
 * user home again (no open away span ≥ 24h), so the previously created
 * auto-ongoing trip is completed instead of staying active forever.
 * end_date is the return-home time from the state machine, clamped into
 * [trip.start_date, today]. Only trips labelled 'auto-ongoing' are touched —
 * never a user-created 'active' trip.
 */
async function closeAutoOngoingTrip(
	db: FluxbaseClient,
	userId: string,
	returnTime: string | null
): Promise<boolean> {
	const today = todayDate();

	// Same lookup as upsertOngoingTrip: only auto-labelled active trips.
	const { data: existing, error: findErr } = await db
		.from('trips')
		.select('id, start_date, end_date')
		.eq('user_id', userId)
		.eq('status', 'active')
		.contains('labels', [ONGOING_LABEL])
		.lte('start_date', today)
		.order('start_date', { ascending: false })
		.limit(1);

	if (findErr) {
		console.warn(`[scheduled-trip-gen] find stale active trip failed for ${userId}:`, findErr);
		return false;
	}

	const row = (existing as any[] | null)?.[0];
	if (!row) return false;

	const startDate = String(row.start_date).slice(0, 10);
	const endDate = returnTime ? returnTime.slice(0, 10) : today;
	// Clamp into [trip.start_date, today] (lexicographic compare is safe for
	// ISO date strings — Math.min/Math.max would coerce to numbers).
	let clampedEnd = endDate;
	if (clampedEnd < startDate) clampedEnd = startDate;
	if (clampedEnd > today) clampedEnd = today;

	const { error: updErr } = await db
		.from('trips')
		.update({
			status: 'completed',
			end_date: clampedEnd,
			updated_at: new Date().toISOString()
		})
		.eq('id', row.id);

	if (updErr) {
		console.warn(`[scheduled-trip-gen] close active trip failed for ${userId}:`, updErr);
		return false;
	}
	console.log(
		`[scheduled-trip-gen] Closed auto-ongoing trip ${row.id} (${startDate} → ${clampedEnd}) for ${userId}`
	);
	return true;
}

/**
 * Insert closed-trip suggestions as 'pending', skipping any whose (user_id,
 * start_date, end_date) already exists as pending, completed, or active to
 * avoid duplicates across runs (e.g. the just-closed auto-ongoing trip) — the
 * unique index on trips backs this up at the schema level. Returns the number
 * inserted.
 */
async function insertPendingSuggestions(
	db: FluxbaseClient,
	userId: string,
	trips: any[]
): Promise<number> {
	if (trips.length === 0) return 0;

	// Fetch existing trip date windows for this user to dedupe. Rejected
	// trips stay re-suggestible on purpose (the user may change their mind).
	const { data: existing, error: listErr } = await db
		.from('trips')
		.select('start_date, end_date')
		.eq('user_id', userId)
		.in('status', ['pending', 'completed', 'active']);
	if (listErr) {
		console.warn(`[scheduled-trip-gen] list pending failed for ${userId}:`, listErr);
		return 0;
	}
	const seen = new Set(
		((existing as any[]) ?? []).map((t) => `${t.start_date}|${t.end_date}`)
	);

	const fresh = trips.filter((t) => {
		const s = (t.start_date || '').slice(0, 10);
		const e = (t.end_date || '').slice(0, 10);
		// DetectedTrip.start_date may be an ISO timestamp; normalize to date.
		return !seen.has(`${s}|${e}`);
	});
	if (fresh.length === 0) return 0;

	const { error: insErr } = await db.from('trips').insert(
		fresh.map((t) => ({ ...t, user_id: userId }))
	);
	if (insErr) {
		console.warn(`[scheduled-trip-gen] insert pending failed for ${userId}:`, insErr);
		return 0;
	}
	return fresh.length;
}

export async function handler(
	_req: Request,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	console.log('🌐 Scheduled trip-suggestion generation for all users');
	job.reportProgress(0, 'Enumerating users with tracker data...');

	const db = fluxbaseService;
	UserProfileService.setFluxbaseClient(db as any);

	// Enumerate distinct users that have tracker_data (service-role read).
	const userIds = new Set<string>();
	let offset = 0;
	while (true) {
		const { data, error } = await db
			.from('tracker_data')
			.select('user_id')
			.range(offset, offset + USERS_RANGE - 1);
		if (error) {
			console.error('❌ Failed to enumerate users:', error);
			return { success: false, error: `Enumerate failed: ${(error as any).message}` };
		}
		if (!data || data.length === 0) break;
		for (const row of data) {
			const uid = (row as any).user_id;
			if (uid) userIds.add(uid);
		}
		offset += USERS_RANGE;
		if (data.length < USERS_RANGE) break;
	}

	const unique = Array.from(userIds);
	console.log(`👥 Processing ${unique.length} users`);

	const startDate = dateNDaysAgo(RECENT_WINDOW_DAYS);
	const endDate = todayDate();

	let activeCreated = 0;
	let activeUpdated = 0;
	let activeClosed = 0;
	let pendingInserted = 0;
	let processed = 0;

	for (let i = 0; i < unique.length; i++) {
		if (await job.isCancelled()) {
			console.log('🛑 Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		const userId = unique[i];
		job.reportProgress(Math.round((i / unique.length) * 100), `User ${i + 1}/${unique.length}`);

		try {
			// Configure the detection service with the user's home address.
			const tripDetectionService = new TripDetectionService(db);
			const homeAddress = await loadHomeAddress(db, userId);
			if (homeAddress?.coordinates) {
				const customHomeLocation: Location = {
					coordinates: {
						lat: homeAddress.coordinates.lat,
						lng: homeAddress.coordinates.lng
					},
					address: {
						city:
							homeAddress.address?.city ||
							homeAddress.address?.town ||
							homeAddress.address?.village,
						// ISO code, not the country name — isHomeCountryTrip
						// compares this against point geocode country codes.
						country_code: homeAddress.address?.country_code?.toUpperCase()
					}
				};
				tripDetectionService.setCustomHomeAddress(customHomeLocation);
			}

			// 1. Closed-trip suggestions over the recent window. Active trips
			// are NOT excluded (excludeActiveTrips:false): the ongoing-trip
			// lifecycle below needs the away data inside the active trip's
			// range to keep rolling / close it on return.
			const detected = await tripDetectionService.detectTrips(userId, startDate, endDate, {
				excludeActiveTrips: false
			});

			// 2. Ongoing-trip lifecycle — runs BEFORE inserting suggestions so
			// a just-closed auto-ongoing trip is already in the dedup set.
			const ongoing = await tripDetectionService.getOngoingTrip();
			if (ongoing) {
				const res = await upsertOngoingTrip(db, userId, ongoing);
				if (res === 'created') activeCreated++;
				else if (res === 'updated') activeUpdated++;
			} else if (!tripDetectionService.isCurrentlyAway()) {
				// User is home again: close the auto-ongoing trip so it
				// doesn't stay active forever (and doesn't get duplicated as
				// a pending suggestion for the same dates).
				const closed = await closeAutoOngoingTrip(
					db,
					userId,
					tripDetectionService.getHomeReturnTime()
				);
				if (closed) activeClosed++;
			}

			// 3. Insert closed-trip suggestions as 'pending'.
			pendingInserted += await insertPendingSuggestions(db, userId, detected);

			processed++;
		} catch (e) {
			console.error(`⚠️ User ${userId} failed:`, e);
		}
	}

	const summary = `Done: ${processed} users, ${pendingInserted} new suggestions, ${activeCreated} active trips created, ${activeUpdated} updated, ${activeClosed} closed`;
	job.reportProgress(100, summary);
	console.log(`✅ Scheduled run complete: ${summary}`);
	return {
		success: true,
		result: {
			users_processed: processed,
			pending_inserted: pendingInserted,
			active_created: activeCreated,
			active_updated: activeUpdated,
			active_closed: activeClosed
		}
	};
}
