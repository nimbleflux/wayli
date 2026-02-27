--
-- Migration: 024_add_missing_foreign_keys.up.sql
-- Description: Add missing foreign key constraints on tables with user_id columns
-- Dependencies: 003_tables_views.up.sql, 009_pgvector_setup.up.sql, 017_place_visits_incremental.up.sql
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

-- ============================================================================
-- CLEANUP ORPHANED RECORDS BEFORE ADDING FOREIGN KEY CONSTRAINTS
-- ============================================================================

-- Clean place_visits
DELETE FROM "public"."place_visits"
WHERE "user_id" NOT IN (
    SELECT "id" FROM "auth"."users"
);

-- Clean poi_embeddings
DELETE FROM "public"."poi_embeddings"
WHERE "user_id" NOT IN (
    SELECT "id" FROM "auth"."users"
);

-- Clean trip_embeddings
DELETE FROM "public"."trip_embeddings"
WHERE "user_id" NOT IN (
    SELECT "id" FROM "auth"."users"
);

-- Clean user_preference_vectors
DELETE FROM "public"."user_preference_vectors"
WHERE "user_id" NOT IN (
    SELECT "id" FROM "auth"."users"
);

-- ============================================================================
-- ADD FOREIGN KEY CONSTRAINTS (idempotent - drop if exists before adding)
-- ============================================================================

-- place_visits.user_id -> auth.users(id)
ALTER TABLE "public"."place_visits"
DROP CONSTRAINT IF EXISTS "place_visits_user_id_fkey";

ALTER TABLE ONLY "public"."place_visits"
ADD CONSTRAINT "place_visits_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

-- poi_embeddings.user_id -> auth.users(id)
ALTER TABLE "public"."poi_embeddings"
DROP CONSTRAINT IF EXISTS "poi_embeddings_user_id_fkey";

ALTER TABLE ONLY "public"."poi_embeddings"
ADD CONSTRAINT "poi_embeddings_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

-- trip_embeddings.user_id -> auth.users(id)
ALTER TABLE "public"."trip_embeddings"
DROP CONSTRAINT IF EXISTS "trip_embeddings_user_id_fkey";

ALTER TABLE ONLY "public"."trip_embeddings"
ADD CONSTRAINT "trip_embeddings_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

-- user_preference_vectors.user_id -> auth.users(id)
ALTER TABLE "public"."user_preference_vectors"
DROP CONSTRAINT IF EXISTS "user_preference_vectors_user_id_fkey";

ALTER TABLE ONLY "public"."user_preference_vectors"
ADD CONSTRAINT "user_preference_vectors_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;

-- ============================================================================
-- ADD FOREIGN KEY FOR trip_embeddings.trip_id -> trips(id)
-- ============================================================================

-- Clean orphaned trip_embeddings
DELETE FROM "public"."trip_embeddings"
WHERE "trip_id" NOT IN (
    SELECT "id" FROM "public"."trips"
);

ALTER TABLE "public"."trip_embeddings"
DROP CONSTRAINT IF EXISTS "trip_embeddings_trip_id_fkey";

ALTER TABLE ONLY "public"."trip_embeddings"
ADD CONSTRAINT "trip_embeddings_trip_id_fkey"
FOREIGN KEY ("trip_id") REFERENCES "public"."trips" ("id") ON DELETE CASCADE;
