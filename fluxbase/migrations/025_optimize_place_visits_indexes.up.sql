--
-- Migration: 025_optimize_place_visits_indexes.up.sql
-- Description: Add indexes to optimize place visit detection query performance
-- Dependencies: 003_tables_views.up.sql, 004_indexes.up.sql
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

-- ============================================================================
-- INDEXES FOR PLACE VISIT DETECTION OPTIMIZATION
-- ============================================================================

-- Partial index for users with trip exclusions (optimizes JSONB array access)
-- Only indexes rows that actually have trip_exclusions, reducing index size
CREATE INDEX IF NOT EXISTS "idx_user_preferences_id_trip_exclusions"
ON "public"."user_preferences" (id)
WHERE jsonb_array_length(trip_exclusions) > 0;

-- GIN index for home_address location queries (optimizes exclusion zone joins)
-- Only indexes rows that have a home_address set
CREATE INDEX IF NOT EXISTS "idx_user_profiles_home_address_gin"
ON "public"."user_profiles" USING GIN (home_address)
WHERE home_address IS NOT NULL;
