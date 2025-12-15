--
-- Migration: 007_grants.down.sql
-- Description: Revoke all grants created by 007_grants.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- Revoke function grants from authenticated
REVOKE EXECUTE ON FUNCTION "public"."full_country" ("country" "text")
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."st_distancesphere" (
    "geog1" "public"."geography",
    "geog2" "public"."geography"
)
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."st_distancesphere" (
    "geom1" "public"."geometry",
    "geom2" "public"."geometry"
)
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."get_points_within_radius" (
    "center_lat" double precision,
    "center_lon" double precision,
    "radius_meters" double precision,
    "user_uuid" "uuid"
)
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."get_user_tracking_data" (
    "user_uuid" "uuid",
    "start_date" timestamp
    with
        time zone,
        "end_date" timestamp
    with
        time zone,
        "limit_count" integer
)
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."sample_tracker_data_if_needed" (
    "p_target_user_id" "uuid",
    "p_start_date" timestamp
    with
        time zone,
        "p_end_date" timestamp
    with
        time zone,
        "p_max_points_threshold" integer,
        "p_min_distance_meters" numeric,
        "p_min_time_minutes" numeric,
        "p_max_points_per_hour" integer,
        "p_offset" integer,
        "p_limit" integer
)
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."validate_tracking_query_limits" (
    "p_limit" integer,
    "p_max_points_threshold" integer
)
FROM
    "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."is_user_admin" ("user_uuid" "uuid")
FROM
    "authenticated";

-- Revoke table grants from authenticated
-- Note: audit_logs table removed - no revoke needed
REVOKE
SELECT
,
    INSERT,
UPDATE,
DELETE ON TABLE "public"."user_profiles"
FROM
    "authenticated";

REVOKE
SELECT
,
    INSERT,
UPDATE,
DELETE ON TABLE "public"."tracker_data"
FROM
    "authenticated";

REVOKE
SELECT
,
    INSERT,
UPDATE,
DELETE ON TABLE "public"."trips"
FROM
    "authenticated";

REVOKE
SELECT
,
    INSERT,
UPDATE,
DELETE ON TABLE "public"."user_preferences"
FROM
    "authenticated";

REVOKE
SELECT
,
    INSERT,
UPDATE,
DELETE ON TABLE "public"."want_to_visit_places"
FROM
    "authenticated";

-- Note: workers revokes removed - workers are now managed by Fluxbase Jobs platform
-- Revoke place_visits and secure views grants
REVOKE EXECUTE ON FUNCTION "public"."refresh_place_visits" ()
FROM
    "service_role";

REVOKE
SELECT
    ON "public"."my_trips"
FROM
    "authenticated";

REVOKE
SELECT
    ON "public"."my_tracker_data"
FROM
    "authenticated";

REVOKE
SELECT
    ON "public"."my_poi_summary"
FROM
    "authenticated";

REVOKE
SELECT
    ON "public"."my_place_visits"
FROM
    "authenticated";

REVOKE
SELECT
    ON "public"."place_visits"
FROM
    "service_role";

-- Drop admin role (first set all admin users back to authenticated)
UPDATE "auth"."users"
SET
    "role" = 'authenticated'
WHERE
    "role" = 'admin';

DROP ROLE IF EXISTS admin;

-- Revoke schema usage
REVOKE USAGE ON SCHEMA "public"
FROM
    "anon";

REVOKE USAGE ON SCHEMA "public"
FROM
    "authenticated";

-- Note: service_role grants are NOT revoked (critical system role)
-- Note: postgres role never had explicit grants (doesn't exist in Fluxbase)
-- Note: Default privileges were NOT set (postgres role doesn't exist in Fluxbase)