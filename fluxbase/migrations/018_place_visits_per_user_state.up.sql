--
-- Migration: 018_place_visits_per_user_state.up.sql
-- Description: Add per-user watermarks for place visits and disable password login setting
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
SET search_path TO public;

-- =============================================================================
-- Step 1: Modify place_visits_state for per-user watermarks
-- =============================================================================

-- Remove singleton constraint to allow multiple rows
ALTER TABLE "public"."place_visits_state" DROP CONSTRAINT IF EXISTS "place_visits_state_singleton";

-- Add user_id column (nullable - NULL means global state)
ALTER TABLE "public"."place_visits_state" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add unique constraint on user_id (allows one row per user, plus one NULL row for global)
ALTER TABLE "public"."place_visits_state" DROP CONSTRAINT IF EXISTS "place_visits_state_user_unique";
ALTER TABLE "public"."place_visits_state" ADD CONSTRAINT "place_visits_state_user_unique" UNIQUE (user_id);

-- Add index for fast lookups by user_id
CREATE INDEX IF NOT EXISTS "place_visits_state_user_id_idx" ON "public"."place_visits_state" (user_id);

-- Update the existing global row to explicitly have NULL user_id
UPDATE "public"."place_visits_state" SET user_id = NULL WHERE id = 1;

COMMENT ON TABLE "public"."place_visits_state" IS 'Tracks incremental refresh state for place_visits - per user and global';
COMMENT ON COLUMN "public"."place_visits_state"."user_id" IS 'User ID for per-user tracking, NULL for global state';

-- =============================================================================
-- Step 2: Add disable password login setting
-- =============================================================================

INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.disable_password_login',
    '{"value": false}'::jsonb,
    true,
    'Disable password-based login, allow only OAuth'
) ON CONFLICT ("key") DO NOTHING;

-- =============================================================================
-- Step 3: Update anonymous policy to include new setting
-- =============================================================================

DROP POLICY IF EXISTS "Anonymous users can read public Wayli settings" ON "app"."settings";
CREATE POLICY "Anonymous users can read public Wayli settings"
ON "app"."settings"
FOR SELECT
TO "anon"
USING (
    "is_public" = true
    AND "key" IN (
        'wayli.is_setup_complete',
        'wayli.server_name',
        'wayli.password_min_length',
        'wayli.password_require_uppercase',
        'wayli.password_require_lowercase',
        'wayli.password_require_number',
        'wayli.password_require_special',
        'wayli.disable_password_login'
    )
);
