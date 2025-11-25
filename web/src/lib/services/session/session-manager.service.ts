// web/src/lib/services/session/session-manager.service.ts
// Global session management service with automatic token refresh and auth state sync

import { fluxbase } from '$lib/fluxbase';
import { userStore, sessionStore } from '$lib/stores/auth';
import { goto } from '$app/navigation';
import { startJobRealtime, stopJobRealtime } from '$lib/stores/job-store';

export class SessionManagerService {
	private static instance: SessionManagerService;
	private refreshInterval: ReturnType<typeof setInterval> | null = null;
	private lastActivityTime: number = Date.now();
	private readonly REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes - check frequently to catch expiring tokens
	private readonly ACTIVITY_TIMEOUT_MS = 3.5 * 60 * 60 * 1000; // 3.5 hours (less than server timeout)
	private isInitialized = false;
	private authListenerSet = false;
	private activityHandler: (() => void) | null = null;
	private activityTrackingSet = false;

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
				// Always update stores first (await to ensure admin token is set)
				await this.updateAuthStores(session);

				if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
					this.startSessionManagement();
				} else if (event === 'SIGNED_OUT' || !session) {
					// Ensure stores are cleared
					await this.updateAuthStores(null);
					this.stopSessionManagement();
				} else if (event === 'TOKEN_REFRESHED' && session) {
					this.updateLastActivity();
				}
			});
			this.authListenerSet = true;
		} else {
			return;
		}

		// Initialize with current session - let auth state change events handle session management
		try {
			const { data } = await fluxbase.auth.getSession();
			if (data && data.session) {
				// Don't manually start session management - auth state change events will handle it
				// But do update the stores with the found session
				await this.updateAuthStores(data.session);
			}
		} catch (error) {
			console.error('❌ [SessionManager] Error during session initialization:', error);
			// Don't clear stores on error - let auth state change events handle it
		}

		// Set up activity tracking
		this.setupActivityTracking();
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
	 * Start automatic session management
	 */
	private startSessionManagement(): void {
		// Only start if not already running
		if (this.refreshInterval) {
			this.updateLastActivity();
			return;
		}

		this.updateLastActivity();

		// Set up automatic token refresh
		this.refreshInterval = setInterval(async () => {
			await this.checkAndRefreshSession();
		}, this.REFRESH_INTERVAL_MS);

		// Start realtime job monitoring
		startJobRealtime();
	}

	/**
	 * Stop session management
	 */
	private stopSessionManagement(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}

		// Stop realtime job monitoring
		stopJobRealtime();
	}

	/**
	 * Check session validity and refresh if needed
	 */
	private async checkAndRefreshSession(): Promise<void> {
		try {
			// Check for inactivity timeout
			const timeSinceLastActivity = Date.now() - this.lastActivityTime;
			if (timeSinceLastActivity > this.ACTIVITY_TIMEOUT_MS) {
				await this.handleSessionExpiry();
				return;
			}

			// Get current session
			const { data } = await fluxbase.auth.getSession();

			if (!data || !data.session) {
				await this.handleSessionExpiry();
				return;
			}

			const session = data.session;

			// Check if token is close to expiry (refresh 5 minutes before expiry)
			const expiresAt = session.expires_at;
			const now = Math.floor(Date.now() / 1000);
			const timeUntilExpiry = expiresAt ? expiresAt - now : 0;

			if (timeUntilExpiry < 300) {
				// 5 minutes
				try {
					const { data, error } = await fluxbase.auth.refreshSession();
					if (error) {
						console.error('❌ [SessionManager] Failed to refresh token:', error);
						await this.handleSessionExpiry();
					} else if (data?.session) {
						await this.updateAuthStores(data.session);
					}
				} catch (refreshError) {
					console.error('❌ [SessionManager] Failed to refresh token:', refreshError);
					await this.handleSessionExpiry();
				}
			}
		} catch (error) {
			console.error('❌ [SessionManager] Error in session check:', error);
		}
	}

	/**
	 * Handle session expiry
	 */
	private async handleSessionExpiry(): Promise<void> {
		try {
			// Clear client-side session
			await fluxbase.auth.signOut();
		} catch (error) {
			console.warn('⚠️ [SessionManager] Error during signout:', error);
		}

		// Update stores
		await this.updateAuthStores(null);

		// Stop session management
		this.stopSessionManagement();

		// Redirect to login if not already on auth pages
		if (typeof window !== 'undefined') {
			const currentPath = window.location.pathname;
			if (!currentPath.startsWith('/auth') && currentPath !== '/') {
				goto('/auth/signin');
			}
		}
	}

	/**
	 * Set up activity tracking
	 */
	private setupActivityTracking(): void {
		if (typeof window === 'undefined') return;
		if (this.activityTrackingSet) return; // Prevent duplicate listeners

		this.activityHandler = () => {
			this.updateLastActivity();
		};

		const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

		activityEvents.forEach((event) => {
			document.addEventListener(event, this.activityHandler!, { passive: true });
		});

		// Also track focus events
		window.addEventListener('focus', this.activityHandler);
		this.activityTrackingSet = true;
	}

	/**
	 * Remove activity tracking listeners
	 */
	private removeActivityTracking(): void {
		if (typeof window === 'undefined') return;
		if (!this.activityHandler || !this.activityTrackingSet) return;

		const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

		activityEvents.forEach((event) => {
			document.removeEventListener(event, this.activityHandler!);
		});

		window.removeEventListener('focus', this.activityHandler);
		this.activityHandler = null;
		this.activityTrackingSet = false;
	}

	/**
	 * Update last activity timestamp
	 */
	private updateLastActivity(): void {
		this.lastActivityTime = Date.now();
	}

	/**
	 * Force refresh the current session
	 */
	async forceRefreshSession(): Promise<boolean> {
		try {
			const { data, error } = await fluxbase.auth.refreshSession();

			if (error) {
				console.error('❌ [SessionManager] Force refresh error:', error);
				await this.handleSessionExpiry();
				return false;
			}

			if (data?.session) {
				await this.updateAuthStores(data.session);
				this.updateLastActivity();
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
	 * Check if user is currently authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		try {
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

	/**
	 * Clean up session manager
	 */
	destroy(): void {
		this.stopSessionManagement();
		this.removeActivityTracking();
		this.isInitialized = false;
	}
}

// Export singleton instance
export const sessionManager = SessionManagerService.getInstance();
