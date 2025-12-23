--
-- Migration: 001_schemas.down.sql
-- Description: Rollback schema initialization
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop extensions (in reverse order)
DROP EXTENSION IF EXISTS "pg_trgm" CASCADE;
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
DROP EXTENSION IF EXISTS "postgis_topology" CASCADE;
DROP EXTENSION IF EXISTS "postgis" CASCADE;

-- Drop topology schema
DROP SCHEMA IF EXISTS "topology" CASCADE;
