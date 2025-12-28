--
-- Migration: 016_fix_view_grants.down.sql
-- Description: Revoke grants on secure views (rollback)
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- Revoke SELECT grants (note: these will be re-applied by 007_grants.up.sql if needed)
REVOKE SELECT ON "public"."my_place_visits" FROM "authenticated";
REVOKE SELECT ON "public"."my_poi_summary" FROM "authenticated";
REVOKE SELECT ON "public"."my_tracker_data" FROM "authenticated";
REVOKE SELECT ON "public"."my_trips" FROM "authenticated";
REVOKE SELECT ON "public"."my_poi_embeddings" FROM "authenticated";
REVOKE SELECT ON "public"."my_trip_embeddings" FROM "authenticated";
REVOKE SELECT ON "public"."my_preferences" FROM "authenticated";
REVOKE SELECT ON "public"."my_embedding_stats" FROM "authenticated";
