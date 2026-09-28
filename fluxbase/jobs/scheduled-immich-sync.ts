/**
 * Scheduled Immich photo metadata sync for all users with the integration
 * enabled. Each enabled user gets a per-user `immich_sync` job submitted
 * onBehalfOf so it runs with their own identity (secrets decryption + RLS).
 * Runs after the 05:00 daily-activity job.
 *
 * @fluxbase:require-role admin, service_role
 * @fluxbase:timeout 3600
 * @fluxbase:progress-timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:schedule 15 5 * * *
 */

import type { FluxbaseClient, JobUtils } from './types';

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
	job.reportProgress(5, `Submitting ${userIds.length} sync(s)...`);

	let submitted = 0;
	let failed = 0;
	for (let i = 0; i < userIds.length; i++) {
		if (await job.isCancelled()) {
			console.log('🛑 Cancelled');
			return { success: false, error: 'Cancelled' };
		}
		const userId = userIds[i];
		try {
			// onBehalfOf needs the email; auth.admin works from service_role.
			const { data: userData, error: userError } = await fluxbaseService.auth.admin
				.getUserById(userId)
				.catch(() => ({ data: null, error: { message: 'getUserById failed' } }));
			const email = userData?.user?.email ?? '';
			if (userError || !email) {
				console.error(`❌ [${userId}] could not resolve email — skipping`);
				failed++;
				continue;
			}

			const { error } = await fluxbaseService.jobs.submit(
				'immich_sync',
				{},
				{
					namespace: 'wayli',
					onBehalfOf: { user_id: userId, user_email: email, user_role: 'authenticated' }
				}
			);
			if (error) {
				console.error(`❌ [${userId}] submit failed:`, error.message);
				failed++;
			} else {
				submitted++;
			}
		} catch (err) {
			console.error(`❌ [${userId}] submit threw:`, err instanceof Error ? err.message : err);
			failed++;
		}
		job.reportProgress(
			Math.round(((i + 1) / Math.max(1, userIds.length)) * 100),
			`Submitted ${i + 1}/${userIds.length}`
		);
	}

	console.log(`✅ Immich sync submissions: ${submitted} ok, ${failed} failed`);
	return { success: failed === 0, submitted, failed, users: userIds.length };
}
