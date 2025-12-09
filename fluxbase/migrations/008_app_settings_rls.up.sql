--
-- Migration: 008_app_settings_rls.up.sql
-- Description: Configure RLS for app.settings to allow anonymous access to public settings
-- Dependencies: Fluxbase app.settings table
-- Author: Wayli Migration System
-- Created: 2025-11-15
--

-- Insert is_setup_complete setting with default value
-- This setting tracks whether the initial setup (first user creation) has been completed
INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.is_setup_complete',
    '{"value": false}'::jsonb,
    true,
    'Indicates whether the initial setup (first user creation) has been completed'
) ON CONFLICT ("key") DO UPDATE SET
    -- Only update the structure if the current value is a plain boolean
    -- This preserves the true/false value while fixing the data structure
    "value" = CASE
        WHEN jsonb_typeof("app"."settings"."value") = 'boolean'
        THEN jsonb_build_object('value', "app"."settings"."value")
        ELSE "app"."settings"."value"
    END,
    "is_public" = EXCLUDED."is_public",
    "description" = EXCLUDED."description",
    "updated_at" = NOW();

-- Insert other public settings that anonymous users should be able to read
INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.server_name',
    '{"value": "Wayli"}'::jsonb,
    true,
    'Server name displayed to users'
) ON CONFLICT ("key") DO UPDATE SET
    -- Only update the structure if the current value is a plain boolean or string
    -- This preserves custom server names while fixing the data structure
    "value" = CASE
        WHEN jsonb_typeof("app"."settings"."value") IN ('boolean', 'string', 'number')
        THEN jsonb_build_object('value', "app"."settings"."value")
        ELSE "app"."settings"."value"
    END,
    "is_public" = EXCLUDED."is_public",
    "description" = EXCLUDED."description",
    "updated_at" = NOW();

-- Insert server-level Pexels API key (private, admin-only)
INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.server_pexels_api_key',
    '{"value": ""}'::jsonb,
    false,
    'Server-level Pexels API key for trip images (fallback when user has no personal key)'
) ON CONFLICT ("key") DO NOTHING;

-- Insert password requirement settings (public for signup page validation)
INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.password_min_length',
    '{"value": 8}'::jsonb,
    true,
    'Minimum password length for user registration'
) ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.password_require_uppercase',
    '{"value": true}'::jsonb,
    true,
    'Require at least one uppercase letter in password'
) ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.password_require_lowercase',
    '{"value": true}'::jsonb,
    true,
    'Require at least one lowercase letter in password'
) ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.password_require_number',
    '{"value": true}'::jsonb,
    true,
    'Require at least one number in password'
) ON CONFLICT ("key") DO NOTHING;

INSERT INTO "app"."settings" ("key", "value", "is_public", "description")
VALUES (
    'wayli.password_require_special',
    '{"value": true}'::jsonb,
    true,
    'Require at least one special character in password'
) ON CONFLICT ("key") DO NOTHING;

-- Create function to mark setup as complete
CREATE OR REPLACE FUNCTION "public"."mark_setup_complete"()
RETURNS TRIGGER
SECURITY DEFINER
SET "search_path" TO 'public', 'app'
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only update if this is the first user profile
    IF (SELECT COUNT(*) FROM "public"."user_profiles") = 1 THEN
        UPDATE "app"."settings"
        SET "value" = '{"value": true}'::jsonb,
            "updated_at" = NOW()
        WHERE "key" = 'wayli.is_setup_complete';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."mark_setup_complete"() IS 'Trigger function to set is_setup_complete when first user is created';

-- Create trigger on user_profiles table
DROP TRIGGER IF EXISTS "trigger_mark_setup_complete" ON "public"."user_profiles";
CREATE TRIGGER "trigger_mark_setup_complete"
    AFTER INSERT ON "public"."user_profiles"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."mark_setup_complete"();

COMMENT ON TRIGGER "trigger_mark_setup_complete" ON "public"."user_profiles" IS 'Marks setup as complete when first user profile is created';

-- Add RLS policies to allow users to read public settings
-- Note: Assuming app.settings already has RLS enabled by Fluxbase

-- Drop policies if they exist to ensure idempotency
DROP POLICY IF EXISTS "Anonymous users can read public Wayli settings" ON "app"."settings";
DROP POLICY IF EXISTS "Authenticated users can read public settings" ON "app"."settings";

-- Allow anonymous users to read specific public Wayli settings
CREATE POLICY "Anonymous users can read public Wayli settings"
ON "app"."settings"
FOR SELECT
TO "anon"
USING (
    "is_public" = true
    AND "key" IN (
        'wayli.is_setup_complete',
        'wayli.server_name',
        'wayli.password_min_length',
        'wayli.password_require_uppercase',
        'wayli.password_require_lowercase',
        'wayli.password_require_number',
        'wayli.password_require_special'
    )
);

-- Allow authenticated users to read all public settings
CREATE POLICY "Authenticated users can read public settings"
ON "app"."settings"
FOR SELECT
TO "authenticated"
USING ("is_public" = true);

-- Allow admins to read ALL settings (including private ones)
CREATE POLICY "Admins can read all settings"
ON "app"."settings"
FOR SELECT
TO "authenticated"
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    )
);

-- Allow admins to insert new settings
CREATE POLICY "Admins can insert settings"
ON "app"."settings"
FOR INSERT
TO "authenticated"
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    )
);

-- Allow admins to update settings
CREATE POLICY "Admins can update settings"
ON "app"."settings"
FOR UPDATE
TO "authenticated"
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    )
);

-- Allow admins to delete settings
CREATE POLICY "Admins can delete settings"
ON "app"."settings"
FOR DELETE
TO "authenticated"
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    )
);

-- Grant necessary permissions
GRANT SELECT ON TABLE "app"."settings" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "app"."settings" TO "authenticated";
GRANT ALL ON TABLE "app"."settings" TO "service_role";
