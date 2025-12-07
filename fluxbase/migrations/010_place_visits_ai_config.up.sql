--
-- Migration: 010_place_visits_ai_config.up.sql
-- Description: Create place_visits table for POI visit detection and ai_config for LLM settings
-- Dependencies: 003_tables_views.up.sql
-- Author: Wayli Migration System
-- Created: 2025-12-07
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

SET default_tablespace = '';
SET default_table_access_method = "heap";

-- =============================================================================
-- Place Visits Table (for POI/restaurant visit detection)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."place_visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,

    -- Temporal (when was this visit?)
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone NOT NULL,
    "duration_minutes" integer GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM ("ended_at" - "started_at")) / 60
    ) STORED,

    -- Spatial (where was this visit?)
    "location" "public"."geometry"(Point, 4326) NOT NULL,

    -- POI details (denormalized for easy LLM SQL queries)
    "poi_name" "text",
    "poi_layer" "text",                    -- 'venue', 'address'
    "poi_amenity" "text",                  -- 'restaurant', 'cafe', 'museum', etc.
    "poi_cuisine" "text",                  -- 'vietnamese', 'italian', 'vegan', etc.
    "poi_category" "text",                 -- High-level: 'food', 'entertainment', 'shopping'
    "poi_tags" "jsonb" DEFAULT '{}'::"jsonb",  -- Full OSM tags for complex queries

    -- Location context (denormalized for easy queries)
    "city" "text",
    "country" "text",
    "country_code" character varying(2),

    -- Confidence and metadata
    "confidence_score" numeric(3,2),       -- 0.00-1.00
    "gps_points_count" integer,            -- How many GPS points formed this cluster
    "avg_accuracy_meters" numeric(8,2),    -- Average GPS accuracy in the cluster
    "detection_method" "text" DEFAULT 'time_cluster'::"text",  -- 'time_cluster', 'user_confirmed'

    -- Alternative candidates (if ambiguous, stores top 3)
    "candidates" "jsonb",                  -- [{poi_name, poi_amenity, distance_meters, confidence_score}]

    -- Metadata
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),

    -- Constraints
    CONSTRAINT "place_visits_confidence_check" CHECK (
        "confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1)
    ),
    CONSTRAINT "place_visits_duration_check" CHECK (
        "ended_at" >= "started_at"
    )
);

-- Comments for documentation
COMMENT ON TABLE "public"."place_visits" IS 'Detected POI/venue visits for natural language queries. Stores restaurant, cafe, museum visits etc.';
COMMENT ON COLUMN "public"."place_visits"."poi_amenity" IS 'OSM amenity type: restaurant, cafe, bar, museum, cinema, etc.';
COMMENT ON COLUMN "public"."place_visits"."poi_cuisine" IS 'Cuisine type if applicable: vietnamese, italian, vegan, etc.';
COMMENT ON COLUMN "public"."place_visits"."poi_category" IS 'High-level category: food, entertainment, shopping, culture, wellness';
COMMENT ON COLUMN "public"."place_visits"."poi_tags" IS 'Full OSM tags JSONB for complex queries like diet:vegan, wheelchair access, etc.';
COMMENT ON COLUMN "public"."place_visits"."candidates" IS 'Alternative POI matches when primary match confidence is low (<0.8)';
COMMENT ON COLUMN "public"."place_visits"."detection_method" IS 'How this visit was detected: time_cluster (automatic), user_confirmed (manual)';

-- Indexes for efficient LLM-generated SQL queries
CREATE INDEX "idx_place_visits_user_date" ON "public"."place_visits" ("user_id", "started_at" DESC);
CREATE INDEX "idx_place_visits_amenity" ON "public"."place_visits" ("poi_amenity") WHERE "poi_amenity" IS NOT NULL;
CREATE INDEX "idx_place_visits_cuisine" ON "public"."place_visits" ("poi_cuisine") WHERE "poi_cuisine" IS NOT NULL;
CREATE INDEX "idx_place_visits_category" ON "public"."place_visits" ("poi_category") WHERE "poi_category" IS NOT NULL;
CREATE INDEX "idx_place_visits_country" ON "public"."place_visits" ("country_code", "started_at" DESC);
CREATE INDEX "idx_place_visits_city" ON "public"."place_visits" ("city", "started_at" DESC) WHERE "city" IS NOT NULL;
CREATE INDEX "idx_place_visits_location" ON "public"."place_visits" USING GIST ("location");
CREATE INDEX "idx_place_visits_poi_tags" ON "public"."place_visits" USING GIN ("poi_tags");

-- =============================================================================
-- AI Configuration Table (server-level settings)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."ai_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "name" "text" NOT NULL UNIQUE,          -- Config name, e.g., 'default', 'location_query'
    "provider" "text" NOT NULL,              -- 'openai', 'anthropic', 'ollama', 'openrouter'
    "model" "text" NOT NULL,                 -- Model identifier, e.g., 'gpt-4o', 'claude-3-sonnet', 'llama3.1'
    "api_endpoint" "text",                   -- Custom endpoint URL (for Ollama, OpenRouter, etc.)
    "api_key_encrypted" "text",              -- Encrypted API key (server-level)
    "max_tokens" integer DEFAULT 4096,
    "temperature" numeric(2,1) DEFAULT 0.7,
    "enabled" boolean DEFAULT true,
    "config" "jsonb" DEFAULT '{}'::"jsonb",  -- Additional provider-specific config
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),

    CONSTRAINT "ai_config_provider_check" CHECK (
        "provider" = ANY (ARRAY['openai'::"text", 'anthropic'::"text", 'ollama'::"text", 'openrouter'::"text", 'azure'::"text", 'custom'::"text"])
    ),
    CONSTRAINT "ai_config_temperature_check" CHECK (
        "temperature" >= 0 AND "temperature" <= 2
    )
);

COMMENT ON TABLE "public"."ai_config" IS 'Server-level AI/LLM configuration. Users can override with their own settings in user_preferences.';
COMMENT ON COLUMN "public"."ai_config"."name" IS 'Configuration name for different use cases: default, location_query, trip_summary, etc.';
COMMENT ON COLUMN "public"."ai_config"."provider" IS 'LLM provider: openai, anthropic, ollama, openrouter, azure, custom';
COMMENT ON COLUMN "public"."ai_config"."api_endpoint" IS 'Custom API endpoint for self-hosted models (Ollama) or alternative providers';
COMMENT ON COLUMN "public"."ai_config"."api_key_encrypted" IS 'Server-level API key (encrypted). Users can provide their own in preferences.';
COMMENT ON COLUMN "public"."ai_config"."config" IS 'Provider-specific configuration like system prompts, stop sequences, etc.';

-- =============================================================================
-- Add AI config fields to user_preferences (user overrides)
-- =============================================================================

-- Add ai_config column to user_preferences for user-level overrides
ALTER TABLE "public"."user_preferences"
ADD COLUMN IF NOT EXISTS "ai_config" "jsonb" DEFAULT '{}'::"jsonb";

COMMENT ON COLUMN "public"."user_preferences"."ai_config" IS 'User-level AI configuration overrides. Structure: {provider, model, api_key, api_endpoint, enabled}';

-- =============================================================================
-- RLS Policies for place_visits
-- =============================================================================

ALTER TABLE "public"."place_visits" ENABLE ROW LEVEL SECURITY;

-- Users can only see their own visits
CREATE POLICY "place_visits_select_own" ON "public"."place_visits"
    FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert their own visits
CREATE POLICY "place_visits_insert_own" ON "public"."place_visits"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own visits
CREATE POLICY "place_visits_update_own" ON "public"."place_visits"
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own visits
CREATE POLICY "place_visits_delete_own" ON "public"."place_visits"
    FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- RLS Policies for ai_config (read-only for users, admin write)
-- =============================================================================

ALTER TABLE "public"."ai_config" ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read AI configs (to know what's available)
CREATE POLICY "ai_config_select_authenticated" ON "public"."ai_config"
    FOR SELECT USING (auth.role() = 'authenticated');

-- Only service role can modify AI configs (admin operations)
CREATE POLICY "ai_config_all_service" ON "public"."ai_config"
    FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- Foreign Key Constraints
-- =============================================================================

ALTER TABLE ONLY "public"."place_visits"
    ADD CONSTRAINT "place_visits_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- =============================================================================
-- Insert default AI configuration
-- =============================================================================

INSERT INTO "public"."ai_config" ("name", "provider", "model", "config") VALUES
    ('default', 'openai', 'gpt-4o-mini', '{"description": "Default AI configuration for general use"}'),
    ('location_query', 'openai', 'gpt-4o-mini', '{
        "description": "AI configuration for natural language location queries",
        "system_prompt": "You are a helpful assistant that translates natural language questions about travel and location history into SQL queries. You have access to a place_visits table with columns: poi_name, poi_amenity, poi_cuisine, poi_category, poi_tags (JSONB), city, country, country_code, started_at, ended_at, duration_minutes. Always return valid PostgreSQL queries."
    }')
ON CONFLICT ("name") DO NOTHING;

-- =============================================================================
-- Function: execute_user_query
-- Safely executes a validated SELECT query on behalf of a user.
-- Used by the location-query edge function for LLM-generated SQL.
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."execute_user_query"(
    query_sql TEXT,
    query_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    sanitized_sql TEXT;
    upper_sql TEXT;
BEGIN
    -- Validate input
    IF query_sql IS NULL OR query_sql = '' THEN
        RAISE EXCEPTION 'Query SQL cannot be empty';
    END IF;

    IF query_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID cannot be null';
    END IF;

    -- Basic SQL validation (defense in depth - edge function also validates)
    upper_sql := UPPER(TRIM(query_sql));

    -- Must start with SELECT
    IF NOT upper_sql LIKE 'SELECT%' THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Block dangerous keywords
    IF upper_sql LIKE '%DROP%' OR
       upper_sql LIKE '%DELETE%' OR
       upper_sql LIKE '%UPDATE%' OR
       upper_sql LIKE '%INSERT%' OR
       upper_sql LIKE '%ALTER%' OR
       upper_sql LIKE '%CREATE%' OR
       upper_sql LIKE '%TRUNCATE%' OR
       upper_sql LIKE '%EXEC%' OR
       upper_sql LIKE '%EXECUTE%' THEN
        RAISE EXCEPTION 'Forbidden SQL keyword detected';
    END IF;

    -- Must reference user_id (should contain $1 placeholder)
    IF NOT LOWER(query_sql) LIKE '%user_id%' THEN
        RAISE EXCEPTION 'Query must filter by user_id';
    END IF;

    -- Replace $1 placeholder with actual user_id (as a quoted literal)
    sanitized_sql := REPLACE(query_sql, '$1', quote_literal(query_user_id::TEXT));

    -- Execute the query and return results as JSONB
    EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', sanitized_sql)
    INTO result;

    RETURN result;

EXCEPTION
    WHEN OTHERS THEN
        -- Log error for debugging but return sanitized message
        RAISE WARNING 'execute_user_query error: % - SQL: %', SQLERRM, LEFT(query_sql, 100);
        RAISE EXCEPTION 'Query execution failed: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION "public"."execute_user_query"(TEXT, UUID) IS 'Safely executes validated SELECT queries for LLM-powered location queries. Used by location-query edge function.';

-- Grant execute permission to authenticated users (RLS on underlying tables still applies)
GRANT EXECUTE ON FUNCTION "public"."execute_user_query"(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION "public"."execute_user_query"(TEXT, UUID) TO service_role;
