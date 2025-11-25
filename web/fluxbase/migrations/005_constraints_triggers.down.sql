--
-- Migration: 005_constraints_triggers.down.sql
-- Description: Drop all triggers and foreign key constraints
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop auth schema trigger
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";

-- Drop public schema triggers
DROP TRIGGER IF EXISTS "audit_user_role_change_trigger" ON "public"."user_profiles";
DROP TRIGGER IF EXISTS "tracker_data_distance_trigger" ON "public"."tracker_data";
DROP TRIGGER IF EXISTS "trigger_sync_user_role" ON "public"."user_profiles";
DROP TRIGGER IF EXISTS "trigger_update_want_to_visit_places_updated_at" ON "public"."want_to_visit_places";
DROP TRIGGER IF EXISTS "update_audit_logs_updated_at" ON "public"."audit_logs";
DROP TRIGGER IF EXISTS "update_user_profiles_updated_at" ON "public"."user_profiles";
DROP TRIGGER IF EXISTS "update_workers_updated_at" ON "public"."workers";

-- Drop foreign key constraints
ALTER TABLE "public"."jobs" DROP CONSTRAINT IF EXISTS "jobs_created_by_fkey";
ALTER TABLE "public"."tracker_data" DROP CONSTRAINT IF EXISTS "tracker_data_user_id_fkey";
ALTER TABLE "public"."trips" DROP CONSTRAINT IF EXISTS "trips_user_id_fkey";
ALTER TABLE "public"."user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_id_fkey";
ALTER TABLE "public"."user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_id_fkey";
ALTER TABLE "public"."want_to_visit_places" DROP CONSTRAINT IF EXISTS "want_to_visit_places_user_id_fkey";
ALTER TABLE "public"."workers" DROP CONSTRAINT IF EXISTS "workers_current_job_fkey";
-- Note: audit_logs and workers_user_id_fkey removed - tables/columns no longer exist
