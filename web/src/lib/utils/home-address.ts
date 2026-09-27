// Home address persistence helpers.
//
// user_profiles.home_address is a jsonb column that has carried three shapes
// over the years, all still live in production:
//   1. adapter shape       { address, location: { lat, lon }, display_name? }
//   2. raw Pelias shape    { display_name, lat, lon, name, layer, address, ... }
//   3. manual coordinates  { display_name: "lat, lng", coordinates: { lat, lng } }
//      (#205 fallback for addresses the geocoder can't find; may carry
//      `address`/`layer` keys when the coordinates were reverse-geocoded)
// Every reader must go through normalizeHomeAddress; legacy plain strings
// carry no coordinates and normalize to null.

export interface ReverseGeocodeSummary {
	label: string;
	address: Record<string, string>;
	layer?: string;
}

export interface NormalizedHomeAddress {
	address: string;
	location: { lat: number; lon: number };
	display_name?: string;
	layer?: string;
	name?: string;
	city?: string;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/** Extract { lat, lon } from a `{ lat, lon }` or `{ lat, lng }` object. */
function pickLatLng(obj: unknown): { lat: number; lon: number } | null {
	if (!obj || typeof obj !== 'object') return null;
	const o = obj as Record<string, unknown>;
	const lat = o.lat;
	const lon = o.lon ?? o.lng;
	if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
	return { lat, lon };
}

function cityFromAddress(address: unknown): string | undefined {
	if (!address || typeof address !== 'object') return undefined;
	const a = address as Record<string, unknown>;
	const city = a.city ?? a.town ?? a.village;
	return typeof city === 'string' && city.length > 0 ? city : undefined;
}

export function normalizeHomeAddress(raw: unknown): NormalizedHomeAddress | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;

	const location = pickLatLng(r.location) ?? pickLatLng(r.coordinates);
	if (!location) {
		// Flat raw-Pelias shape { lat, lon, ... }
		if (isFiniteNumber(r.lat) && isFiniteNumber(r.lon)) {
			const displayName = typeof r.display_name === 'string' ? r.display_name : undefined;
			return {
				address: displayName || (typeof r.name === 'string' ? r.name : '') || 'Home',
				location: { lat: r.lat, lon: r.lon },
				display_name: displayName,
				layer: typeof r.layer === 'string' ? r.layer : undefined,
				name: typeof r.name === 'string' ? r.name : undefined,
				city: cityFromAddress(r.address)
			};
		}
		return null;
	}

	const displayName = typeof r.display_name === 'string' ? r.display_name : undefined;
	const addressField = typeof r.address === 'string' ? r.address : undefined;
	return {
		address: addressField || displayName || (typeof r.name === 'string' ? r.name : '') || 'Home',
		location,
		display_name: displayName,
		layer: typeof r.layer === 'string' ? r.layer : undefined,
		name: typeof r.name === 'string' ? r.name : undefined,
		city: cityFromAddress(r.address)
	};
}

/**
 * Parse the two manual coordinate inputs into the stored manual shape.
 * Accepts both decimal separators; rejects out-of-range values and Null
 * Island. Behavior mirrored verbatim from the previous account-settings
 * inline implementation (#205).
 */
export function parseManualHomeCoordinates(
	latInput: string,
	lngInput: string
): { display_name: string; coordinates: { lat: number; lng: number } } | null {
	const lat = Number.parseFloat(latInput.trim().replace(',', '.'));
	const lng = Number.parseFloat(lngInput.trim().replace(',', '.'));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
	return { display_name: `${lat}, ${lng}`, coordinates: { lat, lng } };
}

/**
 * Build the home_address value for manually entered coordinates. Without a
 * reverse-geocode summary this is exactly the plain manual shape; with one,
 * the label and address/layer keys are added so city-based trip detection
 * works for manual locations too (#205).
 */
export function buildManualHomeAddress(
	lat: number,
	lng: number,
	reverse: ReverseGeocodeSummary | null
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		display_name: reverse?.label || `${lat}, ${lng}`,
		coordinates: { lat, lng }
	};
	if (reverse?.address && Object.keys(reverse.address).length > 0) {
		base.address = reverse.address;
	}
	if (reverse?.layer) {
		base.layer = reverse.layer;
	}
	return base;
}
