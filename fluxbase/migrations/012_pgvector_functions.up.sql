--
-- Migration: 012_pgvector_functions.up.sql
-- Description: Functions for vector similarity search
-- Dependencies: 009_pgvector_setup.up.sql, 010_pgvector_indexes.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- Similar POIs Search Function
-- Find POIs similar to a query embedding
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."search_similar_pois"(
    "query_embedding" vector(1536),
    "p_user_id" "uuid",
    "p_limit" integer DEFAULT 10,
    "p_poi_category" "text" DEFAULT NULL,
    "p_poi_cuisine" "text" DEFAULT NULL,
    "p_city" "text" DEFAULT NULL,
    "p_country_code" "varchar"(2) DEFAULT NULL,
    "p_min_similarity" numeric DEFAULT 0.5
)
RETURNS TABLE (
    "id" "uuid",
    "poi_name" "text",
    "poi_amenity" "text",
    "poi_category" "text",
    "poi_cuisine" "text",
    "poi_sport" "text",
    "city" "text",
    "country_code" "varchar"(2),
    "visit_count" integer,
    "avg_duration_minutes" integer,
    "similarity" numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pe.id,
        pe.poi_name,
        pe.poi_amenity,
        pe.poi_category,
        pe.poi_cuisine,
        pe.poi_sport,
        pe.city,
        pe.country_code,
        pe.visit_count,
        pe.avg_duration_minutes,
        ROUND((1 - (pe.embedding <=> query_embedding))::numeric, 4) as similarity
    FROM poi_embeddings pe
    WHERE pe.user_id = p_user_id
        AND pe.embedding IS NOT NULL
        AND pe.embedded_at IS NOT NULL
        AND (p_poi_category IS NULL OR pe.poi_category = p_poi_category)
        AND (p_poi_cuisine IS NULL OR pe.poi_cuisine ILIKE '%' || p_poi_cuisine || '%')
        AND (p_city IS NULL OR pe.city ILIKE '%' || p_city || '%')
        AND (p_country_code IS NULL OR pe.country_code = p_country_code)
        AND (1 - (pe.embedding <=> query_embedding)) >= p_min_similarity
    ORDER BY pe.embedding <=> query_embedding
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION "public"."search_similar_pois" IS 'Find POIs similar to a query embedding. Uses cosine similarity. Returns only POIs belonging to the specified user.';

-- =============================================================================
-- Similar Trips Search Function
-- Find trips similar to a query embedding
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."search_similar_trips"(
    "query_embedding" vector(1536),
    "p_user_id" "uuid",
    "p_limit" integer DEFAULT 10,
    "p_min_similarity" numeric DEFAULT 0.5
)
RETURNS TABLE (
    "id" "uuid",
    "trip_id" "uuid",
    "trip_title" "text",
    "trip_description" "text",
    "start_date" "date",
    "end_date" "date",
    "status" "text",
    "image_url" "text",
    "visited_cities" "text",
    "visited_countries" "text",
    "similarity" numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        te.id,
        te.trip_id,
        t.title as trip_title,
        t.description as trip_description,
        t.start_date,
        t.end_date,
        t.status,
        t.image_url,
        t.metadata->>'visitedCities' as visited_cities,
        t.metadata->>'visitedCountries' as visited_countries,
        ROUND((1 - (te.embedding <=> query_embedding))::numeric, 4) as similarity
    FROM trip_embeddings te
    JOIN trips t ON te.trip_id = t.id
    WHERE te.user_id = p_user_id
        AND te.embedding IS NOT NULL
        AND te.embedded_at IS NOT NULL
        AND t.status IN ('active', 'completed', 'planned')
        AND (1 - (te.embedding <=> query_embedding)) >= p_min_similarity
    ORDER BY te.embedding <=> query_embedding
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION "public"."search_similar_trips" IS 'Find trips similar to a query embedding. Uses cosine similarity. Returns only trips belonging to the specified user.';

-- =============================================================================
-- Get User Preferences Function
-- Retrieve user preference vectors for personalization
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."get_user_preferences"(
    "p_user_id" "uuid",
    "p_preference_type" "text" DEFAULT NULL
)
RETURNS TABLE (
    "preference_type" "text",
    "top_items" "jsonb",
    "confidence_score" numeric,
    "sample_count" integer,
    "computed_at" timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        upv.preference_type,
        upv.top_items,
        upv.confidence_score,
        upv.sample_count,
        upv.computed_at
    FROM user_preference_vectors upv
    WHERE upv.user_id = p_user_id
        AND upv.preference_embedding IS NOT NULL
        AND (p_preference_type IS NULL OR upv.preference_type = p_preference_type)
    ORDER BY upv.confidence_score DESC;
$$;

COMMENT ON FUNCTION "public"."get_user_preferences" IS 'Retrieve user preference vectors for personalization. Returns preference metadata without exposing raw vectors.';

-- =============================================================================
-- Find Similar Users Function (for collaborative filtering)
-- Find users with similar preferences
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."find_similar_users_by_preference"(
    "p_user_id" "uuid",
    "p_preference_type" "text" DEFAULT 'overall',
    "p_limit" integer DEFAULT 10,
    "p_min_similarity" numeric DEFAULT 0.6
)
RETURNS TABLE (
    "similar_user_id" "uuid",
    "similarity" numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH user_pref AS (
        SELECT preference_embedding
        FROM user_preference_vectors
        WHERE user_id = p_user_id
            AND preference_type = p_preference_type
            AND preference_embedding IS NOT NULL
        LIMIT 1
    )
    SELECT
        upv.user_id as similar_user_id,
        ROUND((1 - (upv.preference_embedding <=> (SELECT preference_embedding FROM user_pref)))::numeric, 4) as similarity
    FROM user_preference_vectors upv, user_pref
    WHERE upv.user_id != p_user_id
        AND upv.preference_type = p_preference_type
        AND upv.preference_embedding IS NOT NULL
        AND (1 - (upv.preference_embedding <=> user_pref.preference_embedding)) >= p_min_similarity
    ORDER BY upv.preference_embedding <=> (SELECT preference_embedding FROM user_pref)
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION "public"."find_similar_users_by_preference" IS 'Find users with similar preferences (for collaborative filtering). Useful for discovering places that similar users have visited.';

-- =============================================================================
-- Embedding Stats Function
-- Get stats about embedding coverage for a user
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."get_embedding_stats"(
    "p_user_id" "uuid"
)
RETURNS TABLE (
    "poi_total" bigint,
    "poi_embedded" bigint,
    "poi_pending" bigint,
    "trip_total" bigint,
    "trip_embedded" bigint,
    "trip_pending" bigint,
    "preference_types" bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = p_user_id) as poi_total,
        (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = p_user_id AND embedded_at IS NOT NULL) as poi_embedded,
        (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = p_user_id AND embedded_at IS NULL) as poi_pending,
        (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = p_user_id) as trip_total,
        (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = p_user_id AND embedded_at IS NOT NULL) as trip_embedded,
        (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = p_user_id AND embedded_at IS NULL) as trip_pending,
        (SELECT COUNT(*) FROM user_preference_vectors WHERE user_id = p_user_id AND preference_embedding IS NOT NULL) as preference_types;
$$;

COMMENT ON FUNCTION "public"."get_embedding_stats" IS 'Get statistics about embedding coverage for a user. Useful for monitoring sync job progress.';

-- =============================================================================
-- Grant execute permissions
-- =============================================================================

GRANT EXECUTE ON FUNCTION "public"."search_similar_pois" TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION "public"."search_similar_trips" TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION "public"."get_user_preferences" TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION "public"."find_similar_users_by_preference" TO service_role;
GRANT EXECUTE ON FUNCTION "public"."get_embedding_stats" TO authenticated, service_role;
