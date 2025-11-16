--
-- Migration: 003_tables_views.up.sql
-- Description: Create all database tables and views for Wayli application
-- Dependencies: 002_functions.up.sql (functions must exist first)
-- Author: Wayli Migration System
-- Created: 2025-01-15
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

SET default_tablespace = '';
SET default_table_access_method = "heap";

SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."database_migrations" (
    "version" character varying(20) NOT NULL PRIMARY KEY,
    "name" character varying(255) NOT NULL,
    "checksum" character varying(32) NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"(),
    "execution_time_ms" integer,
    "error_message" "text"
);
CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "error" "text",
    "last_error" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "worker_id" "text",
    CONSTRAINT "jobs_priority_check" CHECK (
        (
            "priority" = ANY (
                ARRAY ['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]
            )
        )
    ),
    CONSTRAINT "jobs_progress_check" CHECK (
        (
            ("progress" >= 0)
            AND ("progress" <= 100)
        )
    ),
    CONSTRAINT "jobs_status_check" CHECK (
        (
            "status" = ANY (
                ARRAY ['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]
            )
        )
    )
);
ALTER TABLE ONLY "public"."jobs" REPLICA IDENTITY FULL;
COMMENT ON TABLE "public"."jobs" IS 'Job queue table with realtime updates enabled. REPLICA IDENTITY FULL allows realtime to broadcast complete row data for updates.';
COMMENT ON COLUMN "public"."jobs"."retry_count" IS 'Number of retry attempts for this job';
CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL PRIMARY KEY,
    "first_name" "text",
    "last_name" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'user'::"text",
    "avatar_url" "text",
    "home_address" "jsonb",
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_dismissed" boolean DEFAULT false,
    "home_address_skipped" boolean DEFAULT false,
    "first_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_profiles_role_check" CHECK (
        (
            "role" = ANY (
                ARRAY ['user'::"text", 'admin'::"text", 'moderator'::"text"]
            )
        )
    )
);
COMMENT ON TABLE "public"."user_profiles" IS 'User profile information. RLS policies ensure users can only access their own profiles.';
COMMENT ON COLUMN "public"."user_profiles"."onboarding_completed" IS 'Whether user has completed initial onboarding flow';
COMMENT ON COLUMN "public"."user_profiles"."onboarding_dismissed" IS 'Whether user has permanently dismissed onboarding prompts';
COMMENT ON COLUMN "public"."user_profiles"."home_address_skipped" IS 'Whether user explicitly skipped home address setup during onboarding';
COMMENT ON COLUMN "public"."user_profiles"."first_login_at" IS 'Timestamp of first successful login after registration';
CREATE TABLE IF NOT EXISTS "public"."tracker_data" (
    "user_id" "uuid" NOT NULL,
    "tracker_type" "text" NOT NULL,
    "device_id" "text",
    "recorded_at" timestamp with time zone NOT NULL,
    "location" "public"."geometry"(Point, 4326),
    "country_code" character varying(2),
    "altitude" numeric(8, 2),
    "accuracy" numeric(8, 2),
    "speed" numeric(12, 2),
    "distance" numeric(12, 2),
    "time_spent" numeric(12, 2),
    "heading" numeric(5, 2),
    "battery_level" integer,
    "is_charging" boolean,
    "activity_type" "text",
    "geocode" "jsonb",
    "tz_diff" numeric(4, 1),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    PRIMARY KEY ("user_id", "recorded_at")
);
COMMENT ON COLUMN "public"."tracker_data"."distance" IS 'Distance in meters from the previous chronological point for this user';
COMMENT ON COLUMN "public"."tracker_data"."time_spent" IS 'Time spent in seconds from the previous chronological point for this user';
COMMENT ON COLUMN "public"."tracker_data"."tz_diff" IS 'Timezone difference from UTC in hours (e.g., +2.0 for UTC+2, -5.0 for UTC-5)';
CREATE TABLE IF NOT EXISTS "public"."trips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "image_url" "text",
    "labels" "text" [] DEFAULT '{}'::"text" [],
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "trips_status_check" CHECK (
        (
            "status" = ANY (
                ARRAY ['active'::"text", 'planned'::"text", 'completed'::"text", 'cancelled'::"text", 'pending'::"text", 'rejected'::"text"]
            )
        )
    )
);
COMMENT ON COLUMN "public"."trips"."status" IS 'Trip status: active, planned, completed, cancelled, pending (suggested), rejected';
COMMENT ON COLUMN "public"."trips"."labels" IS 'Array of labels including "suggested" for trips created from suggestions';
COMMENT ON COLUMN "public"."trips"."metadata" IS 'Trip metadata including dataPoints, visitedCities, visitedCountries, etc.';
CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "id" "uuid" NOT NULL PRIMARY KEY,
    "theme" "text" DEFAULT 'light'::"text",
    "language" "text" DEFAULT 'en'::"text",
    "notifications_enabled" boolean DEFAULT true,
    "timezone" "text" DEFAULT 'UTC+00:00 (London, Dublin)'::"text",
    "pexels_api_key" "text",
    "owntracks_api_key" "text",
    "trip_exclusions" "jsonb" DEFAULT '[]'::"jsonb",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
CREATE TABLE IF NOT EXISTS "public"."want_to_visit_places" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    "place_id" "text",
    "title" "text" NOT NULL,
    "country_code" character varying(2),
    "type" "text" DEFAULT 'place'::"text",
    "favorite" boolean DEFAULT false,
    "description" "text",
    "location" "public"."geometry"(Point, 4326) NOT NULL,
    "address" "text",
    "marker_type" "text" DEFAULT 'default'::"text",
    "marker_color" "text" DEFAULT '#3B82F6'::"text",
    "labels" "text"[] DEFAULT ARRAY[]::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON COLUMN "public"."want_to_visit_places"."title" IS 'Place title/name';
COMMENT ON COLUMN "public"."want_to_visit_places"."location" IS 'PostGIS Point geometry storing the place coordinates';
COMMENT ON COLUMN "public"."want_to_visit_places"."address" IS 'Full address of the place';
COMMENT ON COLUMN "public"."want_to_visit_places"."marker_type" IS 'Type of marker icon (default, home, restaurant, etc.)';
COMMENT ON COLUMN "public"."want_to_visit_places"."marker_color" IS 'Hex color code for the marker';
COMMENT ON COLUMN "public"."want_to_visit_places"."labels" IS 'Custom labels/tags for the place';
CREATE TABLE IF NOT EXISTS "public"."workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid",
    "status" "text" DEFAULT 'idle'::"text",
    "current_job" "uuid",
    "last_heartbeat" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "workers_status_check" CHECK (
        (
            "status" = ANY (
                ARRAY ['idle'::"text", 'working'::"text", 'error'::"text", 'offline'::"text"]
            )
        )
    )
);
-- Note: server_settings table removed - use Fluxbase AppSettingsManager instead
-- Note: audit_logs table removed - use Fluxbase audit logging instead
