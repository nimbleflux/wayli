/**
 * Scheduled Immich photo metadata sync for all users with the integration
 * enabled. Calls the shared syncUserImmich() directly with each enabled
 * user's id — no per-user job submission (the Deno job runtime has no
 * auth.admin for the onBehalfOf email lookup; that path crashed production).
 *
 * @fluxbase:require-role admin, service_role
 * @fluxbase:timeout 3600
 * @fluxbase:progress-timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 15 5 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';
import { syncUserImmich } from '_shared/services/immich-sync-user.ts';

const USERS_RANGE = 500;

export async function handler(
	_req: Request,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	console.log('🌐 Scheduled Immich photo sync for all enabled users');
	job.reportProgress(0, 'Enumerating Immich users...');

	// Distinct users with immich.enabled = true (jsonb contains filter).
	const userIds: string[] = [];
	let from = 0;
	for (let guard = 0; guard < 1000; guard++) {
		const { data, error } = await fluxbaseService
			.from('user_preferences')
			.select('id, preferences')
			.contains('preferences', { immich: { enabled: true } })
			.range(from, from + USERS_RANGE - 1);
		if (error) {
			console.error('❌ Could not enumerate Immich users:', error.message);
			return { success: false, error: error.message };
		}
		for (const row of data ?? []) {
			const uid = (row as any).id;
			if (uid) userIds.push(uid);
		}
		if (!data || data.length < USERS_RANGE) break;
		from += USERS_RANGE;
	}

	console.log(`👥 ${userIds.length} user(s) with Immich enabled`);
	job.reportProgress(5, `Syncing ${userIds.length} user(s)...`);

	let syncedTotal = 0;
	let permissionErrors = 0;
	for (let i = 0; i < userIds.length; i++) {
		if (await job.isCancelled()) {
			console.log('🛑 Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		const userId = userIds[i];
		try {
			const result = (await syncUserImmich(
				fluxbaseService, // service client writes on the user's behalf
				fluxbaseService,
				userId,
				{},
				(pct, msg) => job.reportProgress(pct, `${userId.slice(0, 8)}: ${msg}`)
			)) as { synced?: number; permissionError?: boolean };
			syncedTotal += result.synced ?? 0;
			if (result.permissionError) permissionErrors++;
		} catch (err) {
			console.error(`❌ [${userId}] sync threw:`, err instanceof Error ? err.message : err);
		}
		job.reportProgress(
			Math.round(((i + 1) / Math.max(1, userIds.length)) * 100),
			`Synced ${i + 1}/${userIds.length}`
		);
	}

	console.log(`✅ Immich sync complete: ${syncedTotal} photos (${permissionErrors} permission errors)`);
	return { success: true, users: userIds.length, photos: syncedTotal, permissionErrors };
}
