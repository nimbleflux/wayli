--
-- Migration: 005_constraints_triggers.up.sql
-- Description: Create triggers, foreign keys, and other constraints
-- Dependencies: 002_functions.up.sql, 003_tables_views.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
SET
    statement_timeout = 0;

SET
    lock_timeout = 0;

SET
    idle_in_transaction_session_timeout = 0;

SET
    client_encoding = 'UTF8';

SET
    standard_conforming_strings = on;

SELECT
    pg_catalog.set_config ('search_path', '', false);

SET
    check_function_bodies = false;

SET
    xmloption = content;

SET
    client_min_messages = warning;

SET
    row_security = off;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE
OR REPLACE TRIGGER "tracker_data_distance_trigger" BEFORE INSERT
OR
UPDATE ON "public"."tracker_data" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_calculate_distance" ();

CREATE
OR REPLACE TRIGGER "trigger_update_want_to_visit_places_updated_at" BEFORE INSERT
OR
UPDATE ON "public"."want_to_visit_places" FOR EACH ROW EXECUTE FUNCTION "public"."update_want_to_visit_places_updated_at" ();

CREATE
OR REPLACE TRIGGER "update_user_profiles_updated_at" BEFORE
UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_profiles_updated_at" ();

-- Note: update_workers_updated_at trigger removed - workers are now managed by Fluxbase Jobs platform
CREATE
OR REPLACE TRIGGER "trigger_sync_user_role" AFTER INSERT
OR
UPDATE OF "role" ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_user_role_to_auth" ();

COMMENT ON TRIGGER "trigger_sync_user_role" ON "public"."user_profiles" IS 'Syncs user role from user_profiles.role to auth.users.role for JWT claims';

-- ============================================================================
-- CLEANUP ORPHANED RECORDS BEFORE ADDING FOREIGN KEY CONSTRAINTS
-- ============================================================================
-- Remove any records referencing non-existent users to prevent FK violations
DELETE FROM "public"."user_preferences"
WHERE
    "id" NOT IN (
        SELECT
            "id"
        FROM
            "auth"."users"
    );

DELETE FROM "public"."user_profiles"
WHERE
    "id" NOT IN (
        SELECT
            "id"
        FROM
            "auth"."users"
    );

DELETE FROM "public"."tracker_data"
WHERE
    "user_id" NOT IN (
        SELECT
            "id"
        FROM
            "auth"."users"
    );

DELETE FROM "public"."trips"
WHERE
    "user_id" NOT IN (
        SELECT
            "id"
        FROM
            "auth"."users"
    );

DELETE FROM "public"."want_to_visit_places"
WHERE
    "user_id" NOT IN (
        SELECT
            "id"
        FROM
            "auth"."users"
    );

-- ============================================================================
-- FOREIGN KEY CONSTRAINTS (idempotent - drop if exists before adding)
-- ============================================================================
-- Note: jobs_created_by_fkey removed - Jobs are now managed by Fluxbase (jobs.queue)
ALTER TABLE "public"."tracker_data"
DROP CONSTRAINT IF EXISTS "tracker_data_user_id_fkey";

ALTER TABLE ONLY "public"."tracker_data" ADD CONSTRAINT "tracker_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

ALTER TABLE "public"."trips"
DROP CONSTRAINT IF EXISTS "trips_user_id_fkey";

ALTER TABLE ONLY "public"."trips" ADD CONSTRAINT "trips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

ALTER TABLE "public"."user_preferences"
DROP CONSTRAINT IF EXISTS "user_preferences_id_fkey";

ALTER TABLE ONLY "public"."user_preferences" ADD CONSTRAINT "user_preferences_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

ALTER TABLE "public"."user_profiles"
DROP CONSTRAINT IF EXISTS "user_profiles_id_fkey";

ALTER TABLE ONLY "public"."user_profiles" ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

ALTER TABLE "public"."want_to_visit_places"
DROP CONSTRAINT IF EXISTS "want_to_visit_places_user_id_fkey";

ALTER TABLE ONLY "public"."want_to_visit_places" ADD CONSTRAINT "want_to_visit_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

-- Note: workers constraints removed - workers are now managed by Fluxbase Jobs platform
-- ============================================================================
-- ADDITIONAL CHECK CONSTRAINTS (idempotent - drop if exists before adding)
-- ============================================================================
-- Trip dates must be logical
ALTER TABLE "public"."trips"
DROP CONSTRAINT IF EXISTS "trips_valid_dates";

ALTER TABLE ONLY "public"."trips" ADD CONSTRAINT "trips_valid_dates" CHECK ("end_date" >= "start_date");

-- Battery level range (0-100)
ALTER TABLE "public"."tracker_data"
DROP CONSTRAINT IF EXISTS "tracker_data_valid_battery";

ALTER TABLE ONLY "public"."tracker_data" ADD CONSTRAINT "tracker_data_valid_battery" CHECK (
    ("battery_level" IS NULL)
    OR (
        ("battery_level" >= 0)
        AND ("battery_level" <= 100)
    )
);

-- Accuracy must be non-negative
ALTER TABLE "public"."tracker_data"
DROP CONSTRAINT IF EXISTS "tracker_data_positive_accuracy";

ALTER TABLE ONLY "public"."tracker_data" ADD CONSTRAINT "tracker_data_positive_accuracy" CHECK (
    ("accuracy" IS NULL)
    OR ("accuracy" >= 0)
);

-- Heading range (0-360 degrees)
ALTER TABLE "public"."tracker_data"
DROP CONSTRAINT IF EXISTS "tracker_data_valid_heading";

ALTER TABLE ONLY "public"."tracker_data" ADD CONSTRAINT "tracker_data_valid_heading" CHECK (
    ("heading" IS NULL)
    OR (
        ("heading" >= 0)
        AND ("heading" < 360)
    )
);

-- ============================================================================
-- AUTH SCHEMA TRIGGERS
-- ============================================================================
CREATE
OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user" ();