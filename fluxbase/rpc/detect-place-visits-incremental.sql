-- @fluxbase:require-role authenticated, service_role
-- @fluxbase:max-execution-time 21600s
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
WITH config AS (
    -- Configuration CTE - single source of truth for all thresholds
    SELECT
        -- Distance thresholds (meters)
        100::numeric as poi_nearby_search_radius,      -- Pelias nearby POI search radius
        75::numeric as poi_nearby_accept_max_distance, -- Max distance to accept nearby POI (increased from 50)
        100::numeric as cluster_spatial_threshold,     -- Max distance for cluster formation
        120::numeric as cluster_unconditional_boundary,-- Unconditional cluster boundary
        100::numeric as cluster_merge_spatial_distance,-- Max distance for merging clusters
        100::numeric as home_detection_distance,       -- Distance to classify as home

        -- Speed thresholds (m/s)
        20::numeric as transit_speed_threshold,        -- Speed to filter transit points
        5::numeric as home_detection_speed_threshold,  -- Max speed for home detection

        -- Time gaps (seconds)
        2700::numeric as time_gap_normal,              -- 45 min normal tracking
        5400::numeric as time_gap_sparse,              -- 90 min sparse tracking
        600::numeric as time_gap_sparse_threshold,     -- Previous gap > 10 min = sparse
        900::numeric as cluster_merge_time_gap,        -- 15 min for cluster merging

        -- POI attribution
        0.6::numeric as poi_high_confidence_threshold, -- High confidence threshold
        0.4::numeric as poi_min_confidence_threshold,  -- Minimum confidence threshold

        -- Cluster validation
        50::numeric as cluster_max_spread,             -- Max diagonal spread (GPS drift)
        10::numeric as cluster_min_overnight_points,   -- Min points for home detection

        -- Quality thresholds
        25::numeric as cluster_good_accuracy_threshold -- Good accuracy for short visits
),
users_to_process AS (
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
      AND COALESCE(td.speed, 0) < c.transit_speed_threshold
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
            OR (distance_meters > c.cluster_spatial_threshold AND COALESCE(speed, 0) > 2)
            -- OR moderate movement (50m+) with higher speed
            OR (distance_meters > 50 AND COALESCE(speed, 0) > 5)
            -- OR large movement regardless of speed (catchall)
            OR distance_meters > c.cluster_unconditional_boundary
            -- OR adaptive time gap exceeded
            OR CASE
                -- Sparse tracking (previous gap > 10 min): allow 90 min gaps (increased for OwnTracks)
                WHEN COALESCE(prev_time_gap_seconds, 0) > c.time_gap_sparse_threshold THEN time_gap_seconds > c.time_gap_sparse
                -- Normal tracking: use 45 min threshold (increased from 30 min)
                ELSE time_gap_seconds > c.time_gap_normal
            END
        THEN 1 ELSE 0 END as new_cluster
    FROM with_prev_gaps
    CROSS JOIN config c
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
-- IMPROVEMENT 10: Extended merge window to reduce home fragmentation
cluster_merging AS (
    SELECT
        cs.*,
        CASE WHEN
            -- Previous cluster exists for same user
            LAG(cluster_id) OVER (PARTITION BY user_id ORDER BY cluster_start) IS NOT NULL
            -- Close in time (< 15 min between cluster end and next start) - increased from 7 min
            -- This helps merge consecutive visits at the same location (esp. home)
            AND EXTRACT(EPOCH FROM (
                cluster_start - LAG(cluster_end) OVER (PARTITION BY user_id ORDER BY cluster_start)
            )) < c.cluster_merge_time_gap
            -- Close in space (< 100m between centroids)
            AND ST_Distance(
                centroid::geography,
                LAG(centroid) OVER (PARTITION BY user_id ORDER BY cluster_start)::geography
            ) < c.cluster_merge_spatial_distance
        THEN LAG(cluster_id) OVER (PARTITION BY user_id ORDER BY cluster_start)
        ELSE cluster_id
        END as merged_cluster_id
    FROM cluster_stats cs
    CROSS JOIN config c
),

-- Propagate merged cluster IDs (handle chain merging) - Phase 3: Fixed with recursive CTE
-- Transitive closure for cluster merging (A→B, C→B means all merge to A)
cluster_merge_graph AS (
    -- Base: each cluster points to its merge target
    SELECT
        user_id,
        cluster_id,
        merged_cluster_id as target_id
    FROM cluster_merging
    WHERE cluster_id != merged_cluster_id

    UNION ALL

    -- Recursive: follow merge chains to find root
    SELECT
        g.user_id,
        g.cluster_id,
        c.target_id
    FROM cluster_merge_graph g
    INNER JOIN cluster_merge_graph c
        ON c.cluster_id = g.target_id
        AND g.user_id = c.user_id
    WHERE g.cluster_id != c.target_id
),

-- Find root cluster for each original cluster (smallest ID = root)
cluster_roots AS (
    SELECT DISTINCT ON (user_id, cluster_id)
        user_id,
        cluster_id,
        MIN(target_id) OVER (PARTITION BY user_id, cluster_id) as root_cluster_id
    FROM cluster_merge_graph
),

-- Assign final cluster IDs
cluster_final_ids AS (
    SELECT
        ci.user_id,
        ci.cluster_id,
        COALESCE(cr.root_cluster_id, ci.cluster_id) as final_cluster_id
    FROM clusters_initial ci
    LEFT JOIN cluster_roots cr
        ON ci.user_id = cr.user_id
        AND ci.cluster_id = cr.cluster_id
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

-- IMPROVEMENT 17: Home detection from ALL historical overnight data for users in current batch
-- Optimized to only scan data for users in the current batch (via INNER JOIN),
-- but includes all historical data for accurate home detection.
-- This prevents scanning the entire tracker_data table for all users when processing.
home_locations AS (
    SELECT DISTINCT ON (td.user_id)
        td.user_id,
        ST_Centroid(ST_Collect(td.location)) as home_location
    FROM tracker_data td
    INNER JOIN users_to_process utp ON td.user_id = utp.target_user_id
    CROSS JOIN config c
    -- Only scan last 90 days for performance (Phase 6 optimization)
    WHERE td.recorded_at >= CURRENT_DATE - INTERVAL '90 days'
      AND EXTRACT(HOUR FROM td.recorded_at) BETWEEN 0 AND 6  -- Overnight hours
      AND COALESCE(td.speed, 0) < c.home_detection_speed_threshold  -- Exclude transit
    GROUP BY td.user_id,
        -- Spatial grouping (~100m precision for clustering)
        ROUND(ST_X(td.location)::numeric, 3),
        ROUND(ST_Y(td.location)::numeric, 3)
    HAVING COUNT(*) >= c.cluster_min_overnight_points  -- Require significant overnight presence
    ORDER BY td.user_id, COUNT(*) DESC
),

-- Home classification - computed once, used for both name and category (Phase 2)
-- Consolidates duplicate home detection logic
home_classification AS (
    SELECT
        clusters.user_id,
        clusters.final_cluster_id,
        EXISTS (
            SELECT 1
            FROM home_locations hl
            CROSS JOIN config c
            INNER JOIN clusters clusters_inner
                ON clusters_inner.user_id = clusters.user_id
                AND clusters_inner.final_cluster_id = clusters.final_cluster_id
            WHERE hl.user_id = clusters.user_id
              AND ST_Distance(
                  ST_SetSRID(ST_MakePoint(
                      AVG(ST_X(clusters_inner.location)),
                      AVG(ST_Y(clusters_inner.location))
                  ), 4326)::geography,
                  hl.home_location::geography
              ) < c.home_detection_distance
              AND COALESCE(
                  MODE() WITHIN GROUP (ORDER BY clusters_inner.amenity)
                      FILTER (WHERE clusters_inner.amenity IS NOT NULL),
                  MODE() WITHIN GROUP (ORDER BY clusters_inner.nearby_amenity)
                      FILTER (WHERE clusters_inner.nearby_amenity IS NOT NULL)
              ) NOT IN ('restaurant','cafe','bar','pub','fast_food','nightclub',
                        'cinema','theatre','shop','supermarket')
        ) as is_home
    FROM (SELECT DISTINCT user_id, final_cluster_id FROM clusters) clusters
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
    SELECT * FROM (
    -- IMPROVEMENT 16: Visit consolidation for GPS drift
    -- Wrap in WITH to allow merging consecutive same-location visits
    WITH raw_visits AS (
    SELECT
        user_id,
        MIN(recorded_at) as started_at,
        LEAST(
            ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer,
            720
        ) as duration_minutes,
        ST_Centroid(ST_Collect(location)) as location,
        -- IMPROVEMENT 5: Confidence-weighted venue attribution with fallback chain
        -- Use 'Home' as consistent name for home visits to avoid address fragmentation
        CASE
            -- If this is a home visit, use 'Home' (Phase 2: consolidated from home_classification CTE)
            WHEN hc.is_home THEN 'Home'
            -- Otherwise use the normal venue attribution
            ELSE COALESCE(
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
            )
        END as poi_name,
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
        -- IMPROVEMENT 12: Check home location first, with priority-based category assignment
        -- Priority order: home > healthcare > worship > transport > food > entertainment > culture > education > sports > accommodation > outdoors > grocery > shopping > other
        CASE
            -- 1. Home detection (Phase 2: consolidated from home_classification CTE)
            WHEN hc.is_home THEN 'home'
            -- 2. Healthcare BEFORE food (pharmacy shouldn't become burger joint)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('hospital','clinic','doctors','dentist','pharmacy','veterinary','optician') THEN 'healthcare'
            -- 3. Worship BEFORE food (church shouldn't become burger joint due to nearby cuisine tag)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('place_of_worship') THEN 'worship'
            -- 4. Transport BEFORE food (airport shouldn't become cafe)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('bus_station','train_station','airport','ferry_terminal','taxi','car_rental','bicycle_rental','bicycle_parking','parking') THEN 'transport'
            -- 5. Food - ONLY when amenity IS a food place, not just cuisine tag from nearby POI
            -- Phase 5: Removed shop-based food matching to prevent category conflicts
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('restaurant','cafe','bar','pub','fast_food','food_court','biergarten','ice_cream','bakery','deli','juice_bar','confectionery') THEN 'food'
            -- 6. Entertainment
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('cinema','theatre','nightclub','casino','amusement_arcade','bowling_alley') THEN 'entertainment'
            -- 7. Culture
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('museum','gallery','library','arts_centre','community_centre')
                OR COALESCE(
                    MODE() WITHIN GROUP (ORDER BY tourism) FILTER (WHERE tourism IS NOT NULL),
                    MODE() WITHIN GROUP (ORDER BY nearby_tourism) FILTER (WHERE nearby_tourism IS NOT NULL)
                ) = 'museum' THEN 'culture'
            -- 8. Education
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('school','university','college','kindergarten','language_school','music_school','driving_school') THEN 'education'
            -- 9. Sports - only from explicit leisure tag, NOT from nearby_sport to prevent pollution
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY leisure) FILTER (WHERE leisure IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_leisure) FILTER (WHERE nearby_leisure IS NOT NULL)
            ) IN ('golf_course','sports_centre','fitness_centre','swimming_pool','pitch','stadium','tennis','ice_rink') THEN 'sports'
            -- Direct sport tag only (remove nearby_sport to prevent category pollution)
            WHEN MODE() WITHIN GROUP (ORDER BY sport) FILTER (WHERE sport IS NOT NULL) IS NOT NULL THEN 'sports'
            -- 10. Accommodation
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('hotel','hostel','guest_house','motel')
                OR COALESCE(
                    MODE() WITHIN GROUP (ORDER BY tourism) FILTER (WHERE tourism IS NOT NULL),
                    MODE() WITHIN GROUP (ORDER BY nearby_tourism) FILTER (WHERE nearby_tourism IS NOT NULL)
                ) IN ('hotel','hostel','guest_house','motel','apartment') THEN 'accommodation'
            -- 11. Services (utility amenities - check BEFORE shopping/cuisine fallbacks)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('atm','bank','post_office','money_transfer','bureau_de_change','car_wash','fuel','charging_station','toilets','shower','laundry','dry_cleaning','vending_machine') THEN 'services'
            -- 12. Outdoors (leisure tags)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY leisure) FILTER (WHERE leisure IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_leisure) FILTER (WHERE nearby_leisure IS NOT NULL)
            ) IN ('park','garden','nature_reserve','playground','dog_park','beach_resort') THEN 'outdoors'
            -- 12b. Outdoors (amenity tags for outdoor furniture/facilities)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY amenity) FILTER (WHERE amenity IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_amenity) FILTER (WHERE nearby_amenity IS NOT NULL)
            ) IN ('bench','picnic_table','fountain','drinking_water','shelter','viewpoint') THEN 'outdoors'
            -- 13. Grocery
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
            ) IN ('supermarket','convenience','grocery','greengrocer','butcher','farm') THEN 'grocery'
            -- 14. Shopping (any other shop)
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY shop) FILTER (WHERE shop IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_shop) FILTER (WHERE nearby_shop IS NOT NULL)
            ) IS NOT NULL THEN 'shopping'
            -- 15. Fallback: if has cuisine but no other strong category, classify as food
            WHEN COALESCE(
                MODE() WITHIN GROUP (ORDER BY cuisine) FILTER (WHERE cuisine IS NOT NULL),
                MODE() WITHIN GROUP (ORDER BY nearby_cuisine) FILTER (WHERE nearby_cuisine IS NOT NULL)
            ) IS NOT NULL THEN 'food'
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
    LEFT JOIN home_classification hc ON clusters.user_id = hc.user_id AND clusters.final_cluster_id = hc.final_cluster_id
    CROSS JOIN config c
    GROUP BY user_id, final_cluster_id, hc.is_home
    -- IMPROVEMENT 4: Adaptive duration thresholds for sparse tracking
    -- Longer duration = fewer points required (accommodates OwnTracks motion-based tracking)
    HAVING (
           -- Long visits (15+ min): Allow 2+ points (sparse tracking mode)
           (
               EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) >= 900
               AND COUNT(*) >= 2
           )
           -- Medium visits (10-15 min): Require 3+ points
           OR (
               EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) >= 600
               AND COUNT(*) >= 3
           )
           -- Short visits (8-10 min): Require good accuracy + 4+ points (dense tracking only)
           OR (
               EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) >= 480
               AND AVG(COALESCE(accuracy, 50)) <= c.cluster_good_accuracy_threshold
               AND COUNT(*) >= 4
           )
       )
       -- IMPROVEMENT 8: Reject clusters with excessive spread (GPS drift)
       -- True visits should be stationary - use config cluster_max_spread
       AND ST_Distance(
           ST_MakePoint(ST_XMin(ST_Collect(location)), ST_YMin(ST_Collect(location)))::geography,
           ST_MakePoint(ST_XMax(ST_Collect(location)), ST_YMax(ST_Collect(location)))::geography
       ) < c.cluster_max_spread
       -- NOTE: Speed filter removed - GPS-derived speed data is unreliable
       -- (83% of Vietnam trip points had avg_speed > 2 m/s due to erroneous data)
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
       -- IMPROVEMENT 10: Distance filter for nearby POI attribution
       -- Phase 7: Increased to 75m for better coverage while maintaining accuracy
       AND (
           -- Direct geocode (venue layer) is always OK (distance ~0)
           MODE() WITHIN GROUP (ORDER BY layer) FILTER (WHERE layer = 'venue') IS NOT NULL
           -- For nearby POIs, require average distance <= 75m
           OR COALESCE(AVG(nearby_distance) FILTER (WHERE nearby_distance IS NOT NULL), 0) <= c.poi_nearby_accept_max_distance
       )
       -- IMPROVEMENT 14: Confidence threshold for POI attribution
       -- Require minimum confidence to avoid low-quality matches
       AND COALESCE(
           AVG(confidence) FILTER (WHERE confidence IS NOT NULL),
           AVG(nearby_confidence) FILTER (WHERE nearby_confidence IS NOT NULL),
           0
       ) >= c.poi_min_confidence_threshold
    ), -- end raw_visits

    -- Step 1: Mark visits that should merge with previous (same category, close in time/space)
    marked_visits AS (
        SELECT *,
            CASE WHEN
                -- Same user as previous
                user_id = LAG(user_id) OVER w
                -- Same category
                AND poi_category = LAG(poi_category) OVER w
                -- Gap < 60 min between end of previous visit and start of this one
                AND EXTRACT(EPOCH FROM (
                    started_at - (LAG(started_at) OVER w + (LAG(duration_minutes) OVER w || ' minutes')::interval)
                )) < 3600
                -- Centroids within 150m
                AND ST_Distance(
                    location::geography,
                    LAG(location) OVER w::geography
                ) < 150
            THEN 0 ELSE 1 END as new_group
        FROM raw_visits
        WINDOW w AS (PARTITION BY user_id ORDER BY started_at)
    ),

    -- Step 2: Assign merge group IDs
    grouped_visits AS (
        SELECT *,
            SUM(new_group) OVER (PARTITION BY user_id ORDER BY started_at) as merge_group
        FROM marked_visits
    ),

    -- Step 3: Consolidate groups into single visits
    consolidated AS (
        SELECT
            user_id,
            MIN(started_at) as started_at,
            -- Duration: from first start to last end
            GREATEST(
                ROUND(EXTRACT(EPOCH FROM (
                    MAX(started_at + (duration_minutes || ' minutes')::interval) - MIN(started_at)
                )) / 60)::integer,
                1
            ) as duration_minutes,
            -- Use centroid of all locations
            ST_Centroid(ST_Collect(location)) as location,
            -- Use 'Home' if any visit is home, otherwise first poi_name
            CASE WHEN bool_or(poi_name = 'Home') THEN 'Home'
                 ELSE (array_agg(poi_name ORDER BY started_at))[1] END as poi_name,
            (array_agg(poi_layer ORDER BY started_at))[1] as poi_layer,
            (array_agg(poi_amenity ORDER BY started_at))[1] as poi_amenity,
            (array_agg(poi_cuisine ORDER BY started_at))[1] as poi_cuisine,
            (array_agg(poi_sport ORDER BY started_at))[1] as poi_sport,
            (array_agg(poi_category ORDER BY started_at))[1] as poi_category,
            ROUND(AVG(confidence_score)::numeric, 3) as confidence_score,
            ROUND(AVG(avg_distance_meters)::numeric, 2) as avg_distance_meters,
            (array_agg(poi_tags ORDER BY started_at))[1] as poi_tags,
            (array_agg(city ORDER BY started_at))[1] as city,
            (array_agg(country_code ORDER BY started_at))[1] as country_code,
            SUM(gps_points_count) as gps_points_count,
            -- Recalculate time fields from consolidated start time
            EXTRACT(HOUR FROM MIN(started_at))::integer as visit_hour,
            CASE
                WHEN EXTRACT(HOUR FROM MIN(started_at)) BETWEEN 5 AND 11 THEN 'morning'
                WHEN EXTRACT(HOUR FROM MIN(started_at)) BETWEEN 12 AND 17 THEN 'afternoon'
                WHEN EXTRACT(HOUR FROM MIN(started_at)) BETWEEN 18 AND 21 THEN 'evening'
                ELSE 'night'
            END as visit_time_of_day,
            TO_CHAR(MIN(started_at), 'Day') as day_of_week,
            EXTRACT(DOW FROM MIN(started_at)) IN (0, 6) as is_weekend,
            -- Recalculate duration category
            CASE
                WHEN ROUND(EXTRACT(EPOCH FROM (
                    MAX(started_at + (duration_minutes || ' minutes')::interval) - MIN(started_at)
                )) / 60) < 30 THEN 'quick'
                WHEN ROUND(EXTRACT(EPOCH FROM (
                    MAX(started_at + (duration_minutes || ' minutes')::interval) - MIN(started_at)
                )) / 60) < 120 THEN 'medium'
                ELSE 'long'
            END as duration_category,
            -- Combine search vectors
            (array_agg(poi_name_search ORDER BY started_at))[1] as poi_name_search,
            -- Alt POI from first visit
            (array_agg(alt_poi_name ORDER BY started_at))[1] as alt_poi_name,
            (array_agg(alt_poi_amenity ORDER BY started_at))[1] as alt_poi_amenity,
            (array_agg(alt_poi_cuisine ORDER BY started_at))[1] as alt_poi_cuisine,
            (array_agg(alt_poi_sport ORDER BY started_at))[1] as alt_poi_sport,
            (array_agg(alt_poi_distance ORDER BY started_at))[1] as alt_poi_distance,
            (array_agg(alt_poi_tags ORDER BY started_at))[1] as alt_poi_tags,
            (array_agg(alt_poi_confidence ORDER BY started_at))[1] as alt_poi_confidence
        FROM grouped_visits
        GROUP BY user_id, merge_group
    )

    SELECT * FROM consolidated
    ) AS aggregated
    -- IMPROVEMENT 15: Category-specific duration thresholds
    -- Different POI types have different expected visit durations
    WHERE CASE
        -- Services (ATM, toilets): quick transactions, 3+ min
        WHEN poi_category = 'services' THEN duration_minutes >= 3
        -- Transport (parking, station): brief stops, 5+ min
        WHEN poi_category = 'transport' THEN duration_minutes >= 5
        -- Grocery/shopping: quick shopping, 10+ min
        WHEN poi_category IN ('grocery', 'shopping') THEN duration_minutes >= 10
        -- Food (restaurant, cafe): seated dining, 15+ min
        WHEN poi_category = 'food' THEN duration_minutes >= 15
        -- Entertainment/culture/sports: extended activities, 20+ min
        WHEN poi_category IN ('entertainment', 'culture', 'sports', 'education') THEN duration_minutes >= 20
        -- Home: actual stays, 30+ min
        WHEN poi_category = 'home' THEN duration_minutes >= 30
        -- Healthcare: variable, 10+ min
        WHEN poi_category = 'healthcare' THEN duration_minutes >= 10
        -- Worship: services/visits, 15+ min
        WHEN poi_category = 'worship' THEN duration_minutes >= 15
        -- Accommodation: hotel stays, 60+ min
        WHEN poi_category = 'accommodation' THEN duration_minutes >= 60
        -- Outdoors: variable, 10+ min
        WHEN poi_category = 'outdoors' THEN duration_minutes >= 10
        -- Default: 8+ min
        ELSE duration_minutes >= 8
    END
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
