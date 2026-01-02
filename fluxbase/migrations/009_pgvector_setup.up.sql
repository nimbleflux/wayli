--
-- Migration: 009_pgvector_setup.up.sql
-- Description: Add pgvector extension and embedding tables for vector search capabilities
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

SET default_tablespace = '';
SET default_table_access_method = "heap";
SET search_path TO public;

-- =============================================================================
-- 1. Enable pgvector extension
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

COMMENT ON EXTENSION vector IS 'pgvector extension for vector similarity search. Used for semantic search of POIs and trips.';

-- =============================================================================
-- 2. POI Embeddings Table
-- Stores embeddings for place visits for similarity search
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."poi_embeddings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    -- Reference to the unique POI (composite key from my_poi_summary)
    "poi_name" "text" NOT NULL,
    "poi_amenity" "text",
    "poi_category" "text",
    "city" "text",
    "country_code" "varchar"(2),
    -- Embedding vector (1536 dimensions for text-embedding-3-small)
    "embedding" vector(1536),
    -- Source text used to generate embedding (for debugging/regeneration)
    "source_text" "text",
    -- Metadata for filtering
    "poi_cuisine" "text",
    "poi_sport" "text",
    "visit_count" INTEGER DEFAULT 0,
    "avg_duration_minutes" INTEGER DEFAULT 0,
    -- Timestamps
    "embedded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    -- Unique constraint to prevent duplicates per user per POI
    CONSTRAINT "poi_embeddings_unique" UNIQUE ("user_id", "poi_name", "city", "country_code")
);

COMMENT ON TABLE "public"."poi_embeddings" IS 'Vector embeddings for POI visits. Used for semantic similarity search (find similar places). Each user has their own embeddings.';
COMMENT ON COLUMN "public"."poi_embeddings"."embedding" IS 'Vector embedding (1536 dimensions) for semantic search. Generated from source_text using text-embedding-3-small model.';
COMMENT ON COLUMN "public"."poi_embeddings"."source_text" IS 'Text used to generate the embedding. Format: "POI Name. Type: X. Category: Y. Cuisine: Z. City: C, Country: CC"';
COMMENT ON COLUMN "public"."poi_embeddings"."embedded_at" IS 'When the embedding was last generated. NULL if not yet embedded.';

-- =============================================================================
-- 3. Trip Embeddings Table
-- Stores embeddings for trips for similarity search
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."trip_embeddings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    "trip_id" "uuid" NOT NULL,
    -- Embedding vector
    "embedding" vector(1536),
    -- Source text used to generate embedding
    "source_text" "text",
    -- Timestamps
    "embedded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    -- Unique constraint (one embedding per trip)
    CONSTRAINT "trip_embeddings_unique" UNIQUE ("trip_id")
);

COMMENT ON TABLE "public"."trip_embeddings" IS 'Vector embeddings for trips. Used for semantic search and similar trip discovery.';
COMMENT ON COLUMN "public"."trip_embeddings"."source_text" IS 'Text used to generate the embedding. Format: "Trip Title. Description. Cities: X. Countries: Y. Labels: Z"';

-- =============================================================================
-- 4. User Preference Vectors Table
-- Aggregated preference vectors learned from user behavior
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."user_preference_vectors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    -- Preference category
    "preference_type" "text" NOT NULL,
    -- Aggregated preference embedding (learned from visit patterns)
    "preference_embedding" vector(1536),
    -- Supporting data
    "top_items" "jsonb",
    "confidence_score" numeric(4,3),
    "sample_count" integer DEFAULT 0,
    -- Timestamps
    "computed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    -- Unique constraint (one preference vector per type per user)
    CONSTRAINT "user_preference_vectors_unique" UNIQUE ("user_id", "preference_type"),
    -- Valid preference types
    CONSTRAINT "user_preference_vectors_type_check" CHECK (
        "preference_type" IN ('cuisine', 'poi_category', 'travel_style', 'time_of_day', 'overall')
    )
);

COMMENT ON TABLE "public"."user_preference_vectors" IS 'User preference vectors computed from visit history. Used for personalized recommendations.';
COMMENT ON COLUMN "public"."user_preference_vectors"."preference_type" IS 'Type of preference: cuisine (food preferences), poi_category (activity preferences), travel_style (adventure vs relaxation), time_of_day (morning/evening person), overall (general preferences)';
COMMENT ON COLUMN "public"."user_preference_vectors"."top_items" IS 'JSON object with top items for this preference type. Example: {"japanese": 15, "italian": 12, "vietnamese": 8}';
COMMENT ON COLUMN "public"."user_preference_vectors"."confidence_score" IS 'Confidence in the preference vector (0.000 - 1.000). Higher values indicate more data points.';
COMMENT ON COLUMN "public"."user_preference_vectors"."sample_count" IS 'Number of data points (visits/trips) used to compute this preference vector.';

-- =============================================================================
-- 5. Foreign Key Constraints
-- Note: We don't add FK to auth.users to avoid coupling with Supabase auth schema
-- RLS policies will enforce user access instead
-- =============================================================================

-- Trip embeddings must reference a valid trip (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'trip_embeddings_trip_id_fkey'
    ) THEN
        ALTER TABLE "public"."trip_embeddings"
            ADD CONSTRAINT "trip_embeddings_trip_id_fkey"
            FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;
    END IF;
END $$;
