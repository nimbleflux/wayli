--
-- Migration: 011_place_visits_materialized_view.up.sql
-- Description: Replace place_visits table with materialized view detecting POI visits
--              using dual-source detection (primary venue + nearby_pois fallback)
-- Dependencies: 003_tables_views.up.sql, 010_place_visits_ai_config.up.sql
-- Author: Wayli Migration System
-- Created: 2025-12-09
-- Updated: 2025-12-10 (dual-source detection, computed columns, summary view)
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- =============================================================================
-- Step 1: Drop existing place_visits table and dependent objects
-- =============================================================================

-- Drop the secure views first (depends on place_visits)
DROP VIEW IF EXISTS "public"."my_place_visits" CASCADE;
DROP VIEW IF EXISTS "public"."my_poi_summary" CASCADE;

-- Drop RLS policies
DROP POLICY IF EXISTS "place_visits_select_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_insert_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_update_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_delete_own" ON "public"."place_visits";

-- Drop the table/materialized view
DROP MATERIALIZED VIEW IF EXISTS "public"."place_visits" CASCADE;
DROP TABLE IF EXISTS "public"."place_visits" CASCADE;

-- =============================================================================
-- Step 2: Create the materialized view for POI visits
-- Uses dual-source detection:
--   1. PRIMARY: geocode->properties when layer is 'venue' (user is AT the venue)
--   2. FALLBACK: nearby_pois array when primary isn't a venue
-- =============================================================================

CREATE MATERIALIZED VIEW "public"."place_visits" AS
WITH venue_points AS (
    -- SOURCE 1: Primary venue from geocode result (user is AT this place)
    -- This is the actual venue Pelias identified for the GPS point
    SELECT
        td.user_id,
        td.recorded_at,
        td.location,
        -- City/country: Try multiple sources in order of preference
        COALESCE(
            td.geocode->'properties'->>'locality',
            td.geocode->'properties'->'address'->>'city',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:city'
        ) as city,
        COALESCE(
            td.geocode->'properties'->>'country',
            td.geocode->'properties'->'address'->>'country',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:country'
        ) as country,
        td.country_code,
        -- POI name is in addendum->osm->name for primary results
        td.geocode->'properties'->'addendum'->'osm'->>'name' as poi_name,
        NULL::text as poi_osm_id,  -- Primary result doesn't have osm_id in same format
        td.geocode->'properties'->>'layer' as poi_layer,
        -- Extract OSM tags from primary result
        td.geocode->'properties'->'addendum'->'osm'->>'amenity' as osm_amenity,
        td.geocode->'properties'->'addendum'->'osm'->>'leisure' as osm_leisure,
        td.geocode->'properties'->'addendum'->'osm'->>'tourism' as osm_tourism,
        td.geocode->'properties'->'addendum'->'osm'->>'shop' as osm_shop,
        td.geocode->'properties'->'addendum'->'osm'->>'sport' as osm_sport,
        td.geocode->'properties'->'addendum'->'osm'->>'cuisine' as poi_cuisine,
        td.geocode->'properties'->'addendum'->'osm' as poi_tags,
        (td.geocode->'properties'->>'confidence')::numeric as poi_confidence,
        0::numeric as poi_distance,  -- User is AT the venue, distance = 0
        'primary' as source
    FROM "public"."tracker_data" td
    WHERE td.geocode->'properties'->'addendum'->'osm'->>'name' IS NOT NULL
      AND td.geocode->'properties'->>'layer' IN ('venue', 'address')
      -- Must have at least one OSM venue tag
      AND (
          td.geocode->'properties'->'addendum'->'osm'->>'amenity' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'leisure' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'tourism' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'shop' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'sport' IS NOT NULL
      )

    UNION ALL

    -- SOURCE 2: Nearby POIs (fallback when primary isn't a venue)
    SELECT
        td.user_id,
        td.recorded_at,
        td.location,
        -- City/country from main geocode (nearby_pois don't have address info)
        COALESCE(
            td.geocode->'properties'->>'locality',
            td.geocode->'properties'->'address'->>'city',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:city'
        ) as city,
        COALESCE(
            td.geocode->'properties'->>'country',
            td.geocode->'properties'->'address'->>'country',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:country'
        ) as country,
        td.country_code,
        poi->>'name' as poi_name,
        poi->>'osm_id' as poi_osm_id,
        poi->>'layer' as poi_layer,
        poi->'addendum'->'osm'->>'amenity' as osm_amenity,
        poi->'addendum'->'osm'->>'leisure' as osm_leisure,
        poi->'addendum'->'osm'->>'tourism' as osm_tourism,
        poi->'addendum'->'osm'->>'shop' as osm_shop,
        poi->'addendum'->'osm'->>'sport' as osm_sport,
        poi->'addendum'->'osm'->>'cuisine' as poi_cuisine,
        poi->'addendum'->'osm' as poi_tags,
        COALESCE((poi->>'confidence')::numeric, 0.8) as poi_confidence,
        (poi->>'distance_meters')::numeric as poi_distance,
        'nearby_pois' as source
    FROM "public"."tracker_data" td,
    LATERAL jsonb_array_elements(td.geocode->'properties'->'nearby_pois') AS poi
    WHERE poi->>'name' IS NOT NULL
      AND (poi->>'distance_meters')::numeric < 75  -- Relaxed from 50m to 75m
      -- Only use nearby_pois when primary result is NOT a venue with OSM tags
      AND NOT (
          td.geocode->'properties'->>'layer' IN ('venue', 'address')
          AND (
              td.geocode->'properties'->'addendum'->'osm'->>'amenity' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'leisure' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'tourism' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'shop' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'sport' IS NOT NULL
          )
      )
),
deduplicated AS (
    -- Deduplicate: prefer primary source over nearby_pois, then closest distance
    SELECT *,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, recorded_at
            ORDER BY (source = 'primary') DESC, poi_distance ASC
        ) as rn
    FROM venue_points
),
poi_points AS (
    -- Keep only the best match per user/timestamp
    SELECT
        user_id,
        recorded_at,
        location,
        city,
        country,
        country_code,
        poi_name,
        poi_osm_id,
        poi_layer,
        -- Derive poi_amenity from OSM tags
        COALESCE(osm_amenity, osm_leisure, osm_tourism, osm_shop) as poi_amenity,
        poi_cuisine,
        osm_sport as poi_sport,
        -- Derive category with expanded mappings
        CASE
            -- Food & Drink
            WHEN osm_amenity IN ('restaurant','cafe','bar','pub','fast_food','food_court','biergarten','ice_cream','bakery') THEN 'food'
            -- Entertainment
            WHEN osm_amenity IN ('cinema','theatre','nightclub','casino','amusement_arcade','bowling_alley') THEN 'entertainment'
            -- Culture
            WHEN osm_amenity IN ('museum','gallery','library','arts_centre','community_centre') OR osm_tourism = 'museum' THEN 'culture'
            -- Education
            WHEN osm_amenity IN ('school','university','college','kindergarten','language_school','music_school','driving_school') THEN 'education'
            -- Sports & Fitness
            WHEN osm_leisure IN ('golf_course','sports_centre','fitness_centre','swimming_pool','pitch','stadium','tennis','ice_rink') THEN 'sports'
            WHEN osm_sport IS NOT NULL THEN 'sports'
            -- Accommodation
            WHEN osm_amenity IN ('hotel','hostel','guest_house','motel') OR osm_tourism IN ('hotel','hostel','guest_house','motel','apartment') THEN 'accommodation'
            -- Healthcare
            WHEN osm_amenity IN ('hospital','clinic','doctors','dentist','pharmacy','veterinary','optician') THEN 'healthcare'
            -- Religious/Worship
            WHEN osm_amenity IN ('place_of_worship') THEN 'worship'
            -- Outdoors/Parks
            WHEN osm_leisure IN ('park','garden','nature_reserve','playground','dog_park','beach_resort') THEN 'outdoors'
            -- Grocery
            WHEN osm_shop IN ('supermarket','convenience','grocery','greengrocer','butcher','bakery','deli') THEN 'grocery'
            -- Transport
            WHEN osm_amenity IN ('bus_station','train_station','airport','ferry_terminal','taxi','car_rental') THEN 'transport'
            -- Shopping (catch-all for other shops)
            WHEN osm_shop IS NOT NULL THEN 'shopping'
            ELSE 'other'
        END as poi_category,
        poi_confidence,
        poi_distance,
        poi_tags,
        source
    FROM deduplicated
    WHERE rn = 1
),
with_boundaries AS (
    -- Detect visit boundaries using LAG
    -- A new visit starts when:
    --   1. POI name changes
    --   2. Gap > 30 minutes since last point
    --   3. First point for user
    SELECT *,
        CASE WHEN
            poi_name IS DISTINCT FROM LAG(poi_name) OVER (PARTITION BY user_id ORDER BY recorded_at)
            OR recorded_at - LAG(recorded_at) OVER (PARTITION BY user_id ORDER BY recorded_at) > INTERVAL '30 minutes'
            OR LAG(poi_name) OVER (PARTITION BY user_id ORDER BY recorded_at) IS NULL
        THEN 1 ELSE 0 END as new_visit
    FROM poi_points
),
visit_groups AS (
    -- Create visit group IDs by cumulative sum of new_visit flags
    SELECT *,
        SUM(new_visit) OVER (PARTITION BY user_id ORDER BY recorded_at) as visit_id
    FROM with_boundaries
)
-- Aggregate GPS points into visits with computed columns
SELECT
    gen_random_uuid() as id,
    user_id,
    MIN(recorded_at) as started_at,
    MAX(recorded_at) as ended_at,
    ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer as duration_minutes,
    ST_Centroid(ST_Collect(location)) as location,
    poi_name,
    MODE() WITHIN GROUP (ORDER BY poi_osm_id) as poi_osm_id,
    MODE() WITHIN GROUP (ORDER BY poi_layer) as poi_layer,
    MODE() WITHIN GROUP (ORDER BY poi_amenity) as poi_amenity,
    MODE() WITHIN GROUP (ORDER BY poi_cuisine) as poi_cuisine,
    MODE() WITHIN GROUP (ORDER BY poi_sport) as poi_sport,
    MODE() WITHIN GROUP (ORDER BY poi_category) as poi_category,
    ROUND(AVG(poi_confidence)::numeric, 3) as confidence_score,
    ROUND(AVG(poi_distance)::numeric, 2) as avg_distance_meters,
    MODE() WITHIN GROUP (ORDER BY poi_tags::text)::jsonb as poi_tags,
    MODE() WITHIN GROUP (ORDER BY city) as city,
    MODE() WITHIN GROUP (ORDER BY country) as country,
    MODE() WITHIN GROUP (ORDER BY country_code) as country_code,
    COUNT(*)::integer as gps_points_count,
    -- NEW: Computed columns for easy querying
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
    -- Full-text search column
    to_tsvector('simple', COALESCE(poi_name, '')) as poi_name_search,
    NOW() as created_at
FROM visit_groups
GROUP BY user_id, visit_id, poi_name
HAVING COUNT(*) >= 2  -- At least 2 GPS points to be a valid visit
   AND ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer >= 15  -- At least 15 minutes for actual visits
ORDER BY user_id, MIN(recorded_at);

COMMENT ON MATERIALIZED VIEW "public"."place_visits" IS 'Detected POI visits using dual-source detection (primary venue + nearby_pois). Refreshed hourly.';

-- =============================================================================
-- Step 3: Create indexes for performance
-- =============================================================================

-- Primary lookup index
CREATE INDEX "idx_place_visits_user_started" ON "public"."place_visits" ("user_id", "started_at" DESC);

-- POI name index for searching
CREATE INDEX "idx_place_visits_poi_name" ON "public"."place_visits" ("poi_name") WHERE "poi_name" IS NOT NULL;

-- Category indexes for filtering
CREATE INDEX "idx_place_visits_poi_amenity" ON "public"."place_visits" ("poi_amenity") WHERE "poi_amenity" IS NOT NULL;
CREATE INDEX "idx_place_visits_poi_category" ON "public"."place_visits" ("poi_category") WHERE "poi_category" IS NOT NULL;
CREATE INDEX "idx_place_visits_poi_cuisine" ON "public"."place_visits" ("poi_cuisine") WHERE "poi_cuisine" IS NOT NULL;
CREATE INDEX "idx_place_visits_poi_sport" ON "public"."place_visits" ("poi_sport") WHERE "poi_sport" IS NOT NULL;

-- Location index for spatial queries
CREATE INDEX "idx_place_visits_location" ON "public"."place_visits" USING GIST ("location");

-- JSONB index for complex tag queries
CREATE INDEX "idx_place_visits_poi_tags" ON "public"."place_visits" USING GIN ("poi_tags");

-- Country/city indexes
CREATE INDEX "idx_place_visits_country" ON "public"."place_visits" ("country_code", "started_at" DESC);
CREATE INDEX "idx_place_visits_city" ON "public"."place_visits" ("city", "started_at" DESC) WHERE "city" IS NOT NULL;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX "idx_place_visits_unique" ON "public"."place_visits" ("id");

-- NEW: Time-based indexes for computed columns
CREATE INDEX "idx_place_visits_time_of_day" ON "public"."place_visits" ("visit_time_of_day", "started_at" DESC);
CREATE INDEX "idx_place_visits_day_of_week" ON "public"."place_visits" ("day_of_week", "started_at" DESC);
CREATE INDEX "idx_place_visits_weekend" ON "public"."place_visits" ("is_weekend", "started_at" DESC) WHERE "is_weekend" = true;
CREATE INDEX "idx_place_visits_duration_category" ON "public"."place_visits" ("duration_category");

-- NEW: Full-text search index
CREATE INDEX "idx_place_visits_fts" ON "public"."place_visits" USING GIN ("poi_name_search");

-- =============================================================================
-- Step 4: Set ownership (RLS not supported on materialized views)
-- =============================================================================

ALTER MATERIALIZED VIEW "public"."place_visits" OWNER TO postgres;

-- NOTE: Materialized views do NOT support Row Level Security in PostgreSQL.
-- Access control is enforced via the my_place_visits secure view which filters by auth.uid().
-- Direct access to place_visits should only be granted to service_role.

-- =============================================================================
-- Step 5: Create secure view for LLM queries
-- =============================================================================

-- security_barrier=true prevents optimization leaks, no security_invoker means it runs as owner (postgres)
-- This allows authenticated users to query via the view even without direct access to place_visits
CREATE OR REPLACE VIEW "public"."my_place_visits"
WITH (security_barrier = true)
AS
SELECT
    id,
    started_at,
    ended_at,
    duration_minutes,
    ST_X(location::geometry) as longitude,
    ST_Y(location::geometry) as latitude,
    poi_name,
    poi_osm_id,
    poi_layer,
    poi_amenity,
    poi_cuisine,
    poi_sport,
    poi_category,
    confidence_score,
    avg_distance_meters,
    poi_tags,
    city,
    country,
    country_code,
    gps_points_count,
    -- NEW: Computed columns
    visit_hour,
    visit_time_of_day,
    day_of_week,
    is_weekend,
    duration_category,
    created_at
FROM "public"."place_visits"
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_place_visits" IS 'Secure view of place_visits filtered to current user. Use this for LLM queries.';

-- =============================================================================
-- Step 6: Create POI summary view for aggregated statistics
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_poi_summary"
WITH (security_barrier = true)
AS
SELECT
    poi_name,
    poi_amenity,
    poi_category,
    city,
    country,
    COUNT(*)::integer as visit_count,
    MIN(started_at) as first_visit,
    MAX(started_at) as last_visit,
    ROUND(AVG(duration_minutes))::integer as avg_duration_minutes,
    SUM(duration_minutes)::integer as total_duration_minutes
FROM "public"."place_visits"
WHERE user_id = auth.uid()
GROUP BY poi_name, poi_amenity, poi_category, city, country;

COMMENT ON VIEW "public"."my_poi_summary" IS 'Aggregated POI visit statistics per user. Use for "most visited", "how many times" questions.';

-- =============================================================================
-- Step 7: Create refresh function
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."refresh_place_visits"()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."place_visits";
$$;

COMMENT ON FUNCTION "public"."refresh_place_visits"() IS 'Refreshes the place_visits materialized view. Call hourly via job scheduler.';

-- =============================================================================
-- Step 8: Grant permissions
-- =============================================================================

-- Grant SELECT on materialized view to service_role only (no RLS, so no direct user access)
GRANT SELECT ON "public"."place_visits" TO service_role;

-- Grant SELECT on secure views to authenticated users (this is how users access visit data)
GRANT SELECT ON "public"."my_place_visits" TO authenticated;
GRANT SELECT ON "public"."my_poi_summary" TO authenticated;

-- Grant execute on refresh function to service_role only
GRANT EXECUTE ON FUNCTION "public"."refresh_place_visits"() TO service_role;

-- =============================================================================
-- Step 9: Update execute_user_query to allow my_poi_summary view
-- =============================================================================

-- Recreate the function with my_poi_summary added to the whitelist
CREATE OR REPLACE FUNCTION "public"."execute_user_query"(
    query_sql TEXT,
    query_user_id UUID,
    max_rows INTEGER DEFAULT 100,
    timeout_ms INTEGER DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    result JSONB;
    safe_sql TEXT;
    stripped_sql TEXT;
    lower_sql TEXT;
    row_count INTEGER;
BEGIN
    -- LAYER 6: User identity verification
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF auth.uid() != query_user_id THEN
        RAISE EXCEPTION 'User identity mismatch';
    END IF;

    -- LAYER 7: Resource limits
    EXECUTE format('SET LOCAL statement_timeout = %L', timeout_ms);

    -- LAYER 4: Force read-only mode
    SET LOCAL transaction_read_only = ON;

    -- Input validation
    IF query_sql IS NULL OR LENGTH(TRIM(query_sql)) < 10 THEN
        RAISE EXCEPTION 'Query SQL is too short or empty';
    END IF;

    IF max_rows < 1 OR max_rows > 1000 THEN
        RAISE EXCEPTION 'max_rows must be between 1 and 1000';
    END IF;

    -- LAYER 1: String validation - strip comments
    stripped_sql := strip_sql_comments(query_sql);
    lower_sql := LOWER(stripped_sql);

    -- Must start with SELECT
    IF NOT (UPPER(stripped_sql) ~ '^\s*SELECT\b') THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Block ALL write operations
    IF UPPER(stripped_sql) ~ '\m(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|ANALYZE|CLUSTER|REINDEX|LOCK|REFRESH|NOTIFY|LISTEN|UNLISTEN|PREPARE|EXECUTE|DEALLOCATE)\M' THEN
        RAISE EXCEPTION 'Write operations are not allowed';
    END IF;

    -- Block dangerous functions
    IF UPPER(stripped_sql) ~ '\m(PG_SLEEP|PG_READ_FILE|PG_WRITE_FILE|PG_READ_BINARY_FILE|LO_IMPORT|LO_EXPORT|LO_CREATE|LO_UNLINK|DBLINK|DBLINK_CONNECT|DBLINK_EXEC|CURRENT_SETTING|SET_CONFIG|PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_RELOAD_CONF|PG_ROTATE_LOGFILE|PG_SWITCH_WAL)\M' THEN
        RAISE EXCEPTION 'Forbidden SQL function detected';
    END IF;

    -- Block ALL SET commands
    IF UPPER(stripped_sql) ~ '\mSET\s+' THEN
        RAISE EXCEPTION 'SET commands are not allowed';
    END IF;

    -- Block system catalog access
    IF lower_sql ~ '\m(pg_catalog|information_schema|pg_class|pg_proc|pg_roles|pg_user|pg_shadow|pg_authid|pg_auth_members)\M' THEN
        RAISE EXCEPTION 'System catalog access is not allowed';
    END IF;

    -- Block auth schema access
    IF lower_sql ~ '\mauth\.' THEN
        RAISE EXCEPTION 'Auth schema access is not allowed';
    END IF;

    -- LAYER 2: Table whitelist - ONLY secure views allowed
    -- Block direct access to base tables
    IF lower_sql ~ '\mplace_visits\M' AND lower_sql !~ '\mmy_place_visits\M' AND lower_sql !~ '\mmy_poi_summary\M' THEN
        RAISE EXCEPTION 'Direct table access not allowed. Use my_place_visits or my_poi_summary views instead.';
    END IF;

    IF lower_sql ~ '\mtracker_data\M' AND lower_sql !~ '\mmy_tracker_data\M' THEN
        RAISE EXCEPTION 'Direct table access not allowed. Use my_tracker_data view instead.';
    END IF;

    IF lower_sql ~ '\mtrips\M' AND lower_sql !~ '\mmy_trips\M' THEN
        RAISE EXCEPTION 'Direct table access not allowed. Use my_trips view instead.';
    END IF;

    -- Block access to sensitive tables
    IF lower_sql ~ '\m(ai_config|user_preferences|rate_limits|query_feedback|users|auth_users|sessions)\M' THEN
        RAISE EXCEPTION 'Access to this table is not allowed';
    END IF;

    -- Verify query uses ONLY allowed views (UPDATED: added my_poi_summary)
    IF NOT (lower_sql ~ '\mmy_place_visits\M' OR lower_sql ~ '\mmy_tracker_data\M' OR lower_sql ~ '\mmy_trips\M' OR lower_sql ~ '\mmy_poi_summary\M') THEN
        RAISE EXCEPTION 'Query must use my_place_visits, my_poi_summary, my_tracker_data, or my_trips views';
    END IF;

    -- Query rewriting
    safe_sql := stripped_sql;

    -- Remove any user_id references (views handle this automatically)
    safe_sql := regexp_replace(safe_sql, 'WHERE\s+user_id\s*=\s*\$1\s*(AND\s+)?', 'WHERE ', 'gi');
    safe_sql := regexp_replace(safe_sql, '\s+AND\s+user_id\s*=\s*\$1', '', 'gi');
    safe_sql := regexp_replace(safe_sql, 'user_id\s*=\s*\$1\s*(AND\s+)?', '', 'gi');

    -- Clean up orphaned WHERE clauses
    safe_sql := regexp_replace(safe_sql, 'WHERE\s+(ORDER|GROUP|LIMIT|$)', '\1', 'gi');
    safe_sql := regexp_replace(safe_sql, 'WHERE\s*$', '', 'gi');

    -- Add LIMIT if not present
    IF NOT (UPPER(safe_sql) ~ '\mLIMIT\s+\d+') THEN
        safe_sql := safe_sql || ' LIMIT ' || max_rows;
    END IF;

    -- Clean up whitespace
    safe_sql := regexp_replace(safe_sql, '\s+', ' ', 'g');
    safe_sql := TRIM(safe_sql);

    -- Execute query (views + RLS provide final security)
    BEGIN
        EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', safe_sql)
        INTO result;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'Permission denied';
        WHEN undefined_table THEN
            RAISE EXCEPTION 'Table or view does not exist';
        WHEN undefined_column THEN
            RAISE EXCEPTION 'Column does not exist';
    END;

    -- Logging (no sensitive data)
    SELECT jsonb_array_length(result) INTO row_count;
    RAISE NOTICE 'execute_user_query: user=%, rows=%', query_user_id, row_count;

    RETURN result;

EXCEPTION
    WHEN query_canceled THEN
        RAISE EXCEPTION 'Query execution timed out';
    WHEN read_only_sql_transaction THEN
        RAISE EXCEPTION 'Write operations are not allowed';
    WHEN OTHERS THEN
        RAISE WARNING 'execute_user_query error: %', SQLERRM;
        RAISE EXCEPTION 'Query execution failed: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION "public"."execute_user_query"(TEXT, UUID, INTEGER, INTEGER) IS 'Safely executes LLM-generated queries using secure views. Allows my_place_visits, my_poi_summary, my_tracker_data, my_trips.';
