--
-- Migration: 018_place_visits_per_user_state.down.sql
-- Description: Revert per-user watermarks and disable password login setting
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
-- Step 1: Remove disable password login setting
-- =============================================================================

DELETE FROM "app"."settings" WHERE "key" = 'wayli.disable_password_login';

-- Restore anonymous policy without the new setting
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
        'wayli.password_require_special'
    )
);

-- =============================================================================
-- Step 2: Revert place_visits_state to singleton
-- =============================================================================

-- Delete per-user rows (keep only global row)
DELETE FROM "public"."place_visits_state" WHERE user_id IS NOT NULL;

-- Drop index
DROP INDEX IF EXISTS "public"."place_visits_state_user_id_idx";

-- Drop unique constraint
ALTER TABLE "public"."place_visits_state" DROP CONSTRAINT IF EXISTS "place_visits_state_user_unique";

-- Drop user_id column
ALTER TABLE "public"."place_visits_state" DROP COLUMN IF EXISTS "user_id";

-- Restore singleton constraint
ALTER TABLE "public"."place_visits_state" ADD CONSTRAINT "place_visits_state_singleton" CHECK (id = 1);

COMMENT ON TABLE "public"."place_visits_state" IS 'Tracks the last incremental refresh timestamp for place_visits';
