import { writable } from 'svelte/store';

import { fluxbase } from '$lib/fluxbase';

import type { UserProfile } from '$lib/types/user.types';
import type { AuthSession, User } from '@nimbleflux/fluxbase-sdk';

type AuthStore = User & Partial<Pick<UserProfile, 'full_name' | 'avatar_url' | 'role'>>;

function createAuthStore() {
	const { subscribe, set } = writable<AuthStore | null>(null);

	// Defer subscription until after sessionStore is declared

	return {
		subscribe,
		set
	};
}

// Session store for tracking the current session
export const sessionStore = writable<Session | null>(null);

export const userStore = createAuthStore();

// Store to track if session store is ready
export const sessionStoreReady = writable<boolean>(false);

// Initialize session store with session manager
async function initializeSessionStore() {
	try {
		// Session manager will handle the auth state changes
		// Just mark the store as ready
		sessionStoreReady.set(true);
	} catch (error) {
		console.error('❌ [AuthStore] Failed to initialize session store:', error);
		sessionStore.set(null);
		userStore.set(null);
		sessionStoreReady.set(true);
	}
}

// Initialize immediately
initializeSessionStore();

// Store for tracking 2FA flow state
export const isInTwoFactorFlow = writable<boolean>(false);
