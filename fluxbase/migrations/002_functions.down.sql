--
-- Migration: 002_functions.down.sql
-- Description: Drop all functions created by 001_functions.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop utility functions
DROP FUNCTION IF EXISTS "public"."full_country"("country" "text");

-- Drop distance calculation functions
DROP FUNCTION IF EXISTS "public"."st_distancesphere"("geog1" "public"."geography", "geog2" "public"."geography");
DROP FUNCTION IF EXISTS "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry");
DROP FUNCTION IF EXISTS "public"."calculate_distances_batch_v2"("p_user_id" "uuid", "p_offset" integer, "p_limit" integer);
DROP FUNCTION IF EXISTS "public"."calculate_mode_aware_speed"("user_id_param" "uuid", "recorded_at_param" timestamp with time zone, "transport_mode" "text");
DROP FUNCTION IF EXISTS "public"."calculate_stable_speed"("user_id_param" "uuid", "recorded_at_param" timestamp with time zone, "window_size" integer);
DROP FUNCTION IF EXISTS "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text");
DROP FUNCTION IF EXISTS "public"."perform_bulk_import_with_distance_calculation"("target_user_id" "uuid");
DROP FUNCTION IF EXISTS "public"."update_tracker_distances"("target_user_id" "uuid");
DROP FUNCTION IF EXISTS "public"."update_tracker_distances_batch"("target_user_id" "uuid", "batch_size" integer);
DROP FUNCTION IF EXISTS "public"."update_tracker_distances_enhanced"("target_user_id" "uuid");
DROP FUNCTION IF EXISTS "public"."update_tracker_distances_small_batch"("target_user_id" "uuid", "max_records" integer);
DROP FUNCTION IF EXISTS "public"."remove_duplicate_tracking_points"("target_user_id" "uuid");

-- Drop query functions
DROP FUNCTION IF EXISTS "public"."get_points_within_radius"("center_lat" double precision, "center_lon" double precision, "radius_meters" double precision, "user_uuid" "uuid");
DROP FUNCTION IF EXISTS "public"."get_user_tracking_data"("user_uuid" "uuid", "start_date" timestamp with time zone, "end_date" timestamp with time zone, "limit_count" integer);
DROP FUNCTION IF EXISTS "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer);
DROP FUNCTION IF EXISTS "public"."sample_tracker_data_if_needed"("p_target_user_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_max_points_threshold" integer, "p_min_distance_meters" numeric, "p_min_time_minutes" numeric, "p_max_points_per_hour" integer, "p_offset" integer, "p_limit" integer);
DROP FUNCTION IF EXISTS "public"."validate_tracking_query_limits"("p_limit" integer, "p_max_points_threshold" integer);

-- Drop admin functions
DROP FUNCTION IF EXISTS "public"."is_user_admin"("user_uuid" "uuid");
DROP FUNCTION IF EXISTS "public"."cleanup_expired_exports"();
DROP FUNCTION IF EXISTS "public"."cleanup_old_audit_logs"("retention_days" integer);
DROP FUNCTION IF EXISTS "public"."get_audit_statistics"("start_date" timestamp with time zone, "end_date" timestamp with time zone);

-- Drop trigger control functions
DROP FUNCTION IF EXISTS "public"."disable_tracker_data_trigger"();
DROP FUNCTION IF EXISTS "public"."enable_tracker_data_trigger"();

-- Drop audit functions
DROP FUNCTION IF EXISTS "public"."log_audit_event"("p_event_type" "text", "p_description" "text", "p_severity" "text", "p_metadata" "jsonb");

-- Drop place visits refresh function
DROP FUNCTION IF EXISTS "public"."refresh_place_visits"();

-- Drop trigger functions
DROP FUNCTION IF EXISTS "public"."audit_user_role_change"();
DROP FUNCTION IF EXISTS "public"."handle_new_user"();
DROP FUNCTION IF EXISTS "public"."sync_user_role_to_auth"();
DROP FUNCTION IF EXISTS "public"."trigger_calculate_distance"();
DROP FUNCTION IF EXISTS "public"."trigger_calculate_distance_enhanced"();
DROP FUNCTION IF EXISTS "public"."update_audit_logs_updated_at"();
DROP FUNCTION IF EXISTS "public"."update_user_profiles_updated_at"();
DROP FUNCTION IF EXISTS "public"."update_want_to_visit_places_updated_at"();
DROP FUNCTION IF EXISTS "public"."update_workers_updated_at"();
