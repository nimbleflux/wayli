--
-- Migration: 024_jsonb_schema_annotations.down.sql
-- Description: Remove JSONB schema annotations
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

-- Reset comments to simple descriptions (removing JSONB schema annotations)
COMMENT ON COLUMN "public"."place_visits"."poi_tags" IS 'OpenStreetMap tags for the POI';
COMMENT ON COLUMN "public"."my_poi_summary"."osm_amenities" IS 'Aggregated amenity flags from visits';
COMMENT ON COLUMN "public"."my_poi_summary"."time_pattern" IS 'Time-of-day visit distribution';
COMMENT ON COLUMN "public"."my_poi_summary"."day_pattern" IS 'Weekend vs weekday visit distribution';
