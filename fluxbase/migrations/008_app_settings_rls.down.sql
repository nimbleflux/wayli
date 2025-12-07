--
-- Migration: 008_app_settings_rls.down.sql
-- Description: Rollback RLS policies and settings for app.settings
-- Dependencies: None
-- Author: Wayli Migration System
-- Created: 2025-11-15
--

-- Drop trigger
DROP TRIGGER IF EXISTS "trigger_mark_setup_complete" ON "public"."user_profiles";

-- Drop function
DROP FUNCTION IF EXISTS "public"."mark_setup_complete"();

-- Drop RLS policies
DROP POLICY IF EXISTS "Anonymous users can read public Wayli settings" ON "app"."settings";
DROP POLICY IF EXISTS "Authenticated users can read public settings" ON "app"."settings";

-- Remove settings (optional - you may want to keep them)
DELETE FROM "app"."settings" WHERE "key" IN (
    'wayli.is_setup_complete',
    'wayli.server_name'
);
