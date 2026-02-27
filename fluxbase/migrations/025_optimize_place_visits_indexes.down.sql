--
-- Migration: 025_optimize_place_visits_indexes.down.sql
-- Description: Remove indexes created for place visit detection query optimization
-- Dependencies: 025_optimize_place_visits_indexes.up.sql
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
-- DROP INDEXES FOR PLACE VISIT DETECTION OPTIMIZATION
-- ============================================================================

DROP INDEX IF EXISTS "public"."idx_user_preferences_id_trip_exclusions";

DROP INDEX IF EXISTS "public"."idx_user_profiles_home_address_gin";
