--
-- Migration: 020_enrich_poi_summary.up.sql
-- Description: Enrich my_poi_summary view with additional columns for embedding generation
--              Adds poi_cuisine, poi_sport, osm_amenities (aggregated), time_pattern
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
-- Update my_poi_summary view with additional columns for semantic embeddings
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_poi_summary"
WITH (security_barrier = true)
AS
SELECT
    poi_name,
    poi_amenity,
    poi_category,
    city,
    country_code,
    -- Existing aggregations
    COUNT(*)::integer as visit_count,
    MIN(started_at) as first_visit,
    MAX(started_at) as last_visit,
    ROUND(AVG(duration_minutes))::integer as avg_duration_minutes,
    SUM(duration_minutes)::integer as total_duration_minutes,
    MIN(started_at) as started_at,
    -- NEW: Most common cuisine and sport
    MODE() WITHIN GROUP (ORDER BY poi_cuisine) FILTER (WHERE poi_cuisine IS NOT NULL) as poi_cuisine,
    MODE() WITHIN GROUP (ORDER BY poi_sport) FILTER (WHERE poi_sport IS NOT NULL) as poi_sport,
    -- NEW: Aggregated OSM amenity tags for embedding enrichment
    jsonb_build_object(
        'outdoor_seating', bool_or(poi_tags->'osm'->>'outdoor_seating' = 'yes'),
        'wifi', bool_or(
            poi_tags->'osm'->>'internet_access' IN ('yes', 'wlan', 'wifi') OR
            poi_tags->'osm'->>'wifi' = 'yes'
        ),
        'wheelchair', bool_or(poi_tags->'osm'->>'wheelchair' IN ('yes', 'limited')),
        'takeaway', bool_or(poi_tags->'osm'->>'takeaway' IN ('yes', 'only')),
        'delivery', bool_or(poi_tags->'osm'->>'delivery' = 'yes'),
        'smoking', bool_or(poi_tags->'osm'->>'smoking' IN ('yes', 'outside', 'separated')),
        'air_conditioning', bool_or(poi_tags->'osm'->>'air_conditioning' = 'yes')
    ) as osm_amenities,
    -- NEW: Time-of-day visit pattern (for vibe inference in embeddings)
    jsonb_build_object(
        'morning', COUNT(*) FILTER (WHERE visit_hour BETWEEN 6 AND 11),
        'afternoon', COUNT(*) FILTER (WHERE visit_hour BETWEEN 12 AND 17),
        'evening', COUNT(*) FILTER (WHERE visit_hour BETWEEN 18 AND 23),
        'night', COUNT(*) FILTER (WHERE visit_hour BETWEEN 0 AND 5)
    ) as time_pattern,
    -- NEW: Weekend vs weekday preference
    jsonb_build_object(
        'weekend_visits', COUNT(*) FILTER (WHERE is_weekend = true),
        'weekday_visits', COUNT(*) FILTER (WHERE is_weekend = false)
    ) as day_pattern
FROM "public"."place_visits"
WHERE user_id = auth.uid()
GROUP BY poi_name, poi_amenity, poi_category, city, country_code;

COMMENT ON VIEW "public"."my_poi_summary" IS 'Aggregated POI visit statistics per user with semantic enrichment. Includes cuisine, amenities, and time patterns for embedding generation.';

-- Ensure grants are in place
GRANT SELECT ON "public"."my_poi_summary" TO "authenticated";
