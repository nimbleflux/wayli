--
-- Migration: 023_drop_embedding_views.up.sql
-- Description: Drop deprecated embedding views and mark tables/functions as deprecated
--              Views are dropped entirely; tables kept for backwards compatibility
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
SET search_path TO public;

-- =============================================================================
-- Mark embedding tables as deprecated (conditional comments)
-- PostgreSQL doesn't support IF EXISTS with COMMENT, so we use DO blocks
-- =============================================================================

DO $$
BEGIN
    -- Mark embedding tables as deprecated
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'poi_embeddings' AND schemaname = 'public') THEN
        EXECUTE 'COMMENT ON TABLE poi_embeddings IS $msg$DEPRECATED: Use knowledge base "wayli-pois" instead. This table is kept for backwards compatibility and will not be removed. New installations should use the Fluxbase knowledge base feature.$msg$';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'trip_embeddings' AND schemaname = 'public') THEN
        EXECUTE 'COMMENT ON TABLE trip_embeddings IS $msg$DEPRECATED: Use knowledge base "wayli-trips" instead. This table is kept for backwards compatibility and will not be removed. New installations should use the Fluxbase knowledge base feature.$msg$';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_preference_vectors' AND schemaname = 'public') THEN
        EXECUTE 'COMMENT ON TABLE user_preference_vectors IS $msg$DEPRECATED: Use user_preferences table instead. This table is kept for backwards compatibility and will not be removed. New installations should use the simpler user_preferences table with array fields.$msg$';
    END IF;
END $$;

DO $$
BEGIN
    -- Drop deprecated views entirely (no longer needed)
    IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'my_poi_embeddings' AND schemaname = 'public') THEN
        EXECUTE 'DROP VIEW IF EXISTS my_poi_embeddings CASCADE';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'my_trip_embeddings' AND schemaname = 'public') THEN
        EXECUTE 'DROP VIEW IF EXISTS my_trip_embeddings CASCADE';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'my_preferences' AND schemaname = 'public') THEN
        EXECUTE 'DROP VIEW IF EXISTS my_preferences CASCADE';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'my_embedding_stats' AND schemaname = 'public') THEN
        EXECUTE 'DROP VIEW IF EXISTS my_embedding_stats CASCADE';
    END IF;
END $$;

DO $$
BEGIN
    -- Mark functions as deprecated (use correct signatures matching migration 012)
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'search_similar_pois') THEN
        EXECUTE 'COMMENT ON FUNCTION search_similar_pois(vector(1536), uuid, integer, text, text, text, varchar(2), numeric) IS $msg$DEPRECATED: Use knowledge base semantic search instead. This function is kept for backwards compatibility.$msg$';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'search_similar_trips') THEN
        EXECUTE 'COMMENT ON FUNCTION search_similar_trips(vector(1536), uuid, integer, numeric) IS $msg$DEPRECATED: Use knowledge base semantic search instead. This function is kept for backwards compatibility.$msg$';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_preferences') THEN
        EXECUTE 'COMMENT ON FUNCTION get_user_preferences(uuid, text) IS $msg$DEPRECATED: Query user_preferences table directly instead. This function is kept for backwards compatibility.$msg$';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'find_similar_users_by_preference') THEN
        EXECUTE 'COMMENT ON FUNCTION find_similar_users_by_preference(uuid, text, integer, numeric) IS $msg$DEPRECATED: Collaborative filtering feature removed from new architecture. This function is kept for backwards compatibility.$msg$';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_embedding_stats') THEN
        EXECUTE 'COMMENT ON FUNCTION get_embedding_stats(uuid) IS $msg$DEPRECATED: Statistics for deprecated embedding infrastructure. This function is kept for backwards compatibility.$msg$';
    END IF;
END $$;

-- Add note about migration path
COMMENT ON SCHEMA public IS 'Wayli database schema. Note: poi_embeddings, trip_embeddings, and user_preference_vectors tables are deprecated. Use Fluxbase knowledge bases and user_preferences table for new features.';

