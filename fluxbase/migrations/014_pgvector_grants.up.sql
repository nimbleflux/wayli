--
-- Migration: 014_pgvector_grants.up.sql
-- Description: Grant permissions on pgvector tables, views, and functions
-- Dependencies: 009_pgvector_setup.up.sql, 012_pgvector_functions.up.sql, 013_pgvector_views.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;

-- =============================================================================
-- Table Grants: Vector embedding tables
-- authenticated: Full CRUD (RLS enforces own data only)
-- service_role: Full access
-- =============================================================================

-- poi_embeddings: Full access for authenticated users (RLS enforces own embeddings)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."poi_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."poi_embeddings" TO "service_role";

-- trip_embeddings: Full access for authenticated users (RLS enforces own embeddings)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."trip_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_embeddings" TO "service_role";

-- user_preference_vectors: Full access for authenticated users (RLS enforces own preferences)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."user_preference_vectors" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preference_vectors" TO "service_role";

-- =============================================================================
-- View Grants: Secure views for chatbot access
-- =============================================================================

-- my_poi_embeddings: Secure view (user filtering built-in)
GRANT SELECT ON "public"."my_poi_embeddings" TO "authenticated";

-- my_trip_embeddings: Secure view (user filtering built-in)
GRANT SELECT ON "public"."my_trip_embeddings" TO "authenticated";

-- Note: Function grants are already defined in 012_pgvector_functions.up.sql
