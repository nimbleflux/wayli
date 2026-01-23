// @fluxbase:name search_visits
// @fluxbase:namespace wayli
// @fluxbase:description Search place visits with smart filtering. Converts country names to codes, uses fuzzy matching for cities/amenities, parses date ranges.
// @fluxbase:timeout 30
// @fluxbase:memory 256

// Country name to ISO 2-letter code mapping
const COUNTRY_MAP: Record<string, string> = {
  vietnam: 'VN',
  'viet nam': 'VN',
  japan: 'JP',
  nippon: 'JP',
  netherlands: 'NL',
  holland: 'NL',
  'the netherlands': 'NL',
  france: 'FR',
  germany: 'DE',
  deutschland: 'DE',
  'united states': 'US',
  usa: 'US',
  america: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  italy: 'IT',
  italia: 'IT',
  spain: 'ES',
  españa: 'ES',
  thailand: 'TH',
  indonesia: 'ID',
  singapore: 'SG',
  malaysia: 'MY',
  australia: 'AU',
  canada: 'CA',
  china: 'CN',
  'south korea': 'KR',
  korea: 'KR',
  taiwan: 'TW',
  'hong kong': 'HK',
  portugal: 'PT',
  belgium: 'BE',
  switzerland: 'CH',
  austria: 'AT',
  poland: 'PL',
  czech: 'CZ',
  czechia: 'CZ',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  greece: 'GR',
  ireland: 'IE',
  hungary: 'HU',
  romania: 'RO',
  brazil: 'BR',
  argentina: 'AR',
  mexico: 'MX',
  india: 'IN',
  russia: 'RU',
  'south africa': 'ZA',
  turkey: 'TR',
  israel: 'IL',
  uae: 'AE',
  'united arab emirates': 'AE',
  philippines: 'PH',
  'new zealand': 'NZ'
};

// Dietary keywords that require checking poi_tags and poi_name in addition to poi_cuisine
const DIETARY_KEYWORDS = ['vegan', 'vegetarian', 'halal', 'kosher', 'gluten-free', 'gluten free'];

function parseDateRange(dateRange: string): string | null {
  const lower = dateRange.toLowerCase();

  if (lower.includes('this year')) {
    return "started_at >= DATE_TRUNC('year', CURRENT_DATE)";
  }
  if (lower.includes('last year')) {
    return "started_at >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '1 year') AND started_at < DATE_TRUNC('year', CURRENT_DATE)";
  }
  if (lower.includes('this month')) {
    return "started_at >= DATE_TRUNC('month', CURRENT_DATE)";
  }
  if (lower.includes('last month')) {
    return "started_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND started_at < DATE_TRUNC('month', CURRENT_DATE)";
  }
  if (lower.includes('last 30 days') || lower.includes('past 30 days')) {
    return "started_at >= CURRENT_DATE - INTERVAL '30 days'";
  }
  if (lower.includes('last 7 days') || lower.includes('past week')) {
    return "started_at >= CURRENT_DATE - INTERVAL '7 days'";
  }
  if (lower.includes('today')) {
    return "started_at >= CURRENT_DATE";
  }

  return null;
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

interface SearchVisitsArgs {
  country?: string;
  city?: string;
  category?: string;
  amenity?: string;
  cuisine?: string;
  dateRange?: string;
  limit?: number;
}

export default async function handler(
  args: SearchVisitsArgs,
  fluxbase: any,
  _fluxbaseService: any,
  _utils: any
) {
  const { country, city, category, amenity, cuisine, dateRange, limit = 20 } = args;
  const conditions: string[] = [];

  if (country) {
    const code = COUNTRY_MAP[country.toLowerCase()] || country.toUpperCase();
    conditions.push(`country_code = '${escapeSql(code)}'`);
  }
  if (city) {
    conditions.push(`city ILIKE '%${escapeSql(city)}%'`);
  }
  if (category) {
    conditions.push(`poi_category = '${escapeSql(category)}'`);
  }
  if (amenity) {
    conditions.push(`poi_amenity ILIKE '%${escapeSql(amenity)}%'`);
  }
  if (cuisine) {
    const escapedCuisine = escapeSql(cuisine);
    const isDietary = DIETARY_KEYWORDS.some(kw => cuisine.toLowerCase().includes(kw));

    if (isDietary) {
      // For dietary terms, check poi_cuisine, poi_tags (OSM dietary tags), and poi_name
      const dietKey = cuisine.toLowerCase().replace(/[ -]/g, ':');
      conditions.push(`(
        poi_cuisine ILIKE '%${escapedCuisine}%'
        OR poi_tags->'osm'->>'diet:${escapeSql(dietKey)}' = 'yes'
        OR poi_name ILIKE '%${escapedCuisine}%'
      )`);
    } else {
      // For regular cuisine types (japanese, italian, etc.), just check poi_cuisine
      conditions.push(`poi_cuisine ILIKE '%${escapedCuisine}%'`);
    }
  }
  if (dateRange) {
    const dateCondition = parseDateRange(dateRange);
    if (dateCondition) {
      conditions.push(dateCondition);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const sql = `
    SELECT poi_name, poi_amenity, poi_cuisine, poi_category, city, country_code,
           started_at, duration_minutes, latitude, longitude
    FROM my_place_visits
    ${whereClause}
    ORDER BY started_at DESC
    LIMIT ${safeLimit}
  `;

  const { data, error } = await fluxbase.rpc('execute_sql', { query: sql });

  if (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }]
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ count: data?.length || 0, visits: data || [] }, null, 2)
      }
    ]
  };
}
