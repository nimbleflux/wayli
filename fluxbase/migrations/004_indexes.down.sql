--
-- Migration: 004_indexes.down.sql
-- Description: Drop all indexes created by 003_indexes.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop audit_logs indexes
DROP INDEX IF EXISTS "public"."idx_audit_logs_event_type";
DROP INDEX IF EXISTS "public"."idx_audit_logs_ip_address";
DROP INDEX IF EXISTS "public"."idx_audit_logs_request_id";
DROP INDEX IF EXISTS "public"."idx_audit_logs_severity";
DROP INDEX IF EXISTS "public"."idx_audit_logs_severity_timestamp";
DROP INDEX IF EXISTS "public"."idx_audit_logs_timestamp";
DROP INDEX IF EXISTS "public"."idx_audit_logs_type_timestamp";
DROP INDEX IF EXISTS "public"."idx_audit_logs_user_id";
DROP INDEX IF EXISTS "public"."idx_audit_logs_user_timestamp";

-- Drop jobs indexes
DROP INDEX IF EXISTS "public"."idx_jobs_created_at";
DROP INDEX IF EXISTS "public"."idx_jobs_created_by";
DROP INDEX IF EXISTS "public"."idx_jobs_priority";
DROP INDEX IF EXISTS "public"."idx_jobs_status";
DROP INDEX IF EXISTS "public"."idx_jobs_worker_id";

-- Drop tracker_data indexes
DROP INDEX IF EXISTS "public"."idx_tracker_data_device_id";
DROP INDEX IF EXISTS "public"."idx_tracker_data_location";
DROP INDEX IF EXISTS "public"."idx_tracker_data_timestamp";
DROP INDEX IF EXISTS "public"."idx_tracker_data_tz_diff";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_id";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_timestamp_distance";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_timestamp_location";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_timestamp_ordered";

-- Drop trips indexes
DROP INDEX IF EXISTS "public"."idx_trips_end_date";
DROP INDEX IF EXISTS "public"."idx_trips_start_date";
DROP INDEX IF EXISTS "public"."idx_trips_user_id";

-- Drop user_preferences indexes
DROP INDEX IF EXISTS "public"."idx_user_preferences_id";

-- Drop user_profiles indexes
DROP INDEX IF EXISTS "public"."idx_user_profiles_id";

-- Drop want_to_visit_places indexes
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_created_at";
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_favorite";
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_type";
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_user_id";

-- Drop workers indexes
DROP INDEX IF EXISTS "public"."idx_workers_last_heartbeat";
DROP INDEX IF EXISTS "public"."idx_workers_status";
DROP INDEX IF EXISTS "public"."idx_workers_updated_at";
