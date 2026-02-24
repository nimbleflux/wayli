--
-- Migration: 023_mark_deprecated.down.sql
-- Description: Rollback deprecation comments
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

-- Remove deprecation comments from tables
COMMENT ON TABLE IF EXISTS poi_embeddings IS NULL;
COMMENT ON TABLE IF EXISTS trip_embeddings IS NULL;
COMMENT ON TABLE IF EXISTS user_preference_vectors IS NULL;

-- Remove deprecation comments from views
COMMENT ON VIEW IF EXISTS my_poi_embeddings IS NULL;
COMMENT ON VIEW IF EXISTS my_trip_embeddings IS NULL;
COMMENT ON VIEW IF EXISTS my_preferences IS NULL;
COMMENT ON VIEW IF EXISTS my_embedding_stats IS NULL;

-- Remove deprecation comments from functions (use correct signatures matching migration 012)
COMMENT ON FUNCTION IF EXISTS search_similar_pois(vector(1536), uuid, integer, text, text, text, varchar(2), numeric) IS NULL;
COMMENT ON FUNCTION IF EXISTS search_similar_trips(vector(1536), uuid, integer, numeric) IS NULL;
COMMENT ON FUNCTION IF EXISTS get_user_preferences(uuid, text) IS NULL;
COMMENT ON FUNCTION IF EXISTS find_similar_users_by_preference(uuid, text, integer, numeric) IS NULL;
COMMENT ON FUNCTION IF EXISTS get_embedding_stats(uuid) IS NULL;

-- Remove schema comment
COMMENT ON SCHEMA public IS NULL;

