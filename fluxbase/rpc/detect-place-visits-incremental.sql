-- @fluxbase:require-role authenticated, service_role
-- @fluxbase:max-execution-time 1800s
-- @fluxbase:param user_id uuid?
-- Detect place visits incrementally using enhanced cluster-first approach
-- Improvements:
-- 1. Lower spatial threshold (100m) for better urban granularity
-- 2. Adaptive time gaps based on tracking density
-- 3. Speed-based stationarity detection
-- 4. Flexible duration threshold (3-5 min with quality checks)
-- 5. Confidence-weighted venue attribution
-- 6. Sequential cluster merging
-- 7. Transit point filtering
-- 8. Cluster radius validation
-- When user_id is provided: processes only that user's data since their watermark
-- When user_id is NULL: processes all users, each from their respective watermarks

-- Get all users to process with their watermarks
WITH users_to_process AS (
    SELECT
        COALESCE(ps.user_id, td.user_id) as target_user_id,
        COALESCE(ps.last_processed_at, '1970-01-01'::timestamptz) as v_since
    FROM (
        -- Get existing per-user watermarks
        SELECT user_id, last_processed_at
        FROM "public"."place_visits_state"
        WHERE user_id IS NOT NULL
          AND ($user_id::uuid IS NULL OR user_id = $user_id::uuid)
    ) ps
    FULL OUTER JOIN (
        -- Get distinct users from tracker_data (for users without state yet)
        SELECT DISTINCT user_id
        FROM "public"."tracker_data"
        WHERE $user_id::uuid IS NULL OR user_id = $user_id::uuid
    ) td ON ps.user_id = td.user_id
    WHERE COALESCE(ps.user_id, td.user_id) IS NOT NULL
),

-- Delete visits that may be affected by new tracker_data for each user
-- (visits that started within 1 hour before the user's watermark)
deleted_visits AS (
    DELETE FROM "public"."place_visits" pv
    USING users_to_process utp
    WHERE pv.user_id = utp.target_user_id
      AND pv.started_at >= utp.v_since - INTERVAL '1 hour'
    RETURNING pv.user_id
),

-- Get ALL tracker points with sensor data for clustering
-- IMPROVEMENT 7: Filter transit points (>36 km/h or vehicle activity)
all_points AS (
    SELECT
        td.user_id,
        td.recorded_at,
        td.location,
        -- Sensor data for clustering decisions
        td.accuracy,
        td.speed,
        td.activity_type,
        -- City and country
        COALESCE(
            td.geocode->'properties'->>'locality',
            td.geocode->'properties'->'address'->>'city',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:city'
        ) as city,
        td.country_code,
        -- Primary venue info (from direct geocode)
        td.geocode->'properties'->'addendum'->'osm'->>'name' as osm_name,
        td.geocode->'properties'->>'layer' as layer,
        td.geocode->'properties'->'addendum'->'osm'->>'amenity' as amenity,
        td.geocode->'properties'->'addendum'->'osm'->>'leisure' as leisure,
        td.geocode->'properties'->'addendum'->'osm'->>'tourism' as tourism,
        td.geocode->'properties'->'addendum'->'osm'->>'shop' as shop,
        td.geocode->'properties'->'addendum'->'osm'->>'sport' as sport,
        td.geocode->'properties'->'addendum'->'osm'->>'cuisine' as cuisine,
        td.geocode->'properties'->'addendum'->'osm' as osm_tags,
        (td.geocode->'properties'->>'confidence')::numeric as confidence,
        -- Nearest POI from nearby_pois array
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
    INNER JOIN users_to_process utp ON td.user_id = utp.target_user_id
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
        ORDER BY (poi->>'distance_meters')::numeric
        LIMIT 1
    ) nearest_poi ON true
    WHERE td.recorded_at >= utp.v_since - INTERVAL '1 hour'
      -- Filter out high-speed transit points (speed > 20 m/s = 72 km/h) - more permissive
      AND COALESCE(td.speed, 0) < 20
),

-- Calculate time gaps and distances for boundary detection (step 1)
with_gaps AS (
    SELECT *,
        -- Time gap from previous point in seconds
        EXTRACT(EPOCH FROM (
            recorded_at - LAG(recorded_at) OVER (PARTITION BY user_id ORDER BY recorded_at)
        )) as time_gap_seconds,
        -- Distance from previous point in meters
        ST_Distance(
            location::geography,
            LAG(location) OVER (PARTITION BY user_id ORDER BY recorded_at)::geography
        ) as distance_meters
    FROM all_points
),

-- Calculate previous time gap for adaptive threshold (step 2 - avoids nested window functions)
with_prev_gaps AS (
    SELECT *,
        LAG(time_gap_seconds) OVER (PARTITION BY user_id ORDER BY recorded_at) as prev_time_gap_seconds
    FROM with_gaps
),

-- Detect cluster boundaries with enhanced logic
-- IMPROVEMENTS 1, 2, 3: Lower threshold (100m), adaptive time gaps, speed-based detection
-- IMPROVEMENT 11: Tighter unconditional boundary (120m) for accuracy
with_boundaries AS (
    SELECT *,
        CASE WHEN
            -- First point (no previous location) - use distance_meters IS NULL as indicator
            distance_meters IS NULL
            -- OR significant movement (100m+) with speed confirming travel
            OR (distance_meters > 100 AND COALESCE(speed, 0) > 2)
            -- OR moderate movement (50m+) with higher speed
            OR (distance_meters > 50 AND COALESCE(speed, 0) > 5)
            -- OR large movement regardless of speed (catchall) - was 150m
            OR distance_meters > 120
            -- OR adaptive time gap exceeded
            OR CASE
                -- Sparse tracking (previous gap > 10 min): allow 60 min gaps
                WHEN COALESCE(prev_time_gap_seconds, 0) > 600 THEN time_gap_seconds > 3600
                -- Dense tracking: use 30 min threshold
                ELSE time_gap_seconds > 1800
            END
        THEN 1 ELSE 0 END as new_cluster
    FROM with_prev_gaps
),

-- Assign initial cluster IDs
clusters_initial AS (
    SELECT *,
        SUM(new_cluster) OVER (PARTITION BY user_id ORDER BY recorded_at) as cluster_id
    FROM with_boundaries
),

-- IMPROVEMENT 6: Calculate cluster-level stats for merging decision
cluster_stats AS (
    SELECT
        user_id,
        cluster_id,
        MIN(recorded_at) as cluster_start,
        MAX(recorded_at) as cluster_end,
        ST_Centroid(ST_Collect(location)) as centroid,
        COUNT(*) as point_count
    FROM clusters_initial
    GROUP BY user_id, cluster_id
),

-- Determine which clusters should be merged (close in time AND space)
-- IMPROVEMENT 10: Tighter merge thresholds for accuracy
cluster_merging AS (
    SELECT
        cs.*,
        CASE WHEN
            -- Previous cluster exists for same user
            LAG(cluster_id) OVER (PARTITION BY user_id ORDER BY cluster_start) IS NOT NULL
            -- Close in time (< 7 min between cluster end and next start) - was 10 min
            AND EXTRACT(EPOCH FROM (
                cluster_start - LAG(cluster_end) OVER (PARTITION BY user_id ORDER BY cluster_start)
            )) < 420
            -- Close in space (< 100m between centroids) - was 150m
            AND ST_Distance(
                centroid::geography,
                LAG(centroid) OVER (PARTITION BY user_id ORDER BY cluster_start)::geography
            ) < 100
        THEN LAG(cluster_id) OVER (PARTITION BY user_id ORDER BY cluster_start)
        ELSE cluster_id
        END as merged_cluster_id
    FROM cluster_stats cs
),

-- Propagate merged cluster IDs (handle chain merging)
cluster_final_ids AS (
    SELECT
        user_id,
        cluster_id,
        -- Use recursive logic: if merged, take the target's merged_cluster_id
        FIRST_VALUE(merged_cluster_id) OVER (
            PARTITION BY user_id, merged_cluster_id
            ORDER BY cluster_start
        ) as final_cluster_id
    FROM cluster_merging
),

-- Join back to get final cluster assignment for each point
clusters AS (
    SELECT
        ci.*,
        COALESCE(cfi.final_cluster_id, ci.cluster_id) as final_cluster_id
    FROM clusters_initial ci
    LEFT JOIN cluster_final_ids cfi
        ON ci.user_id = cfi.user_id AND ci.cluster_id = cfi.cluster_id
),

-- IMPROVEMENT 12: Identify home locations per user from overnight clusters
-- Most frequent cluster during overnight hours (midnight to 6am) with good point density
home_locations AS (
    SELECT DISTINCT ON (user_id)
        user_id,
        ST_Centroid(ST_Collect(location)) as home_location
    FROM clusters
    WHERE EXTRACT(HOUR FROM recorded_at) BETWEEN 0 AND 6  -- Overnight hours
    GROUP BY user_id, final_cluster_id
    HAVING COUNT(*) >= 5  -- Require significant presence
    ORDER BY user_id, COUNT(*) DESC
),

-- Insert aggregated visits with enhanced logic
-- IMPROVEMENTS 4, 5, 8: Flexible duration, confidence-weighted attribution, cluster radius check
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
        -- IMPROVEMENT 5: Confidence-weighted venue attribution with fallback chain
        COALESCE(
            -- High-confidence venue from direct geocode
            MODE() WITHIN GROUP (ORDER BY osm_name) FILTER (
                WHERE osm_name IS NOT NULL
                AND layer IN ('venue', 'address')
                AND confidence >= 0.6
            ),
            -- High-confidence nearby POI
            MODE() WITHIN GROUP (ORDER BY nearby_name) FILTER (
                WHERE nearby_name IS NOT NULL
                AND nearby_confidence >= 0.6
            ),
            -- Any venue from direct geocode (lower confidence)
            MODE() WITHIN GROUP (ORDER BY osm_name) FILTER (
                WHERE osm_name IS NOT NULL
                AND layer IN ('venue', 'address')
            ),
            -- Any nearby POI
            MODE() WITHIN GROUP (ORDER BY nearby_name) FILTER (WHERE nearby_name IS NOT NULL),
            -- Last resort: any OSM name
            MODE() WITHIN GROUP (ORDER BY osm_name) FILTER (WHERE osm_name IS NOT NULL)
        ) as poi_name,
        -- Layer: prefer venue/address, fallback to any
        COALESCE(
            MODE() WITHIN GROUP (ORDER BY layer) FILTER (WHERE layer IN ('venue', 'address')),
            MODE() WITHIN GROUP (ORDER BY nearby_layer) FILTER (WHERE nearby_layer IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY layer) FILTER (WHERE layer IS NOT NULL)
        ) as poi_layer,
        -- Amenity: from venue or nearby
        COALESCE(
            MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY leisure) FILTER (WHERE leisure IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_leisure) FILTER (WHERE nearby_leisure IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY tourism) FILTER (WHERE tourism IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_tourism) FILTER (WHERE nearby_tourism IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
        ) as poi_amenity,
        -- Cuisine
        COALESCE(
            MODE() WITHIN GROUP (ORDER BY cuisine) FILTER (WHERE cuisine IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_cuisine) FILTER (WHERE nearby_cuisine IS NOT NULL)
        ) as poi_cuisine,
        -- Sport
        COALESCE(
            MODE() WITHIN GROUP (ORDER BY sport) FILTER (WHERE sport IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_sport) FILTER (WHERE nearby_sport IS NOT NULL)
        ) as poi_sport,
        -- Category (computed from available data)
        -- IMPROVEMENT 12: Check home location first using pre-computed home_locations
        CASE
            -- Home detection: cluster centroid within 100m of user's home location
            WHEN (
                SELECT ST_Distance(
                    ST_SetSRID(ST_MakePoint(
                        AVG(ST_X(clusters.location)),
                        AVG(ST_Y(clusters.location))
                    ), 4326)::geography,
                    hl.home_location::geography
                ) < 100
                FROM home_locations hl
                WHERE hl.user_id = clusters.user_id
            ) THEN 'home'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('restaurant','cafe','bar','pub','fast_food','food_court','biergarten','ice_cream','bakery','deli','juice_bar','confectionery')
                -- Also detect food via cuisine tag (if place has cuisine, it's food)
                OR COALESCE(
                    MODE() WITHIN GROUP (ORDER BY cuisine) FILTER (WHERE cuisine IS NOT NULL),
                    MODE() WITHIN GROUP (ORDER BY nearby_cuisine) FILTER (WHERE nearby_cuisine IS NOT NULL)
                ) IS NOT NULL
                -- Also detect food-related shops
                OR COALESCE(
                    MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL),
                    MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
                ) IN ('bakery','deli','confectionery','chocolate','pastry','coffee','tea') THEN 'food'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('cinema','theatre','nightclub','casino','amusement_arcade','bowling_alley') THEN 'entertainment'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('museum','gallery','library','arts_centre','community_centre')
                OR COALESCE(
                    MODE() WITHIN GROUP (ORDER BY tourism) FILTER (WHERE tourism IS NOT NULL),
                    MODE() WITHIN GROUP (ORDER BY nearby_tourism) FILTER (WHERE nearby_tourism IS NOT NULL)
                ) = 'museum' THEN 'culture'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('school','university','college','kindergarten','language_school','music_school','driving_school') THEN 'education'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY leisure) FILTER (WHERE leisure IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_leisure) FILTER (WHERE nearby_leisure IS NOT NULL)
            ) IN ('golf_course','sports_centre','fitness_centre','swimming_pool','pitch','stadium','tennis','ice_rink') THEN 'sports'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY sport) FILTER (WHERE sport IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_sport) FILTER (WHERE nearby_sport IS NOT NULL)
            ) IS NOT NULL THEN 'sports'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('hotel','hostel','guest_house','motel')
                OR COALESCE(
                    MODE() WITHIN GROUP (ORDER BY tourism) FILTER (WHERE tourism IS NOT NULL),
                    MODE() WITHIN GROUP (ORDER BY nearby_tourism) FILTER (WHERE nearby_tourism IS NOT NULL)
                ) IN ('hotel','hostel','guest_house','motel','apartment') THEN 'accommodation'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('hospital','clinic','doctors','dentist','pharmacy','veterinary','optician') THEN 'healthcare'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('place_of_worship') THEN 'worship'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY leisure) FILTER (WHERE leisure IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_leisure) FILTER (WHERE nearby_leisure IS NOT NULL)
            ) IN ('park','garden','nature_reserve','playground','dog_park','beach_resort') THEN 'outdoors'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
            ) IN ('supermarket','convenience','grocery','greengrocer','butcher','farm') THEN 'grocery'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('bus_station','train_station','airport','ferry_terminal','taxi','car_rental') THEN 'transport'
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
            ) IS NOT NULL THEN 'shopping'
            ELSE 'other'
        END as poi_category,
        -- Confidence score
        ROUND(COALESCE(
            AVG(confidence) FILTER (WHERE confidence IS NOT NULL),
            AVG(nearby_confidence) FILTER (WHERE nearby_confidence IS NOT NULL),
            0.5
        )::numeric, 3) as confidence_score,
        -- Average distance (0 if from direct geocode, actual distance if from nearby POI)
        ROUND(COALESCE(
            AVG(nearby_distance) FILTER (WHERE nearby_distance IS NOT NULL),
            0
        )::numeric, 2) as avg_distance_meters,
        -- POI tags
        COALESCE(
            MODE() WITHIN GROUP (ORDER BY osm_tags::text) FILTER (WHERE osm_tags IS NOT NULL AND layer IN ('venue', 'address')),
            MODE() WITHIN GROUP (ORDER BY nearby_tags::text) FILTER (WHERE nearby_tags IS NOT NULL)
        )::jsonb as poi_tags,
        -- City and country
        MODE() WITHIN GROUP (ORDER BY city) FILTER (WHERE city IS NOT NULL) as city,
        MODE() WITHIN GROUP (ORDER BY country_code) FILTER (WHERE country_code IS NOT NULL) as country_code,
        -- Metadata
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
        -- Full-text search on poi_name
        to_tsvector('simple', COALESCE(
            COALESCE(
                MODE() WITHIN GROUP (ORDER BY osm_name) FILTER (
                    WHERE osm_name IS NOT NULL AND layer IN ('venue', 'address') AND confidence >= 0.6
                ),
                MODE() WITHIN GROUP (ORDER BY nearby_name) FILTER (
                    WHERE nearby_name IS NOT NULL AND nearby_confidence >= 0.6
                ),
                MODE() WITHIN GROUP (ORDER BY osm_name) FILTER (
                    WHERE osm_name IS NOT NULL AND layer IN ('venue', 'address')
                ),
                MODE() WITHIN GROUP (ORDER BY nearby_name) FILTER (WHERE nearby_name IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY osm_name) FILTER (WHERE osm_name IS NOT NULL)
            ),
            ''
        )) as poi_name_search,
        -- Alternative POI (from nearby_pois)
        MODE() WITHIN GROUP (ORDER BY nearby_name) FILTER (WHERE nearby_name IS NOT NULL) as alt_poi_name,
        COALESCE(
            MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_leisure) FILTER (WHERE nearby_leisure IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_tourism) FILTER (WHERE nearby_tourism IS NOT NULL),
            MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
        ) as alt_poi_amenity,
        MODE() WITHIN GROUP (ORDER BY nearby_cuisine) FILTER (WHERE nearby_cuisine IS NOT NULL) as alt_poi_cuisine,
        MODE() WITHIN GROUP (ORDER BY nearby_sport) FILTER (WHERE nearby_sport IS NOT NULL) as alt_poi_sport,
        ROUND(AVG(nearby_distance) FILTER (WHERE nearby_distance IS NOT NULL)::numeric, 2) as alt_poi_distance,
        MODE() WITHIN GROUP (ORDER BY nearby_tags::text) FILTER (WHERE nearby_tags IS NOT NULL)::jsonb as alt_poi_tags,
        ROUND(AVG(nearby_confidence) FILTER (WHERE nearby_confidence IS NOT NULL)::numeric, 3) as alt_poi_confidence
    FROM clusters
    GROUP BY user_id, final_cluster_id
    -- IMPROVEMENT 4: Stricter duration threshold for accuracy
    HAVING COUNT(*) >= 3  -- Require 3+ points (was 2)
       AND (
           -- Standard: 8+ minutes with 3+ points
           EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) >= 480
           -- OR shorter visits (5 min) require good accuracy AND 4+ points
           OR (
               EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) >= 300
               AND AVG(COALESCE(accuracy, 50)) <= 25
               AND COUNT(*) >= 4
           )
       )
       -- IMPROVEMENT 8: Reject clusters with excessive spread (GPS drift)
       -- Use bounding box diagonal as proxy for cluster diameter (500m more permissive)
       AND ST_Distance(
           ST_MakePoint(ST_XMin(ST_Collect(location)), ST_YMin(ST_Collect(location)))::geography,
           ST_MakePoint(ST_XMax(ST_Collect(location)), ST_YMax(ST_Collect(location)))::geography
       ) < 500
       -- IMPROVEMENT 9: Require actual POI attribution (not just address)
       AND (
           -- Has venue layer
           MODE() WITHIN GROUP (ORDER BY layer) FILTER (WHERE layer = 'venue') IS NOT NULL
           -- OR has nearby POI with name
           OR MODE() WITHIN GROUP (ORDER BY nearby_name) FILTER (WHERE nearby_name IS NOT NULL) IS NOT NULL
           -- OR has amenity/shop/tourism/leisure tag
           OR MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL) IS NOT NULL
           OR MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL) IS NOT NULL
           OR MODE() WITHIN GROUP (ORDER BY tourism) FILTER (WHERE tourism IS NOT NULL) IS NOT NULL
           OR MODE() WITHIN GROUP (ORDER BY leisure) FILTER (WHERE leisure IS NOT NULL) IS NOT NULL
       )
    ON CONFLICT (user_id, started_at)
    DO UPDATE SET
        duration_minutes = EXCLUDED.duration_minutes,
        location = EXCLUDED.location,
        poi_name = EXCLUDED.poi_name,
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
    RETURNING user_id
),

-- Get distinct users that were processed
processed_users AS (
    SELECT DISTINCT target_user_id as user_id FROM users_to_process
),

-- Upsert per-user state for each processed user
state_upsert AS (
    INSERT INTO "public"."place_visits_state" (user_id, last_processed_at, updated_at)
    SELECT user_id, NOW(), NOW()
    FROM processed_users
    ON CONFLICT (user_id) DO UPDATE SET
        last_processed_at = NOW(),
        updated_at = NOW()
    RETURNING user_id
),

-- Trigger state upsert by referencing it
state_trigger AS (
    SELECT COUNT(*) FROM state_upsert
)

-- Return counts
SELECT
    (SELECT COUNT(*) FROM new_visits)::integer as inserted_count,
    (SELECT COUNT(DISTINCT user_id) FROM processed_users)::integer as users_processed,
    (SELECT COUNT(*) FROM deleted_visits)::integer as deleted_count;
