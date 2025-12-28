--
-- Migration: 013_pgvector_views.up.sql
-- Description: Secure views for chatbot vector queries
-- Dependencies: 012_pgvector_functions.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- Secure View: my_poi_embeddings
-- For chatbot to query user's POI embeddings (without exposing raw vectors)
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_poi_embeddings"
WITH (security_barrier = true)
AS
SELECT
    id,
    poi_name,
    poi_amenity,
    poi_category,
    poi_cuisine,
    poi_sport,
    city,
    country_code,
    visit_count,
    avg_duration_minutes,
    embedded_at IS NOT NULL as has_embedding,
    created_at,
    updated_at,
    created_at as started_at
FROM "public"."poi_embeddings"
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_poi_embeddings" IS 'Secure view of user POI embeddings. Does not expose raw vectors - use search_similar_pois() function for similarity queries.';

-- =============================================================================
-- Secure View: my_trip_embeddings
-- For chatbot to query user's trip embeddings (without exposing raw vectors)
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_trip_embeddings"
WITH (security_barrier = true)
AS
SELECT
    te.id,
    te.trip_id,
    t.title as trip_title,
    t.description as trip_description,
    t.start_date,
    t.end_date,
    t.status,
    t.image_url,
    t.labels,
    t.metadata->>'visitedCities' as visited_cities,
    t.metadata->>'visitedCountries' as visited_countries,
    te.embedded_at IS NOT NULL as has_embedding,
    te.created_at,
    te.updated_at,
    t.start_date as started_at
FROM "public"."trip_embeddings" te
JOIN "public"."trips" t ON te.trip_id = t.id
WHERE te.user_id = auth.uid();

COMMENT ON VIEW "public"."my_trip_embeddings" IS 'Secure view of user trip embeddings. Does not expose raw vectors - use search_similar_trips() function for similarity queries.';

-- =============================================================================
-- Secure View: my_preferences
-- For chatbot to query user's preference summaries
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_preferences"
WITH (security_barrier = true)
AS
SELECT
    preference_type,
    top_items,
    confidence_score,
    sample_count,
    computed_at,
    created_at,
    updated_at,
    computed_at as started_at
FROM "public"."user_preference_vectors"
WHERE user_id = auth.uid()
    AND preference_embedding IS NOT NULL;

COMMENT ON VIEW "public"."my_preferences" IS 'Secure view of user preferences. Shows preference summaries without exposing raw preference vectors.';

-- =============================================================================
-- Secure View: my_embedding_stats
-- For chatbot to show embedding coverage to user
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_embedding_stats"
WITH (security_barrier = true)
AS
SELECT
    (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = auth.uid()) as poi_total,
    (SELECT COUNT(*) FROM poi_embeddings WHERE user_id = auth.uid() AND embedded_at IS NOT NULL) as poi_embedded,
    (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = auth.uid()) as trip_total,
    (SELECT COUNT(*) FROM trip_embeddings WHERE user_id = auth.uid() AND embedded_at IS NOT NULL) as trip_embedded,
    (SELECT COUNT(*) FROM user_preference_vectors WHERE user_id = auth.uid() AND preference_embedding IS NOT NULL) as preferences_computed,
    now() as started_at;

COMMENT ON VIEW "public"."my_embedding_stats" IS 'Secure view showing user embedding coverage statistics.';

-- =============================================================================
-- Grant SELECT on views to authenticated users
-- =============================================================================

GRANT SELECT ON "public"."my_poi_embeddings" TO authenticated;
GRANT SELECT ON "public"."my_trip_embeddings" TO authenticated;
GRANT SELECT ON "public"."my_preferences" TO authenticated;
GRANT SELECT ON "public"."my_embedding_stats" TO authenticated;
