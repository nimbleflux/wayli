/**
 * Types for reverse geocoded GPS coordinates
 */

// =============================================================================
// Pelias Types
// =============================================================================

/**
 * Pelias API Response (GeoJSON FeatureCollection)
 */
export interface PeliasResponse {
	type: 'FeatureCollection';
	features: PeliasFeature[];
	geocoding?: {
		version: string;
		attribution: string;
		query: Record<string, unknown>;
		timestamp: number;
	};
	bbox?: [number, number, number, number];
}

/**
 * Pelias Feature (GeoJSON Feature)
 */
export interface PeliasFeature {
	type: 'Feature';
	geometry: {
		type: 'Point';
		coordinates: [number, number]; // [lon, lat]
	};
	properties: PeliasProperties;
}

/**
 * Pelias Properties
 */
export interface PeliasProperties {
	id?: string;
	gid?: string;
	layer?: string;
	source?: string;
	source_id?: string;
	name?: string;
	label?: string;
	confidence?: number;
	accuracy?: string;
	distance?: number;
	// Administrative hierarchy
	continent?: string;
	country?: string;
	country_a?: string; // 3-letter ISO code (e.g., "USA")
	region?: string; // State/Province
	region_a?: string; // State abbreviation (e.g., "NY")
	county?: string;
	locality?: string; // City
	borough?: string;
	neighbourhood?: string;
	// Address details
	housenumber?: string;
	street?: string;
	postalcode?: string;
	// Categories for POI type detection
	category?: string[];
	// OSM addendum data (contains venue type, amenity info, etc.)
	addendum?: {
		osm?: Record<string, unknown>;
		[key: string]: unknown;
	};
	// Allow additional properties
	[key: string]: unknown;
}

/**
 * Pelias address structure (used for internal storage)
 */
export interface PeliasAddress {
	railway?: string;
	road?: string;
	suburb?: string;
	city?: string;
	municipality?: string;
	state?: string;
	'ISO3166-2-lvl4'?: string;
	country?: string;
	postcode?: string;
	country_code?: string;
	neighbourhood?: string;
	borough?: string;
	house_number?: string;
	county?: string;
	[key: string]: string | undefined;
}

// =============================================================================
// Country Code Conversion (ISO 3166-1 alpha-3 to alpha-2)
// =============================================================================

const COUNTRY_CODE_3TO2: Record<string, string> = {
	AFG: 'af',
	ALB: 'al',
	DZA: 'dz',
	AND: 'ad',
	AGO: 'ao',
	ARG: 'ar',
	ARM: 'am',
	AUS: 'au',
	AUT: 'at',
	AZE: 'az',
	BHS: 'bs',
	BHR: 'bh',
	BGD: 'bd',
	BRB: 'bb',
	BLR: 'by',
	BEL: 'be',
	BLZ: 'bz',
	BEN: 'bj',
	BTN: 'bt',
	BOL: 'bo',
	BIH: 'ba',
	BWA: 'bw',
	BRA: 'br',
	BRN: 'bn',
	BGR: 'bg',
	BFA: 'bf',
	BDI: 'bi',
	KHM: 'kh',
	CMR: 'cm',
	CAN: 'ca',
	CPV: 'cv',
	CAF: 'cf',
	TCD: 'td',
	CHL: 'cl',
	CHN: 'cn',
	COL: 'co',
	COM: 'km',
	COG: 'cg',
	COD: 'cd',
	CRI: 'cr',
	CIV: 'ci',
	HRV: 'hr',
	CUB: 'cu',
	CYP: 'cy',
	CZE: 'cz',
	DNK: 'dk',
	DJI: 'dj',
	DMA: 'dm',
	DOM: 'do',
	ECU: 'ec',
	EGY: 'eg',
	SLV: 'sv',
	GNQ: 'gq',
	ERI: 'er',
	EST: 'ee',
	SWZ: 'sz',
	ETH: 'et',
	FJI: 'fj',
	FIN: 'fi',
	FRA: 'fr',
	GAB: 'ga',
	GMB: 'gm',
	GEO: 'ge',
	DEU: 'de',
	GHA: 'gh',
	GRC: 'gr',
	GRD: 'gd',
	GTM: 'gt',
	GIN: 'gn',
	GNB: 'gw',
	GUY: 'gy',
	HTI: 'ht',
	HND: 'hn',
	HKG: 'hk',
	HUN: 'hu',
	ISL: 'is',
	IND: 'in',
	IDN: 'id',
	IRN: 'ir',
	IRQ: 'iq',
	IRL: 'ie',
	ISR: 'il',
	ITA: 'it',
	JAM: 'jm',
	JPN: 'jp',
	JOR: 'jo',
	KAZ: 'kz',
	KEN: 'ke',
	KIR: 'ki',
	PRK: 'kp',
	KOR: 'kr',
	KWT: 'kw',
	KGZ: 'kg',
	LAO: 'la',
	LVA: 'lv',
	LBN: 'lb',
	LSO: 'ls',
	LBR: 'lr',
	LBY: 'ly',
	LIE: 'li',
	LTU: 'lt',
	LUX: 'lu',
	MAC: 'mo',
	MDG: 'mg',
	MWI: 'mw',
	MYS: 'my',
	MDV: 'mv',
	MLI: 'ml',
	MLT: 'mt',
	MHL: 'mh',
	MRT: 'mr',
	MUS: 'mu',
	MEX: 'mx',
	FSM: 'fm',
	MDA: 'md',
	MCO: 'mc',
	MNG: 'mn',
	MNE: 'me',
	MAR: 'ma',
	MOZ: 'mz',
	MMR: 'mm',
	NAM: 'na',
	NRU: 'nr',
	NPL: 'np',
	NLD: 'nl',
	NZL: 'nz',
	NIC: 'ni',
	NER: 'ne',
	NGA: 'ng',
	MKD: 'mk',
	NOR: 'no',
	OMN: 'om',
	PAK: 'pk',
	PLW: 'pw',
	PAN: 'pa',
	PNG: 'pg',
	PRY: 'py',
	PER: 'pe',
	PHL: 'ph',
	POL: 'pl',
	PRT: 'pt',
	QAT: 'qa',
	ROU: 'ro',
	RUS: 'ru',
	RWA: 'rw',
	KNA: 'kn',
	LCA: 'lc',
	VCT: 'vc',
	WSM: 'ws',
	SMR: 'sm',
	STP: 'st',
	SAU: 'sa',
	SEN: 'sn',
	SRB: 'rs',
	SYC: 'sc',
	SLE: 'sl',
	SGP: 'sg',
	SVK: 'sk',
	SVN: 'si',
	SLB: 'sb',
	SOM: 'so',
	ZAF: 'za',
	SSD: 'ss',
	ESP: 'es',
	LKA: 'lk',
	SDN: 'sd',
	SUR: 'sr',
	SWE: 'se',
	CHE: 'ch',
	SYR: 'sy',
	TWN: 'tw',
	TJK: 'tj',
	TZA: 'tz',
	THA: 'th',
	TLS: 'tl',
	TGO: 'tg',
	TON: 'to',
	TTO: 'tt',
	TUN: 'tn',
	TUR: 'tr',
	TKM: 'tm',
	TUV: 'tv',
	UGA: 'ug',
	UKR: 'ua',
	ARE: 'ae',
	GBR: 'gb',
	USA: 'us',
	URY: 'uy',
	UZB: 'uz',
	VUT: 'vu',
	VAT: 'va',
	VEN: 've',
	VNM: 'vn',
	YEM: 'ye',
	ZMB: 'zm',
	ZWE: 'zw'
};

/**
 * Convert ISO 3166-1 alpha-3 country code to alpha-2
 */
export function convertCountryCode3to2(code3: string | undefined): string {
	if (!code3) return '';
	const upper = code3.toUpperCase();
	return COUNTRY_CODE_3TO2[upper] || code3.substring(0, 2).toLowerCase();
}

/**
 * Helper function to convert Pelias response to our GeocodedLocation type
 */
export function fromPeliasResponse(feature: PeliasFeature): GeocodedLocation {
	const props = feature.properties;
	const [lon, lat] = feature.geometry.coordinates;

	// Build Pelias address
	const address: PeliasAddress = {};
	if (props.locality) address.city = props.locality;
	if (props.region) address.state = props.region;
	if (props.country) address.country = props.country;
	if (props.neighbourhood) address.neighbourhood = props.neighbourhood;
	if (props.borough) address.borough = props.borough;
	if (props.street) address.road = props.street;
	if (props.housenumber) address.house_number = props.housenumber;
	if (props.postalcode) address.postcode = props.postalcode;
	if (props.county) address.county = props.county;
	if (props.country_a) {
		address.country_code = convertCountryCode3to2(props.country_a);
	}

	return {
		display_name: props.label || '',
		coordinates: { lat, lng: lon },
		address,
		name: props.name,
		// Map Pelias layer to type for compatibility
		type: props.layer,
		// Store category for transport mode detection
		class: props.category?.join(',')
	};
}

// =============================================================================
// GeocodedLocation and helpers
// =============================================================================

export interface GeocodedLocation {
	display_name: string;
	coordinates: {
		lat: number;
		lng: number;
	};
	address: PeliasAddress;
	place_id?: number;
	osm_type?: string;
	osm_id?: number;
	class?: string;
	type?: string;
	name?: string;
}

/**
 * Helper function to create a minimal GeocodedLocation from basic data
 */
export function createGeocodedLocation(
	displayName: string,
	lat: number,
	lng: number,
	address?: PeliasAddress
): GeocodedLocation {
	return {
		display_name: displayName,
		coordinates: { lat, lng },
		address: address || {}
	};
}
