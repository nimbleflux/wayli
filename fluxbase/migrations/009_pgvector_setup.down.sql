--
-- Migration: 009_pgvector_setup.down.sql
-- Description: Remove pgvector extension and embedding tables
--

SET search_path TO public;

-- Drop foreign key constraints first
ALTER TABLE IF EXISTS "public"."trip_embeddings"
    DROP CONSTRAINT IF EXISTS "trip_embeddings_trip_id_fkey";

-- Drop tables (order matters due to no FK from poi_embeddings)
DROP TABLE IF EXISTS "public"."user_preference_vectors" CASCADE;
DROP TABLE IF EXISTS "public"."trip_embeddings" CASCADE;
DROP TABLE IF EXISTS "public"."poi_embeddings" CASCADE;

-- Note: We don't drop the vector extension as it may be used by other tables
-- If you want to drop it, uncomment the following:
-- DROP EXTENSION IF EXISTS vector;
