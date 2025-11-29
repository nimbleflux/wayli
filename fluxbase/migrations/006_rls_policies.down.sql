--
-- Migration: 006_rls_policies.down.sql
-- Description: Drop all RLS policies and disable RLS on tables
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Note: Realtime publication not used in Fluxbase - no need to drop

-- Disable RLS on all tables
ALTER TABLE "public"."audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."database_migrations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tracker_data" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trips" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_preferences" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."want_to_visit_places" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workers" DISABLE ROW LEVEL SECURITY;

-- Drop all RLS policies
DROP POLICY IF EXISTS "Jobs can be updated" ON "public"."jobs";
DROP POLICY IF EXISTS "Service role can delete audit logs" ON "public"."audit_logs";
DROP POLICY IF EXISTS "Service role can insert audit logs" ON "public"."audit_logs";
DROP POLICY IF EXISTS "Service role can manage migrations" ON "public"."database_migrations";
DROP POLICY IF EXISTS "Service role can update audit logs" ON "public"."audit_logs";
DROP POLICY IF EXISTS "User preferences can be deleted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be inserted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be selected" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be updated" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User profile can be deleted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profile can be inserted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profile can be selected" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profile can be updated" ON "public"."user_profiles";
DROP POLICY IF EXISTS "Users can create jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can delete jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can select own audit logs or admins can select all" ON "public"."audit_logs";
DROP POLICY IF EXISTS "Users can select their jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Want to visit places can be deleted" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Want to visit places can be inserted" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Want to visit places can be selected" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Want to visit places can be updated" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Workers can be deleted" ON "public"."workers";
DROP POLICY IF EXISTS "Workers can be inserted" ON "public"."workers";
DROP POLICY IF EXISTS "Workers can be selected" ON "public"."workers";
DROP POLICY IF EXISTS "Workers can be updated" ON "public"."workers";
DROP POLICY IF EXISTS "tracker_data_delete_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "tracker_data_insert_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "tracker_data_select_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "tracker_data_update_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "trips_delete_policy" ON "public"."trips";
DROP POLICY IF EXISTS "trips_insert_policy" ON "public"."trips";
DROP POLICY IF EXISTS "trips_select_policy" ON "public"."trips";
DROP POLICY IF EXISTS "trips_update_policy" ON "public"."trips";

-- Drop storage policies
DROP POLICY IF EXISTS "Allow authenticated uploads" ON "storage"."objects";
DROP POLICY IF EXISTS "Allow public read access" ON "storage"."objects";
DROP POLICY IF EXISTS "Users can delete own trip images" ON "storage"."objects";
DROP POLICY IF EXISTS "Users can update own trip images" ON "storage"."objects";

-- Drop auth schema and functions
DROP FUNCTION IF EXISTS auth.uid();
DROP FUNCTION IF EXISTS auth.role();
DROP SCHEMA IF EXISTS auth CASCADE;
