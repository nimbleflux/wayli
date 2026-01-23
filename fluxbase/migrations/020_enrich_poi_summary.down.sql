--
-- Migration: 020_enrich_poi_summary.down.sql
-- Description: Revert my_poi_summary view to original schema (without embedding enrichment columns)
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
-- Revert to original my_poi_summary view (from migration 017)
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
    COUNT(*)::integer as visit_count,
    MIN(started_at) as first_visit,
    MAX(started_at) as last_visit,
    ROUND(AVG(duration_minutes))::integer as avg_duration_minutes,
    SUM(duration_minutes)::integer as total_duration_minutes,
    MIN(started_at) as started_at
FROM "public"."place_visits"
WHERE user_id = auth.uid()
GROUP BY poi_name, poi_amenity, poi_category, city, country_code;

COMMENT ON VIEW "public"."my_poi_summary" IS 'Aggregated POI visit statistics per user. Use for "most visited", "how many times" questions.';

GRANT SELECT ON "public"."my_poi_summary" TO "authenticated";
