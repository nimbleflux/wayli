--
-- Migration: 011_pgvector_rls.down.sql
-- Description: Remove RLS policies for vector embedding tables
--

SET search_path TO public;

-- POI embeddings policies
DROP POLICY IF EXISTS "poi_embeddings_select_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_insert_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_update_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_delete_own" ON "public"."poi_embeddings";

-- Trip embeddings policies
DROP POLICY IF EXISTS "trip_embeddings_select_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_insert_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_update_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_delete_own" ON "public"."trip_embeddings";

-- User preference vectors policies
DROP POLICY IF EXISTS "user_preference_vectors_select_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_insert_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_update_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_delete_own" ON "public"."user_preference_vectors";

-- Disable RLS (optional - comment out if you want to keep RLS enabled)
ALTER TABLE IF EXISTS "public"."poi_embeddings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."trip_embeddings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."user_preference_vectors" DISABLE ROW LEVEL SECURITY;
