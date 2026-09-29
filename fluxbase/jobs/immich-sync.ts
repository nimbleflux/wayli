/**
 * Immich photo metadata sync (per-user).
 *
 * Pulls geotagged photo metadata from the user's Immich instance into the
 * `immich_assets` table. DISPLAY-ONLY: photo coordinates never become
 * tracking points and never affect trip detection.
 *
 * Submitted by the authenticated user ("Sync now" on the Connections page,
 * or automatically by the photo picker when the table is empty). The
 * scheduled job calls the shared syncUserImmich() directly.
 *
 * Payload:
 *   { fullResync?: boolean }  — ignore the watermark and replace all rows
 *   { wipe?: boolean }        — disconnect: delete rows, disable the integration
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 3600
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type { FluxbaseClient, JobUtils } from './types';
import { syncUserImmich } from '_shared/services/immich-sync-user.ts';

export async function handler(
	_req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const userId = context.user?.id;
	if (!userId) {
		return { success: false, error: 'No user context available' };
	}

	const payload = (context.payload ?? {}) as { fullResync?: boolean; wipe?: boolean };
	return syncUserImmich(fluxbase, fluxbaseService, userId, payload, (pct, msg) =>
		job.reportProgress(pct, msg)
	);
}
