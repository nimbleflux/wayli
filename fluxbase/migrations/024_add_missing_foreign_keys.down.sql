--
-- Migration: 024_add_missing_foreign_keys.down.sql
-- Description: Remove foreign key constraints added in migration 024
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
-- DROP FOREIGN KEY CONSTRAINTS
-- ============================================================================

ALTER TABLE "public"."place_visits" DROP CONSTRAINT IF EXISTS "place_visits_user_id_fkey";
ALTER TABLE "public"."poi_embeddings" DROP CONSTRAINT IF EXISTS "poi_embeddings_user_id_fkey";
ALTER TABLE "public"."trip_embeddings" DROP CONSTRAINT IF EXISTS "trip_embeddings_user_id_fkey";
ALTER TABLE "public"."user_preference_vectors" DROP CONSTRAINT IF EXISTS "user_preference_vectors_user_id_fkey";
ALTER TABLE "public"."trip_embeddings" DROP CONSTRAINT IF EXISTS "trip_embeddings_trip_id_fkey";
