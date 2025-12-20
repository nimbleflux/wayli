--
-- Migration: 013_pgvector_views.down.sql
-- Description: Remove secure views for chatbot vector queries
--

SET search_path TO public;

-- Revoke permissions first
REVOKE SELECT ON "public"."my_poi_embeddings" FROM authenticated;
REVOKE SELECT ON "public"."my_trip_embeddings" FROM authenticated;
REVOKE SELECT ON "public"."my_preferences" FROM authenticated;
REVOKE SELECT ON "public"."my_embedding_stats" FROM authenticated;

-- Drop views
DROP VIEW IF EXISTS "public"."my_embedding_stats";
DROP VIEW IF EXISTS "public"."my_preferences";
DROP VIEW IF EXISTS "public"."my_trip_embeddings";
DROP VIEW IF EXISTS "public"."my_poi_embeddings";
