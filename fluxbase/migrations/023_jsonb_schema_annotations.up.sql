--
-- Migration: 024_jsonb_schema_annotations.up.sql
-- Description: Add JSONB schema annotations for AI knowledge base table exports
--              These annotations help the AI understand the structure of JSONB columns
--              when tables are exported to knowledge bases for RAG.
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
-- place_visits.poi_tags: OpenStreetMap tags with amenity details
-- =============================================================================

COMMENT ON COLUMN "public"."place_visits"."poi_tags" IS '{"_fluxbase_jsonb_schema": {"type": "object", "description": "OpenStreetMap tags for the POI", "properties": {"osm": {"type": "object", "description": "OpenStreetMap-specific tags", "properties": {"amenity": {"type": "string", "description": "Type of amenity (e.g., restaurant, cafe, bar)"}, "cuisine": {"type": "string", "description": "Cuisine type (e.g., japanese, italian, vietnamese)"}, "name": {"type": "string", "description": "Name of the place"}, "outdoor_seating": {"type": "boolean", "description": "Has outdoor seating"}, "internet_access": {"type": "string", "description": "Internet access type (yes, wlan, no)"}, "wifi": {"type": "string", "description": "WiFi availability"}, "wheelchair": {"type": "string", "description": "Wheelchair accessibility (yes, limited, no)"}, "takeaway": {"type": "string", "description": "Takeaway option (yes, only, no)"}, "delivery": {"type": "string", "description": "Delivery service (yes, no)"}, "smoking": {"type": "string", "description": "Smoking policy (yes, outside, separated, no)"}, "air_conditioning": {"type": "string", "description": "Air conditioning (yes, no)"}, "leisure": {"type": "string", "description": "Leisure type (e.g., park, sports_centre)"}, "tourism": {"type": "string", "description": "Tourism type (e.g., hotel, museum)"}, "shop": {"type": "string", "description": "Shop type (e.g., supermarket, convenience)"}, "sport": {"type": "string", "description": "Sport type (e.g., tennis, swimming)"}}}}}}';

-- =============================================================================
-- my_poi_summary.osm_amenities: Aggregated amenity flags from visit history
-- =============================================================================

COMMENT ON COLUMN "public"."my_poi_summary"."osm_amenities" IS '{"_fluxbase_jsonb_schema": {"type": "object", "description": "Aggregated amenity flags derived from all visits to this POI. True if any visit had this amenity.", "properties": {"outdoor_seating": {"type": "boolean", "description": "Has outdoor seating available"}, "wifi": {"type": "boolean", "description": "Has free WiFi available"}, "wheelchair": {"type": "boolean", "description": "Wheelchair accessible"}, "takeaway": {"type": "boolean", "description": "Takeaway available"}, "delivery": {"type": "boolean", "description": "Delivery service available"}, "smoking": {"type": "boolean", "description": "Smoking allowed in some form"}, "air_conditioning": {"type": "boolean", "description": "Air conditioned"}}}}';

-- =============================================================================
-- my_poi_summary.time_pattern: Time-of-day visit distribution
-- =============================================================================

COMMENT ON COLUMN "public"."my_poi_summary"."time_pattern" IS '{"_fluxbase_jsonb_schema": {"type": "object", "description": "Distribution of visits by time of day. Useful for finding morning spots, evening places, etc.", "properties": {"morning": {"type": "integer", "description": "Number of visits between 6am-11am"}, "afternoon": {"type": "integer", "description": "Number of visits between 12pm-5pm"}, "evening": {"type": "integer", "description": "Number of visits between 6pm-11pm"}, "night": {"type": "integer", "description": "Number of visits between midnight-5am"}}}}';

-- =============================================================================
-- my_poi_summary.day_pattern: Weekend vs weekday visit distribution
-- =============================================================================

COMMENT ON COLUMN "public"."my_poi_summary"."day_pattern" IS '{"_fluxbase_jsonb_schema": {"type": "object", "description": "Distribution of visits by day type. Useful for finding weekend spots vs weekday places.", "properties": {"weekend_visits": {"type": "integer", "description": "Number of visits on Saturday or Sunday"}, "weekday_visits": {"type": "integer", "description": "Number of visits on Monday through Friday"}}}}';

-- =============================================================================
-- user_preferences: Add schema annotations for preference fields (not JSONB, but helpful)
-- NOTE: favorite_cuisines and favorite_categories are planned for future implementation
-- These will be added in a later migration when the computation job is implemented
-- =============================================================================
