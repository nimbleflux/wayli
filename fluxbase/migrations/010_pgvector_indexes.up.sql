--
-- Migration: 010_pgvector_indexes.up.sql
-- Description: Create indexes for vector similarity search
-- Dependencies: 009_pgvector_setup.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- POI Embeddings Indexes
-- =============================================================================

-- HNSW index for fast approximate nearest neighbor search
-- HNSW is preferred over IVFFlat because:
-- 1. Better recall at same speed
-- 2. No need to tune number of lists
-- 3. Supports concurrent inserts (important for real-time embedding sync)
-- Using cosine distance (vector_cosine_ops) for semantic similarity
CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_vector_hnsw"
ON "public"."poi_embeddings"
USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX "public"."idx_poi_embeddings_vector_hnsw" IS 'HNSW index for fast approximate nearest neighbor search on POI embeddings. m=16 for good recall/speed balance, ef_construction=64 for build quality.';

-- Standard indexes for filtering before/after vector search
CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_user_id"
ON "public"."poi_embeddings" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_category"
ON "public"."poi_embeddings" ("poi_category");

CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_cuisine"
ON "public"."poi_embeddings" ("poi_cuisine");

CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_city"
ON "public"."poi_embeddings" ("city");

CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_country"
ON "public"."poi_embeddings" ("country_code");

CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_amenity"
ON "public"."poi_embeddings" ("poi_amenity");

-- Composite index for common query pattern: user + category
CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_user_category"
ON "public"."poi_embeddings" ("user_id", "poi_category");

-- Index for finding embeddings that need to be generated
CREATE INDEX IF NOT EXISTS "idx_poi_embeddings_not_embedded"
ON "public"."poi_embeddings" ("user_id")
WHERE "embedded_at" IS NULL;

-- =============================================================================
-- Trip Embeddings Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS "idx_trip_embeddings_vector_hnsw"
ON "public"."trip_embeddings"
USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX "public"."idx_trip_embeddings_vector_hnsw" IS 'HNSW index for fast approximate nearest neighbor search on trip embeddings.';

CREATE INDEX IF NOT EXISTS "idx_trip_embeddings_user_id"
ON "public"."trip_embeddings" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_trip_embeddings_trip_id"
ON "public"."trip_embeddings" ("trip_id");

-- Index for finding embeddings that need to be generated
CREATE INDEX IF NOT EXISTS "idx_trip_embeddings_not_embedded"
ON "public"."trip_embeddings" ("user_id")
WHERE "embedded_at" IS NULL;

-- =============================================================================
-- User Preference Vectors Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS "idx_user_preference_vectors_vector_hnsw"
ON "public"."user_preference_vectors"
USING hnsw ("preference_embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX "public"."idx_user_preference_vectors_vector_hnsw" IS 'HNSW index for user preference similarity search.';

CREATE INDEX IF NOT EXISTS "idx_user_preference_vectors_user_id"
ON "public"."user_preference_vectors" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_user_preference_vectors_type"
ON "public"."user_preference_vectors" ("preference_type");

-- Composite index for common query: user + preference type
CREATE INDEX IF NOT EXISTS "idx_user_preference_vectors_user_type"
ON "public"."user_preference_vectors" ("user_id", "preference_type");
