--
-- Migration: 010_place_visits_ai_config.down.sql
-- Description: Remove place_visits, ai_config, rate_limits, query_feedback, and related functions
-- Author: Wayli Migration System
-- Created: 2025-12-07
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

-- =============================================================================
-- Drop Functions (in dependency order)
-- =============================================================================

DROP FUNCTION IF EXISTS "public"."execute_user_query"(TEXT, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS "public"."strip_sql_comments"(TEXT);
DROP FUNCTION IF EXISTS "public"."check_rate_limit"(UUID, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS "public"."cleanup_rate_limits"();
DROP FUNCTION IF EXISTS "public"."encrypt_api_key"(TEXT, TEXT);
DROP FUNCTION IF EXISTS "public"."decrypt_api_key"(TEXT, TEXT);

-- =============================================================================
-- Drop Query Feedback Table
-- =============================================================================

DROP POLICY IF EXISTS "query_feedback_insert_own" ON "public"."query_feedback";
DROP POLICY IF EXISTS "query_feedback_select_own" ON "public"."query_feedback";
DROP TABLE IF EXISTS "public"."query_feedback";

-- =============================================================================
-- Drop Rate Limits Table
-- =============================================================================

DROP INDEX IF EXISTS "public"."idx_rate_limits_lookup";
DROP TABLE IF EXISTS "public"."rate_limits";

-- =============================================================================
-- Remove AI config column from user_preferences
-- =============================================================================

ALTER TABLE "public"."user_preferences"
DROP COLUMN IF EXISTS "ai_config";

-- =============================================================================
-- Drop AI Config Table
-- =============================================================================

DROP POLICY IF EXISTS "ai_config_select_authenticated" ON "public"."ai_config";
DROP POLICY IF EXISTS "ai_config_all_service" ON "public"."ai_config";
DROP TABLE IF EXISTS "public"."ai_config";

-- =============================================================================
-- Drop Place Visits Table
-- =============================================================================

DROP POLICY IF EXISTS "place_visits_select_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_insert_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_update_own" ON "public"."place_visits";
DROP POLICY IF EXISTS "place_visits_delete_own" ON "public"."place_visits";

DROP INDEX IF EXISTS "public"."idx_place_visits_user_date";
DROP INDEX IF EXISTS "public"."idx_place_visits_amenity";
DROP INDEX IF EXISTS "public"."idx_place_visits_cuisine";
DROP INDEX IF EXISTS "public"."idx_place_visits_category";
DROP INDEX IF EXISTS "public"."idx_place_visits_country";
DROP INDEX IF EXISTS "public"."idx_place_visits_city";
DROP INDEX IF EXISTS "public"."idx_place_visits_location";
DROP INDEX IF EXISTS "public"."idx_place_visits_poi_tags";

DROP TABLE IF EXISTS "public"."place_visits";
