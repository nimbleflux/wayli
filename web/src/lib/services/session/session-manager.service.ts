// web/src/lib/services/session/session-manager.service.ts
// Global session management service with Remember Me and re-authentication support
// Token refresh is handled by Fluxbase SDK's autoRefresh feature

import { fluxbase } from '$lib/fluxbase';
import { userStore, sessionStore } from '$lib/stores/auth';
import { goto } from '$app/navigation';
import { cleanup as cleanupJobStore, initializeJobStore } from '$lib/stores/job-store';
import { writable, get } from 'svelte/store';

// LocalStorage keys
const REMEMBER_ME_KEY = 'wayli.rememberMe';
const SESSION_START_KEY = 'wayli.sessionStart';
const REAUTH_TIME_KEY = 'wayli.lastReauthTime';

// Session duration for non-remembered sessions (24 hours)
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Re-authentication validity window (5 minutes)
const REAUTH_VALIDITY_MS = 5 * 60 * 1000;

// Token refresh threshold - refresh if token expires within this time (5 minutes)
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

// Periodic token check interval (2 minutes)
const TOKEN_CHECK_INTERVAL_MS = 2 * 60 * 1000;

// Store to control re-auth modal visibility
export const showReauthModal = writable(false);
export const reauthResolver = writable<((success: boolean) => void) | null>(null);

export class SessionManagerService {
	private static instance: SessionManagerService;
	private isInitialized = false;
	private authListenerSet = false;
	private periodicCheckInterval: ReturnType<typeof setInterval> | null = null;
	private boundVisibilityHandler: (() => Promise<void>) | null = null;

	private constructor() {
		// Private constructor for singleton
	}

	static getInstance(): SessionManagerService {
		if (!SessionManagerService.instance) {
			SessionManagerService.instance = new SessionManagerService();
		}
		return SessionManagerService.instance;
	}

	/**
	 * Initialize the session manager
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		// Set the initialized flag early to prevent concurrent initialization
		this.isInitialized = true;

		// Set up auth state change listener (only once)
		if (!this.authListenerSet) {
			fluxbase.auth.onAuthStateChange(async (event: string, session: any) => {
				// Debug logging for token refresh verification
				console.log('🔑 [SessionManager] Auth state change:', {
					event,
					hasSession: !!session,
					userId: session?.user?.id,
					expiresAt: session?.expires_at ? new Date(session.expires_at).toISOString() : null,
					expiresIn: session?.expires_at
						? `${Math.round((session.expires_at - Date.now()) / 1000 / 60)} minutes`
						: null
				});

				// Always update stores first (await to ensure admin token is set)
				await this.updateAuthStores(session);

				if (event === 'SIGNED_OUT' || !session) {
					// Ensure stores are cleared
					await this.updateAuthStores(null);
					this.stopBackgroundRefresh();
					cleanupJobStore();
				} else if (session?.user?.id) {
					// Initialize job store when user signs in
					initializeJobStore(session.user.id);
					// Start background refresh for new sessions
					this.startBackgroundRefresh();
				}
			});
			this.authListenerSet = true;
		} else {
			return;
		}

		// Initialize with current session - validate token with retry logic
		try {
			const { data } = await fluxbase.auth.getSession();
			if (data && data.session) {
				// Check Remember Me expiry first
				if (this.isSessionExpiredByRememberMe()) {
					console.info('ℹ️ [SessionManager] Session expired (Remember Me disabled, >24h)');
					await this.handleSessionExpiry();
					return;
				}

				// Validate token with retry logic
				const isValid = await this.validateTokenWithRetry();
				if (!isValid) {
					return; // handleSessionExpiry already called in validateTokenWithRetry
				}

				// Token is valid - update stores and initialize job store
				await this.updateAuthStores(data.session);
				if (data.session?.user?.id) {
					initializeJobStore(data.session.user.id);
				}

				// Start background refresh mechanisms
				this.startBackgroundRefresh();
			}
		} catch (error) {
			console.error('❌ [SessionManager] Error during session initialization:', error);
			// Clear invalid session state to prevent broken auth
			this.forceClearStores();
		}
	}

	/**
	 * Validate token with retry logic - tries refresh before giving up
	 */
	private async validateTokenWithRetry(): Promise<boolean> {
		// First attempt: validate with getCurrentUser() (makes server request to verify token)
		// Note: getUser() only returns cached data and doesn't validate the token
		const { error: userError } = await fluxbase.auth.getCurrentUser();

		if (!userError) {
			console.log('✅ [SessionManager] Token validation successful');
			return true; // Token is valid
		}

		console.warn(
			'⚠️ [SessionManager] Token validation failed, attempting refresh:',
			userError.message
		);

		// Second attempt: try to refresh the token
		try {
			console.log('🔄 [SessionManager] Attempting token refresh in validateTokenWithRetry...');
			const { data, error: refreshError } = await fluxbase.auth.refreshSession();
			if (refreshError) {
				console.error('❌ [SessionManager] Token refresh failed:', refreshError.message);
				await this.handleSessionExpiry();
				return false;
			}

			// Log the new token expiry
			if (data?.session?.expires_at) {
				console.log('✅ [SessionManager] Token refreshed, new expiry:', {
					expiresAt: new Date(data.session.expires_at).toISOString(),
					expiresIn: `${Math.round((data.session.expires_at - Date.now()) / 1000 / 60)} minutes`
				});
			}

			// Refresh succeeded, validate again with server request
			const { error: retryError } = await fluxbase.auth.getCurrentUser();
			if (retryError) {
				console.error('❌ [SessionManager] Token still invalid after refresh:', retryError.message);
				await this.handleSessionExpiry();
				return false;
			}

			console.info('✅ [SessionManager] Token refreshed and validated successfully');
			return true;
		} catch (error) {
			console.error('❌ [SessionManager] Error during token refresh:', error);
			await this.handleSessionExpiry();
			return false;
		}
	}

	/**
	 * Check if session has expired based on Remember Me setting
	 * Returns true if session should be expired
	 */
	private isSessionExpiredByRememberMe(): boolean {
		if (typeof window === 'undefined') return false;

		const rememberMe = localStorage.getItem(REMEMBER_ME_KEY);

		// If Remember Me is true or not set (default to remembered), use token expiry
		if (rememberMe === null || rememberMe === 'true') {
			return false;
		}

		// Remember Me is false - check if > 24 hours since login
		const sessionStart = localStorage.getItem(SESSION_START_KEY);
		if (!sessionStart) {
			return false; // No start time recorded, allow session
		}

		const elapsed = Date.now() - parseInt(sessionStart, 10);
		return elapsed > SESSION_MAX_AGE_MS;
	}

	/**
	 * Record login timestamp and Remember Me preference
	 */
	recordLogin(rememberMe: boolean): void {
		if (typeof window === 'undefined') return;

		localStorage.setItem(REMEMBER_ME_KEY, String(rememberMe));
		localStorage.setItem(SESSION_START_KEY, String(Date.now()));
	}

	/**
	 * Update auth stores with current session
	 */
	private async updateAuthStores(session: any): Promise<void> {
		sessionStore.set(session);

		if (session?.user) {
			userStore.set(session.user);

			// Set admin token if user has admin role
			await this.setAdminTokenIfNeeded(session);
		} else {
			userStore.set(null);

			// Clear admin token when session is cleared
			try {
				fluxbase.admin.clearToken();
			} catch (error) {
				// Ignore errors if clearToken doesn't exist
			}
		}
	}

	/**
	 * Set admin token for admin users
	 */
	private async setAdminTokenIfNeeded(session: any): Promise<void> {
		try {
			// Check if setToken method exists
			if (typeof fluxbase.admin?.setToken !== 'function') {
				return;
			}

			// Check if user has admin role from user_profiles
			const { data: profile, error } = await fluxbase
				.from('user_profiles')
				.select('role')
				.eq('id', session.user.id)
				.single();

			if (error) {
				return;
			}

			if (profile?.role === 'admin') {
				fluxbase.admin.setToken(session.access_token);
			}
		} catch (error) {
			console.error('❌ [SessionManager] Error setting admin token:', error);
		}
	}

	/**
	 * Force clear all auth stores (for emergency cleanup)
	 */
	public forceClearStores(): void {
		sessionStore.set(null);
		userStore.set(null);
		// Clear admin token if set
		try {
			fluxbase.admin.clearToken();
		} catch (error) {
			// Ignore errors if clearToken doesn't exist
		}
	}

	/**
	 * Handle session expiry - clear everything and redirect
	 */
	private async handleSessionExpiry(): Promise<void> {
		// Stop background refresh mechanisms
		this.stopBackgroundRefresh();

		try {
			// Clear client-side session
			await fluxbase.auth.signOut();
		} catch (error) {
			console.warn('⚠️ [SessionManager] Error during signout:', error);
		}

		// Update stores
		await this.updateAuthStores(null);

		// Clean up session-related localStorage
		this.clearSessionData();

		// Cleanup realtime job monitoring
		cleanupJobStore();

		// Redirect to login if not already on auth pages
		if (typeof window !== 'undefined') {
			const currentPath = window.location.pathname;
			if (!currentPath.startsWith('/auth') && currentPath !== '/') {
				goto('/auth/signin');
			}
		}
	}

	/**
	 * Clear session-related localStorage data
	 */
	private clearSessionData(): void {
		if (typeof window === 'undefined') return;

		// Clear wayli-specific localStorage
		localStorage.removeItem(REMEMBER_ME_KEY);
		localStorage.removeItem(SESSION_START_KEY);
		localStorage.removeItem(REAUTH_TIME_KEY);

		// Clear Fluxbase session from localStorage (failsafe if signOut fails)
		localStorage.removeItem('fluxbase.auth.session');

		// Clear job store cache (user-specific data)
		localStorage.removeItem('wayli_finished_jobs');

		// Clear sessionStorage items
		sessionStorage.removeItem('pending_verification_email');
	}

	/**
	 * Force refresh the current session
	 */
	async forceRefreshSession(): Promise<boolean> {
		try {
			console.log('🔄 [SessionManager] Attempting token refresh...');
			const { data, error } = await fluxbase.auth.refreshSession();

			if (error) {
				console.error('❌ [SessionManager] Force refresh error:', error);
				await this.handleSessionExpiry();
				return false;
			}

			if (data?.session) {
				console.log('✅ [SessionManager] Token refreshed successfully:', {
					expiresAt: data.session.expires_at
						? new Date(data.session.expires_at).toISOString()
						: null,
					expiresIn: data.session.expires_at
						? `${Math.round((data.session.expires_at - Date.now()) / 1000 / 60)} minutes`
						: null
				});
				await this.updateAuthStores(data.session);
				return true;
			}

			return false;
		} catch (error) {
			console.error('❌ [SessionManager] Force refresh error:', error);
			await this.handleSessionExpiry();
			return false;
		}
	}

	/**
	 * Check if session manager is ready and has completed initial session restoration
	 */
	isReady(): boolean {
		return this.isInitialized;
	}

	/**
	 * Extract token expiry timestamp from JWT access token
	 * Fallback for when expires_at is not set in the session
	 */
	private getTokenExpiryFromJWT(accessToken: string): number | null {
		try {
			const payload = JSON.parse(atob(accessToken.split('.')[1]));
			// JWT exp is in seconds, convert to milliseconds
			return payload.exp ? payload.exp * 1000 : null;
		} catch {
			return null;
		}
	}

	/**
	 * Check if the current token should be refreshed (expires within threshold)
	 */
	private shouldRefreshToken(): boolean {
		const session = get(sessionStore) as { expires_at?: number; access_token?: string } | null;
		if (!session) return false;

		// Use expires_at if available, otherwise extract from JWT
		let expiresAt: number | null | undefined = session.expires_at;
		if (!expiresAt && session.access_token) {
			expiresAt = this.getTokenExpiryFromJWT(session.access_token);
		}

		// If we can't determine expiry, trigger a refresh to be safe
		if (!expiresAt) return true;

		const timeUntilExpiry = expiresAt - Date.now();
		return timeUntilExpiry < TOKEN_REFRESH_THRESHOLD_MS;
	}

	/**
	 * Check token expiry and refresh if needed
	 */
	private async checkAndRefreshToken(): Promise<void> {
		// Skip if not initialized or no session
		if (!this.isInitialized) return;

		const session = get(sessionStore);
		if (!session) return;

		if (this.shouldRefreshToken()) {
			console.log('🔄 [SessionManager] Token expiring soon, proactively refreshing...');
			await this.forceRefreshSession();
		}
	}

	/**
	 * Handle visibility change - refresh token when tab becomes visible
	 */
	private handleVisibilityChange = async (): Promise<void> => {
		if (document.visibilityState === 'visible') {
			console.log('👁️ [SessionManager] Tab became visible, checking token...');
			await this.checkAndRefreshToken();
		}
	};

	/**
	 * Start background token refresh mechanisms
	 * - Visibility change handler: refreshes when tab becomes visible
	 * - Periodic check: refreshes every few minutes if token is expiring soon
	 */
	private startBackgroundRefresh(): void {
		if (typeof window === 'undefined') return;

		// Set up visibility change handler
		if (!this.boundVisibilityHandler) {
			this.boundVisibilityHandler = this.handleVisibilityChange;
			document.addEventListener('visibilitychange', this.boundVisibilityHandler);
			console.log('✅ [SessionManager] Visibility change handler registered');
		}

		// Set up periodic token check
		if (!this.periodicCheckInterval) {
			this.periodicCheckInterval = setInterval(() => {
				this.checkAndRefreshToken();
			}, TOKEN_CHECK_INTERVAL_MS);
			console.log(
				`✅ [SessionManager] Periodic token check started (every ${TOKEN_CHECK_INTERVAL_MS / 1000 / 60} minutes)`
			);
		}
	}

	/**
	 * Stop background token refresh mechanisms
	 */
	private stopBackgroundRefresh(): void {
		if (typeof window === 'undefined') return;

		// Remove visibility change handler
		if (this.boundVisibilityHandler) {
			document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
			this.boundVisibilityHandler = null;
		}

		// Clear periodic check interval
		if (this.periodicCheckInterval) {
			clearInterval(this.periodicCheckInterval);
			this.periodicCheckInterval = null;
		}
	}

	/**
	 * Check if user is currently authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		try {
			// Check Remember Me expiry first
			if (this.isSessionExpiredByRememberMe()) {
				await this.handleSessionExpiry();
				return false;
			}

			// Check Fluxbase session directly
			const { data } = await fluxbase.auth.getSession();

			if (data && data.session && data.session.user) {
				// Update stores with the found session if they're empty
				await this.updateAuthStores(data.session);
				return true;
			}

			return false;
		} catch (error) {
			console.error('❌ [SessionManager] Error in isAuthenticated:', error);
			return false;
		}
	}

	/**
	 * Get current session
	 */
	async getCurrentSession() {
		try {
			return fluxbase.auth.getSession();
		} catch {
			return null;
		}
	}

	// ==========================================
	// Re-authentication for sensitive actions
	// ==========================================

	/**
	 * Check if user has recently re-authenticated (within 5 minutes)
	 */
	isRecentlyReauthenticated(): boolean {
		if (typeof window === 'undefined') return false;

		const lastReauth = localStorage.getItem(REAUTH_TIME_KEY);
		if (!lastReauth) return false;

		const elapsed = Date.now() - parseInt(lastReauth, 10);
		return elapsed < REAUTH_VALIDITY_MS;
	}

	/**
	 * Record successful re-authentication timestamp
	 */
	recordReauth(): void {
		if (typeof window === 'undefined') return;
		localStorage.setItem(REAUTH_TIME_KEY, String(Date.now()));
	}

	/**
	 * Verify password for re-authentication
	 * Returns true if password is correct
	 */
	async verifyPassword(password: string): Promise<{ success: boolean; error?: string }> {
		try {
			// Get current user's email
			const { data: sessionData } = await fluxbase.auth.getSession();
			const email = sessionData?.session?.user?.email;

			if (!email) {
				return { success: false, error: 'No active session' };
			}

			// Attempt to sign in with the password to verify it
			// Note: This creates a new session, but we'll keep the existing one
			const { error } = await fluxbase.auth.signInWithPassword({
				email,
				password
			});

			if (error) {
				return { success: false, error: error.message };
			}

			// Password is correct, record re-auth time
			this.recordReauth();
			return { success: true };
		} catch (error) {
			console.error('❌ [SessionManager] Re-auth verification error:', error);
			return { success: false, error: 'Verification failed' };
		}
	}

	/**
	 * Require re-authentication before a sensitive action
	 * Shows the re-auth modal if needed, returns true if authenticated
	 */
	async requireReauth(): Promise<boolean> {
		// Check if recently re-authenticated
		if (this.isRecentlyReauthenticated()) {
			return true;
		}

		// Show the re-auth modal and wait for result
		return new Promise((resolve) => {
			reauthResolver.set(resolve);
			showReauthModal.set(true);
		});
	}

	/**
	 * Complete the re-auth flow (called by the modal)
	 */
	completeReauth(success: boolean): void {
		const resolver = get(reauthResolver);
		if (resolver) {
			resolver(success);
		}
		reauthResolver.set(null);
		showReauthModal.set(false);
	}

	/**
	 * Clean up session manager
	 */
	destroy(): void {
		this.stopBackgroundRefresh();
		cleanupJobStore();
		this.isInitialized = false;
	}

	/**
	 * Sign out the user completely
	 */
	async signOut(): Promise<void> {
		await this.handleSessionExpiry();
	}
}

// Export singleton instance
export const sessionManager = SessionManagerService.getInstance();
