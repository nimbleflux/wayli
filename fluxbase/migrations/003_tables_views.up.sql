--
-- Migration: 003_tables_views.up.sql
-- Description: Create all database tables and views for Wayli application
-- Dependencies: 002_functions.up.sql (functions must exist first)
-- Author: Wayli Migration System
-- Created: 2025-01-15
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

CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL PRIMARY KEY,
    "first_name" "text",
    "last_name" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'user'::"text",
    "avatar_url" "text",
    "home_address" "jsonb",
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_dismissed" boolean DEFAULT false,
    "home_address_skipped" boolean DEFAULT false,
    "first_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_profiles_role_check" CHECK (
        (
            "role" = ANY (
                ARRAY ['user'::"text", 'admin'::"text", 'moderator'::"text"]
            )
        )
    )
);
COMMENT ON TABLE "public"."user_profiles" IS 'User profile information. RLS policies ensure users can only access their own profiles.';
COMMENT ON COLUMN "public"."user_profiles"."onboarding_completed" IS 'Whether user has completed initial onboarding flow';
COMMENT ON COLUMN "public"."user_profiles"."onboarding_dismissed" IS 'Whether user has permanently dismissed onboarding prompts';
COMMENT ON COLUMN "public"."user_profiles"."home_address_skipped" IS 'Whether user explicitly skipped home address setup during onboarding';
COMMENT ON COLUMN "public"."user_profiles"."first_login_at" IS 'Timestamp of first successful login after registration';
CREATE TABLE IF NOT EXISTS "public"."tracker_data" (
    "user_id" "uuid" NOT NULL,
    "tracker_type" "text" NOT NULL,
    "device_id" "text",
    "recorded_at" timestamp with time zone NOT NULL,
    "location" "public"."geometry"(Point, 4326),
    "country_code" character varying(2),
    "altitude" numeric(8, 2),
    "accuracy" numeric(8, 2),
    "speed" numeric(12, 2),
    "distance" numeric(12, 2),
    "time_spent" numeric(12, 2),
    "heading" numeric(5, 2),
    "battery_level" integer,
    "is_charging" boolean,
    "activity_type" "text",
    "geocode" "jsonb",
    "tz_diff" numeric(4, 1),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    PRIMARY KEY ("user_id", "recorded_at")
);
COMMENT ON COLUMN "public"."tracker_data"."distance" IS 'Distance in meters from the previous chronological point for this user';
COMMENT ON COLUMN "public"."tracker_data"."time_spent" IS 'Time spent in seconds from the previous chronological point for this user';
COMMENT ON COLUMN "public"."tracker_data"."tz_diff" IS 'Timezone difference from UTC in hours (e.g., +2.0 for UTC+2, -5.0 for UTC-5)';
CREATE TABLE IF NOT EXISTS "public"."trips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "image_url" "text",
    "labels" "text" [] DEFAULT '{}'::"text" [],
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "trips_status_check" CHECK (
        (
            "status" = ANY (
                ARRAY ['active'::"text", 'planned'::"text", 'completed'::"text", 'cancelled'::"text", 'pending'::"text", 'rejected'::"text"]
            )
        )
    )
);
COMMENT ON COLUMN "public"."trips"."status" IS 'Trip status: active, planned, completed, cancelled, pending (suggested), rejected';
COMMENT ON COLUMN "public"."trips"."labels" IS 'Array of labels including "suggested" for trips created from suggestions';
COMMENT ON COLUMN "public"."trips"."metadata" IS 'Trip metadata including dataPoints, visitedCities, visitedCountries, etc.';
CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "id" "uuid" NOT NULL PRIMARY KEY,
    "theme" "text" DEFAULT 'light'::"text",
    "language" "text" DEFAULT 'en'::"text",
    "notifications_enabled" boolean DEFAULT true,
    "timezone" "text" DEFAULT 'UTC+00:00 (London, Dublin)'::"text",
    "pexels_api_key" "text",
    "owntracks_api_key" "text",
    "trip_exclusions" "jsonb" DEFAULT '[]'::"jsonb",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
CREATE TABLE IF NOT EXISTS "public"."want_to_visit_places" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL,
    "place_id" "text",
    "title" "text" NOT NULL,
    "country_code" character varying(2),
    "type" "text" DEFAULT 'place'::"text",
    "favorite" boolean DEFAULT false,
    "description" "text",
    "location" "public"."geometry"(Point, 4326) NOT NULL,
    "address" "text",
    "marker_type" "text" DEFAULT 'default'::"text",
    "marker_color" "text" DEFAULT '#3B82F6'::"text",
    "labels" "text"[] DEFAULT ARRAY[]::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON COLUMN "public"."want_to_visit_places"."title" IS 'Place title/name';
COMMENT ON COLUMN "public"."want_to_visit_places"."location" IS 'PostGIS Point geometry storing the place coordinates';
COMMENT ON COLUMN "public"."want_to_visit_places"."address" IS 'Full address of the place';
COMMENT ON COLUMN "public"."want_to_visit_places"."marker_type" IS 'Type of marker icon (default, home, restaurant, etc.)';
COMMENT ON COLUMN "public"."want_to_visit_places"."marker_color" IS 'Hex color code for the marker';
COMMENT ON COLUMN "public"."want_to_visit_places"."labels" IS 'Custom labels/tags for the place';
-- Note: workers table removed - workers are now managed by Fluxbase Jobs platform
-- Note: server_settings table removed - use Fluxbase AppSettingsManager instead
-- Note: audit_logs table removed - use Fluxbase audit logging instead

-- =============================================================================
-- Place Visits Materialized View
-- Detects POI visits using dual-source detection:
--   1. PRIMARY: geocode->properties when layer is 'venue' (user is AT the venue)
--   2. FALLBACK: nearby_pois array when primary isn't a venue
-- =============================================================================

-- Set search_path to include public for PostGIS functions
SET search_path TO public;

CREATE MATERIALIZED VIEW "public"."place_visits" AS
WITH venue_points AS (
    -- SOURCE 1: Primary venue from geocode result (user is AT this place)
    SELECT
        td.user_id,
        td.recorded_at,
        td.location,
        COALESCE(
            td.geocode->'properties'->>'locality',
            td.geocode->'properties'->'address'->>'city',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:city'
        ) as city,
        td.country_code,
        td.geocode->'properties'->'addendum'->'osm'->>'name' as poi_name,
        td.geocode->'properties'->>'layer' as poi_layer,
        td.geocode->'properties'->'addendum'->'osm'->>'amenity' as osm_amenity,
        td.geocode->'properties'->'addendum'->'osm'->>'leisure' as osm_leisure,
        td.geocode->'properties'->'addendum'->'osm'->>'tourism' as osm_tourism,
        td.geocode->'properties'->'addendum'->'osm'->>'shop' as osm_shop,
        td.geocode->'properties'->'addendum'->'osm'->>'sport' as osm_sport,
        td.geocode->'properties'->'addendum'->'osm'->>'cuisine' as poi_cuisine,
        td.geocode->'properties'->'addendum'->'osm' as poi_tags,
        (td.geocode->'properties'->>'confidence')::numeric as poi_confidence,
        0::numeric as poi_distance,
        'primary' as source
    FROM "public"."tracker_data" td
    WHERE td.geocode->'properties'->'addendum'->'osm'->>'name' IS NOT NULL
      AND td.geocode->'properties'->>'layer' IN ('venue', 'address')
      AND (
          td.geocode->'properties'->'addendum'->'osm'->>'amenity' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'leisure' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'tourism' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'shop' IS NOT NULL
          OR td.geocode->'properties'->'addendum'->'osm'->>'sport' IS NOT NULL
      )

    UNION ALL

    -- SOURCE 2: Nearby POIs (fallback when primary isn't a venue)
    SELECT
        td.user_id,
        td.recorded_at,
        td.location,
        COALESCE(
            td.geocode->'properties'->>'locality',
            td.geocode->'properties'->'address'->>'city',
            td.geocode->'properties'->'addendum'->'osm'->>'addr:city'
        ) as city,
        td.country_code,
        poi->>'name' as poi_name,
        poi->>'layer' as poi_layer,
        poi->'addendum'->'osm'->>'amenity' as osm_amenity,
        poi->'addendum'->'osm'->>'leisure' as osm_leisure,
        poi->'addendum'->'osm'->>'tourism' as osm_tourism,
        poi->'addendum'->'osm'->>'shop' as osm_shop,
        poi->'addendum'->'osm'->>'sport' as osm_sport,
        poi->'addendum'->'osm'->>'cuisine' as poi_cuisine,
        poi->'addendum'->'osm' as poi_tags,
        COALESCE((poi->>'confidence')::numeric, 0.8) as poi_confidence,
        (poi->>'distance_meters')::numeric as poi_distance,
        'nearby_pois' as source
    FROM "public"."tracker_data" td,
    LATERAL jsonb_array_elements(td.geocode->'properties'->'nearby_pois') AS poi
    WHERE poi->>'name' IS NOT NULL
      AND (poi->>'distance_meters')::numeric < 75
      AND NOT (
          td.geocode->'properties'->>'layer' IN ('venue', 'address')
          AND (
              td.geocode->'properties'->'addendum'->'osm'->>'amenity' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'leisure' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'tourism' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'shop' IS NOT NULL
              OR td.geocode->'properties'->'addendum'->'osm'->>'sport' IS NOT NULL
          )
      )
),
deduplicated AS (
    SELECT *,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, recorded_at
            ORDER BY (source = 'primary') DESC, poi_distance ASC
        ) as rn
    FROM venue_points
),
poi_points AS (
    SELECT
        user_id,
        recorded_at,
        location,
        city,
        country_code,
        poi_name,
        poi_layer,
        COALESCE(osm_amenity, osm_leisure, osm_tourism, osm_shop) as poi_amenity,
        poi_cuisine,
        osm_sport as poi_sport,
        CASE
            WHEN osm_amenity IN ('restaurant','cafe','bar','pub','fast_food','food_court','biergarten','ice_cream','bakery') THEN 'food'
            WHEN osm_amenity IN ('cinema','theatre','nightclub','casino','amusement_arcade','bowling_alley') THEN 'entertainment'
            WHEN osm_amenity IN ('museum','gallery','library','arts_centre','community_centre') OR osm_tourism = 'museum' THEN 'culture'
            WHEN osm_amenity IN ('school','university','college','kindergarten','language_school','music_school','driving_school') THEN 'education'
            WHEN osm_leisure IN ('golf_course','sports_centre','fitness_centre','swimming_pool','pitch','stadium','tennis','ice_rink') THEN 'sports'
            WHEN osm_sport IS NOT NULL THEN 'sports'
            WHEN osm_amenity IN ('hotel','hostel','guest_house','motel') OR osm_tourism IN ('hotel','hostel','guest_house','motel','apartment') THEN 'accommodation'
            WHEN osm_amenity IN ('hospital','clinic','doctors','dentist','pharmacy','veterinary','optician') THEN 'healthcare'
            WHEN osm_amenity IN ('place_of_worship') THEN 'worship'
            WHEN osm_leisure IN ('park','garden','nature_reserve','playground','dog_park','beach_resort') THEN 'outdoors'
            WHEN osm_shop IN ('supermarket','convenience','grocery','greengrocer','butcher','bakery','deli') THEN 'grocery'
            WHEN osm_amenity IN ('bus_station','train_station','airport','ferry_terminal','taxi','car_rental') THEN 'transport'
            WHEN osm_shop IS NOT NULL THEN 'shopping'
            ELSE 'other'
        END as poi_category,
        poi_confidence,
        poi_distance,
        poi_tags,
        source
    FROM deduplicated
    WHERE rn = 1
),
with_boundaries AS (
    SELECT *,
        CASE WHEN
            poi_name IS DISTINCT FROM LAG(poi_name) OVER (PARTITION BY user_id ORDER BY recorded_at)
            OR recorded_at - LAG(recorded_at) OVER (PARTITION BY user_id ORDER BY recorded_at) > INTERVAL '30 minutes'
            OR LAG(poi_name) OVER (PARTITION BY user_id ORDER BY recorded_at) IS NULL
        THEN 1 ELSE 0 END as new_visit
    FROM poi_points
),
visit_groups AS (
    SELECT *,
        SUM(new_visit) OVER (PARTITION BY user_id ORDER BY recorded_at) as visit_id
    FROM with_boundaries
)
SELECT
    gen_random_uuid() as id,
    user_id,
    MIN(recorded_at) as started_at,
    ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer as duration_minutes,
    ST_Centroid(ST_Collect(location)) as location,
    poi_name,
    MODE() WITHIN GROUP (ORDER BY poi_layer) as poi_layer,
    MODE() WITHIN GROUP (ORDER BY poi_amenity) as poi_amenity,
    MODE() WITHIN GROUP (ORDER BY poi_cuisine) as poi_cuisine,
    MODE() WITHIN GROUP (ORDER BY poi_sport) as poi_sport,
    MODE() WITHIN GROUP (ORDER BY poi_category) as poi_category,
    ROUND(AVG(poi_confidence)::numeric, 3) as confidence_score,
    ROUND(AVG(poi_distance)::numeric, 2) as avg_distance_meters,
    MODE() WITHIN GROUP (ORDER BY poi_tags::text)::jsonb as poi_tags,
    MODE() WITHIN GROUP (ORDER BY city) as city,
    MODE() WITHIN GROUP (ORDER BY country_code) as country_code,
    COUNT(*)::integer as gps_points_count,
    EXTRACT(HOUR FROM MIN(recorded_at))::integer as visit_hour,
    CASE
        WHEN EXTRACT(HOUR FROM MIN(recorded_at)) BETWEEN 5 AND 11 THEN 'morning'
        WHEN EXTRACT(HOUR FROM MIN(recorded_at)) BETWEEN 12 AND 17 THEN 'afternoon'
        WHEN EXTRACT(HOUR FROM MIN(recorded_at)) BETWEEN 18 AND 21 THEN 'evening'
        ELSE 'night'
    END as visit_time_of_day,
    TRIM(LOWER(TO_CHAR(MIN(recorded_at), 'day'))) as day_of_week,
    EXTRACT(DOW FROM MIN(recorded_at)) IN (0, 6) as is_weekend,
    CASE
        WHEN ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer < 30 THEN 'short'
        WHEN ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer <= 90 THEN 'regular'
        ELSE 'extended'
    END as duration_category,
    to_tsvector('simple', COALESCE(poi_name, '')) as poi_name_search,
    NOW() as created_at
FROM visit_groups
GROUP BY user_id, visit_id, poi_name
HAVING COUNT(*) >= 2
   AND ROUND(EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 60)::integer >= 15
ORDER BY user_id, MIN(recorded_at);

COMMENT ON MATERIALIZED VIEW "public"."place_visits" IS 'Detected POI visits using dual-source detection (primary venue + nearby_pois). Refreshed hourly.';

-- =============================================================================
-- Secure Views for LLM Queries
-- =============================================================================

CREATE OR REPLACE VIEW "public"."my_place_visits"
WITH (security_barrier = true)
AS
SELECT
    id,
    started_at,
    duration_minutes,
    ST_X(location::geometry) as longitude,
    ST_Y(location::geometry) as latitude,
    poi_name,
    poi_layer,
    poi_amenity,
    poi_cuisine,
    poi_sport,
    poi_category,
    confidence_score,
    avg_distance_meters,
    poi_tags,
    city,
    country_code,
    gps_points_count,
    visit_hour,
    visit_time_of_day,
    day_of_week,
    is_weekend,
    duration_category,
    created_at
FROM "public"."place_visits"
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_place_visits" IS 'Secure view of place_visits filtered to current user. Use this for LLM queries.';

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
    SUM(duration_minutes)::integer as total_duration_minutes
FROM "public"."place_visits"
WHERE user_id = auth.uid()
GROUP BY poi_name, poi_amenity, poi_category, city, country_code;

COMMENT ON VIEW "public"."my_poi_summary" IS 'Aggregated POI visit statistics per user. Use for "most visited", "how many times" questions.';

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
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_tracker_data" IS 'Secure view of tracker_data filtered to current user. Use this for LLM queries.';

CREATE OR REPLACE VIEW "public"."my_trips"
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
    id,
    title,
    description,
    start_date,
    end_date,
    status,
    image_url,
    labels,
    metadata,
    metadata->>'dataPoints' as data_points,
    metadata->>'visitedCities' as visited_cities,
    metadata->>'visitedCountries' as visited_countries,
    created_at,
    updated_at
FROM "public"."trips"
WHERE user_id = auth.uid();

COMMENT ON VIEW "public"."my_trips" IS 'Secure view of trips filtered to current user. Use this for LLM queries.';
