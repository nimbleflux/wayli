--
-- Migration: 009_cleanup_jobs_workers.up.sql
-- Description: Remove job queue and worker infrastructure (migrated to Fluxbase Jobs platform)
-- Dependencies: All previous migrations
-- Author: Wayli Migration System
-- Created: 2025-11-24
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

-- ============================================================================
-- CLEANUP: Job Queue and Worker Infrastructure
-- ============================================================================
--
-- This migration removes all job queue and worker database objects as these
-- are now handled by the Fluxbase Jobs platform. Job handlers have been
-- migrated to fluxbase/jobs/ directory.
--
-- Removal order (reverse of creation):
-- 1. RLS policies
-- 2. Grants
-- 3. Triggers
-- 4. Foreign key constraints
-- 5. Indexes
-- 6. Functions that depend on jobs/workers tables
-- 7. Tables
--

-- ============================================================================
-- 1. DROP RLS POLICIES
-- ============================================================================

-- Jobs table RLS policies
DROP POLICY IF EXISTS "Jobs can be updated" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can delete their own jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can insert their own jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can view their own jobs" ON "public"."jobs";

-- Note: Workers table has no RLS policies (system-only table)

-- ============================================================================
-- 2. REVOKE GRANTS
-- ============================================================================

-- Revoke function grants
REVOKE ALL ON FUNCTION "public"."cleanup_expired_exports"() FROM "service_role";
REVOKE ALL ON FUNCTION "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text") FROM "service_role";

-- Revoke table grants
REVOKE ALL ON TABLE "public"."jobs" FROM "authenticated";
REVOKE ALL ON TABLE "public"."jobs" FROM "service_role";
REVOKE ALL ON TABLE "public"."workers" FROM "authenticated";
REVOKE ALL ON TABLE "public"."workers" FROM "service_role";

-- ============================================================================
-- 3. DROP TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS "update_workers_updated_at" ON "public"."workers";

-- ============================================================================
-- 4. DROP FOREIGN KEY CONSTRAINTS
-- ============================================================================

ALTER TABLE IF EXISTS "public"."workers" DROP CONSTRAINT IF EXISTS "workers_current_job_fkey";
ALTER TABLE IF EXISTS "public"."jobs" DROP CONSTRAINT IF EXISTS "jobs_created_by_fkey";

-- ============================================================================
-- 5. DROP INDEXES
-- ============================================================================

-- Jobs table indexes
DROP INDEX IF EXISTS "public"."idx_jobs_created_at";
DROP INDEX IF EXISTS "public"."idx_jobs_created_by";
DROP INDEX IF EXISTS "public"."idx_jobs_priority";
DROP INDEX IF EXISTS "public"."idx_jobs_status";
DROP INDEX IF EXISTS "public"."idx_jobs_worker_id";
DROP INDEX IF EXISTS "public"."idx_jobs_queue";

-- Workers table indexes
DROP INDEX IF EXISTS "public"."idx_workers_last_heartbeat";
DROP INDEX IF EXISTS "public"."idx_workers_status";
DROP INDEX IF EXISTS "public"."idx_workers_updated_at";

-- ============================================================================
-- 6. DROP FUNCTIONS THAT DEPEND ON JOBS/WORKERS TABLES
-- ============================================================================

DROP FUNCTION IF EXISTS "public"."cleanup_expired_exports"();
DROP FUNCTION IF EXISTS "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text");
DROP FUNCTION IF EXISTS "public"."update_workers_updated_at"();

-- ============================================================================
-- 7. DROP TABLES
-- ============================================================================

DROP TABLE IF EXISTS "public"."workers" CASCADE;
DROP TABLE IF EXISTS "public"."jobs" CASCADE;

-- ============================================================================
-- COMPLETION
-- ============================================================================

COMMENT ON SCHEMA "public" IS 'Wayli public schema - job/worker infrastructure migrated to Fluxbase Jobs platform';
