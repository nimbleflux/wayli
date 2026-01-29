--
-- Migration: 021_fix_rls_policies.up.sql
-- Description: Fix RLS policies to use TO authenticated instead of PUBLIC,
--              add WITH CHECK clauses to UPDATE policies for defense in depth
-- Dependencies: 006_rls_policies.up.sql, 011_pgvector_rls.up.sql, 017_place_visits_incremental.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-29
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- USER_PROFILES TABLE
-- Uses `id` column as both PK and FK to auth.users(id)
-- =============================================================================

DROP POLICY IF EXISTS "User profiles can be viewed" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be inserted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be updated" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be deleted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "Service role full access to user_profiles" ON "public"."user_profiles";

-- User can view their own profile
CREATE POLICY "User profiles can be viewed" ON "public"."user_profiles"
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- User can insert their own profile
CREATE POLICY "User profiles can be inserted" ON "public"."user_profiles"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- User can update their own profile
CREATE POLICY "User profiles can be updated" ON "public"."user_profiles"
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- User can delete their own profile
CREATE POLICY "User profiles can be deleted" ON "public"."user_profiles"
FOR DELETE
TO authenticated
USING (auth.uid() = id);

-- Service role has full access
CREATE POLICY "Service role full access to user_profiles" ON "public"."user_profiles"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- USER_PREFERENCES TABLE
-- Uses `id` column as both PK and FK to auth.users(id)
-- =============================================================================

DROP POLICY IF EXISTS "User preferences can be viewed" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be inserted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be updated" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be deleted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "Service role full access to user_preferences" ON "public"."user_preferences";

-- User can view their own preferences
CREATE POLICY "User preferences can be viewed" ON "public"."user_preferences"
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- User can insert their own preferences
CREATE POLICY "User preferences can be inserted" ON "public"."user_preferences"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- User can update their own preferences
CREATE POLICY "User preferences can be updated" ON "public"."user_preferences"
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- User can delete their own preferences
CREATE POLICY "User preferences can be deleted" ON "public"."user_preferences"
FOR DELETE
TO authenticated
USING (auth.uid() = id);

-- Service role has full access
CREATE POLICY "Service role full access to user_preferences" ON "public"."user_preferences"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- TRACKER_DATA TABLE
-- Uses `user_id` column
-- Note: Admin/service_role policies already fixed in 018_tracker_data_admin_permissions
-- =============================================================================

DROP POLICY IF EXISTS "Users can view their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can insert their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can update their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can delete their own tracker data" ON "public"."tracker_data";

-- User can view their own tracker data
CREATE POLICY "Users can view their own tracker data" ON "public"."tracker_data"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- User can insert their own tracker data
CREATE POLICY "Users can insert their own tracker data" ON "public"."tracker_data"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- User can update their own tracker data
CREATE POLICY "Users can update their own tracker data" ON "public"."tracker_data"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User can delete their own tracker data
CREATE POLICY "Users can delete their own tracker data" ON "public"."tracker_data"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- TRIPS TABLE
-- Uses `user_id` column
-- =============================================================================

DROP POLICY IF EXISTS "Users can view their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can insert their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can update their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can delete their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Service role full access to trips" ON "public"."trips";

-- User can view their own trips
CREATE POLICY "Users can view their own trips" ON "public"."trips"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- User can insert their own trips
CREATE POLICY "Users can insert their own trips" ON "public"."trips"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- User can update their own trips
CREATE POLICY "Users can update their own trips" ON "public"."trips"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User can delete their own trips
CREATE POLICY "Users can delete their own trips" ON "public"."trips"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role has full access (for background jobs)
CREATE POLICY "Service role full access to trips" ON "public"."trips"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- WANT_TO_VISIT_PLACES TABLE
-- Uses `user_id` column
-- =============================================================================

DROP POLICY IF EXISTS "Users can view their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can insert their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can update their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can delete their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Service role full access to want_to_visit_places" ON "public"."want_to_visit_places";

-- User can view their own want to visit places
CREATE POLICY "Users can view their own want to visit places" ON "public"."want_to_visit_places"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- User can insert their own want to visit places
CREATE POLICY "Users can insert their own want to visit places" ON "public"."want_to_visit_places"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- User can update their own want to visit places
CREATE POLICY "Users can update their own want to visit places" ON "public"."want_to_visit_places"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User can delete their own want to visit places
CREATE POLICY "Users can delete their own want to visit places" ON "public"."want_to_visit_places"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access to want_to_visit_places" ON "public"."want_to_visit_places"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- POI_EMBEDDINGS TABLE
-- Uses `user_id` column
-- =============================================================================

DROP POLICY IF EXISTS "poi_embeddings_select_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_insert_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_update_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "poi_embeddings_delete_own" ON "public"."poi_embeddings";
DROP POLICY IF EXISTS "Service role full access to poi_embeddings" ON "public"."poi_embeddings";

-- User can view their own POI embeddings
CREATE POLICY "poi_embeddings_select_own" ON "public"."poi_embeddings"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- User can insert their own POI embeddings
CREATE POLICY "poi_embeddings_insert_own" ON "public"."poi_embeddings"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- User can update their own POI embeddings
CREATE POLICY "poi_embeddings_update_own" ON "public"."poi_embeddings"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User can delete their own POI embeddings
CREATE POLICY "poi_embeddings_delete_own" ON "public"."poi_embeddings"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role has full access (for embedding sync jobs)
CREATE POLICY "Service role full access to poi_embeddings" ON "public"."poi_embeddings"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- TRIP_EMBEDDINGS TABLE
-- Uses `user_id` column
-- =============================================================================

DROP POLICY IF EXISTS "trip_embeddings_select_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_insert_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_update_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "trip_embeddings_delete_own" ON "public"."trip_embeddings";
DROP POLICY IF EXISTS "Service role full access to trip_embeddings" ON "public"."trip_embeddings";

-- User can view their own trip embeddings
CREATE POLICY "trip_embeddings_select_own" ON "public"."trip_embeddings"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- User can insert their own trip embeddings
CREATE POLICY "trip_embeddings_insert_own" ON "public"."trip_embeddings"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- User can update their own trip embeddings
CREATE POLICY "trip_embeddings_update_own" ON "public"."trip_embeddings"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User can delete their own trip embeddings
CREATE POLICY "trip_embeddings_delete_own" ON "public"."trip_embeddings"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role has full access (for embedding sync jobs)
CREATE POLICY "Service role full access to trip_embeddings" ON "public"."trip_embeddings"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- USER_PREFERENCE_VECTORS TABLE
-- Uses `user_id` column
-- =============================================================================

DROP POLICY IF EXISTS "user_preference_vectors_select_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_insert_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_update_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "user_preference_vectors_delete_own" ON "public"."user_preference_vectors";
DROP POLICY IF EXISTS "Service role full access to user_preference_vectors" ON "public"."user_preference_vectors";

-- User can view their own preference vectors
CREATE POLICY "user_preference_vectors_select_own" ON "public"."user_preference_vectors"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- User can insert their own preference vectors
CREATE POLICY "user_preference_vectors_insert_own" ON "public"."user_preference_vectors"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- User can update their own preference vectors
CREATE POLICY "user_preference_vectors_update_own" ON "public"."user_preference_vectors"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User can delete their own preference vectors
CREATE POLICY "user_preference_vectors_delete_own" ON "public"."user_preference_vectors"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role has full access (for preference computation jobs)
CREATE POLICY "Service role full access to user_preference_vectors" ON "public"."user_preference_vectors"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================================================
-- PLACE_VISITS TABLE
-- Uses `user_id` column
-- Service role and admin policies need WITH CHECK added
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own place_visits" ON "public"."place_visits";
DROP POLICY IF EXISTS "Service role full access to place_visits" ON "public"."place_visits";
DROP POLICY IF EXISTS "Admin users full access to place_visits" ON "public"."place_visits";

-- User can view their own place visits
CREATE POLICY "Users can view own place_visits" ON "public"."place_visits"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access to place_visits" ON "public"."place_visits"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Admin users have full access
CREATE POLICY "Admin users full access to place_visits" ON "public"."place_visits"
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin')
WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- =============================================================================
-- PLACE_VISITS_STATE TABLE
-- Service role and admin only - add WITH CHECK
-- =============================================================================

DROP POLICY IF EXISTS "Service role full access to place_visits_state" ON "public"."place_visits_state";
DROP POLICY IF EXISTS "Admin users full access to place_visits_state" ON "public"."place_visits_state";

-- Service role has full access
CREATE POLICY "Service role full access to place_visits_state" ON "public"."place_visits_state"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Admin users have full access
CREATE POLICY "Admin users full access to place_visits_state" ON "public"."place_visits_state"
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin')
WITH CHECK (auth.jwt() ->> 'role' = 'admin');
