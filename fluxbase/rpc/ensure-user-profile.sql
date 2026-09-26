-- @fluxbase:description Create the caller's user_profiles row if missing (app-side bootstrap, replacing the auth.users trigger Fluxbase wipes on restart). The first-user→admin decision is made SERVER-SIDE inside request_user_profile (SECURITY DEFINER, advisory-locked): clients can never send an id or role, so only the very first signup on a fresh instance becomes admin. Idempotent; returns the profile row as JSON.
-- @fluxbase:require-role authenticated
-- @fluxbase:input { "first_name": "text", "last_name": "text", "full_name": "text" }
-- @fluxbase:allowed-tables user_profiles
-- @fluxbase:max-execution-time 10s

SELECT public.request_user_profile(
    COALESCE($first_name::text, ''),
    COALESCE($last_name::text, ''),
    COALESCE($full_name::text, '')
) AS profile;
