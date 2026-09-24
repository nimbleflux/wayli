// Unit tests for ensureUserProfile() — the app-side replacement for the
// auth.users trigger that Fluxbase wipes on restart.
//
// The role decision lives SERVER-SIDE now (RPC `ensure_user_profile` →
// SECURITY DEFINER `request_user_profile`): the client must never decide or
// send a role, and must never send the user id (identity comes from the JWT).
// These tests pin that contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = { id: 'user-123', first_name: 'Ada', last_name: 'Lovelace' };

const { fluxbase } = vi.hoisted(() => ({ fluxbase: { rpc: vi.fn(), from: vi.fn(), auth: {} as any } }));
vi.mock('$lib/fluxbase', () => ({ fluxbase }));

import { ensureUserProfile } from '$lib/services/session/user-profile-bootstrap';

describe('ensureUserProfile', () => {
	beforeEach(() => {
		fluxbase.rpc.mockReset();
		fluxbase.from.mockReset();
	});

	it('creates a profile via the ensure_user_profile RPC (signup)', async () => {
		fluxbase.rpc.mockResolvedValue({
			data: { id: mockUser.id, role: 'user', onboarding_completed: false },
			error: null
		});

		const result = await ensureUserProfile({
			userId: mockUser.id,
			first_name: mockUser.first_name,
			last_name: mockUser.last_name
		});

		expect(fluxbase.rpc).toHaveBeenCalledWith(
			'ensure_user_profile',
			expect.objectContaining({ p_first_name: 'Ada', p_last_name: 'Lovelace', p_full_name: 'Ada Lovelace' })
		);
		expect(result).toMatchObject({ id: mockUser.id, role: 'user', onboarding_completed: false });
	});

	it('never sends the user id or a role to the server', async () => {
		fluxbase.rpc.mockResolvedValue({ data: { id: mockUser.id, role: 'user' }, error: null });

		await ensureUserProfile({ userId: mockUser.id, first_name: 'Ada', last_name: 'Lovelace' });

		const [, args] = fluxbase.rpc.mock.calls[0];
		expect(args).not.toHaveProperty('userId');
		expect(args).not.toHaveProperty('p_id');
		expect(args).not.toHaveProperty('p_role');
		expect(JSON.stringify(args)).not.toContain(mockUser.id);
	});

	it('normalizes array-wrapped RPC payloads', async () => {
		fluxbase.rpc.mockResolvedValue({
			data: [{ id: mockUser.id, role: 'user', first_login_at: null }],
			error: null
		});

		const result = await ensureUserProfile({ userId: mockUser.id });

		expect(result).toMatchObject({ id: mockUser.id, role: 'user', first_login_at: null });
	});

	it('returns the existing profile untouched when the RPC reports one', async () => {
		const existing = { id: mockUser.id, role: 'user', onboarding_completed: true, first_login_at: '2026-01-01' };
		fluxbase.rpc.mockResolvedValue({ data: existing, error: null });

		const result = await ensureUserProfile({ userId: mockUser.id });

		expect(result).toEqual(existing);
		expect(fluxbase.from).not.toHaveBeenCalled();
	});

	it('returns null on an RPC error', async () => {
		fluxbase.rpc.mockResolvedValue({ data: null, error: { message: 'function not found (PGRST 404)' } });

		const result = await ensureUserProfile({ userId: mockUser.id });

		expect(result).toBeNull();
	});

	it('returns null when the RPC throws', async () => {
		fluxbase.rpc.mockRejectedValue(new TypeError('network down'));

		const result = await ensureUserProfile({ userId: mockUser.id });

		expect(result).toBeNull();
	});
});
