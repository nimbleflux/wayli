-- @fluxbase:require-role admin
-- @fluxbase:max-execution-time 1800s
-- Detect place visits incrementally (processes only new data since last refresh)

-- Determine the starting point for incremental processing
WITH config AS (
    SELECT COALESCE(
        (SELECT last_processed_at FROM "public"."place_visits_state" WHERE id = 1),
        NOW() - INTERVAL '30 days'
    ) as v_since
),

-- Delete visits that may be affected by new tracker_data
-- (visits that started within 1 hour before our since timestamp, as they might extend)
deleted_visits AS (
    DELETE FROM "public"."place_visits"
    WHERE started_at >= (SELECT v_since FROM config) - INTERVAL '1 hour'
    RETURNING 1
),

-- Extract venue points from tracker_data
venue_points AS (
    SELECT
        td.user_id,
        td.recorded_at,
        td.location,
        COALESCE(
            td.geocode->'properties'->>'locality',
            td.geocode->'properties'->'address'->>'city',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:city'
        ) as city,
        td.country_code,
        (
            td.geocode->'properties'->'addendum'->'osm'->>'name' IS NOT NULL
            AND td.geocode->'properties'->>'layer' IN ('venue', 'address')
            AND (
                td.geocode->'properties'->'addendum'->'osm'->>'amenity' IS NOT NULL
                OR td.geocode->'properties'->'addendum'->'osm'->>'leisure' IS NOT NULL
                OR td.geocode->'properties'->'addendum'->'osm'->>'tourism' IS NOT NULL
                OR td.geocode->'properties'->'addendum'->'osm'->>'shop' IS NOT NULL
                OR td.geocode->'properties'->'addendum'->'osm'->>'sport' IS NOT NULL
            )
        ) as has_primary_venue,
        td.geocode->'properties'->'addendum'->'osm'->>'name' as primary_name,
        td.geocode->'properties'->>'layer' as primary_layer,
        td.geocode->'properties'->'addendum'->'osm'->>'amenity' as primary_amenity,
        td.geocode->'properties'->'addendum'->'osm'->>'leisure' as primary_leisure,
        td.geocode->'properties'->'addendum'->'osm'->>'tourism' as primary_tourism,
        td.geocode->'properties'->'addendum'->'osm'->>'shop' as primary_shop,
        td.geocode->'properties'->'addendum'->'osm'->>'sport' as primary_sport,
        td.geocode->'properties'->'addendum'->'osm'->>'cuisine' as primary_cuisine,
        td.geocode->'properties'->'addendum'->'osm' as primary_tags,
        (td.geocode->'properties'->>'confidence')::numeric as primary_confidence,
        nearest_poi.name as nearby_name,
        nearest_poi.layer as nearby_layer,
        nearest_poi.amenity as nearby_amenity,
        nearest_poi.leisure as nearby_leisure,
        nearest_poi.tourism as nearby_tourism,
        nearest_poi.shop as nearby_shop,
        nearest_poi.sport as nearby_sport,
        nearest_poi.cuisine as nearby_cuisine,
        nearest_poi.tags as nearby_tags,
        nearest_poi.confidence as nearby_confidence,
        nearest_poi.distance as nearby_distance
    FROM "public"."tracker_data" td
    CROSS JOIN config
    LEFT JOIN LATERAL (
        SELECT
            poi->>'name' as name,
            poi->>'layer' as layer,
            poi->'addendum'->'osm'->>'amenity' as amenity,
            poi->'addendum'->'osm'->>'leisure' as leisure,
            poi->'addendum'->'osm'->>'tourism' as tourism,
            poi->'addendum'->'osm'->>'shop' as shop,
            poi->'addendum'->'osm'->>'sport' as sport,
            poi->'addendum'->'osm'->>'cuisine' as cuisine,
            poi->'addendum'->'osm' as tags,
            COALESCE((poi->>'confidence')::numeric, 0.8) as confidence,
            (poi->>'distance_meters')::numeric as distance
        FROM jsonb_array_elements(td.geocode->'properties'->'nearby_pois') AS poi
        WHERE poi->>'name' IS NOT NULL
          AND (poi->>'distance_meters')::numeric < 75
        ORDER BY (poi->>'distance_meters')::numeric
        LIMIT 1
    ) nearest_poi ON true
    WHERE td.recorded_at >= config.v_since - INTERVAL '1 hour'
      AND (
          (
              td.geocode->'properties'->'addendum'->'osm'->>'name' IS NOT NULL
              AND td.geocode->'properties'->>'layer' IN ('venue', 'address')
              AND (
                  td.geocode->'properties'->'addendum'->'osm'->>'amenity' IS NOT NULL
                  OR td.geocode->'properties'->'addendum'->'osm'->>'leisure' IS NOT NULL
                  OR td.geocode->'properties'->'addendum'->'osm'->>'tourism' IS NOT NULL
                  OR td.geocode->'properties'->'addendum'->'osm'->>'shop' IS NOT NULL
                  OR td.geocode->'properties'->'addendum'->'osm'->>'sport' IS NOT NULL
              )
          ) OR nearest_poi.name IS NOT NULL
      )
),

-- Map venue points to POI data with categorization
poi_points AS (
    SELECT
        user_id,
        recorded_at,
        location,
        city,
        country_code,
        CASE WHEN has_primary_venue THEN primary_name ELSE nearby_name END as poi_name,
        CASE WHEN has_primary_venue THEN primary_layer ELSE nearby_layer END as poi_layer,
        CASE WHEN has_primary_venue
             THEN COALESCE(primary_amenity, primary_leisure, primary_tourism, primary_shop)
             ELSE COALESCE(nearby_amenity, nearby_leisure, nearby_tourism, nearby_shop)
        END as poi_amenity,
        CASE WHEN has_primary_venue THEN primary_cuisine ELSE nearby_cuisine END as poi_cuisine,
        CASE WHEN has_primary_venue THEN primary_sport ELSE nearby_sport END as poi_sport,
        CASE
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('restaurant','cafe','bar','pub','fast_food','food_court','biergarten','ice_cream','bakery') THEN 'food'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('cinema','theatre','nightclub','casino','amusement_arcade','bowling_alley') THEN 'entertainment'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('museum','gallery','library','arts_centre','community_centre')
                OR COALESCE(
                    CASE WHEN has_primary_venue THEN primary_tourism ELSE nearby_tourism END
                ) = 'museum' THEN 'culture'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('school','university','college','kindergarten','language_school','music_school','driving_school') THEN 'education'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_leisure ELSE nearby_leisure END
            ) IN ('golf_course','sports_centre','fitness_centre','swimming_pool','pitch','stadium','tennis','ice_rink') THEN 'sports'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_sport ELSE nearby_sport END
            ) IS NOT NULL THEN 'sports'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('hotel','hostel','guest_house','motel')
                OR COALESCE(
                    CASE WHEN has_primary_venue THEN primary_tourism ELSE nearby_tourism END
                ) IN ('hotel','hostel','guest_house','motel','apartment') THEN 'accommodation'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('hospital','clinic','doctors','dentist','pharmacy','veterinary','optician') THEN 'healthcare'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('place_of_worship') THEN 'worship'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_leisure ELSE nearby_leisure END
            ) IN ('park','garden','nature_reserve','playground','dog_park','beach_resort') THEN 'outdoors'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_shop ELSE nearby_shop END
            ) IN ('supermarket','convenience','grocery','greengrocer','butcher','bakery','deli') THEN 'grocery'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_amenity ELSE nearby_amenity END
            ) IN ('bus_station','train_station','airport','ferry_terminal','taxi','car_rental') THEN 'transport'
            WHEN COALESCE(
                CASE WHEN has_primary_venue THEN primary_shop ELSE nearby_shop END
            ) IS NOT NULL THEN 'shopping'
            ELSE 'other'
        END as poi_category,
        CASE WHEN has_primary_venue THEN primary_confidence ELSE nearby_confidence END as poi_confidence,
        CASE WHEN has_primary_venue THEN 0::numeric ELSE nearby_distance END as poi_distance,
        CASE WHEN has_primary_venue THEN primary_tags ELSE nearby_tags END as poi_tags,
        nearby_name as alt_poi_name,
        COALESCE(nearby_amenity, nearby_leisure, nearby_tourism, nearby_shop) as alt_poi_amenity,
        nearby_cuisine as alt_poi_cuisine,
        nearby_sport as alt_poi_sport,
        nearby_distance as alt_poi_distance,
        nearby_tags as alt_poi_tags,
        nearby_confidence as alt_poi_confidence
    FROM venue_points
),

-- Detect visit boundaries (new visit when POI changes or gap > 30 minutes)
with_boundaries AS (
    SELECT *,
        CASE WHEN
            poi_name IS DISTINCT FROM LAG(poi_name) OVER (PARTITION BY user_id ORDER BY recorded_at)
            OR recorded_at - LAG(recorded_at) OVER (PARTITION BY user_id ORDER BY recorded_at) > INTERVAL '30 minutes'
            OR LAG(poi_name) OVER (PARTITION BY user_id ORDER BY recorded_at) IS NULL
        THEN 1 ELSE 0 END as new_visit
    FROM poi_points
),

-- Group consecutive points into visits
visit_groups AS (
    SELECT *,
        SUM(new_visit) OVER (PARTITION BY user_id ORDER BY recorded_at) as visit_id
    FROM with_boundaries
),

-- Insert aggregated visits
new_visits AS (
    INSERT INTO "public"."place_visits" (
        user_id,
        started_at,
        duration_minutes,
        location,
        poi_name,
        poi_layer,
        poi_amenity,
        poi_cuisine,
        poi_sport,
        poi_category,
        confidence_score,
        avg_distance_meters,
        poi_tags,
        city,
        country_code,
        gps_points_count,
        visit_hour,
        visit_time_of_day,
        day_of_week,
        is_weekend,
        duration_category,
        poi_name_search,
        alt_poi_name,
        alt_poi_amenity,
        alt_poi_cuisine,
        alt_poi_sport,
        alt_poi_distance,
        alt_poi_tags,
        alt_poi_confidence
    )
    SELECT
        user_id,
        MIN(recorded_at) as started_at,
        LEAST(
            ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer,
            720
        ) as duration_minutes,
        ST_Centroid(ST_Collect(location)) as location,
        poi_name,
        MODE() WITHIN GROUP (ORDER BY poi_layer) as poi_layer,
        MODE() WITHIN GROUP (ORDER BY poi_amenity) as poi_amenity,
        MODE() WITHIN GROUP (ORDER BY poi_cuisine) as poi_cuisine,
        MODE() WITHIN GROUP (ORDER BY poi_sport) as poi_sport,
        MODE() WITHIN GROUP (ORDER BY poi_category) as poi_category,
        ROUND(AVG(poi_confidence)::numeric, 3) as confidence_score,
        ROUND(AVG(poi_distance)::numeric, 2) as avg_distance_meters,
        MODE() WITHIN GROUP (ORDER BY poi_tags::text)::jsonb as poi_tags,
        MODE() WITHIN GROUP (ORDER BY city) as city,
        MODE() WITHIN GROUP (ORDER BY country_code) as country_code,
        COUNT(*)::integer as gps_points_count,
        EXTRACT(HOUR FROM MIN(recorded_at))::integer as visit_hour,
        CASE
            WHEN EXTRACT(HOUR FROM MIN(recorded_at)) BETWEEN 5 AND 11 THEN 'morning'
            WHEN EXTRACT(HOUR FROM MIN(recorded_at)) BETWEEN 12 AND 17 THEN 'afternoon'
            WHEN EXTRACT(HOUR FROM MIN(recorded_at)) BETWEEN 18 AND 21 THEN 'evening'
            ELSE 'night'
        END as visit_time_of_day,
        TRIM(LOWER(TO_CHAR(MIN(recorded_at), 'day'))) as day_of_week,
        EXTRACT(DOW FROM MIN(recorded_at)) IN (0, 6) as is_weekend,
        CASE
            WHEN ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer < 30 THEN 'short'
            WHEN ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer <= 90 THEN 'regular'
            ELSE 'extended'
        END as duration_category,
        to_tsvector('simple', COALESCE(poi_name, '')) as poi_name_search,
        MODE() WITHIN GROUP (ORDER BY alt_poi_name) as alt_poi_name,
        MODE() WITHIN GROUP (ORDER BY alt_poi_amenity) as alt_poi_amenity,
        MODE() WITHIN GROUP (ORDER BY alt_poi_cuisine) as alt_poi_cuisine,
        MODE() WITHIN GROUP (ORDER BY alt_poi_sport) as alt_poi_sport,
        ROUND(AVG(alt_poi_distance)::numeric, 2) as alt_poi_distance,
        MODE() WITHIN GROUP (ORDER BY alt_poi_tags::text)::jsonb as alt_poi_tags,
        ROUND(AVG(alt_poi_confidence)::numeric, 3) as alt_poi_confidence
    FROM visit_groups
    GROUP BY user_id, visit_id, poi_name
    HAVING COUNT(*) >= 2
       AND ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer >= 15
    ON CONFLICT (user_id, started_at, poi_name)
    DO UPDATE SET
        duration_minutes = EXCLUDED.duration_minutes,
        location = EXCLUDED.location,
        poi_layer = EXCLUDED.poi_layer,
        poi_amenity = EXCLUDED.poi_amenity,
        poi_cuisine = EXCLUDED.poi_cuisine,
        poi_sport = EXCLUDED.poi_sport,
        poi_category = EXCLUDED.poi_category,
        confidence_score = EXCLUDED.confidence_score,
        avg_distance_meters = EXCLUDED.avg_distance_meters,
        poi_tags = EXCLUDED.poi_tags,
        city = EXCLUDED.city,
        country_code = EXCLUDED.country_code,
        gps_points_count = EXCLUDED.gps_points_count,
        visit_hour = EXCLUDED.visit_hour,
        visit_time_of_day = EXCLUDED.visit_time_of_day,
        day_of_week = EXCLUDED.day_of_week,
        is_weekend = EXCLUDED.is_weekend,
        duration_category = EXCLUDED.duration_category,
        poi_name_search = EXCLUDED.poi_name_search,
        alt_poi_name = EXCLUDED.alt_poi_name,
        alt_poi_amenity = EXCLUDED.alt_poi_amenity,
        alt_poi_cuisine = EXCLUDED.alt_poi_cuisine,
        alt_poi_sport = EXCLUDED.alt_poi_sport,
        alt_poi_distance = EXCLUDED.alt_poi_distance,
        alt_poi_tags = EXCLUDED.alt_poi_tags,
        alt_poi_confidence = EXCLUDED.alt_poi_confidence,
        updated_at = NOW()
    RETURNING 1
),

-- Update state
state_update AS (
    UPDATE "public"."place_visits_state"
    SET last_processed_at = NOW(), updated_at = NOW()
    WHERE id = 1
    RETURNING 1
)

-- Return counts
SELECT
    (SELECT COUNT(*) FROM new_visits)::integer as inserted_count,
    0::integer as updated_count,
    (SELECT COUNT(*) FROM deleted_visits)::integer as deleted_count;
