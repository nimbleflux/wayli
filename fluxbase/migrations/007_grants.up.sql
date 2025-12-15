--
-- Migration: 007_grants.up.sql
-- Description: Grant appropriate permissions on all database objects
-- Dependencies: All previous migrations (must be last)
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- Security Model:
-- - anon: Schema USAGE only (no object access)
-- - authenticated: EXECUTE on safe functions, SELECT/INSERT/UPDATE/DELETE on tables (RLS enforced)
-- - service_role: Full access to all objects
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
-- GRANTS: Following Principle of Least Privilege
-- ============================================================================

-- Schema usage grants
-- Note: postgres role doesn't exist in Fluxbase (only in Supabase)
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

-- ============================================================================
-- ADMIN ROLE: Application-level admin role that inherits from authenticated
-- ============================================================================
-- Create admin role that inherits from authenticated
-- This allows admin users to have 'admin' in their JWT role claim
-- while still having all the permissions of authenticated users
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin NOLOGIN INHERIT;
        -- Admin inherits from authenticated, so it gets all authenticated permissions
        GRANT authenticated TO admin;
        RAISE NOTICE 'Created admin role inheriting from authenticated';
    ELSE
        RAISE NOTICE 'Admin role already exists, skipping creation';
    END IF;
END $$;

COMMENT ON ROLE admin IS 'Admin role for Wayli application - inherits all permissions from authenticated role';

GRANT USAGE ON SCHEMA "public" TO "admin";
GRANT USAGE ON SCHEMA "auth" TO "admin";
GRANT USAGE ON SCHEMA "app" TO "admin";

-- Function grants: Principle of Least Privilege
-- Note: Trigger functions have no direct grants (internal use only)
-- Note: Admin/maintenance functions only granted to service_role
-- Note: SECURITY DEFINER functions have auth checks built-in

-- Read-only utility functions - safe for all authenticated users
GRANT EXECUTE ON FUNCTION "public"."full_country"("country" "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."full_country"("country" "text") TO "service_role";

-- Calculation utilities - safe for authenticated users, used by application
GRANT EXECUTE ON FUNCTION "public"."st_distancesphere"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."st_distancesphere"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";

-- SECURITY DEFINER functions with built-in auth checks - authenticated users can execute
GRANT EXECUTE ON FUNCTION "public"."get_points_within_radius"("center_lat" double precision, "center_lon" double precision, "radius_meters" double precision, "user_uuid" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_points_within_radius"("center_lat" double precision, "center_lon" double precision, "radius_meters" double precision, "user_uuid" "uuid") TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_user_tracking_data"("user_uuid" "uuid", "start_date" timestamp with time zone, "end_date" timestamp with time zone, "limit_count" integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_user_tracking_data"("user_uuid" "uuid", "start_date" timestamp with time zone, "end_date" timestamp with time zone, "limit_count" integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sample_tracker_data_if_needed"("p_target_user_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_max_points_threshold" integer, "p_min_distance_meters" numeric, "p_min_time_minutes" numeric, "p_max_points_per_hour" integer, "p_offset" integer, "p_limit" integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."sample_tracker_data_if_needed"("p_target_user_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_max_points_threshold" integer, "p_min_distance_meters" numeric, "p_min_time_minutes" numeric, "p_max_points_per_hour" integer, "p_offset" integer, "p_limit" integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."validate_tracking_query_limits"("p_limit" integer, "p_max_points_threshold" integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."validate_tracking_query_limits"("p_limit" integer, "p_max_points_threshold" integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_user_admin"("user_uuid" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_user_admin"("user_uuid" "uuid") TO "service_role";

-- Note: cleanup_expired_exports() grant removed - Fluxbase handles job cleanup

-- Distance calculation functions - service_role only (used by backend jobs)
GRANT EXECUTE ON FUNCTION "public"."calculate_distances_batch_v2"("p_user_id" "uuid", "p_offset" integer, "p_limit" integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."calculate_mode_aware_speed"("user_id_param" "uuid", "recorded_at_param" timestamp with time zone, "transport_mode" "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."calculate_stable_speed"("user_id_param" "uuid", "recorded_at_param" timestamp with time zone, "window_size" integer) TO "service_role";
-- Note: create_distance_calculation_job() grant removed - Jobs created via Fluxbase SDK
GRANT EXECUTE ON FUNCTION "public"."perform_bulk_import_with_distance_calculation"("target_user_id" "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_tracker_distances"("target_user_id" "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_tracker_distances_batch"("target_user_id" "uuid", "batch_size" integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_tracker_distances_enhanced"("target_user_id" "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."update_tracker_distances_small_batch"("target_user_id" "uuid", "max_records" integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."remove_duplicate_tracking_points"("target_user_id" "uuid") TO "service_role";

-- Trigger control functions - service_role only
GRANT EXECUTE ON FUNCTION "public"."disable_tracker_data_trigger"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."enable_tracker_data_trigger"() TO "service_role";

-- Trigger functions - no direct grants (invoked by trigger system only)
-- "public"."handle_new_user"()
-- "public"."trigger_calculate_distance"()
-- "public"."trigger_calculate_distance_enhanced"()
-- "public"."update_user_profiles_updated_at"()
-- "public"."update_want_to_visit_places_updated_at"()
-- "public"."update_workers_updated_at"()
-- Table grants: Principle of Least Privilege
-- Note: RLS policies provide row-level access control
-- Note: Grants only define column-level permissions
-- Note: anon role has NO table access (must authenticate first)

-- user_profiles: Full access for authenticated users (RLS enforces own profile only)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";

-- Note: server_settings GRANT statements removed - use Fluxbase AppSettingsManager instead
-- Note: recent_security_events view removed - use Fluxbase audit logging instead

-- tracker_data: Full access for authenticated users (RLS enforces own data only)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."tracker_data" TO "authenticated";
GRANT ALL ON TABLE "public"."tracker_data" TO "service_role";

-- trips: Full access for authenticated users (RLS enforces own trips only)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."trips" TO "authenticated";
GRANT ALL ON TABLE "public"."trips" TO "service_role";

-- user_preferences: Full access for authenticated users (RLS enforces own preferences only)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";

-- want_to_visit_places: Full access for authenticated users (RLS enforces own places only)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."want_to_visit_places" TO "authenticated";
GRANT ALL ON TABLE "public"."want_to_visit_places" TO "service_role";

-- Note: workers grants removed - workers are now managed by Fluxbase Jobs platform

-- =============================================================================
-- PLACE VISITS AND SECURE VIEWS GRANTS
-- =============================================================================

-- place_visits: service_role only (materialized view, no RLS)
GRANT SELECT ON "public"."place_visits" TO "service_role";

-- Secure views: SELECT for authenticated users (views enforce user filtering)
GRANT SELECT ON "public"."my_place_visits" TO "authenticated";
GRANT SELECT ON "public"."my_poi_summary" TO "authenticated";
GRANT SELECT ON "public"."my_tracker_data" TO "authenticated";
GRANT SELECT ON "public"."my_trips" TO "authenticated";

-- refresh_place_visits: service_role only (for job scheduler)
GRANT EXECUTE ON FUNCTION "public"."refresh_place_visits"() TO "service_role";

-- Default privileges: Not configured for Fluxbase
-- Note: Fluxbase doesn't have a 'postgres' role like Supabase
-- Note: Default privileges for future objects should be configured via Fluxbase settings if needed
-- Note: All current objects have explicit grants defined above
