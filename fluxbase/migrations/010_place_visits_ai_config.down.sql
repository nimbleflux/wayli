--
-- Migration: 010_place_visits_ai_config.down.sql
-- Description: Remove place_visits table and ai_config
-- Author: Wayli Migration System
-- Created: 2025-12-07
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

-- Remove AI config column from user_preferences
ALTER TABLE "public"."user_preferences"
DROP COLUMN IF EXISTS "ai_config";

-- Drop RLS policies for ai_config
DROP POLICY IF EXISTS "ai_config_select_authenticated" ON "public"."ai_config";
DROP POLICY IF EXISTS "ai_config_all_service" ON "public"."ai_config";

-- Drop ai_config table
DROP TABLE IF EXISTS "public"."ai_config";

-- Drop RLS policies for place_visits
DROP POLICY IF EXISTS "place_visits_select_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_insert_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_update_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_delete_own" ON "public"."place_visits";

-- Drop indexes for place_visits
DROP INDEX IF EXISTS "public"."idx_place_visits_user_date";
DROP INDEX IF EXISTS "public"."idx_place_visits_amenity";
DROP INDEX IF EXISTS "public"."idx_place_visits_cuisine";
DROP INDEX IF EXISTS "public"."idx_place_visits_category";
DROP INDEX IF EXISTS "public"."idx_place_visits_country";
DROP INDEX IF EXISTS "public"."idx_place_visits_city";
DROP INDEX IF EXISTS "public"."idx_place_visits_location";
DROP INDEX IF EXISTS "public"."idx_place_visits_poi_tags";

-- Drop place_visits table
DROP TABLE IF EXISTS "public"."place_visits";
