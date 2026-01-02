--
-- Migration: 017_place_visits_incremental.up.sql
-- Description: Create place_visits table for incremental POI visit detection
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
-- Step 1: Create place_visits_state table to track incremental refresh state
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."place_visits_state" (
    "id" integer PRIMARY KEY DEFAULT 1,
    "last_processed_at" timestamp with time zone,
    "last_full_refresh_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "place_visits_state_singleton" CHECK (id = 1)
);

INSERT INTO "public"."place_visits_state" (id, last_processed_at, last_full_refresh_at)
VALUES (1, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE "public"."place_visits_state" IS 'Tracks the last incremental refresh timestamp for place_visits';

-- =============================================================================
-- Step 2: Create place_visits table (regular table, not materialized view)
-- =============================================================================

-- First, save existing data if the materialized view exists
CREATE TEMP TABLE place_visits_backup AS
SELECT * FROM "public"."place_visits" WHERE false; -- Just schema, no data initially

DO $$
BEGIN
    -- Try to backup existing data
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'place_visits' AND schemaname = 'public') THEN
        EXECUTE 'INSERT INTO place_visits_backup SELECT * FROM "public"."place_visits"';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not backup place_visits data: %', SQLERRM;
END $$;

-- Drop the materialized view and dependent views
DROP VIEW IF EXISTS "public"."my_place_visits" CASCADE;
DROP VIEW IF EXISTS "public"."my_poi_summary" CASCADE;

-- Drop materialized view only if it exists as a matview (idempotent)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'place_visits' AND schemaname = 'public') THEN
        DROP MATERIALIZED VIEW "public"."place_visits" CASCADE;
    END IF;
END $$;

-- Create the new table
CREATE TABLE IF NOT EXISTS "public"."place_visits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "user_id" uuid NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "duration_minutes" integer,
    "location" geometry(Point, 4326),
    "poi_name" text,
    "poi_layer" text,
    "poi_amenity" text,
    "poi_cuisine" text,
    "poi_sport" text,
    "poi_category" text,
    "confidence_score" numeric(5,3),
    "avg_distance_meters" numeric(8,2),
    "poi_tags" jsonb,
    "city" text,
    "country_code" varchar(2),
    "gps_points_count" integer,
    "visit_hour" integer,
    "visit_time_of_day" text,
    "day_of_week" text,
    "is_weekend" boolean,
    "duration_category" text,
    "poi_name_search" tsvector,
    "alt_poi_name" text,
    "alt_poi_amenity" text,
    "alt_poi_cuisine" text,
    "alt_poi_sport" text,
    "alt_poi_distance" numeric(8,2),
    "alt_poi_tags" jsonb,
    "alt_poi_confidence" numeric(5,3),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    -- Add constraint for upsert conflict resolution
    CONSTRAINT "place_visits_unique_visit" UNIQUE (user_id, started_at, poi_name)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "place_visits_user_id_idx" ON "public"."place_visits" (user_id);
CREATE INDEX IF NOT EXISTS "place_visits_started_at_idx" ON "public"."place_visits" (started_at DESC);
CREATE INDEX IF NOT EXISTS "place_visits_user_started_idx" ON "public"."place_visits" (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS "place_visits_poi_category_idx" ON "public"."place_visits" (poi_category);
CREATE INDEX IF NOT EXISTS "place_visits_poi_name_search_idx" ON "public"."place_visits" USING gin (poi_name_search);
CREATE INDEX IF NOT EXISTS "place_visits_location_idx" ON "public"."place_visits" USING gist (location);

-- Restore backed up data if any
INSERT INTO "public"."place_visits"
SELECT * FROM place_visits_backup
ON CONFLICT (user_id, started_at, poi_name) DO NOTHING;

DROP TABLE place_visits_backup;

COMMENT ON TABLE "public"."place_visits" IS 'Detected POI visits using dual-source detection. Updated incrementally.';

-- =============================================================================
-- Step 3: Create the secure views
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_place_visits"
WITH (security_barrier = true)
AS
SELECT
    id,
    started_at,
    duration_minutes,
    ST_X(location::geometry) as longitude,
    ST_Y(location::geometry) as latitude,
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
    alt_poi_name,
    alt_poi_amenity,
    alt_poi_cuisine,
    alt_poi_sport,
    alt_poi_distance,
    alt_poi_tags,
    alt_poi_confidence,
    created_at
FROM "public"."place_visits"
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_place_visits" IS 'Secure view of place_visits filtered to current user. Includes alternative POI for GPS inaccuracy visibility.';

CREATE OR REPLACE VIEW "public"."my_poi_summary"
WITH (security_barrier = true)
AS
SELECT
    poi_name,
    poi_amenity,
    poi_category,
    city,
    country_code,
    COUNT(*)::integer as visit_count,
    MIN(started_at) as first_visit,
    MAX(started_at) as last_visit,
    ROUND(AVG(duration_minutes))::integer as avg_duration_minutes,
    SUM(duration_minutes)::integer as total_duration_minutes,
    MIN(started_at) as started_at
FROM "public"."place_visits"
WHERE user_id = auth.uid()
GROUP BY poi_name, poi_amenity, poi_category, city, country_code;

COMMENT ON VIEW "public"."my_poi_summary" IS 'Aggregated POI visit statistics per user. Use for "most visited", "how many times" questions.';

-- =============================================================================
-- Step 4: Enable RLS on place_visits table
-- =============================================================================

ALTER TABLE "public"."place_visits" ENABLE ROW LEVEL SECURITY;

-- Users can only see their own place visits
CREATE POLICY "Users can view own place_visits"
    ON "public"."place_visits"
    FOR SELECT
    USING (user_id = auth.uid());

-- Service role can do anything
CREATE POLICY "Service role full access to place_visits"
    ON "public"."place_visits"
    FOR ALL
    USING (auth.role() = 'service_role');

-- =============================================================================
-- Step 5: Grant permissions
-- =============================================================================

GRANT SELECT ON "public"."place_visits" TO authenticated;
GRANT ALL ON "public"."place_visits" TO service_role;
GRANT SELECT ON "public"."my_place_visits" TO authenticated;
GRANT SELECT ON "public"."my_poi_summary" TO authenticated;
GRANT SELECT, UPDATE ON "public"."place_visits_state" TO service_role;
