--
-- Migration: 019_view_column_comments.up.sql
-- Description: Add column descriptions to chatbot-accessible views
-- Purpose: Schema documentation in DDL for MCP schema introspection
-- Author: Wayli Migration System
-- Created: 2025-01-05
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- View: my_place_visits
-- =============================================================================

COMMENT ON COLUMN my_place_visits.poi_name IS 'Name of the venue/place';
COMMENT ON COLUMN my_place_visits.poi_amenity IS 'Venue type (restaurant, cafe, museum, gym, etc). Use ILIKE: poi_amenity ILIKE ''%restaurant%''';
COMMENT ON COLUMN my_place_visits.poi_cuisine IS 'Cuisine type for food venues (japanese, italian, thai). Use ILIKE for matching';
COMMENT ON COLUMN my_place_visits.poi_sport IS 'Sport type for sports venues (tennis, golf, swimming). Use ILIKE for matching';
COMMENT ON COLUMN my_place_visits.poi_category IS 'High-level category. Exact values: food, sports, culture, education, entertainment, shopping, accommodation, healthcare, worship, outdoors, grocery, transport, other';
COMMENT ON COLUMN my_place_visits.city IS 'City name where the venue is located';
COMMENT ON COLUMN my_place_visits.country_code IS '2-letter ISO country code (JP, NL, FR, US, GB, etc)';
COMMENT ON COLUMN my_place_visits.started_at IS 'When the visit started (timestamp)';
COMMENT ON COLUMN my_place_visits.duration_minutes IS 'How long the visit lasted in minutes';
COMMENT ON COLUMN my_place_visits.latitude IS 'GPS latitude coordinate';
COMMENT ON COLUMN my_place_visits.longitude IS 'GPS longitude coordinate';
COMMENT ON COLUMN my_place_visits.visit_time_of_day IS 'Time category: morning, afternoon, evening, night';
COMMENT ON COLUMN my_place_visits.is_weekend IS 'Whether the visit was on a weekend';

-- =============================================================================
-- View: my_poi_summary
-- =============================================================================

COMMENT ON COLUMN my_poi_summary.poi_name IS 'Name of the venue/place';
COMMENT ON COLUMN my_poi_summary.poi_amenity IS 'Venue type (restaurant, cafe, museum, gym, etc). Use ILIKE for matching';
COMMENT ON COLUMN my_poi_summary.poi_category IS 'High-level category. Exact values: food, sports, culture, education, entertainment, shopping, accommodation, healthcare, worship, outdoors, grocery, transport, other';
COMMENT ON COLUMN my_poi_summary.city IS 'City name where the venue is located';
COMMENT ON COLUMN my_poi_summary.country_code IS '2-letter ISO country code (JP, NL, FR, US, GB, etc)';
COMMENT ON COLUMN my_poi_summary.visit_count IS 'Total number of visits to this POI';
COMMENT ON COLUMN my_poi_summary.first_visit IS 'Date of first visit';
COMMENT ON COLUMN my_poi_summary.last_visit IS 'Date of most recent visit';
COMMENT ON COLUMN my_poi_summary.avg_duration_minutes IS 'Average visit duration in minutes';

-- =============================================================================
-- View: my_trips
-- =============================================================================

COMMENT ON COLUMN my_trips.id IS 'Unique trip identifier - include in SELECT for UI display';
COMMENT ON COLUMN my_trips.title IS 'Trip title - include in SELECT for UI display';
COMMENT ON COLUMN my_trips.image_url IS 'Trip cover image URL - include in SELECT for UI cards';
COMMENT ON COLUMN my_trips.start_date IS 'Trip start date';
COMMENT ON COLUMN my_trips.end_date IS 'Trip end date';
COMMENT ON COLUMN my_trips.status IS 'Trip status: active, planned, or completed';
COMMENT ON COLUMN my_trips.labels IS 'User-assigned labels/tags for the trip';
COMMENT ON COLUMN my_trips.trip_days IS 'Duration of trip in days';
COMMENT ON COLUMN my_trips.visited_cities IS 'Comma-separated list of cities visited. Use ILIKE for matching';
COMMENT ON COLUMN my_trips.visited_country_codes IS 'Comma-separated 2-letter ISO codes (JP, NL, FR). Use ILIKE for matching';

-- =============================================================================
-- View: my_poi_embeddings
-- =============================================================================

COMMENT ON COLUMN my_poi_embeddings.poi_name IS 'Name of the venue/place';
COMMENT ON COLUMN my_poi_embeddings.poi_amenity IS 'Venue type (restaurant, cafe, museum, gym, etc)';
COMMENT ON COLUMN my_poi_embeddings.poi_category IS 'High-level category';
COMMENT ON COLUMN my_poi_embeddings.has_embedding IS 'Whether this POI has a vector embedding for similarity search';

-- =============================================================================
-- View: my_trip_embeddings
-- =============================================================================

COMMENT ON COLUMN my_trip_embeddings.trip_title IS 'Trip title';
COMMENT ON COLUMN my_trip_embeddings.has_embedding IS 'Whether this trip has a vector embedding for similarity search';

-- =============================================================================
-- View: my_preferences
-- =============================================================================

COMMENT ON COLUMN my_preferences.preference_type IS 'Type of preference (e.g., cuisine, amenity, category)';
COMMENT ON COLUMN my_preferences.top_items IS 'Top items for this preference type as JSON array';
COMMENT ON COLUMN my_preferences.confidence_score IS 'Confidence score for this preference (0-1)';
