/**
 * Scheduled daily activity refresh for all users.
 *
 * Runs daily to keep the tracker_daily_activity cache fresh for the activity
 * calendar RPC. Each user is processed incrementally from their own watermark.
 *
 * @fluxbase:require-role admin, service_role
 * @fluxbase:timeout 3600
 * @fluxbase:progress-timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 0 5 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';
import { dayWindowSince } from './_shared/day-window.ts';

const LOOKBACK_DAYS = 1;
const USERS_RANGE = 1000;

export async function handler(
	_req: Request,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	console.log('🌐 Scheduled daily activity refresh for all users');
	job.reportProgress(0, 'Enumerating users...');

	const db = fluxbaseService;

	// Distinct users from tracker_data. Order by the composite PK so the row
	// order is deterministic — unordered offset pagination can skip users when
	// the underlying order shifts between page fetches.
	const userIds = new Set<string>();
	let offset = 0;
	while (true) {
		const { data, error } = await db
			.from('tracker_data')
			.select('user_id')
			.order('user_id', { ascending: true })
			.order('recorded_at', { ascending: true })
			.range(offset, offset + USERS_RANGE - 1);
		if (error) {
			console.error('❌ Enumerate users failed:', error);
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

	const now = new Date();
	let processed = 0;
	let totalDays = 0;

	for (let i = 0; i < unique.length; i++) {
		if (await job.isCancelled()) {
			console.log('🛑 Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		const userId = unique[i];
		job.reportProgress(Math.round((i / unique.length) * 100), `User ${i + 1}/${unique.length}`);

		try {
			const days = await refreshUser(db, userId, now);
			processed++;
			totalDays += days;
		} catch (e) {
			console.error(`⚠️ User ${userId} failed:`, e);
		}
	}

	// Visited-countries cache: one set-based rebuild for ALL users (the RPC is
	// user_id-optional for service roles). Failure must not fail the job — the
	// countries map keeps serving its previous state.
	let countries = 0;
	try {
		const { error: vcError } = await (db.rpc as any).invoke(
			'refresh-visited-countries-sql',
			{},
			{ namespace: 'wayli' }
		);
		if (vcError) throw new Error((vcError as any).message ?? 'RPC failed');
		// Count via the table — the reader RPC is auth.uid()-scoped, which is
		// empty under the service role this job runs as.
		const { count } = await db
			.from('visited_countries')
			.select('*', { count: 'exact', head: true });
		countries = count ?? 0;
	} catch (vcErr) {
		console.warn('⚠️ visited-countries refresh failed (kept previous cache):', vcErr);
	}

	job.reportProgress(
		100,
		`Done: ${processed} users, ${totalDays} days, ${countries} countries`
	);
	console.log(
		`✅ Daily activity refresh complete: ${processed} users, ${totalDays} days, ${countries} countries`
	);
	return {
		success: true,
		result: { users_processed: processed, days_upserted: totalDays, countries }
	};
}

async function refreshUser(db: FluxbaseClient, userId: string, now: Date): Promise<number> {
	// Read watermark.
	const { data: stateRow } = await db
		.from('tracker_daily_activity_state')
		.select('last_processed_at')
		.eq('user_id', userId)
		.maybeSingle();
	const lastProcessedAt = (stateRow as any)?.last_processed_at ?? null;

	// Full rebuild if cache is empty for this user (first run or failed prior run).
	const { count: existingCount } = await db
		.from('tracker_daily_activity')
		.select('*', { count: 'exact', head: true })
		.eq('user_id', userId);
	const isFullRebuild = !existingCount || existingCount === 0;
	// The upsert below OVERWRITES day rows, so the window must start at 00:00Z —
	// a mid-day start would re-aggregate only the post-window slice of the
	// earlier affected day and wipe the rest of that day's totals.
	const since = dayWindowSince(lastProcessedAt, isFullRebuild, LOOKBACK_DAYS);

	// Build a FRESH query per batch — reusing the builder across .range() calls
	// doesn't work reliably in the fluxbase SDK.
	const baseSelect = 'recorded_at, distance, time_spent';

	const byDay = new Map<string, { distance: number; time_spent: number; points: number }>();
	let offset = 0;
	const BATCH = 5000;

	while (true) {
		let query = db
			.from('tracker_data')
			.select(baseSelect)
			.eq('user_id', userId)
			.not('location', 'is', null) // Same filter as refresh-daily-activity-sql RPC
			.order('recorded_at', { ascending: true })
			.range(offset, offset + BATCH - 1);
		if (since) query = query.gte('recorded_at', since);

		const { data: batch, error } = await query;
		if (error) throw new Error(`Fetch: ${(error as any).message}`);
		if (!batch || batch.length === 0) break;

		for (const row of batch as any[]) {
			const day = new Date(row.recorded_at).toISOString().slice(0, 10);
			const cur = byDay.get(day) ?? { distance: 0, time_spent: 0, points: 0 };
			cur.distance += Number(row.distance) || 0;
			cur.time_spent += Number(row.time_spent) || 0;
			cur.points += 1;
			byDay.set(day, cur);
		}
		offset += BATCH;
		if (batch.length < BATCH) break;
	}

	const upserts = Array.from(byDay.entries()).map(([day, v]) => ({
		user_id: userId,
		day,
		distance: Math.round(v.distance * 100) / 100,
		time_spent: Math.round(v.time_spent * 100) / 100,
		points: v.points,
		updated_at: now.toISOString()
	}));

	let upserted = 0;
	const UPSERT_BATCH = 500;
	for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
		const slice = upserts.slice(i, i + UPSERT_BATCH);
		const { error: upErr } = await db
			.from('tracker_daily_activity')
			.upsert(slice, { onConflict: 'user_id,day' });
		if (!upErr) upserted += slice.length;
	}

	const nowIso = now.toISOString();
	await db
		.from('tracker_daily_activity_state')
		.upsert(
			{ user_id: userId, last_processed_at: nowIso, updated_at: nowIso },
			{ onConflict: 'user_id' }
		);

	return upserted;
}
