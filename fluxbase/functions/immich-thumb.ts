/**
 * Immich thumbnail proxy — streams an Immich thumbnail to the requesting
 * user WITHOUT exposing their API key or making Wayli a generic gateway.
 *
 * Authorization: the integration must be enabled (server + user) and the
 * asset must already exist in the requesting user's immich_assets.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:timeout 30
 */

import type { FluxbaseClient } from '../jobs/types';
import {
	authorizeThumb,
	thumbSize,
	THUMB_CACHE_CONTROL
} from './_shared/immich.ts';
import { fetchThumbnail, resolveImmichBase } from '../jobs/_shared/services/external/immich.service.ts';

interface FluxbaseRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string;
	params: Record<string, string>;
}

const IMMICH_API_KEY = 'immich_api_key';

export async function handler(
	req: FluxbaseRequest,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient
): Promise<Response> {
	let userId: string | undefined;
	try {
		const {
			data: { user }
		} = await fluxbase.auth.getUser();
		userId = user?.id;
	} catch {
		userId = undefined;
	}
	if (!userId) {
		return Response.json({ error: 'Not authenticated' }, { status: 401 });
	}

	const assetId = req.params?.assetId;
	if (!assetId) {
		return Response.json({ error: 'assetId is required' }, { status: 400 });
	}
	const size = thumbSize(req.params?.size);

	// Authorization inputs (service DB: admin toggle + user prefs + ownership).
	const adminSetting = await getAdminSetting<boolean>(fluxbaseService, 'wayli.immich_enabled');
	if (adminSetting.error || adminSetting.value !== true) {
		return new Response(null, { status: 403 });
	}
	const { data: prefRow } = await fluxbaseService
		.from('user_preferences')
		.select('preferences')
		.eq('id', userId)
		.maybeSingle();
	const userEnabled = (prefRow?.preferences as any)?.immich?.enabled === true;
	const { data: owned } = await fluxbaseService
		.from('immich_assets')
		.select('asset_id')
		.eq('user_id', userId)
		.eq('asset_id', assetId)
		.maybeSingle();

	const denial = authorizeThumb({
		adminEnabled: adminSetting.value === true,
		userEnabled,
		hasAssetRow: !!owned
	});
	if (!denial.allowed) {
		return new Response(null, { status: denial.status });
	}

	let apiKey: string;
	try {
		apiKey = await fluxbaseService.admin.settings.app.getUserSecretValue(userId, IMMICH_API_KEY);
	} catch {
		return new Response(null, { status: 502 });
	}
	if (!apiKey) return new Response(null, { status: 502 });

	const endpointSetting = await getAdminSetting<string>(fluxbaseService, 'wayli.immich_endpoint');
	const { data: prefUrl } = await fluxbaseService
		.from('user_preferences')
		.select('preferences')
		.eq('id', userId)
		.maybeSingle();
	const base = resolveImmichBase(
		typeof (prefUrl?.preferences as any)?.immich?.server_url === 'string'
			? (prefUrl!.preferences as any).immich.server_url
			: undefined,
		endpointSetting.value
	);
	if (!base) return new Response(null, { status: 502 });

	const result = await fetchThumbnail(base, apiKey, assetId, size);
	if (!result.ok || !result.response.body) {
		return new Response(null, { status: 502 });
	}
	return new Response(result.response.body, {
		status: 200,
		headers: {
			'Content-Type': result.response.headers.get('Content-Type') ?? 'image/webp',
			'Cache-Control': THUMB_CACHE_CONTROL
		}
	});
}
