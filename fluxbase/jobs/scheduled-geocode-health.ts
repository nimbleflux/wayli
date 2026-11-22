/**
 * Scheduled geocode-health monitor for all users.
 *
 * Counts tracker_data points whose geocode is NULL over a recent window per
 * user and alerts when a significant share is missing: a loud log line plus
 * an in-app notification (deduplicated to one unread per user). Geocode is
 * filled by reverse geocoding, so a geocoder outage or a broken geocoding
 * job shows up here as a growing backlog instead of as silent feature loss —
 * sleep-based trip detection only processes points that carry a city, so an
 * unnoticed geocode outage makes recent trips undetectable while every job
 * still reports success.
 *
 * Payload overrides for manual runs: window_days, min_missing_count,
 * min_missing_ratio.
 *
 * @fluxbase:require-role admin, service_role
 * @fluxbase:timeout 600
 * @fluxbase:allow-net true
 * @fluxbase:schedule 30 6 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';
import {
	shouldFlagGeocodeBacklog,
	DEFAULT_GEOCODE_BACKLOG_THRESHOLDS
} from './_shared/utils/geocode-health.ts';

const USERS_RANGE = 1000;

interface GeocodeHealthPayload {
	window_days?: number;
	min_missing_count?: number;
	min_missing_ratio?: number;
}

interface BacklogDetail {
	user_id: string;
	missing: number;
	total: number;
}

export async function handler(
	_req: Request,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = (context?.payload ?? {}) as GeocodeHealthPayload;

	const windowDays = payload.window_days ?? 14;
	const thresholds = {
		minMissingCount:
			payload.min_missing_count ?? DEFAULT_GEOCODE_BACKLOG_THRESHOLDS.minMissingCount,
		minMissingRatio:
			payload.min_missing_ratio ?? DEFAULT_GEOCODE_BACKLOG_THRESHOLDS.minMissingRatio
	};
	const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

	console.log(
		`🩺 Geocode health check: last ${windowDays}d (since ${windowStart}), ` +
			`thresholds: count>=${thresholds.minMissingCount}, ratio>=${thresholds.minMissingRatio}`
	);
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
			return { success: false, error: `Enumerate failed: ${error.message}` };
		}
		if (!data || data.length === 0) break;
		for (const row of data) {
			const uid = typeof row.user_id === 'string' ? row.user_id : null;
			if (uid) userIds.add(uid);
		}
		offset += USERS_RANGE;
		if (data.length < USERS_RANGE) break;
	}

	const unique = Array.from(userIds);
	console.log(`👥 Scanning ${unique.length} users with tracker data`);

	let affected = 0;
	let totalMissing = 0;
	const details: BacklogDetail[] = [];

	for (let i = 0; i < unique.length; i++) {
		if (await job.isCancelled()) {
			console.log('🛑 Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		const userId = unique[i];
		job.reportProgress(Math.round((i / unique.length) * 100), `User ${i + 1}/${unique.length}`);

		try {
			const { count: total, error: totalError } = await db
				.from('tracker_data')
				.select('recorded_at', { count: 'exact', head: true })
				.eq('user_id', userId)
				.gte('recorded_at', windowStart);
			if (totalError) throw new Error(totalError.message);
			if (!total) continue;

			const { count: missing, error: missingError } = await db
				.from('tracker_data')
				.select('recorded_at', { count: 'exact', head: true })
				.eq('user_id', userId)
				.gte('recorded_at', windowStart)
				.is('geocode', null);
			if (missingError) throw new Error(missingError.message);

			const missingCount = missing ?? 0;
			if (!shouldFlagGeocodeBacklog(total, missingCount, thresholds)) continue;

			affected++;
			totalMissing += missingCount;
			details.push({ user_id: userId, missing: missingCount, total });
			console.error(
				`🚨 User ${userId}: ${missingCount}/${total} points ` +
					`(${Math.round((missingCount / total) * 100)}%) lack geocode in the last ${windowDays}d — ` +
					`reverse geocoding is stale or broken`
			);

			// One unread notification at a time — during a multi-day outage the
			// daily schedule would otherwise re-alert every morning. A read
			// notification re-arms the alert for the next day.
			const { data: unread } = await db
				.from('notifications')
				.select('id')
				.eq('user_id', userId)
				.eq('type', 'geocode_missing')
				.is('read_at', null)
				.limit(1);
			if (unread && unread.length > 0) continue;

			const { error: insertError } = await db.from('notifications').insert({
				user_id: userId,
				type: 'geocode_missing',
				title: 'Location data is missing geocoding',
				body:
					`${missingCount.toLocaleString()} of ${total.toLocaleString()} GPS points from the last ` +
					`${windowDays} days have no geocode (${Math.round((missingCount / total) * 100)}%). ` +
					`Trips and place visits can't be detected for those points — ` +
					`run reverse geocoding once the geocoder is reachable.`,
				link: '/dashboard/server-admin-settings'
			});
			if (insertError) {
				console.error(`⚠️ Failed to notify user ${userId}:`, insertError);
			}
		} catch (e) {
			console.error(`⚠️ User ${userId} failed:`, e);
		}
	}

	const summary = `${unique.length} users scanned, ${affected} with significant geocode backlog, ${totalMissing} points missing`;
	job.reportProgress(100, `Done: ${summary}`);
	console.log(`✅ Geocode health check complete: ${summary}`);
	return {
		success: true,
		result: {
			users_scanned: unique.length,
			users_affected: affected,
			missing_points_in_window: totalMissing,
			window_days: windowDays,
			details
		}
	};
}
