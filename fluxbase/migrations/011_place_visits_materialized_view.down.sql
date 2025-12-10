--
-- Migration: 011_place_visits_materialized_view.down.sql
-- Description: Revert materialized view back to placeholder table from migration 010
-- Author: Wayli Migration System
-- Created: 2025-12-09
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
-- Step 1: Drop materialized view and dependent objects
-- =============================================================================

-- Drop the secure view
DROP VIEW IF EXISTS "public"."my_place_visits" CASCADE;

-- Drop refresh function
DROP FUNCTION IF EXISTS "public"."refresh_place_visits"() CASCADE;

-- Drop RLS policies (if they exist on materialized view)
DROP POLICY IF EXISTS "place_visits_select_own" ON "public"."place_visits";

-- Drop the materialized view
DROP MATERIALIZED VIEW IF EXISTS "public"."place_visits" CASCADE;

-- =============================================================================
-- Step 2: Recreate original place_visits table from migration 010
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."place_visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,

    -- Temporal (when was this visit?)
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone NOT NULL,
    "duration_minutes" integer GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM ("ended_at" - "started_at")) / 60
    ) STORED,

    -- Spatial (where was this visit?)
    "location" "public"."geometry"(Point, 4326) NOT NULL,

    -- POI details (denormalized for easy LLM SQL queries)
    "poi_name" "text",
    "poi_layer" "text",
    "poi_amenity" "text",
    "poi_cuisine" "text",
    "poi_category" "text",
    "poi_tags" "jsonb" DEFAULT '{}'::"jsonb",

    -- Location context (denormalized for easy queries)
    "city" "text",
    "country" "text",
    "country_code" character varying(2),

    -- Confidence and metadata
    "confidence_score" numeric(3,2),
    "gps_points_count" integer,
    "avg_accuracy_meters" numeric(8,2),
    "detection_method" "text" DEFAULT 'time_cluster'::"text",

    -- Alternative candidates (if ambiguous, stores top 3)
    "candidates" "jsonb",

    -- Metadata
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),

    -- Constraints
    CONSTRAINT "place_visits_confidence_check" CHECK (
        "confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1)
    ),
    CONSTRAINT "place_visits_duration_check" CHECK (
        "ended_at" >= "started_at"
    )
);

COMMENT ON TABLE "public"."place_visits" IS 'Detected POI/venue visits for natural language queries. Stores restaurant, cafe, museum visits etc.';

-- =============================================================================
-- Step 3: Recreate indexes
-- =============================================================================

CREATE INDEX "idx_place_visits_user_date" ON "public"."place_visits" ("user_id", "started_at" DESC);
CREATE INDEX "idx_place_visits_amenity" ON "public"."place_visits" ("poi_amenity") WHERE "poi_amenity" IS NOT NULL;
CREATE INDEX "idx_place_visits_cuisine" ON "public"."place_visits" ("poi_cuisine") WHERE "poi_cuisine" IS NOT NULL;
CREATE INDEX "idx_place_visits_category" ON "public"."place_visits" ("poi_category") WHERE "poi_category" IS NOT NULL;
CREATE INDEX "idx_place_visits_country" ON "public"."place_visits" ("country_code", "started_at" DESC);
CREATE INDEX "idx_place_visits_city" ON "public"."place_visits" ("city", "started_at" DESC) WHERE "city" IS NOT NULL;
CREATE INDEX "idx_place_visits_location" ON "public"."place_visits" USING GIST ("location");
CREATE INDEX "idx_place_visits_poi_tags" ON "public"."place_visits" USING GIN ("poi_tags");

-- =============================================================================
-- Step 4: Recreate RLS policies
-- =============================================================================

ALTER TABLE "public"."place_visits" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "place_visits_select_own" ON "public"."place_visits"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "place_visits_insert_own" ON "public"."place_visits"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "place_visits_update_own" ON "public"."place_visits"
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "place_visits_delete_own" ON "public"."place_visits"
    FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- Step 5: Recreate secure view
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_place_visits"
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    id,
    started_at,
    ended_at,
    duration_minutes,
    ST_X(location::geometry) as longitude,
    ST_Y(location::geometry) as latitude,
    poi_name,
    poi_layer,
    poi_amenity,
    poi_cuisine,
    poi_category,
    poi_tags,
    city,
    country,
    country_code,
    confidence_score,
    gps_points_count,
    avg_accuracy_meters,
    detection_method,
    candidates,
    created_at
FROM "public"."place_visits"
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_place_visits" IS 'Secure view of place_visits filtered to current user. Use this for LLM queries.';

-- =============================================================================
-- Step 6: Recreate foreign key and grants
-- =============================================================================

ALTER TABLE ONLY "public"."place_visits"
    ADD CONSTRAINT "place_visits_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

GRANT SELECT ON "public"."my_place_visits" TO authenticated;
