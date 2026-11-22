// Unit tests for the session token-validation contract (issue #290: users
// were logged out whenever they opened the app offline).
//
// Only a definitive rejection from the auth server (401/403) may expire the
// session. Everything else — offline, timeouts, rate limits, 5xx — is
// transient: the session must be kept. validateTokenWithRetry() classifies
// into 'valid' | 'invalid' | 'unknown'; these tests pin that classification
// and the expiry side effects.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fluxbase, gotoMock } = vi.hoisted(() => ({
	fluxbase: {
		auth: {
			onAuthStateChange: vi.fn(),
			getSession: vi.fn(),
			getCurrentUser: vi.fn(),
			refreshSession: vi.fn(),
			signInWithPassword: vi.fn(),
			signOut: vi.fn()
		},
		admin: { setToken: vi.fn(), clearToken: vi.fn() },
		from: vi.fn()
	},
	gotoMock: vi.fn()
}));
vi.mock('$lib/fluxbase', () => ({ fluxbase }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

import { sessionManager } from '$lib/services/session/session-manager.service';
import { isDefinitiveAuthError } from '$lib/utils/auth-error';
import { get } from 'svelte/store';
import { sessionStore } from '$lib/stores/auth';

// validateTokenWithRetry is private; reach it through a typed accessor so the
// classification contract is testable without going through initialize().
const validateToken = () =>
	(
		sessionManager as unknown as {
			validateTokenWithRetry: () => Promise<'valid' | 'invalid' | 'unknown'>;
		}
	).validateTokenWithRetry();

const err = (status?: number, message = 'boom') =>
	status === undefined ? new Error(message) : Object.assign(new Error(message), { status });

const profileQuery = () => ({
	select: () => ({
		eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) })
	})
});

beforeEach(() => {
	for (const fn of [
		fluxbase.auth.getSession,
		fluxbase.auth.getCurrentUser,
		fluxbase.auth.refreshSession,
		fluxbase.auth.signOut,
		fluxbase.admin.setToken,
		fluxbase.admin.clearToken,
		fluxbase.from,
		gotoMock
	]) {
		fn.mockReset();
	}
	sessionStore.set(null);
});

describe('isDefinitiveAuthError', () => {
	it('treats 401 and 403 as definitive', () => {
		expect(isDefinitiveAuthError(err(401))).toBe(true);
		expect(isDefinitiveAuthError(err(403))).toBe(true);
	});

	it('treats transport failures (no status) as transient', () => {
		expect(isDefinitiveAuthError(err())).toBe(false);
		expect(isDefinitiveAuthError(new TypeError('Failed to fetch'))).toBe(false);
	});

	it('treats rate limits, server errors and junk as transient', () => {
		expect(isDefinitiveAuthError(err(429))).toBe(false);
		expect(isDefinitiveAuthError(err(500))).toBe(false);
		expect(isDefinitiveAuthError(err('401' as unknown as number))).toBe(false);
		expect(isDefinitiveAuthError(null)).toBe(false);
	});
});

describe('validateTokenWithRetry', () => {
	it("returns 'valid' when the server accepts the token", async () => {
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
		await expect(validateToken()).resolves.toBe('valid');
		expect(fluxbase.auth.refreshSession).not.toHaveBeenCalled();
	});

	it("returns 'unknown' on transport failure and keeps the session", async () => {
		sessionStore.set({ user: { id: 'u1' } } as never);
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: null, error: err() });
		await expect(validateToken()).resolves.toBe('unknown');
		expect(fluxbase.auth.refreshSession).not.toHaveBeenCalled();
		expect(fluxbase.auth.signOut).not.toHaveBeenCalled();
		expect(get(sessionStore)).toMatchObject({ user: { id: 'u1' } });
	});

	it("returns 'unknown' on rate limit / server errors", async () => {
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: null, error: err(429) });
		await expect(validateToken()).resolves.toBe('unknown');
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: null, error: err(500) });
		await expect(validateToken()).resolves.toBe('unknown');
		expect(fluxbase.auth.signOut).not.toHaveBeenCalled();
	});

	it('expires the session when refresh is definitively rejected', async () => {
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: null, error: err(401) });
		fluxbase.auth.refreshSession.mockResolvedValue({ data: null, error: err(401) });

		await expect(validateToken()).resolves.toBe('invalid');

		// handleSessionExpiry ran: local data cleared, signed out, stores emptied
		expect(fluxbase.auth.signOut).toHaveBeenCalled();
		expect(get(sessionStore)).toBeNull();
	});

	it("returns 'unknown' when refresh fails transiently", async () => {
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: null, error: err(401) });
		fluxbase.auth.refreshSession.mockResolvedValue({ data: null, error: err() });

		await expect(validateToken()).resolves.toBe('unknown');
		expect(fluxbase.auth.signOut).not.toHaveBeenCalled();
	});

	it("returns 'valid' when refresh recovers the session", async () => {
		fluxbase.auth.getCurrentUser
			.mockResolvedValueOnce({ data: null, error: err(401) })
			.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
		fluxbase.auth.refreshSession.mockResolvedValue({
			data: { session: { expires_at: Date.now() + 3600_000 } },
			error: null
		});

		await expect(validateToken()).resolves.toBe('valid');
		expect(fluxbase.auth.signOut).not.toHaveBeenCalled();
	});

	it('expires the session when the token is still rejected after refresh', async () => {
		fluxbase.auth.getCurrentUser.mockResolvedValue({ data: null, error: err(401) });
		fluxbase.auth.refreshSession.mockResolvedValue({
			data: { session: { expires_at: Date.now() + 3600_000 } },
			error: null
		});

		await expect(validateToken()).resolves.toBe('invalid');
		expect(fluxbase.auth.signOut).toHaveBeenCalled();
	});

	it("returns 'unknown' when post-refresh validation fails transiently", async () => {
		fluxbase.auth.getCurrentUser
			.mockResolvedValueOnce({ data: null, error: err(401) })
			.mockResolvedValueOnce({ data: null, error: err(503) });
		fluxbase.auth.refreshSession.mockResolvedValue({
			data: { session: { expires_at: Date.now() + 3600_000 } },
			error: null
		});

		await expect(validateToken()).resolves.toBe('unknown');
		expect(fluxbase.auth.signOut).not.toHaveBeenCalled();
	});
});

describe('forceRefreshSession', () => {
	it('updates the stores and reports success on refresh', async () => {
		fluxbase.auth.refreshSession.mockResolvedValue({
			data: { session: { user: { id: 'u1' }, access_token: 'tok' } },
			error: null
		});
		fluxbase.from.mockImplementation(() => profileQuery());

		await expect(sessionManager.forceRefreshSession()).resolves.toBe(true);
		expect(get(sessionStore)).toMatchObject({ user: { id: 'u1' } });
	});

	it('keeps the session on transient refresh failures', async () => {
		sessionStore.set({ user: { id: 'u1' } } as never);
		fluxbase.auth.refreshSession.mockResolvedValue({ data: null, error: err() });

		await expect(sessionManager.forceRefreshSession()).resolves.toBe(false);
		expect(fluxbase.auth.signOut).not.toHaveBeenCalled();
		expect(get(sessionStore)).toMatchObject({ user: { id: 'u1' } });
	});

	it('expires the session only on definitive rejection', async () => {
		fluxbase.auth.refreshSession.mockResolvedValue({ data: null, error: err(403) });

		await expect(sessionManager.forceRefreshSession()).resolves.toBe(false);
		expect(fluxbase.auth.signOut).toHaveBeenCalled();
		expect(get(sessionStore)).toBeNull();
	});
});
