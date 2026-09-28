// Immich photo integration — user-facing types.
// Photo metadata synced from a user's Immich instance is DISPLAY-ONLY:
// it never becomes tracking points and never affects trip detection.

/** Per-user Immich connection settings, stored in `preferences.immich` jsonb. */
export interface ImmichSettings {
	/** Master per-user switch. Inert unless the server admin also enabled the integration. */
	enabled: boolean;
	/** Immich base URL. Falls back to the server-wide `wayli.immich_endpoint` default. */
	server_url?: string;
	/** Watermark of the last successful metadata sync (max asset taken_at). */
	last_sync_at?: string;
}

/** fluxbase secret key holding the user's Immich API key (server-side only). */
export const IMMICH_API_KEY = 'immich_api_key';

/** The Immich API-key permissions Wayli requires, and what each is for. */
export const IMMICH_REQUIRED_PERMISSIONS: Array<{ scope: string; why: string }> = [
	{ scope: 'user.read', why: 'verify the connection ("Test connection" reads your user profile)' },
	{
		scope: 'asset.read',
		why: 'sync photo metadata (GPS coordinates, capture date, city/country)'
	},
	{
		scope: 'asset.view',
		why: 'display photo thumbnails (streamed live through Wayli’s proxy; nothing is stored)'
	}
];

/** A synced geotagged photo, as stored in `immich_assets`. */
export interface ImmichAssetRow {
	asset_id: string;
	latitude: number;
	longitude: number;
	taken_at: string;
	city: string | null;
	state: string | null;
	country: string | null;
}
