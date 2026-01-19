--
-- Migration: 019_view_column_comments.down.sql
-- Description: Remove column descriptions from chatbot-accessible views
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

COMMENT ON COLUMN my_place_visits.poi_name IS NULL;
COMMENT ON COLUMN my_place_visits.poi_amenity IS NULL;
COMMENT ON COLUMN my_place_visits.poi_cuisine IS NULL;
COMMENT ON COLUMN my_place_visits.poi_sport IS NULL;
COMMENT ON COLUMN my_place_visits.poi_category IS NULL;
COMMENT ON COLUMN my_place_visits.city IS NULL;
COMMENT ON COLUMN my_place_visits.country_code IS NULL;
COMMENT ON COLUMN my_place_visits.started_at IS NULL;
COMMENT ON COLUMN my_place_visits.duration_minutes IS NULL;
COMMENT ON COLUMN my_place_visits.latitude IS NULL;
COMMENT ON COLUMN my_place_visits.longitude IS NULL;
COMMENT ON COLUMN my_place_visits.visit_time_of_day IS NULL;
COMMENT ON COLUMN my_place_visits.is_weekend IS NULL;

-- =============================================================================
-- View: my_poi_summary
-- =============================================================================

COMMENT ON COLUMN my_poi_summary.poi_name IS NULL;
COMMENT ON COLUMN my_poi_summary.poi_amenity IS NULL;
COMMENT ON COLUMN my_poi_summary.poi_category IS NULL;
COMMENT ON COLUMN my_poi_summary.city IS NULL;
COMMENT ON COLUMN my_poi_summary.country_code IS NULL;
COMMENT ON COLUMN my_poi_summary.visit_count IS NULL;
COMMENT ON COLUMN my_poi_summary.first_visit IS NULL;
COMMENT ON COLUMN my_poi_summary.last_visit IS NULL;
COMMENT ON COLUMN my_poi_summary.avg_duration_minutes IS NULL;

-- =============================================================================
-- View: my_trips
-- =============================================================================

COMMENT ON COLUMN my_trips.id IS NULL;
COMMENT ON COLUMN my_trips.title IS NULL;
COMMENT ON COLUMN my_trips.image_url IS NULL;
COMMENT ON COLUMN my_trips.start_date IS NULL;
COMMENT ON COLUMN my_trips.end_date IS NULL;
COMMENT ON COLUMN my_trips.status IS NULL;
COMMENT ON COLUMN my_trips.labels IS NULL;
COMMENT ON COLUMN my_trips.trip_days IS NULL;
COMMENT ON COLUMN my_trips.visited_cities IS NULL;
COMMENT ON COLUMN my_trips.visited_country_codes IS NULL;

-- =============================================================================
-- View: my_poi_embeddings
-- =============================================================================

COMMENT ON COLUMN my_poi_embeddings.poi_name IS NULL;
COMMENT ON COLUMN my_poi_embeddings.poi_amenity IS NULL;
COMMENT ON COLUMN my_poi_embeddings.poi_category IS NULL;
COMMENT ON COLUMN my_poi_embeddings.has_embedding IS NULL;

-- =============================================================================
-- View: my_trip_embeddings
-- =============================================================================

COMMENT ON COLUMN my_trip_embeddings.trip_title IS NULL;
COMMENT ON COLUMN my_trip_embeddings.has_embedding IS NULL;

-- =============================================================================
-- View: my_preferences
-- =============================================================================

COMMENT ON COLUMN my_preferences.preference_type IS NULL;
COMMENT ON COLUMN my_preferences.top_items IS NULL;
COMMENT ON COLUMN my_preferences.confidence_score IS NULL;
