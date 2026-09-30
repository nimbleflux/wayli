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
	THUMB_CACHE_CONTROL,
	getAdminSetting
} from './_shared/immich.ts';
import { fetchThumbnail, resolveImmichBase } from './_shared/immich.service.ts';

const IMMICH_API_KEY = 'immich_api_key';

export async function handler(
	req: Request,
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

	const url = new URL(req.url);
	// Params via POST body (the SDK's functions.invoke can't attach query
	// params) or query string (direct GET) — whichever is present.
	let assetId = url.searchParams.get('assetId');
	let size = thumbSize(url.searchParams.get('size'));
	if (!assetId && req.method === 'POST') {
		const body = (await req.json().catch(() => null)) as {
			assetId?: string;
			size?: string;
		} | null;
		if (body && typeof body.assetId === 'string') {
			assetId = body.assetId;
			size = thumbSize(body.size ?? undefined);
		}
	}
	if (!assetId) {
		return Response.json({ error: 'assetId is required' }, { status: 400 });
	}

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

	// The Fluxbase runtime bridge serializes function responses as text
	// (wrap.go does `await result.text()`), so raw image bytes arrive
	// mangled. Base64-encode here and let the client decode — thumbnails
	// are small, the +33% overhead is acceptable.
	const buffer = await result.response.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return Response.json(
		{
			ok: true,
			contentType: result.response.headers.get('Content-Type') ?? 'image/webp',
			base64: btoa(binary)
		},
		{ headers: { 'Cache-Control': THUMB_CACHE_CONTROL } }
	);
}
