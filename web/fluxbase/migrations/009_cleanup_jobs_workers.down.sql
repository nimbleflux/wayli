--
-- Migration: 009_cleanup_jobs_workers.down.sql
-- Description: Rollback - Restore job queue and worker infrastructure
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

SET default_tablespace = '';
SET default_table_access_method = "heap";

-- ============================================================================
-- ROLLBACK: Restore Job Queue and Worker Infrastructure
-- ============================================================================

-- ============================================================================
-- 1. RECREATE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "error" "text",
    "last_error" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "worker_id" "text",
    CONSTRAINT "jobs_priority_check" CHECK (
        (
            "priority" = ANY (
                ARRAY ['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]
            )
        )
    ),
    CONSTRAINT "jobs_progress_check" CHECK (
        (
            ("progress" >= 0)
            AND ("progress" <= 100)
        )
    ),
    CONSTRAINT "jobs_status_check" CHECK (
        (
            "status" = ANY (
                ARRAY ['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]
            )
        )
    )
);

ALTER TABLE ONLY "public"."jobs" REPLICA IDENTITY FULL;
COMMENT ON TABLE "public"."jobs" IS 'Job queue table with realtime updates enabled. REPLICA IDENTITY FULL allows realtime to broadcast complete row data for updates.';
COMMENT ON COLUMN "public"."jobs"."retry_count" IS 'Number of retry attempts for this job';

CREATE TABLE IF NOT EXISTS "public"."workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "status" "text" DEFAULT 'idle'::"text",
    "current_job" "uuid",
    "last_heartbeat" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "workers_status_check" CHECK (
        (
            "status" = ANY (
                ARRAY ['idle'::"text", 'working'::"text", 'error'::"text", 'offline'::"text"]
            )
        )
    )
);

-- ============================================================================
-- 2. RECREATE FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."update_workers_updated_at"() RETURNS "trigger" LANGUAGE "plpgsql"
SET "search_path" TO '' AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."cleanup_expired_exports"() RETURNS integer LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE deleted_count INTEGER := 0;
expired_job RECORD;
BEGIN -- Find expired export jobs
FOR expired_job IN
SELECT id,
    (data->>'file_path') as file_path
FROM public.jobs
WHERE type = 'data_export'
    AND (data->>'expires_at')::timestamp with time zone < NOW()
    AND data->>'file_path' IS NOT NULL LOOP -- Delete the file from storage
DELETE FROM storage.objects
WHERE name = expired_job.file_path
    AND bucket_id = 'exports';
DELETE FROM public.jobs
WHERE id = expired_job.id;
deleted_count := deleted_count + 1;
END LOOP;
RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."create_distance_calculation_job"(
        "target_user_id" "uuid",
        "job_reason" "text" DEFAULT 'import_fallback'::"text"
    ) RETURNS "uuid" LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO '' AS $$
DECLARE job_id UUID;
BEGIN -- Insert the job using the correct column name (created_by instead of user_id)
INSERT INTO public.jobs (
        type,
        status,
        priority,
        data,
        created_by
    )
VALUES (
        'distance_calculation',
        'queued',
        'low',
        jsonb_build_object(
            'type',
            'distance_calculation',
            'target_user_id',
            target_user_id,
            'reason',
            job_reason,
            'created_at',
            now()
        ),
        target_user_id
    )
RETURNING id INTO job_id;
RETURN job_id;
END;
$$;
COMMENT ON FUNCTION "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text") IS 'Safely creates a distance calculation job using the correct column names.';

-- ============================================================================
-- 3. RECREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_jobs_created_at" ON "public"."jobs" USING "btree" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_jobs_created_by" ON "public"."jobs" USING "btree" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_jobs_priority" ON "public"."jobs" USING "btree" ("priority");
CREATE INDEX IF NOT EXISTS "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");
CREATE INDEX IF NOT EXISTS "idx_jobs_worker_id" ON "public"."jobs" USING "btree" ("worker_id");
CREATE INDEX IF NOT EXISTS "idx_jobs_queue" ON "public"."jobs" USING "btree" ("status", "priority" DESC, "created_at")
WHERE ("status" = ANY (ARRAY ['queued'::"text", 'running'::"text"]));
COMMENT ON INDEX "public"."idx_jobs_queue" IS 'Optimizes job queue queries for processing queued and running jobs by priority';

CREATE INDEX IF NOT EXISTS "idx_workers_last_heartbeat" ON "public"."workers" USING "btree" ("last_heartbeat");
CREATE INDEX IF NOT EXISTS "idx_workers_status" ON "public"."workers" USING "btree" ("status");
CREATE INDEX IF NOT EXISTS "idx_workers_updated_at" ON "public"."workers" USING "btree" ("updated_at");

-- ============================================================================
-- 4. RECREATE FOREIGN KEY CONSTRAINTS
-- ============================================================================

ALTER TABLE ONLY "public"."jobs"
ADD CONSTRAINT "jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."workers"
ADD CONSTRAINT "workers_current_job_fkey" FOREIGN KEY ("current_job") REFERENCES "public"."jobs"("id") ON DELETE SET NULL;

-- ============================================================================
-- 5. RECREATE TRIGGERS
-- ============================================================================

CREATE OR REPLACE TRIGGER "update_workers_updated_at" BEFORE
UPDATE ON "public"."workers" FOR EACH ROW EXECUTE FUNCTION "public"."update_workers_updated_at"();

-- ============================================================================
-- 6. RESTORE GRANTS
-- ============================================================================

-- Function grants
GRANT EXECUTE ON FUNCTION "public"."cleanup_expired_exports"() TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text") TO "service_role";

-- Table grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."workers" TO "authenticated";
GRANT ALL ON TABLE "public"."workers" TO "service_role";

-- ============================================================================
-- 7. RESTORE RLS POLICIES
-- ============================================================================

-- Enable RLS on jobs table
ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;

-- Jobs table RLS policies
CREATE POLICY "Jobs can be updated" ON "public"."jobs" FOR
UPDATE USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "created_by"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
            OR (
                EXISTS (
                    SELECT 1
                    FROM "public"."workers"
                    WHERE (
                            (
                                "workers"."id" = (
                                    SELECT "auth"."uid"() AS "uid"
                                )
                            )
                            AND ("workers"."current_job" = "jobs"."id")
                        )
                )
            )
        )
    );
COMMENT ON POLICY "Jobs can be updated" ON "public"."jobs" IS 'Allows job updates by: job creator, service role, or worker assigned to this specific job';

CREATE POLICY "Users can delete their own jobs" ON "public"."jobs" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "created_by"
    )
);

CREATE POLICY "Users can insert their own jobs" ON "public"."jobs" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "created_by"
        )
    );

CREATE POLICY "Users can view their own jobs" ON "public"."jobs" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "created_by"
        )
    );
COMMENT ON POLICY "Users can view their own jobs" ON "public"."jobs" IS 'Allows users to view their own jobs. This policy is compatible with Supabase Realtime - users will receive real-time updates for jobs they created.';
