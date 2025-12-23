--
-- Migration: 012_pgvector_functions.down.sql
-- Description: Remove vector search functions
--

SET search_path TO public;

-- Revoke permissions first
REVOKE EXECUTE ON FUNCTION IF EXISTS "public"."search_similar_pois"(vector(1536), uuid, integer, text, text, text, varchar(2), numeric) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION IF EXISTS "public"."search_similar_trips"(vector(1536), uuid, integer, numeric) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION IF EXISTS "public"."get_user_preferences"(uuid, text) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION IF EXISTS "public"."find_similar_users_by_preference"(uuid, text, integer, numeric) FROM service_role;
REVOKE EXECUTE ON FUNCTION IF EXISTS "public"."get_embedding_stats"(uuid) FROM authenticated, service_role;

-- Drop functions
DROP FUNCTION IF EXISTS "public"."search_similar_pois"(vector(1536), uuid, integer, text, text, text, varchar(2), numeric);
DROP FUNCTION IF EXISTS "public"."search_similar_trips"(vector(1536), uuid, integer, numeric);
DROP FUNCTION IF EXISTS "public"."get_user_preferences"(uuid, text);
DROP FUNCTION IF EXISTS "public"."find_similar_users_by_preference"(uuid, text, integer, numeric);
DROP FUNCTION IF EXISTS "public"."get_embedding_stats"(uuid);
