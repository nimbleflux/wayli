--
-- Migration: 006_rls_policies.up.sql
-- Description: Enable Row-Level Security and create all RLS policies
-- Dependencies: 003_tables_views.up.sql, 002_functions.up.sql
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

-- ============================================================================
-- AUTH SCHEMA AND FUNCTIONS
-- ============================================================================

-- Create auth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS auth;

-- Create auth.uid() function to return the current authenticated user ID
-- This function reads from the session variable set by Fluxbase RLS middleware
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$;

COMMENT ON FUNCTION auth.uid() IS 'Returns the user ID of the currently authenticated user from JWT claims';

-- Create auth.role() function to return the current role
-- This function reads from the session variable set by Fluxbase RLS middleware
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '')::text;
$$;

COMMENT ON FUNCTION auth.role() IS 'Returns the role of the currently authenticated user from JWT claims';

-- Grant execute permission to authenticated and anon roles
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- ============================================================================
-- ROW-LEVEL SECURITY POLICIES
-- ============================================================================

-- Note: server_settings RLS policies removed - use Fluxbase AppSettingsManager instead
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
CREATE POLICY "Service role can manage migrations" ON "public"."database_migrations" USING (
    (
        (
            SELECT "auth"."role"() AS "role"
        ) = 'service_role'::"text"
    )
);
CREATE POLICY "User preferences can be deleted" ON "public"."user_preferences" FOR DELETE USING (
    (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "id"
        )
        OR (
            (
                SELECT "auth"."role"() AS "role"
            ) = 'service_role'::"text"
        )
    )
);
CREATE POLICY "User preferences can be inserted" ON "public"."user_preferences" FOR
INSERT WITH CHECK (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "User preferences can be updated" ON "public"."user_preferences" FOR
UPDATE USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "User preferences can be viewed" ON "public"."user_preferences" FOR
SELECT USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "User profiles can be deleted" ON "public"."user_profiles" FOR DELETE USING (
    (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "id"
        )
        OR (
            (
                SELECT "auth"."role"() AS "role"
            ) = 'service_role'::"text"
        )
    )
);
CREATE POLICY "User profiles can be inserted" ON "public"."user_profiles" FOR
INSERT WITH CHECK (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "User profiles can be updated" ON "public"."user_profiles" FOR
UPDATE USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "User profiles can be viewed" ON "public"."user_profiles" FOR
SELECT USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "Users can delete their own jobs" ON "public"."jobs" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "created_by"
    )
);
CREATE POLICY "Users can delete their own tracker data" ON "public"."tracker_data" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "user_id"
    )
);
CREATE POLICY "Users can delete their own trips" ON "public"."trips" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "user_id"
    )
);
CREATE POLICY "Users can delete their own want to visit places" ON "public"."want_to_visit_places" FOR DELETE USING (
    (
        (
            SELECT "auth"."uid"() AS "uid"
        ) = "user_id"
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
CREATE POLICY "Users can insert their own tracker data" ON "public"."tracker_data" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can insert their own trips" ON "public"."trips" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can insert their own want to visit places" ON "public"."want_to_visit_places" FOR
INSERT WITH CHECK (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can update their own tracker data" ON "public"."tracker_data" FOR
UPDATE USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can update their own trips" ON "public"."trips" FOR
UPDATE USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can update their own want to visit places" ON "public"."want_to_visit_places" FOR
UPDATE USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
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
CREATE POLICY "Users can view their own tracker data" ON "public"."tracker_data" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can view their own trips" ON "public"."trips" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Users can view their own want to visit places" ON "public"."want_to_visit_places" FOR
SELECT USING (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
    );
CREATE POLICY "Workers can be deleted" ON "public"."workers" FOR DELETE USING (
    (
        (
            (
                SELECT "auth"."uid"() AS "uid"
            ) = "user_id"
        )
        OR (
            (
                SELECT "auth"."role"() AS "role"
            ) = 'service_role'::"text"
        )
    )
);
CREATE POLICY "Workers can be inserted" ON "public"."workers" FOR
INSERT WITH CHECK (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "user_id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "Workers can be updated" ON "public"."workers" FOR
UPDATE USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "user_id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
CREATE POLICY "Workers can be viewed" ON "public"."workers" FOR
SELECT USING (
        (
            (
                (
                    SELECT "auth"."uid"() AS "uid"
                ) = "user_id"
            )
            OR (
                (
                    SELECT "auth"."role"() AS "role"
                ) = 'service_role'::"text"
            )
        )
    );
ALTER TABLE "public"."database_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tracker_data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."want_to_visit_places" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workers" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

CREATE POLICY "Public can view trip images" ON "storage"."objects" FOR
SELECT USING (("bucket_id" = 'trip-images'::"text"));

CREATE POLICY "Users access own exports" ON "storage"."objects" FOR
SELECT USING (
        (
            ("bucket_id" = 'exports'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users access own temp files" ON "storage"."objects" FOR
SELECT USING (
        (
            ("bucket_id" = 'temp-files'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users delete own exports" ON "storage"."objects" FOR DELETE USING (
    (
        ("bucket_id" = 'exports'::"text")
        AND (
            ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
        )
    )
);

CREATE POLICY "Users delete own temp files" ON "storage"."objects" FOR DELETE USING (
    (
        ("bucket_id" = 'temp-files'::"text")
        AND (
            ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
        )
    )
);

CREATE POLICY "Users delete own trip images" ON "storage"."objects" FOR DELETE USING (
    (
        ("bucket_id" = 'trip-images'::"text")
        AND (
            ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
        )
    )
);

CREATE POLICY "Users update own exports" ON "storage"."objects" FOR
UPDATE USING (
        (
            ("bucket_id" = 'exports'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users update own temp files" ON "storage"."objects" FOR
UPDATE USING (
        (
            ("bucket_id" = 'temp-files'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users update own trip images" ON "storage"."objects" FOR
UPDATE USING (
        (
            ("bucket_id" = 'trip-images'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users upload own exports" ON "storage"."objects" FOR
INSERT WITH CHECK (
        (
            ("bucket_id" = 'exports'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users upload own temp files" ON "storage"."objects" FOR
INSERT WITH CHECK (
        (
            ("bucket_id" = 'temp-files'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );

CREATE POLICY "Users upload own trip images" ON "storage"."objects" FOR
INSERT WITH CHECK (
        (
            ("bucket_id" = 'trip-images'::"text")
            AND (
                ("auth"."uid"())::"text" = ("storage"."foldername"("name")) [1]
            )
        )
    );
