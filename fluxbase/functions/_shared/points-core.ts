/**
 * Shared GPS-point ingestion core — used by both ingest functions:
 *
 *   - owntracks-points: external OwnTracks apps (legacy api_key auth) and
 *     older Wayli app builds (device token, rc.8/rc.9)
 *   - wayli-points:     the Wayli Android app (device-token auth only)
 *
 * Both speak the OwnTracks location wire format, so validation, reverse
 * geocoding (Pelias), timezone lookup, and the tracker_data upsert live here
 * exactly once.
 *
 * Import map note: '_shared/' resolves via the functions deno.json import map.
 */

import type { FluxbaseClient } from '../../jobs/types';

// GeoJSON types for timezone lookup
type Position = number[];
interface Polygon { type: 'Polygon'; coordinates: Position[][]; }
interface MultiPolygon { type: 'MultiPolygon'; coordinates: Position[][][]; }
interface Feature<G = Polygon | MultiPolygon> { type: 'Feature'; geometry: G; properties: Record<string, unknown> | null; }
interface FeatureCollection<G = Polygon | MultiPolygon> { type: 'FeatureCollection'; features: Feature<G>[]; }

import timezonesRaw from '_shared/timezones';
const timezonesGeoJSON = timezonesRaw as unknown as FeatureCollection;

// ===== Utility Functions =====
export function successResponse(_status = 200): Response {
  return new Response('[]', {
    status: _status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function errorResponse(status = 400): Response {
  return new Response('[]', {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function logError(error: unknown, context: string, data?: unknown): void {
  console.error(`❌ [${context}] Error:`, error, data || '');
}

export function logInfo(message: string, context: string, data?: unknown): void {
  console.log(`ℹ️ [${context}] ${message}`, data || '');
}

export function logSuccess(message: string, context: string, data?: unknown): void {
  console.log(`✅ [${context}] ${message}`, data || '');
}

// ===== Geohash Encoding =====
// Encodes lat/lon into a short string for privacy-safe logging
// Uses 4 characters (~39km precision) - enough for debugging without exposing exact location
const GEOHASH_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz';

function encodeGeohash(lat: number, lon: number, precision = 4): string {
	let minLat = -90, maxLat = 90;
	let minLon = -180, maxLon = 180;
	let hash = '';
	let isLon = true;
	let bit = 0;
	let charIndex = 0;

	while (hash.length < precision) {
		if (isLon) {
			const midLon = (minLon + maxLon) / 2;
			if (lon >= midLon) {
				charIndex = (charIndex << 1) | 1;
				minLon = midLon;
			} else {
				charIndex = charIndex << 1;
				maxLon = midLon;
			}
		} else {
			const midLat = (minLat + maxLat) / 2;
			if (lat >= midLat) {
				charIndex = (charIndex << 1) | 1;
				minLat = midLat;
			} else {
				charIndex = charIndex << 1;
				maxLat = midLat;
			}
		}

		isLon = !isLon;
		bit++;

		if (bit === 5) {
			hash += GEOHASH_CHARS[charIndex];
			bit = 0;
			charIndex = 0;
		}
	}

	return hash;
}

// ===== Configuration =====

// Helper function to get Pelias endpoint (similar to getPexelsRateLimit pattern)
async function getPeliasEndpoint(fluxbase: FluxbaseClient): Promise<string> {
  try {
    const { data, error } = await fluxbase
      .from('app.settings')
      .select('value')
      .eq('key', 'wayli.pelias_endpoint')
      .single();

    if (!error && data?.value?.value) {
      return data.value.value as string;
    }
  } catch (error) {
    console.log('No custom Pelias endpoint configured, using default');
  }

  return Deno.env.get('PELIAS_ENDPOINT') || 'https://pelias.wayli.app';
}

// Country code conversion (3-letter to 2-letter ISO)
const COUNTRY_CODE_3TO2: Record<string, string> = {
  USA: 'US',
  GBR: 'GB',
  DEU: 'DE',
  FRA: 'FR',
  ITA: 'IT',
  ESP: 'ES',
  NLD: 'NL',
  BEL: 'BE',
  AUT: 'AT',
  CHE: 'CH',
  POL: 'PL',
  CZE: 'CZ',
  DNK: 'DK',
  SWE: 'SE',
  NOR: 'NO',
  FIN: 'FI',
  PRT: 'PT',
  GRC: 'GR',
  IRL: 'IE',
  HUN: 'HU',
  ROU: 'RO',
  BGR: 'BG',
  HRV: 'HR',
  SVN: 'SI',
  SVK: 'SK',
  LUX: 'LU',
  EST: 'EE',
  LVA: 'LV',
  LTU: 'LT',
  CAN: 'CA',
  MEX: 'MX',
  BRA: 'BR',
  ARG: 'AR',
  AUS: 'AU',
  NZL: 'NZ',
  JPN: 'JP',
  KOR: 'KR',
  CHN: 'CN',
  IND: 'IN',
  RUS: 'RU',
  ZAF: 'ZA',
  TUR: 'TR',
  ISR: 'IL',
  ARE: 'AE',
  SGP: 'SG',
  MYS: 'MY',
  THA: 'TH',
  IDN: 'ID',
  PHL: 'PH',
  VNM: 'VN',
  TWN: 'TW',
  HKG: 'HK',
  MAC: 'MO'
};

function convertCountryCode3to2(code3: string): string {
  return COUNTRY_CODE_3TO2[code3?.toUpperCase()] || code3?.toLowerCase() || '';
}

// ===== Point-in-Polygon for Timezone Lookup =====
function pointInRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, coordinates: Position[][]): boolean {
  if (!pointInRing(lng, lat, coordinates[0])) return false;
  for (let i = 1; i < coordinates.length; i++) {
    if (pointInRing(lng, lat, coordinates[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lng: number, lat: number, coordinates: Position[][][]): boolean {
  for (const polygon of coordinates) {
    if (pointInPolygon(lng, lat, polygon)) return true;
  }
  return false;
}

function pointInFeature(lng: number, lat: number, feature: Feature): boolean {
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon') {
    return pointInPolygon(lng, lat, (geometry as Polygon).coordinates);
  } else if (geometry.type === 'MultiPolygon') {
    return pointInMultiPolygon(lng, lat, (geometry as MultiPolygon).coordinates);
  }
  return false;
}

function getTimezoneOffset(lat: number, lon: number): number | null {
  if (!timezonesGeoJSON.features || timezonesGeoJSON.features.length === 0) return null;
  for (const feature of timezonesGeoJSON.features) {
    if (pointInFeature(lon, lat, feature)) {
      const offset = parseFloat(feature.properties?.name as string);
      return isNaN(offset) ? null : offset;
    }
  }
  return null;
}

// ===== Coarse Geocoding for Country/Region =====
async function fetchCoarseGeocode(lat: number, lon: number, endpoint: string): Promise<{
  country_code: string | null;
  country: string | null;
  region: string | null;
  locality: string | null;
} | null> {
  try {
    const peliasUrl = `${endpoint}/v1/reverse?point.lat=${lat}&point.lon=${lon}&layers=coarse&size=1`;
    const response = await fetch(peliasUrl, {
      headers: {
        'User-Agent': 'Wayli/1.0 (https://wayli.app)',
        Accept: 'application/json'
      }
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!result.features || result.features.length === 0) return null;

    const props = result.features[0].properties;
    let countryCode = props.country_code?.toUpperCase() || null;
    if (!countryCode && props.country_a) {
      countryCode = convertCountryCode3to2(props.country_a);
    }
    return {
      country_code: countryCode,
      country: props.country || null,
      region: props.region || null,
      locality: props.locality || null
    };
  } catch {
    return null;
  }
}

// Helper function to perform reverse geocoding using Pelias
async function reverseGeocode(lat: number, lon: number, endpoint: string): Promise<any | null> {
  try {
    // instead of just address-level data which lacks country information
    const peliasUrl = `${endpoint}/v1/reverse?point.lat=${lat}&point.lon=${lon}&size=1`;

    const response = await fetch(peliasUrl, {
      headers: {
        'User-Agent': 'Wayli/1.0 (https://wayli.app)',
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      logError(`Pelias API error: ${response.status}`, 'OWNTRACKS_REVERSE_GEOCODE');
      return null;
    }

    const result = await response.json();

    // Check if Pelias returned any results
    if (!result.features || result.features.length === 0) {
      logError('Pelias returned no results', 'OWNTRACKS_REVERSE_GEOCODE');
      return null;
    }

    const feature = result.features[0];
    const props = feature.properties;

    // Build normalized address with fallbacks for city
    const address: Record<string, string> = {};
    // City: try multiple sources - locality, localadmin, neighbourhood, or OSM addr:city
    const city = props.locality || props.localadmin || props.neighbourhood || props.addendum?.osm?.['addr:city'];
    if (city) address.city = city;
    if (props.region) address.state = props.region;
    if (props.country) address.country = props.country;
    if (props.neighbourhood) address.neighbourhood = props.neighbourhood;
    if (props.street) address.road = props.street;
    if (props.housenumber) address.house_number = props.housenumber;
    if (props.postalcode) address.postcode = props.postalcode;
    // Pelias returns country_code as 2-letter ISO (e.g., 'NL') and country_a as 3-letter (e.g., 'NLD')
    if (props.country_code) {
      address.country_code = props.country_code.toUpperCase();
    } else if (props.country_a) {
      address.country_code = convertCountryCode3to2(props.country_a);
    }

    // Return geocode data in the format expected by tracker_data.geocode column
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lon, lat]
      },
      properties: {
        display_name: props.label || '',
        label: props.label,
        name: props.name,
        layer: props.layer,
        category: props.category,
        confidence: props.confidence,
        address: address,
        locality: props.locality,
        region: props.region,
        country: props.country,
        neighbourhood: props.neighbourhood,
        borough: props.borough,
        addendum: props.addendum,
        geocoded_at: new Date().toISOString(),
        geocoding_provider: 'pelias',
        import_source: 'owntracks',
        imported_at: new Date().toISOString()
      }
    };
  } catch (error) {
    logError(error, 'OWNTRACKS_REVERSE_GEOCODE');
    return null;
  }
}

// Sleep utility for retry backoff
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry wrapper for reverse geocoding with exponential backoff
async function reverseGeocodeWithRetry(
  lat: number,
  lon: number,
  endpoint: string,
  maxRetries: number = 3
): Promise<any | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await reverseGeocode(lat, lon, endpoint);
      if (result) return result;
      // If result is null (no features), don't retry - this is a valid response
      if (attempt === 0) {
        // Only log on first attempt to avoid spam
        return null;
      }
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // Last attempt failed, propagate the error
        throw error;
      }
      // Wait with exponential backoff: 100ms, 200ms, 400ms
      const backoffMs = Math.pow(2, attempt) * 100;
      logInfo(`Geocoding attempt ${attempt + 1} failed, retrying in ${backoffMs}ms`, 'OWNTRACKS_GEOCODE_RETRY');
      await sleep(backoffMs);
    }
  }
  return null;
}

// SHA-256 hex digest via Web Crypto (Deno runtime)
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Resolve the DB client used for token authentication — the service client
 * (device_tokens has no anon RLS policy, and the request carries no user JWT,
 * so the user client can never see token rows; see points-core header). Also
 * guards the tenant-less runtime where the injected service client is null.
 */
export function requireServiceClient(
  fluxbaseService: FluxbaseClient | null,
  logTag: string
): FluxbaseClient | null {
  if (!fluxbaseService) {
    logError(
      'Service client unavailable: this instance has no tenant context for the function runtime. ' +
        'Token authentication requires a tenant-configured Fluxbase instance.',
      logTag
    );
  }
  return fluxbaseService;
}

/**
 * Ingest a parsed OwnTracks-format submission into tracker_data:
 * point extraction/validation, Pelias reverse geocoding with coarse country
 * fallback, timezone-offset lookup, and the idempotent upsert.
 *
 * [logTag] labels the per-function log lines (e.g. OWNTRACKS_POINTS /
 * WAYLI_POINTS) so operators can tell the endpoints apart in logs.
 */
export async function ingestPoints(
  fluxbaseService: FluxbaseClient | null,
  userId: string,
  authMethod: string,
  body: unknown,
  logTag: string
): Promise<Response> {
  try {
    // The runtime injects the service client only when the execution has a
    // tenant context — on tenant-less instances it is null and any use would
    // crash. Fail loudly with guidance instead.
    if (!fluxbaseService) {
      logError(
        'Service client unavailable: this instance has no tenant context for the function runtime. ' +
          'GPS ingestion requires a tenant-configured Fluxbase instance.',
        logTag
      );
      return errorResponse(503);
    }
    const user = { id: userId };
    logInfo('Processing points', logTag, { userId: user.id, authMethod });

    const bodyRecord = body as Record<string, unknown>;

    // Handle both single location objects and arrays of points
    // OwnTracks sends single location objects, but we also support batch imports
    let points: any[];
    if (bodyRecord._type === 'location') {
      // Single OwnTracks location object
      points = [bodyRecord];
    } else if (Array.isArray(bodyRecord.points)) {
      // Array of points (for batch import)
      points = bodyRecord.points;
    } else if (Array.isArray(body)) {
      // Direct array of points
      points = body as any[];
    } else {
      points = [];
    }

    if (!Array.isArray(points) || points.length === 0) {
      logError('No valid points data found', logTag);
      return errorResponse(400);
    }

    logInfo('Processing points', logTag, {
      userId: user.id,
      pointCount: points.length
    });

    // Get Pelias endpoint from database settings
    const peliasEndpoint = await getPeliasEndpoint(fluxbaseService);

    // Process points and perform reverse geocoding synchronously
    // This ensures data is complete when inserted (takes longer but better data quality)
    const processedPoints = await Promise.all(
      points.map(async (point: any) => {
        let geocodeData: any = null;
        let countryCode: string | null = null;
        let tzDiff: number | null = null;

        // Always fetch reverse geocode from Pelias for consistency
        try {
          logInfo('Fetching reverse geocode from Pelias', 'OWNTRACKS_GEOCODE', {
            userId: user.id,
            lat: point.lat,
            lon: point.lon
          });

          geocodeData = await reverseGeocodeWithRetry(point.lat, point.lon, peliasEndpoint);

          if (geocodeData) {
            countryCode = geocodeData.properties?.address?.country_code?.toUpperCase() || null;

            // If address-level geocoding didn't return country_code, fetch coarse data
            if (!countryCode) {
              const coarseData = await fetchCoarseGeocode(point.lat, point.lon, peliasEndpoint);
              if (coarseData) {
                countryCode = coarseData.country_code;
                // Enrich geocode with coarse data
                if (countryCode) {
                  geocodeData.properties.address.country_code = countryCode;
                }
                if (coarseData.country && !geocodeData.properties.country) {
                  geocodeData.properties.country = coarseData.country;
                  geocodeData.properties.address.country = coarseData.country;
                }
                if (coarseData.region && !geocodeData.properties.region) {
                  geocodeData.properties.region = coarseData.region;
                }
                if (coarseData.locality && !geocodeData.properties.locality) {
                  geocodeData.properties.locality = coarseData.locality;
                  if (!geocodeData.properties.address.city) {
                    geocodeData.properties.address.city = coarseData.locality;
                  }
                }
              }
            }

            logSuccess('Point geocoded successfully', 'OWNTRACKS_GEOCODE', {
              userId: user.id,
              timestamp: point.tst,
              countryCode
            });
          } else {
            logError(
              `Geocoding returned null for user ${user.id} at lat=${point.lat}, lon=${point.lon}`,
              'OWNTRACKS_GEOCODE'
            );
          }
        } catch (error) {
          // Log the error with full details but continue - we'll insert the point without geocode data
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : '';
          logError(
            `Geocoding failed for user ${user.id} at lat=${point.lat}, lon=${point.lon}: ${errorMsg}\n${errorStack}`,
            'OWNTRACKS_GEOCODE'
          );
        }

        // Calculate timezone offset from coordinates
        tzDiff = getTimezoneOffset(point.lat, point.lon);

        // Return processed point with geocode data (if available)
        return {
          user_id: user.id,
          tracker_type: 'owntracks',
          device_id: point.tid || 'owntracks',
          recorded_at: new Date(point.tst * 1000).toISOString(),
          location: `POINT(${point.lon} ${point.lat})`,
          altitude: point.alt != null ? Number(point.alt) : null,
          accuracy: point.acc != null ? Math.abs(Number(point.acc)) : null,
          speed: point.vel != null ? Number(point.vel) : null,
          // ponytail: wrap heading into [0,360) — OwnTracks-Android emits cog=360 for due north, which trips the tracker_data_valid_heading CHECK (heading < 360)
          heading: point.cog != null ? ((Number(point.cog) % 360) + 360) % 360 : null,
          battery_level: point.batt != null ? Math.min(100, Math.max(0, Number(point.batt))) : null,
          // Wayli app extension: activity-recognition hint (still/on_foot/in_vehicle/on_bike).
          // Ignored by real OwnTracks devices (field absent → null).
          activity_type: typeof point.act === 'string' ? point.act : null,
          geocode: geocodeData,
          country_code: countryCode,
          tz_diff: tzDiff
        };
      })
    );

    // Insert points with complete geocode data using SDK
    // Use upsert with ignoreDuplicates to handle cases where OwnTracks retries the same point
    const { data: insertedPoints, error: insertError } = await fluxbaseService
      .from('tracker_data')
      .upsert(processedPoints, { ignoreDuplicates: true });

    if (insertError) {
      logError(
        `Failed to insert ${processedPoints.length} points for user ${user.id}: ${insertError.message}`,
        logTag
      );
      return errorResponse(500);
    }
    const geocodedCount = processedPoints.filter((p) => p.geocode !== null).length;
    const insertedCount = insertedPoints?.length || processedPoints.length;

    logSuccess('Points inserted successfully', logTag, {
      userId: user.id,
      totalCount: insertedCount,
      geocodedCount,
      ungeocodedCount: insertedCount - geocodedCount
    });

    return successResponse();
  } catch (error) {
    logError(error, logTag);
    return errorResponse(500);
  }
}
