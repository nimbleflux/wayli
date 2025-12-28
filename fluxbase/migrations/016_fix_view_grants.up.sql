--
-- Migration: 016_fix_view_grants.up.sql
-- Description: Re-apply grants on secure views for authenticated role
-- Dependencies: 003_tables_views.up.sql, 007_grants.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- Note: Grants are dropped when views are recreated with CREATE OR REPLACE VIEW.
-- This migration ensures all my_* views have the correct grants.
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- Re-apply SELECT grants on secure views for authenticated users
-- =============================================================================

-- Views from 003_tables_views.up.sql
GRANT SELECT ON "public"."my_place_visits" TO "authenticated";
GRANT SELECT ON "public"."my_poi_summary" TO "authenticated";
GRANT SELECT ON "public"."my_tracker_data" TO "authenticated";
GRANT SELECT ON "public"."my_trips" TO "authenticated";

-- Views from 013_pgvector_views.up.sql (included for completeness)
GRANT SELECT ON "public"."my_poi_embeddings" TO "authenticated";
GRANT SELECT ON "public"."my_trip_embeddings" TO "authenticated";
GRANT SELECT ON "public"."my_preferences" TO "authenticated";
GRANT SELECT ON "public"."my_embedding_stats" TO "authenticated";
