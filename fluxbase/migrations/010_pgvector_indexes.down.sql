--
-- Migration: 010_pgvector_indexes.down.sql
-- Description: Remove pgvector indexes
--

SET search_path TO public;

-- POI embeddings indexes
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_vector_hnsw";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_user_id";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_category";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_cuisine";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_city";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_country";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_amenity";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_user_category";
DROP INDEX IF EXISTS "public"."idx_poi_embeddings_not_embedded";

-- Trip embeddings indexes
DROP INDEX IF EXISTS "public"."idx_trip_embeddings_vector_hnsw";
DROP INDEX IF EXISTS "public"."idx_trip_embeddings_user_id";
DROP INDEX IF EXISTS "public"."idx_trip_embeddings_trip_id";
DROP INDEX IF EXISTS "public"."idx_trip_embeddings_not_embedded";

-- User preference vectors indexes
DROP INDEX IF EXISTS "public"."idx_user_preference_vectors_vector_hnsw";
DROP INDEX IF EXISTS "public"."idx_user_preference_vectors_user_id";
DROP INDEX IF EXISTS "public"."idx_user_preference_vectors_type";
DROP INDEX IF EXISTS "public"."idx_user_preference_vectors_user_type";
