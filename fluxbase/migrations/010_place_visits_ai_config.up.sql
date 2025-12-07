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
SELECT pg_catalog.set_config('search_path', 'public', false);
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
-- Function: strip_sql_comments
-- Removes SQL comments to prevent keyword-hiding attacks.
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."strip_sql_comments"(sql_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    result TEXT;
BEGIN
    result := sql_input;
    -- Remove block comments /* ... */
    result := regexp_replace(result, '/\*.*?\*/', ' ', 'g');
    -- Remove line comments -- ...
    result := regexp_replace(result, '--[^\n\r]*', ' ', 'g');
    -- Normalize whitespace
    result := regexp_replace(result, '\s+', ' ', 'g');
    RETURN TRIM(result);
END;
$$;

COMMENT ON FUNCTION "public"."strip_sql_comments"(TEXT) IS 'Strips SQL comments to prevent keyword-hiding attacks in user queries.';

-- =============================================================================
-- SECURE VIEWS FOR LLM QUERIES
-- =============================================================================
-- These views enforce user_id filtering at the VIEW level, not relying on
-- string matching. Even if a malicious LLM/Ollama returns a query without
-- user_id filtering, the view itself only returns the current user's data.
--
-- CRITICAL: LLM queries MUST use these views, not the base tables.
-- =============================================================================

-- Secure view for place_visits - ALWAYS filtered to current user
CREATE OR REPLACE VIEW "public"."my_place_visits"
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    id,
    started_at,
    ended_at,
    duration_minutes,
    ST_X(location::geometry) as longitude,
    ST_Y(location::geometry) as latitude,
    poi_name,
    poi_layer,
    poi_amenity,
    poi_cuisine,
    poi_category,
    poi_tags,
    city,
    country,
    country_code,
    confidence_score,
    gps_points_count,
    avg_accuracy_meters,
    detection_method,
    candidates,
    created_at
FROM "public"."place_visits"
WHERE user_id = auth.uid();  -- HARDCODED - cannot be bypassed by LLM

COMMENT ON VIEW "public"."my_place_visits" IS 'Secure view of place_visits filtered to current user. Use this for LLM queries.';

-- Secure view for tracker_data - ALWAYS filtered to current user
CREATE OR REPLACE VIEW "public"."my_tracker_data"
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    recorded_at,
    ST_X(location::geometry) as longitude,
    ST_Y(location::geometry) as latitude,
    country_code,
    geocode,
    accuracy,
    created_at
FROM "public"."tracker_data"
WHERE user_id = auth.uid();  -- HARDCODED - cannot be bypassed by LLM

COMMENT ON VIEW "public"."my_tracker_data" IS 'Secure view of tracker_data filtered to current user. Use this for LLM queries.';

-- Grant SELECT on views to authenticated users
GRANT SELECT ON "public"."my_place_visits" TO authenticated;
GRANT SELECT ON "public"."my_tracker_data" TO authenticated;

-- =============================================================================
-- Function: execute_user_query
-- Safely executes a validated SELECT query on behalf of a user.
-- Used by the location-query edge function for LLM-generated SQL.
--
-- SECURITY MODEL (Defense in Depth):
-- =============================================================================
-- Layer 1: String validation (comment stripping, keyword blocking)
-- Layer 2: Table whitelist (ONLY my_place_visits, my_tracker_data views)
-- Layer 3: Views have hardcoded user_id = auth.uid() filter
-- Layer 4: Read-only transaction mode
-- Layer 5: RLS policies on underlying tables
-- Layer 6: User identity verification (auth.uid() must match claimed user)
-- Layer 7: Statement timeout to prevent DoS
--
-- Even if a malicious Ollama model returns:
--   "SELECT * FROM my_place_visits" (no user_id filter)
-- The view definition enforces: WHERE user_id = auth.uid()
-- So the query ONLY returns the authenticated user's data.
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."execute_user_query"(
    query_sql TEXT,
    query_user_id UUID,
    max_rows INTEGER DEFAULT 100,
    timeout_ms INTEGER DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
-- NOT using SECURITY DEFINER - query runs with caller's permissions
-- RLS and view security_invoker apply
SET search_path = public
AS $$
DECLARE
    result JSONB;
    safe_sql TEXT;
    stripped_sql TEXT;
    lower_sql TEXT;
    row_count INTEGER;
BEGIN
    -- ==========================================================
    -- LAYER 6: User identity verification
    -- ==========================================================
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- The caller must be the user they claim to be
    IF auth.uid() != query_user_id THEN
        RAISE EXCEPTION 'User identity mismatch';
    END IF;

    -- ==========================================================
    -- LAYER 7: Resource limits
    -- ==========================================================
    EXECUTE format('SET LOCAL statement_timeout = %L', timeout_ms);

    -- ==========================================================
    -- LAYER 4: Force read-only mode
    -- ==========================================================
    SET LOCAL transaction_read_only = ON;

    -- ==========================================================
    -- Input validation
    -- ==========================================================
    IF query_sql IS NULL OR LENGTH(TRIM(query_sql)) < 10 THEN
        RAISE EXCEPTION 'Query SQL is too short or empty';
    END IF;

    IF max_rows < 1 OR max_rows > 1000 THEN
        RAISE EXCEPTION 'max_rows must be between 1 and 1000';
    END IF;

    -- ==========================================================
    -- LAYER 1: String validation - strip comments
    -- ==========================================================
    stripped_sql := strip_sql_comments(query_sql);
    lower_sql := LOWER(stripped_sql);

    -- Must start with SELECT
    IF NOT (UPPER(stripped_sql) ~ '^\s*SELECT\b') THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Block ALL write operations
    IF UPPER(stripped_sql) ~ '\m(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|ANALYZE|CLUSTER|REINDEX|LOCK|REFRESH|NOTIFY|LISTEN|UNLISTEN|PREPARE|EXECUTE|DEALLOCATE)\M' THEN
        RAISE EXCEPTION 'Write operations are not allowed';
    END IF;

    -- Block dangerous functions
    IF UPPER(stripped_sql) ~ '\m(PG_SLEEP|PG_READ_FILE|PG_WRITE_FILE|PG_READ_BINARY_FILE|LO_IMPORT|LO_EXPORT|LO_CREATE|LO_UNLINK|DBLINK|DBLINK_CONNECT|DBLINK_EXEC|CURRENT_SETTING|SET_CONFIG|PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_RELOAD_CONF|PG_ROTATE_LOGFILE|PG_SWITCH_WAL)\M' THEN
        RAISE EXCEPTION 'Forbidden SQL function detected';
    END IF;

    -- Block ALL SET commands
    IF UPPER(stripped_sql) ~ '\mSET\s+' THEN
        RAISE EXCEPTION 'SET commands are not allowed';
    END IF;

    -- Block system catalog access
    IF lower_sql ~ '\m(pg_catalog|information_schema|pg_class|pg_proc|pg_roles|pg_user|pg_shadow|pg_authid|pg_auth_members)\M' THEN
        RAISE EXCEPTION 'System catalog access is not allowed';
    END IF;

    -- Block auth schema access
    IF lower_sql ~ '\mauth\.' THEN
        RAISE EXCEPTION 'Auth schema access is not allowed';
    END IF;

    -- ==========================================================
    -- LAYER 2: Table whitelist - ONLY secure views allowed
    -- ==========================================================

    -- Block direct access to base tables
    IF lower_sql ~ '\mplace_visits\M' AND lower_sql !~ '\mmy_place_visits\M' THEN
        RAISE EXCEPTION 'Direct table access not allowed. Use my_place_visits view instead.';
    END IF;

    IF lower_sql ~ '\mtracker_data\M' AND lower_sql !~ '\mmy_tracker_data\M' THEN
        RAISE EXCEPTION 'Direct table access not allowed. Use my_tracker_data view instead.';
    END IF;

    -- Block access to sensitive tables
    IF lower_sql ~ '\m(ai_config|user_preferences|rate_limits|query_feedback|users|auth_users|sessions)\M' THEN
        RAISE EXCEPTION 'Access to this table is not allowed';
    END IF;

    -- Verify query uses ONLY allowed views
    IF NOT (lower_sql ~ '\mmy_place_visits\M' OR lower_sql ~ '\mmy_tracker_data\M') THEN
        RAISE EXCEPTION 'Query must use my_place_visits or my_tracker_data views';
    END IF;

    -- ==========================================================
    -- Query rewriting
    -- ==========================================================
    safe_sql := stripped_sql;

    -- Remove any user_id references (views handle this automatically)
    -- This prevents confusion but isn't security-critical since views enforce it
    safe_sql := regexp_replace(safe_sql, 'WHERE\s+user_id\s*=\s*\$1\s*(AND\s+)?', 'WHERE ', 'gi');
    safe_sql := regexp_replace(safe_sql, '\s+AND\s+user_id\s*=\s*\$1', '', 'gi');
    safe_sql := regexp_replace(safe_sql, 'user_id\s*=\s*\$1\s*(AND\s+)?', '', 'gi');

    -- Clean up orphaned WHERE clauses
    safe_sql := regexp_replace(safe_sql, 'WHERE\s+(ORDER|GROUP|LIMIT|$)', '\1', 'gi');
    safe_sql := regexp_replace(safe_sql, 'WHERE\s*$', '', 'gi');

    -- Add LIMIT if not present
    IF NOT (UPPER(safe_sql) ~ '\mLIMIT\s+\d+') THEN
        safe_sql := safe_sql || ' LIMIT ' || max_rows;
    END IF;

    -- Clean up whitespace
    safe_sql := regexp_replace(safe_sql, '\s+', ' ', 'g');
    safe_sql := TRIM(safe_sql);

    -- ==========================================================
    -- Execute query (views + RLS provide final security)
    -- ==========================================================
    BEGIN
        EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', safe_sql)
        INTO result;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'Permission denied';
        WHEN undefined_table THEN
            RAISE EXCEPTION 'Table or view does not exist';
        WHEN undefined_column THEN
            RAISE EXCEPTION 'Column does not exist';
    END;

    -- Logging (no sensitive data)
    SELECT jsonb_array_length(result) INTO row_count;
    RAISE NOTICE 'execute_user_query: user=%, rows=%', query_user_id, row_count;

    RETURN result;

EXCEPTION
    WHEN query_canceled THEN
        RAISE EXCEPTION 'Query execution timed out';
    WHEN read_only_sql_transaction THEN
        RAISE EXCEPTION 'Write operations are not allowed';
    WHEN OTHERS THEN
        RAISE WARNING 'execute_user_query error: %', SQLERRM;
        RAISE EXCEPTION 'Query execution failed: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION "public"."execute_user_query"(TEXT, UUID, INTEGER, INTEGER) IS 'Safely executes LLM-generated queries using secure views. Multiple security layers prevent unauthorized data access.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION "public"."execute_user_query"(TEXT, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION "public"."execute_user_query"(TEXT, UUID, INTEGER, INTEGER) TO service_role;

-- =============================================================================
-- Rate Limiting Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "id" SERIAL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 1,
    CONSTRAINT "rate_limits_unique" UNIQUE ("user_id", "action", "window_start")
);

CREATE INDEX "idx_rate_limits_lookup" ON "public"."rate_limits" ("user_id", "action", "window_start");

-- Clean up old rate limit entries (run periodically)
CREATE OR REPLACE FUNCTION "public"."cleanup_rate_limits"()
RETURNS void
LANGUAGE sql
AS $$
    DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
$$;

-- Check rate limit function
CREATE OR REPLACE FUNCTION "public"."check_rate_limit"(
    p_user_id UUID,
    p_action TEXT,
    p_max_requests INTEGER DEFAULT 60,
    p_window_minutes INTEGER DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    current_window TIMESTAMPTZ;
    current_count INTEGER;
BEGIN
    -- Calculate current window (rounded to minute)
    current_window := date_trunc('minute', NOW());

    -- Try to insert or increment
    INSERT INTO rate_limits (user_id, action, window_start, request_count)
    VALUES (p_user_id, p_action, current_window, 1)
    ON CONFLICT (user_id, action, window_start)
    DO UPDATE SET request_count = rate_limits.request_count + 1
    RETURNING request_count INTO current_count;

    -- Check if over limit
    RETURN current_count <= p_max_requests;
END;
$$;

COMMENT ON FUNCTION "public"."check_rate_limit"(UUID, TEXT, INTEGER, INTEGER) IS 'Checks and increments rate limit for a user action. Returns TRUE if under limit.';
GRANT EXECUTE ON FUNCTION "public"."check_rate_limit"(UUID, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION "public"."check_rate_limit"(UUID, TEXT, INTEGER, INTEGER) TO service_role;

-- =============================================================================
-- API Key Encryption Functions (using pgcrypto)
-- =============================================================================

-- Note: Requires pgcrypto extension
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION "public"."encrypt_api_key"(
    plain_key TEXT,
    encryption_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Use AES-256 encryption
    -- In production, encryption_key should come from environment variable
    RETURN encode(
        pgp_sym_encrypt(plain_key, encryption_key, 'cipher-algo=aes256'),
        'base64'
    );
EXCEPTION
    WHEN undefined_function THEN
        RAISE EXCEPTION 'pgcrypto extension not installed. Run: CREATE EXTENSION pgcrypto;';
END;
$$;

CREATE OR REPLACE FUNCTION "public"."decrypt_api_key"(
    encrypted_key TEXT,
    encryption_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN pgp_sym_decrypt(
        decode(encrypted_key, 'base64'),
        encryption_key
    );
EXCEPTION
    WHEN undefined_function THEN
        RAISE EXCEPTION 'pgcrypto extension not installed. Run: CREATE EXTENSION pgcrypto;';
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to decrypt API key';
END;
$$;

COMMENT ON FUNCTION "public"."encrypt_api_key"(TEXT, TEXT) IS 'Encrypts an API key using AES-256. Requires pgcrypto extension.';
COMMENT ON FUNCTION "public"."decrypt_api_key"(TEXT, TEXT) IS 'Decrypts an API key encrypted with encrypt_api_key. Requires pgcrypto extension.';

-- Only service role can encrypt/decrypt (admin operations)
GRANT EXECUTE ON FUNCTION "public"."encrypt_api_key"(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION "public"."decrypt_api_key"(TEXT, TEXT) TO service_role;

-- =============================================================================
-- Query Feedback Table (for improving LLM accuracy)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."query_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    "question" "text" NOT NULL,
    "generated_sql" "text",
    "was_helpful" boolean,
    "feedback_type" "text", -- 'wrong_results', 'syntax_error', 'missing_data', 'perfect', 'other'
    "feedback_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "query_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."query_feedback" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "query_feedback_insert_own" ON "public"."query_feedback"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "query_feedback_select_own" ON "public"."query_feedback"
    FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE "public"."query_feedback" IS 'User feedback on LLM-generated queries to improve accuracy over time.';

-- =============================================================================
-- Query History Table (for UX - show past queries and favorites)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."query_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    "question" "text" NOT NULL,
    "generated_sql" "text",
    "explanation" "text",
    "result_count" integer,
    "execution_time_ms" integer,
    "is_favorite" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "query_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."query_history" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "query_history_select_own" ON "public"."query_history"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "query_history_insert_own" ON "public"."query_history"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "query_history_update_own" ON "public"."query_history"
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "query_history_delete_own" ON "public"."query_history"
    FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX "idx_query_history_user_created" ON "public"."query_history" ("user_id", "created_at" DESC);
CREATE INDEX "idx_query_history_favorites" ON "public"."query_history" ("user_id", "is_favorite") WHERE is_favorite = true;

COMMENT ON TABLE "public"."query_history" IS 'User query history for quick re-execution and favorites.';

-- =============================================================================
-- Function: get_personalized_suggestions
-- Returns query suggestions based on user's actual travel data
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."get_personalized_suggestions"(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    recent_countries TEXT[];
    recent_cities TEXT[];
    top_amenities TEXT[];
    top_cuisines TEXT[];
BEGIN
    -- Get user's recent countries (last 6 months)
    SELECT array_agg(DISTINCT country ORDER BY country)
    INTO recent_countries
    FROM (
        SELECT country FROM place_visits
        WHERE user_id = p_user_id
          AND country IS NOT NULL
          AND started_at >= NOW() - INTERVAL '6 months'
        LIMIT 10
    ) c;

    -- Get user's recent cities
    SELECT array_agg(DISTINCT city ORDER BY city)
    INTO recent_cities
    FROM (
        SELECT city FROM place_visits
        WHERE user_id = p_user_id
          AND city IS NOT NULL
          AND started_at >= NOW() - INTERVAL '6 months'
        LIMIT 10
    ) c;

    -- Get user's top amenity types
    SELECT array_agg(poi_amenity ORDER BY cnt DESC)
    INTO top_amenities
    FROM (
        SELECT poi_amenity, COUNT(*) as cnt
        FROM place_visits
        WHERE user_id = p_user_id
          AND poi_amenity IS NOT NULL
        GROUP BY poi_amenity
        ORDER BY cnt DESC
        LIMIT 5
    ) a;

    -- Get user's top cuisines
    SELECT array_agg(poi_cuisine ORDER BY cnt DESC)
    INTO top_cuisines
    FROM (
        SELECT poi_cuisine, COUNT(*) as cnt
        FROM place_visits
        WHERE user_id = p_user_id
          AND poi_cuisine IS NOT NULL
        GROUP BY poi_cuisine
        ORDER BY cnt DESC
        LIMIT 5
    ) c;

    -- Build personalized suggestions
    result := jsonb_build_object(
        'suggestions', jsonb_build_array(),
        'stats', jsonb_build_object(
            'recent_countries', COALESCE(recent_countries, ARRAY[]::TEXT[]),
            'recent_cities', COALESCE(recent_cities, ARRAY[]::TEXT[]),
            'top_amenities', COALESCE(top_amenities, ARRAY[]::TEXT[]),
            'top_cuisines', COALESCE(top_cuisines, ARRAY[]::TEXT[])
        )
    );

    -- Generate personalized question suggestions
    IF recent_countries IS NOT NULL AND array_length(recent_countries, 1) > 0 THEN
        result := jsonb_set(result, '{suggestions}',
            result->'suggestions' || jsonb_build_array(
                jsonb_build_object(
                    'question', 'What restaurants did I visit in ' || recent_countries[1] || '?',
                    'description', 'Based on your recent travels to ' || recent_countries[1],
                    'category', 'location'
                )
            )
        );
    END IF;

    IF recent_cities IS NOT NULL AND array_length(recent_cities, 1) > 0 THEN
        result := jsonb_set(result, '{suggestions}',
            result->'suggestions' || jsonb_build_array(
                jsonb_build_object(
                    'question', 'Show me all places I visited in ' || recent_cities[1],
                    'description', 'Explore your visits in ' || recent_cities[1],
                    'category', 'location'
                )
            )
        );
    END IF;

    IF top_amenities IS NOT NULL AND array_length(top_amenities, 1) > 0 THEN
        result := jsonb_set(result, '{suggestions}',
            result->'suggestions' || jsonb_build_array(
                jsonb_build_object(
                    'question', 'Which ' || top_amenities[1] || 's have I visited most often?',
                    'description', 'You seem to enjoy visiting ' || top_amenities[1] || 's',
                    'category', 'venue_type'
                )
            )
        );
    END IF;

    IF top_cuisines IS NOT NULL AND array_length(top_cuisines, 1) > 0 THEN
        result := jsonb_set(result, '{suggestions}',
            result->'suggestions' || jsonb_build_array(
                jsonb_build_object(
                    'question', 'Show me all ' || top_cuisines[1] || ' restaurants I visited',
                    'description', 'You enjoy ' || top_cuisines[1] || ' cuisine',
                    'category', 'cuisine'
                )
            )
        );
    END IF;

    -- Add time-based suggestions
    result := jsonb_set(result, '{suggestions}',
        result->'suggestions' || jsonb_build_array(
            jsonb_build_object(
                'question', 'Where did I spend the most time eating last month?',
                'description', 'Find your longest restaurant visits',
                'category', 'time'
            ),
            jsonb_build_object(
                'question', 'What new places did I discover this year?',
                'description', 'See all your 2024/2025 discoveries',
                'category', 'discovery'
            )
        )
    );

    RETURN result;
END;
$$;

COMMENT ON FUNCTION "public"."get_personalized_suggestions"(UUID) IS 'Returns personalized query suggestions based on user travel patterns.';
GRANT EXECUTE ON FUNCTION "public"."get_personalized_suggestions"(UUID) TO authenticated;

-- =============================================================================
-- Function: update_visit_confirmation
-- Allows users to confirm or correct place visit detection
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."update_visit_confirmation"(
    p_visit_id UUID,
    p_action TEXT,  -- 'confirm', 'reject', 'correct'
    p_corrected_poi JSONB DEFAULT NULL  -- For 'correct': {poi_name, poi_amenity, poi_cuisine, poi_category}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_result JSONB;
BEGIN
    -- Verify ownership
    SELECT user_id INTO v_user_id
    FROM place_visits
    WHERE id = p_visit_id;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Visit not found');
    END IF;

    IF v_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
    END IF;

    CASE p_action
        WHEN 'confirm' THEN
            UPDATE place_visits
            SET detection_method = 'user_confirmed',
                confidence_score = 1.0,
                updated_at = NOW()
            WHERE id = p_visit_id;

            v_result := jsonb_build_object('success', true, 'message', 'Visit confirmed');

        WHEN 'reject' THEN
            DELETE FROM place_visits
            WHERE id = p_visit_id;

            v_result := jsonb_build_object('success', true, 'message', 'Visit removed');

        WHEN 'correct' THEN
            IF p_corrected_poi IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error', 'Corrected POI data required');
            END IF;

            UPDATE place_visits
            SET poi_name = COALESCE(p_corrected_poi->>'poi_name', poi_name),
                poi_amenity = COALESCE(p_corrected_poi->>'poi_amenity', poi_amenity),
                poi_cuisine = COALESCE(p_corrected_poi->>'poi_cuisine', poi_cuisine),
                poi_category = COALESCE(p_corrected_poi->>'poi_category', poi_category),
                detection_method = 'user_corrected',
                confidence_score = 1.0,
                updated_at = NOW()
            WHERE id = p_visit_id;

            v_result := jsonb_build_object('success', true, 'message', 'Visit corrected');

        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Use confirm, reject, or correct.');
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION "public"."update_visit_confirmation"(UUID, TEXT, JSONB) IS 'Allows users to confirm, reject, or correct detected place visits.';
GRANT EXECUTE ON FUNCTION "public"."update_visit_confirmation"(UUID, TEXT, JSONB) TO authenticated;
