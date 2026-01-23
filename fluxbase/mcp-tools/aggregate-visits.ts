// @fluxbase:name aggregate_visits
// @fluxbase:namespace wayli
// @fluxbase:description Aggregate statistics about place visits: total time, visit counts, or average duration. Group by POI, category, city, or country.
// @fluxbase:timeout 30
// @fluxbase:memory 256

const COUNTRY_MAP: Record<string, string> = {
  vietnam: 'VN',
  japan: 'JP',
  netherlands: 'NL',
  france: 'FR',
  germany: 'DE',
  'united states': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  italy: 'IT',
  spain: 'ES',
  thailand: 'TH',
  indonesia: 'ID',
  singapore: 'SG',
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
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  greece: 'GR',
  ireland: 'IE',
  brazil: 'BR',
  mexico: 'MX',
  india: 'IN',
  'new zealand': 'NZ'
};

function parseDateRange(dateRange: string): string | null {
  const lower = dateRange.toLowerCase();
  if (lower.includes('this year')) {
    return "started_at >= DATE_TRUNC('year', CURRENT_DATE)";
  }
  if (lower.includes('last year')) {
    return "started_at >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '1 year') AND started_at < DATE_TRUNC('year', CURRENT_DATE)";
  }
  if (lower.includes('last month')) {
    return "started_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND started_at < DATE_TRUNC('month', CURRENT_DATE)";
  }
  if (lower.includes('this month')) {
    return "started_at >= DATE_TRUNC('month', CURRENT_DATE)";
  }
  if (lower.includes('last 30 days') || lower.includes('past 30 days')) {
    return "started_at >= CURRENT_DATE - INTERVAL '30 days'";
  }
  if (lower.includes('last 7 days') || lower.includes('past week')) {
    return "started_at >= CURRENT_DATE - INTERVAL '7 days'";
  }
  return null;
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

interface AggregateVisitsArgs {
  metric: 'total_time' | 'visit_count' | 'avg_duration';
  groupBy: 'poi_name' | 'poi_category' | 'city' | 'country_code';
  country?: string;
  city?: string;
  category?: string;
  dateRange?: string;
  limit?: number;
}

export default async function handler(
  args: AggregateVisitsArgs,
  fluxbase: any,
  _fluxbaseService: any,
  _utils: any
) {
  const { metric, groupBy, country, city, category, dateRange, limit = 10 } = args;

  // Validate required parameters
  if (!metric || !groupBy) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'Both metric and groupBy parameters are required' }) }
      ]
    };
  }

  const metricExprMap: Record<string, string> = {
    total_time: 'SUM(duration_minutes)',
    visit_count: 'COUNT(*)',
    avg_duration: 'ROUND(AVG(duration_minutes))'
  };

  const metricAliasMap: Record<string, string> = {
    total_time: 'total_minutes',
    visit_count: 'visit_count',
    avg_duration: 'avg_minutes'
  };

  const metricExpr = metricExprMap[metric];
  const metricAlias = metricAliasMap[metric];

  if (!metricExpr) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: `Invalid metric: ${metric}. Use total_time, visit_count, or avg_duration` }) }
      ]
    };
  }

  const validGroupBy = ['poi_name', 'poi_category', 'city', 'country_code'];
  if (!validGroupBy.includes(groupBy)) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: `Invalid groupBy: ${groupBy}. Use poi_name, poi_category, city, or country_code` }) }
      ]
    };
  }

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
  if (dateRange) {
    const dateCondition = parseDateRange(dateRange);
    if (dateCondition) {
      conditions.push(dateCondition);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const sql = `
    SELECT ${groupBy}, ${metricExpr} as ${metricAlias}, COUNT(*) as total_visits,
           MIN(started_at) as first_visit, MAX(started_at) as last_visit
    FROM my_place_visits
    ${whereClause}
    GROUP BY ${groupBy}
    HAVING ${metricExpr} IS NOT NULL
    ORDER BY ${metricAlias} DESC
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
        text: JSON.stringify(
          { metric, groupBy, count: data?.length || 0, results: data || [] },
          null,
          2
        )
      }
    ]
  };
}
