/**
 * Immich connection test — verifies the user's Immich URL + API key.
 *
 * Reports { ok, user } on success, or { ok: false, errorKind, hint } where
 * errorKind ∈ auth | permission | network | other and hint names the three
 * required API-key permissions so the user can fix the key in Immich.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:timeout 30
 */

import type { FluxbaseClient } from '../jobs/types';
import { resolveImmichBase, testConnection } from '../jobs/_shared/services/external/immich.service.ts';
import { getAdminSetting } from './_shared/immich.ts';

interface FluxbaseRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string;
	params: Record<string, string>;
}

const IMMICH_API_KEY = 'immich_api_key';

const PERMISSION_HINT =
	'Re-check the API key permissions in Immich: it needs user.read, asset.read and asset.view.';

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
		return Response.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
	}

	// Admin toggle gates the whole integration.
	const adminSetting = await getAdminSetting<boolean>(fluxbaseService, 'wayli.immich_enabled');
	if (adminSetting.error || adminSetting.value !== true) {
		return Response.json(
			{ ok: false, errorKind: 'disabled', error: 'The Immich integration is disabled on this server.' },
			{ status: 403 }
		);
	}

	let serverUrl: string | undefined;
	try {
		({ serverUrl } = JSON.parse(req.body || '{}'));
	} catch {
		serverUrl = undefined;
	}

	const endpointSetting = await getAdminSetting<string>(fluxbaseService, 'wayli.immich_endpoint');

	const base = resolveImmichBase(serverUrl, endpointSetting.value);
	if (!base) {
		return Response.json(
			{ ok: false, errorKind: 'other', error: 'No Immich server URL configured.' },
			{ status: 400 }
		);
	}

	let apiKey: string;
	try {
		apiKey = await fluxbaseService.admin.settings.app.getUserSecretValue(userId, IMMICH_API_KEY);
	} catch {
		return Response.json(
			{ ok: false, errorKind: 'auth', error: 'No Immich API key saved yet.', hint: PERMISSION_HINT },
			{ status: 400 }
		);
	}
	if (!apiKey) {
		return Response.json(
			{ ok: false, errorKind: 'auth', error: 'No Immich API key saved yet.', hint: PERMISSION_HINT },
			{ status: 400 }
		);
	}

	const result = await testConnection(base, apiKey);
	if (result.ok) {
		return Response.json({ ok: true, user: result.user });
	}
	return Response.json(
		{
			ok: false,
			errorKind: result.errorKind,
			error: result.error,
			hint: result.errorKind === 'permission' || result.errorKind === 'auth' ? PERMISSION_HINT : undefined
		},
		{ status: 200 }
	);
}
