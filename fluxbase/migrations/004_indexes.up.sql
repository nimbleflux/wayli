--
-- Migration: 004_indexes.up.sql
-- Description: Create all database indexes for performance optimization
-- Dependencies: 003_tables_views.up.sql (tables must exist first)
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

CREATE INDEX IF NOT EXISTS "idx_jobs_created_at" ON "public"."jobs" USING "btree" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_jobs_created_by" ON "public"."jobs" USING "btree" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_jobs_priority" ON "public"."jobs" USING "btree" ("priority");
CREATE INDEX IF NOT EXISTS "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");
CREATE INDEX IF NOT EXISTS "idx_jobs_worker_id" ON "public"."jobs" USING "btree" ("worker_id");
CREATE INDEX IF NOT EXISTS "idx_jobs_queue" ON "public"."jobs" USING "btree" ("status", "priority" DESC, "created_at")
WHERE ("status" = ANY (ARRAY ['queued'::"text", 'running'::"text"]));
COMMENT ON INDEX "public"."idx_jobs_queue" IS 'Optimizes job queue queries for processing queued and running jobs by priority';
CREATE INDEX IF NOT EXISTS "idx_tracker_data_device_id" ON "public"."tracker_data" USING "btree" ("device_id");
CREATE INDEX IF NOT EXISTS "idx_tracker_data_location" ON "public"."tracker_data" USING "gist" ("location");
CREATE INDEX IF NOT EXISTS "idx_tracker_data_timestamp" ON "public"."tracker_data" USING "btree" ("recorded_at");
CREATE INDEX IF NOT EXISTS "idx_tracker_data_tz_diff" ON "public"."tracker_data" USING "btree" ("tz_diff");
CREATE INDEX IF NOT EXISTS "idx_tracker_data_user_id" ON "public"."tracker_data" USING "btree" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_tracker_data_user_timestamp_distance" ON "public"."tracker_data" USING "btree" ("user_id", "recorded_at")
WHERE (
        ("distance" IS NULL)
        OR ("distance" = (0)::numeric)
    );
COMMENT ON INDEX "public"."idx_tracker_data_user_timestamp_distance" IS 'Optimizes finding records that need distance calculation';
CREATE INDEX IF NOT EXISTS "idx_tracker_data_user_timestamp_location" ON "public"."tracker_data" USING "btree" ("user_id", "recorded_at")
WHERE ("location" IS NOT NULL);
COMMENT ON INDEX "public"."idx_tracker_data_user_timestamp_location" IS 'Optimizes distance calculation queries by user and timestamp with location filter';
CREATE INDEX IF NOT EXISTS "idx_tracker_data_user_timestamp_ordered" ON "public"."tracker_data" USING "btree" ("user_id", "recorded_at", "location")
WHERE ("location" IS NOT NULL);
COMMENT ON INDEX "public"."idx_tracker_data_user_timestamp_ordered" IS 'Optimizes LAG window function performance for distance calculations';
CREATE INDEX IF NOT EXISTS "idx_tracker_data_geocode" ON "public"."tracker_data" USING "gin" ("geocode");
COMMENT ON INDEX "public"."idx_tracker_data_geocode" IS 'Optimizes JSONB geocode searches using GIN index';
CREATE INDEX IF NOT EXISTS "idx_trips_end_date" ON "public"."trips" USING "btree" ("end_date");
CREATE INDEX IF NOT EXISTS "idx_trips_start_date" ON "public"."trips" USING "btree" ("start_date");
CREATE INDEX IF NOT EXISTS "idx_trips_user_id" ON "public"."trips" USING "btree" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_trips_date_range" ON "public"."trips" USING "btree" ("user_id", "start_date", "end_date");
COMMENT ON INDEX "public"."idx_trips_date_range" IS 'Optimizes trip date range queries for a specific user';
CREATE INDEX IF NOT EXISTS "idx_trips_metadata" ON "public"."trips" USING "gin" ("metadata");
COMMENT ON INDEX "public"."idx_trips_metadata" IS 'Optimizes JSONB metadata searches using GIN index';
CREATE INDEX IF NOT EXISTS "idx_user_preferences_id" ON "public"."user_preferences" USING "btree" ("id");
CREATE INDEX IF NOT EXISTS "idx_user_preferences_trip_exclusions" ON "public"."user_preferences" USING "gin" ("trip_exclusions");
COMMENT ON INDEX "public"."idx_user_preferences_trip_exclusions" IS 'Optimizes JSONB trip_exclusions searches using GIN index';
CREATE INDEX IF NOT EXISTS "idx_user_profiles_id" ON "public"."user_profiles" USING "btree" ("id");
CREATE INDEX IF NOT EXISTS "idx_want_to_visit_places_created_at" ON "public"."want_to_visit_places" USING "btree" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_want_to_visit_places_favorite" ON "public"."want_to_visit_places" USING "btree" ("favorite");
CREATE INDEX IF NOT EXISTS "idx_want_to_visit_places_type" ON "public"."want_to_visit_places" USING "btree" ("type");
CREATE INDEX IF NOT EXISTS "idx_want_to_visit_places_marker_type" ON "public"."want_to_visit_places" USING "btree" ("marker_type");
CREATE INDEX IF NOT EXISTS "idx_want_to_visit_places_user_id" ON "public"."want_to_visit_places" USING "btree" ("user_id");

-- Note: workers indexes removed - workers are now managed by Fluxbase Jobs platform

-- =============================================================================
-- Place Visits Materialized View Indexes
-- =============================================================================

-- Required for REFRESH CONCURRENTLY (must have unique index)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_place_visits_unique" ON "public"."place_visits" ("id");

-- Primary query indexes
CREATE INDEX IF NOT EXISTS "idx_place_visits_user_started" ON "public"."place_visits" USING "btree" ("user_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_place_visits_poi_name" ON "public"."place_visits" USING "btree" ("poi_name");
CREATE INDEX IF NOT EXISTS "idx_place_visits_poi_amenity" ON "public"."place_visits" USING "btree" ("poi_amenity");
CREATE INDEX IF NOT EXISTS "idx_place_visits_poi_category" ON "public"."place_visits" USING "btree" ("poi_category");
CREATE INDEX IF NOT EXISTS "idx_place_visits_poi_cuisine" ON "public"."place_visits" USING "btree" ("poi_cuisine");
CREATE INDEX IF NOT EXISTS "idx_place_visits_poi_sport" ON "public"."place_visits" USING "btree" ("poi_sport");

-- Spatial index for location queries
CREATE INDEX IF NOT EXISTS "idx_place_visits_location" ON "public"."place_visits" USING "gist" ("location");

-- JSONB index for poi_tags
CREATE INDEX IF NOT EXISTS "idx_place_visits_poi_tags" ON "public"."place_visits" USING "gin" ("poi_tags");

-- Location indexes
CREATE INDEX IF NOT EXISTS "idx_place_visits_country" ON "public"."place_visits" USING "btree" ("country_code");
CREATE INDEX IF NOT EXISTS "idx_place_visits_city" ON "public"."place_visits" USING "btree" ("city");

-- Time-based query indexes
CREATE INDEX IF NOT EXISTS "idx_place_visits_time_of_day" ON "public"."place_visits" USING "btree" ("visit_time_of_day");
CREATE INDEX IF NOT EXISTS "idx_place_visits_day_of_week" ON "public"."place_visits" USING "btree" ("day_of_week");
CREATE INDEX IF NOT EXISTS "idx_place_visits_weekend" ON "public"."place_visits" USING "btree" ("is_weekend");
CREATE INDEX IF NOT EXISTS "idx_place_visits_duration_category" ON "public"."place_visits" USING "btree" ("duration_category");

-- Full-text search index
CREATE INDEX IF NOT EXISTS "idx_place_visits_fts" ON "public"."place_visits" USING "gin" ("poi_name_search");
