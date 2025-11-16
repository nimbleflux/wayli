--
-- Migration: 001_schemas.up.sql
-- Description: Initialize PostgreSQL settings, extensions, and schemas
-- Dependencies: None (must be first)
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

-- Comment on public schema
COMMENT ON SCHEMA "public" IS 'Wayli public schema';

-- Enable required extensions
-- Note: PostGIS should already be enabled in Fluxbase/Supabase
-- CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "public";
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "public";
