--
-- Migration: 011_pgvector_rls.up.sql
-- Description: RLS policies for vector embedding tables
-- Dependencies: 009_pgvector_setup.up.sql, 006_rls_policies.up.sql (auth schema)
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- Enable RLS on all vector tables
-- =============================================================================

ALTER TABLE "public"."poi_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trip_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_preference_vectors" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- POI Embeddings Policies
-- Users can only access their own POI embeddings
-- Service role has full access for sync jobs
-- =============================================================================

-- Drop existing policies first to ensure idempotency
DROP POLICY IF EXISTS "poi_embeddings_select_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_insert_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_update_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_delete_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_select_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_insert_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_update_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_delete_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "user_preference_vectors_select_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_insert_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_update_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_delete_own" ON "public"."user_preference_vectors";

CREATE POLICY "poi_embeddings_select_own" ON "public"."poi_embeddings"
FOR SELECT USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "poi_embeddings_insert_own" ON "public"."poi_embeddings"
FOR INSERT WITH CHECK (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "poi_embeddings_update_own" ON "public"."poi_embeddings"
FOR UPDATE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "poi_embeddings_delete_own" ON "public"."poi_embeddings"
FOR DELETE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

-- =============================================================================
-- Trip Embeddings Policies
-- Users can only access their own trip embeddings
-- Service role has full access for sync jobs
-- =============================================================================

CREATE POLICY "trip_embeddings_select_own" ON "public"."trip_embeddings"
FOR SELECT USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "trip_embeddings_insert_own" ON "public"."trip_embeddings"
FOR INSERT WITH CHECK (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "trip_embeddings_update_own" ON "public"."trip_embeddings"
FOR UPDATE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "trip_embeddings_delete_own" ON "public"."trip_embeddings"
FOR DELETE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

-- =============================================================================
-- User Preference Vectors Policies
-- Users can only access their own preference vectors
-- Service role has full access for computing preferences
-- =============================================================================

CREATE POLICY "user_preference_vectors_select_own" ON "public"."user_preference_vectors"
FOR SELECT USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "user_preference_vectors_insert_own" ON "public"."user_preference_vectors"
FOR INSERT WITH CHECK (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "user_preference_vectors_update_own" ON "public"."user_preference_vectors"
FOR UPDATE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);

CREATE POLICY "user_preference_vectors_delete_own" ON "public"."user_preference_vectors"
FOR DELETE USING (
    (
        (SELECT "auth"."uid"() AS "uid") = "user_id"
    )
    OR (
        (SELECT "auth"."role"() AS "role") = 'service_role'::"text"
    )
);
