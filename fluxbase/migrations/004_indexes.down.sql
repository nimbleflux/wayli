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

-- Note: workers indexes removed - workers are now managed by Fluxbase Jobs platform
-- Drop place_visits indexes
DROP INDEX IF EXISTS "public"."idx_place_visits_fts";

DROP INDEX IF EXISTS "public"."idx_place_visits_duration_category";

DROP INDEX IF EXISTS "public"."idx_place_visits_weekend";

DROP INDEX IF EXISTS "public"."idx_place_visits_day_of_week";

DROP INDEX IF EXISTS "public"."idx_place_visits_time_of_day";

DROP INDEX IF EXISTS "public"."idx_place_visits_city";

DROP INDEX IF EXISTS "public"."idx_place_visits_country";

DROP INDEX IF EXISTS "public"."idx_place_visits_poi_tags";

DROP INDEX IF EXISTS "public"."idx_place_visits_location";

DROP INDEX IF EXISTS "public"."idx_place_visits_poi_sport";

DROP INDEX IF EXISTS "public"."idx_place_visits_poi_cuisine";

DROP INDEX IF EXISTS "public"."idx_place_visits_poi_category";

DROP INDEX IF EXISTS "public"."idx_place_visits_poi_amenity";

DROP INDEX IF EXISTS "public"."idx_place_visits_poi_name";

DROP INDEX IF EXISTS "public"."idx_place_visits_user_started";

DROP INDEX IF EXISTS "public"."idx_place_visits_unique";