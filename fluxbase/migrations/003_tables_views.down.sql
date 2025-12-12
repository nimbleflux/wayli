--
-- Migration: 003_tables_views.down.sql
-- Description: Drop all tables and views
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- WARNING: This will delete all data in these tables!
--

-- Drop secure views first (depend on base tables/views)
DROP VIEW IF EXISTS "public"."my_trips";
DROP VIEW IF EXISTS "public"."my_tracker_data";
DROP VIEW IF EXISTS "public"."my_poi_summary";
DROP VIEW IF EXISTS "public"."my_place_visits";

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS "public"."place_visits";

-- Drop other views
DROP VIEW IF EXISTS "public"."recent_security_events";

-- Drop tables (no specific order needed with CASCADE)
DROP TABLE IF EXISTS "public"."want_to_visit_places" CASCADE;
DROP TABLE IF EXISTS "public"."user_preferences" CASCADE;
DROP TABLE IF EXISTS "public"."user_profiles" CASCADE;
DROP TABLE IF EXISTS "public"."trips" CASCADE;
DROP TABLE IF EXISTS "public"."tracker_data" CASCADE;
DROP TABLE IF EXISTS "public"."jobs" CASCADE;
DROP TABLE IF EXISTS "public"."database_migrations" CASCADE;
DROP TABLE IF EXISTS "public"."audit_logs" CASCADE;
-- Note: workers table removed - workers are now managed by Fluxbase Jobs platform
