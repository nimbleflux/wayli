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

-- Drop existing policies first to ensure idempotency
DROP POLICY IF EXISTS "User preferences can be deleted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be inserted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be updated" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be viewed" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User profiles can be deleted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be inserted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be updated" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profiles can be viewed" ON "public"."user_profiles";
DROP POLICY IF EXISTS "Users can delete their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can delete their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can delete their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can insert their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can insert their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can insert their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can update their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can update their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can update their own want to visit places" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Users can view their own tracker data" ON "public"."tracker_data";
DROP POLICY IF EXISTS "Users can view their own trips" ON "public"."trips";
DROP POLICY IF EXISTS "Users can view their own want to visit places" ON "public"."want_to_visit_places";

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
-- Workers table does NOT have RLS enabled
-- It's a system-only table that should only be accessed by service_role
-- No RLS policies needed - access is controlled by grants only
ALTER TABLE "public"."tracker_data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."want_to_visit_places" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

-- Drop existing storage policies first to ensure idempotency
DROP POLICY IF EXISTS "Public can view trip images" ON "storage"."objects";
DROP POLICY IF EXISTS "Users access own exports" ON "storage"."objects";
DROP POLICY IF EXISTS "Users access own temp files" ON "storage"."objects";
DROP POLICY IF EXISTS "Users delete own exports" ON "storage"."objects";
DROP POLICY IF EXISTS "Users delete own temp files" ON "storage"."objects";
DROP POLICY IF EXISTS "Users delete own trip images" ON "storage"."objects";
DROP POLICY IF EXISTS "Users update own exports" ON "storage"."objects";
DROP POLICY IF EXISTS "Users update own temp files" ON "storage"."objects";
DROP POLICY IF EXISTS "Users update own trip images" ON "storage"."objects";
DROP POLICY IF EXISTS "Users upload own exports" ON "storage"."objects";
DROP POLICY IF EXISTS "Users upload own temp files" ON "storage"."objects";
DROP POLICY IF EXISTS "Users upload own trip images" ON "storage"."objects";

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

-- ============================================================================
-- APP.SETTINGS ADMIN RLS POLICIES
-- ============================================================================
-- Description: Allow admin users to manage all app.settings
-- Dependencies: is_user_admin function, auth.uid function
-- Created: 2025-11-18
--

-- Drop existing admin policies if they exist to ensure idempotency
DROP POLICY IF EXISTS "Admins can read all settings" ON "app"."settings";
DROP POLICY IF EXISTS "Admins can update settings" ON "app"."settings";
DROP POLICY IF EXISTS "Admins can insert settings" ON "app"."settings";
DROP POLICY IF EXISTS "Admins can delete settings" ON "app"."settings";

-- Allow admin users to read ALL settings (public and private)
CREATE POLICY "Admins can read all settings"
ON "app"."settings"
FOR SELECT
TO "authenticated"
USING (
    "public"."is_user_admin"("auth"."uid"())
);

-- Allow admin users to update settings
CREATE POLICY "Admins can update settings"
ON "app"."settings"
FOR UPDATE
TO "authenticated"
USING (
    "public"."is_user_admin"("auth"."uid"())
)
WITH CHECK (
    "public"."is_user_admin"("auth"."uid"())
);

-- Allow admin users to insert new settings
CREATE POLICY "Admins can insert settings"
ON "app"."settings"
FOR INSERT
TO "authenticated"
WITH CHECK (
    "public"."is_user_admin"("auth"."uid"())
);

-- Allow admin users to delete settings (for cleanup/maintenance)
CREATE POLICY "Admins can delete settings"
ON "app"."settings"
FOR DELETE
TO "authenticated"
USING (
    "public"."is_user_admin"("auth"."uid"())
);

-- Grant necessary permissions to authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "app"."settings" TO "authenticated";
