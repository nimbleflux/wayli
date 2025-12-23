--
-- Migration: 014_pgvector_grants.down.sql
-- Description: Revoke permissions on pgvector tables, views, and functions
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- Note: Function grants are revoked in 012_pgvector_functions.down.sql

-- Revoke view grants
REVOKE SELECT ON "public"."my_poi_embeddings" FROM "authenticated";
REVOKE SELECT ON "public"."my_trip_embeddings" FROM "authenticated";

-- Revoke table grants
REVOKE ALL ON TABLE "public"."poi_embeddings" FROM "authenticated";
REVOKE ALL ON TABLE "public"."poi_embeddings" FROM "service_role";

REVOKE ALL ON TABLE "public"."trip_embeddings" FROM "authenticated";
REVOKE ALL ON TABLE "public"."trip_embeddings" FROM "service_role";

REVOKE ALL ON TABLE "public"."user_preference_vectors" FROM "authenticated";
REVOKE ALL ON TABLE "public"."user_preference_vectors" FROM "service_role";
