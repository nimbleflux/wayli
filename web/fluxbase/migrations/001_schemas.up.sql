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

-- Create topology schema for PostGIS topology extension
CREATE SCHEMA IF NOT EXISTS "topology";

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "public";
CREATE EXTENSION IF NOT EXISTS "postgis_topology" WITH SCHEMA "topology";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "public";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";
