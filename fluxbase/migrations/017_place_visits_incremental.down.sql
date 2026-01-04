--
-- Migration: 017_place_visits_incremental.down.sql
-- Description: Revert place_visits table back to materialized view
-- WARNING: This will delete all place_visits data!
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET search_path TO public;

-- =============================================================================
-- Step 1: Drop views
-- =============================================================================

DROP VIEW IF EXISTS "public"."my_place_visits" CASCADE;
DROP VIEW IF EXISTS "public"."my_poi_summary" CASCADE;

-- =============================================================================
-- Step 2: Drop policies
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own place_visits" ON "public"."place_visits";
DROP POLICY IF EXISTS "Service role full access to place_visits" ON "public"."place_visits";
DROP POLICY IF EXISTS "Admin users full access to place_visits" ON "public"."place_visits";

DROP POLICY IF EXISTS "Service role full access to place_visits_state" ON "public"."place_visits_state";
DROP POLICY IF EXISTS "Admin users full access to place_visits_state" ON "public"."place_visits_state";

-- =============================================================================
-- Step 3: Drop tables
-- =============================================================================

DROP TABLE IF EXISTS "public"."place_visits" CASCADE;
DROP TABLE IF EXISTS "public"."place_visits_state" CASCADE;

-- =============================================================================
-- Step 4: Recreate original materialized view (basic structure)
-- =============================================================================

-- Note: The original materialized view definition would need to be restored here
-- This is a placeholder - the actual view definition depends on the pre-017 state
CREATE MATERIALIZED VIEW "public"."place_visits" AS
SELECT
    gen_random_uuid() as id,
    td.user_id,
    td.recorded_at as started_at,
    0 as duration_minutes,
    td.location,
    td.geocode->'properties'->'addendum'->'osm'->>'name' as poi_name,
    td.geocode->'properties'->>'layer' as poi_layer,
    td.geocode->'properties'->'addendum'->'osm'->>'amenity' as poi_amenity,
    td.geocode->'properties'->'addendum'->'osm'->>'cuisine' as poi_cuisine,
    td.geocode->'properties'->'addendum'->'osm'->>'sport' as poi_sport,
    'other'::text as poi_category,
    (td.geocode->'properties'->>'confidence')::numeric as confidence_score,
    0::numeric as avg_distance_meters,
    td.geocode->'properties'->'addendum'->'osm' as poi_tags,
    COALESCE(
        td.geocode->'properties'->>'locality',
        td.geocode->'properties'->'address'->>'city'
    ) as city,
    td.country_code,
    1 as gps_points_count,
    EXTRACT(HOUR FROM td.recorded_at)::integer as visit_hour,
    'other'::text as visit_time_of_day,
    TRIM(LOWER(TO_CHAR(td.recorded_at, 'day'))) as day_of_week,
    EXTRACT(DOW FROM td.recorded_at) IN (0, 6) as is_weekend,
    'short'::text as duration_category,
    to_tsvector('simple', COALESCE(td.geocode->'properties'->'addendum'->'osm'->>'name', '')) as poi_name_search,
    NULL::text as alt_poi_name,
    NULL::text as alt_poi_amenity,
    NULL::text as alt_poi_cuisine,
    NULL::text as alt_poi_sport,
    NULL::numeric as alt_poi_distance,
    NULL::jsonb as alt_poi_tags,
    NULL::numeric as alt_poi_confidence,
    NOW() as created_at,
    NOW() as updated_at
FROM "public"."tracker_data" td
WHERE td.geocode->'properties'->'addendum'->'osm'->>'name' IS NOT NULL
LIMIT 0; -- Empty view, needs to be refreshed

-- Create indexes on the materialized view
CREATE INDEX IF NOT EXISTS "place_visits_user_id_idx" ON "public"."place_visits" (user_id);
CREATE INDEX IF NOT EXISTS "place_visits_started_at_idx" ON "public"."place_visits" (started_at DESC);

-- Create the old refresh function
CREATE OR REPLACE FUNCTION "public"."refresh_place_visits"()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW "public"."place_visits";
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."refresh_place_visits" TO service_role;
