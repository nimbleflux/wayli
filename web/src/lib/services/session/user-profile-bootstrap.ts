/**
 * Ensures a `user_profiles` row exists for the authenticated user.
 *
 * Background: Wayli used to rely on a Postgres trigger (`on_auth_user_created`
 * on `auth.users`) to insert a profile on signup. That trigger could not
 * survive the migration to Fluxbase's declarative schema — Fluxbase owns and
 * re-applies the `auth` schema on every restart, wiping any trigger Wayli
 * attaches to `auth.users`. The trigger was dropped (see commit history) with
 * no replacement, so every signup since has silently lacked a profile row —
 * breaking the admin check and storage RLS for new users.
 *
 * This is the app-side replacement: call `ensureUserProfile()` from every auth
 * entry point (signup, OAuth callback, email-verification completion). It's
 * idempotent and restart-safe (application code, not DB state Fluxbase can
 * wipe).
 *
 * Security: the first-user→admin decision is made entirely server-side by the
 * `ensure_user_profile` RPC (SECURITY DEFINER `request_user_profile` in
 * fluxbase/schema/public.sql — advisory-locked, identity from the JWT). The
 * client neither sends the user id nor a role; earlier versions counted rows
 * client-side, which under owner-only RLS always saw zero rows and made every
 * signup an admin.
 */

import { fluxbase } from '$lib/fluxbase';

export interface EnsureProfileInput {
	/** The authenticated user's id (auth.users.id). Client-side only — never sent to the server. */
	userId: string;
	/** Optional metadata, typically from auth user_metadata at signup. */
	first_name?: string;
	last_name?: string;
	full_name?: string;
}

/**
 * Create the caller's `user_profiles` row if it doesn't already exist, via the
 * `ensure_user_profile` RPC. Returns the profile row (id, role,
 * onboarding_completed, first_login_at, …) or null on failure. Safe to call
 * repeatedly.
 */
export async function ensureUserProfile(
	input: EnsureProfileInput
): Promise<Record<string, any> | null> {
	const { userId, first_name = '', last_name = '', full_name } = input;
	const resolvedFull = full_name || `${first_name} ${last_name}`.trim() || '';

	try {
		const { data, error } = await fluxbase.rpc('ensure_user_profile', {
			first_name,
			last_name,
			full_name: resolvedFull
		});

		if (error) {
			console.error('[ensureUserProfile] rpc failed:', error);
			return null;
		}

		// The RPC returns a single jsonb object (some client versions wrap
		// scalar/single-row results in an array — normalize both).
		const profile = (Array.isArray(data) ? data[0] : data) as Record<string, any> | null;
		if (!profile) return null;
		return profile.id ? profile : { ...profile, id: userId };
	} catch (err) {
		console.error('[ensureUserProfile] unexpected error:', err);
		return null;
	}
}
