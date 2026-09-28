export interface TripMedia {
	id: string;
	trip_id: string;
	entry_id: string | null;
	user_id: string;
	storage_path: string;
	thumbnail_path: string | null;
	media_type: string;
	caption: string;
	sort_order: number;
	width: number | null;
	height: number | null;
	taken_at: string | null;
	exif: Record<string, unknown> | null;
	source?: 'upload' | 'immich';
	immich_asset_id?: string | null;
	created_at: string;
}

export interface CreateTripMediaInput {
	trip_id: string;
	entry_id?: string;
	storage_path: string;
	thumbnail_path?: string;
	media_type?: string;
	caption?: string;
	width?: number;
	height?: number;
	taken_at?: string;
	exif?: Record<string, unknown>;
	source?: 'upload' | 'immich';
	immich_asset_id?: string;
}
