// @fluxbase:name get_visit_summary
// @fluxbase:namespace wayli
// @fluxbase:description Get summary statistics for a specific POI or category. Returns visit count, total time, first/last visit, and top cities.
// @fluxbase:timeout 30
// @fluxbase:memory 256

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

interface GetVisitSummaryArgs {
  poiName?: string;
  category?: string;
}

export default async function handler(
  args: GetVisitSummaryArgs,
  fluxbase: any,
  _fluxbaseService: any,
  _utils: any
) {
  const { poiName, category } = args;

  if (!poiName && !category) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'Either poiName or category is required' }) }
      ]
    };
  }

  const conditions: string[] = [];

  if (poiName) {
    conditions.push(`poi_name ILIKE '%${escapeSql(poiName)}%'`);
  }
  if (category) {
    conditions.push(`poi_category = '${escapeSql(category)}'`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const summarySql = `
    SELECT COUNT(*) as visit_count,
           COALESCE(SUM(duration_minutes), 0) as total_minutes,
           ROUND(AVG(duration_minutes)) as avg_minutes,
           MIN(started_at) as first_visit,
           MAX(started_at) as last_visit
    FROM my_place_visits
    ${whereClause}
  `;

  const citiesSql = `
    SELECT city, country_code, COUNT(*) as visits
    FROM my_place_visits
    ${whereClause}
    AND city IS NOT NULL
    GROUP BY city, country_code
    ORDER BY visits DESC
    LIMIT 5
  `;

  const poisSql = `
    SELECT poi_name, poi_amenity, COUNT(*) as visits, SUM(duration_minutes) as total_minutes
    FROM my_place_visits
    ${whereClause}
    AND poi_name IS NOT NULL
    GROUP BY poi_name, poi_amenity
    ORDER BY visits DESC
    LIMIT 10
  `;

  try {
    const [summaryResult, citiesResult, poisResult] = await Promise.all([
      fluxbase.rpc('execute_sql', { query: summarySql }),
      fluxbase.rpc('execute_sql', { query: citiesSql }),
      category ? fluxbase.rpc('execute_sql', { query: poisSql }) : Promise.resolve({ data: null })
    ]);

    if (summaryResult.error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: summaryResult.error.message }) }]
      };
    }

    const s = summaryResult.data?.[0] || {};

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              summary: {
                visit_count: parseInt(s.visit_count) || 0,
                total_minutes: parseInt(s.total_minutes) || 0,
                avg_minutes: parseInt(s.avg_minutes) || 0,
                first_visit: s.first_visit || null,
                last_visit: s.last_visit || null
              },
              top_cities: citiesResult.data || [],
              top_pois: poisResult.data || null
            },
            null,
            2
          )
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }) }
      ]
    };
  }
}
