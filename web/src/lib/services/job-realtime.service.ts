// web/src/lib/services/job-realtime.service.ts
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@fluxbase/sdk';
import { fluxbase } from '$lib/fluxbase';

export interface JobUpdate {
	id: string;
	type: string;
	status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
	progress: number;
	created_at: string;
	updated_at: string;
	result?: unknown;
	error?: string;
}

export interface JobRealtimeOptions {
	onConnected?: () => void;
	onDisconnected?: () => void;
	onError?: (error: string) => void;
	onJobUpdate?: (job: JobUpdate) => void;
	onJobCompleted?: (job: JobUpdate) => void;
	onConnectionStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

interface Subscriber {
	id: string;
	callbacks: JobRealtimeOptions;
}

export class JobRealtimeService {
	private static instance: JobRealtimeService | null = null;

	private channel: RealtimeChannel | null = null;
	private subscribers = new Map<string, Subscriber>();
	private userId: string | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10; // Increased from 5 for better resilience
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private isConnecting = false;
	private authUnsubscribe: (() => void) | null = null;
	private connectionStartTime: number | null = null;
	private connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error' = 'disconnected';

	private constructor() {
		// Listen for auth changes to update Realtime token
		// This ensures the WebSocket stays authenticated when tokens refresh
		this.authUnsubscribe = fluxbase.auth.onAuthStateChange((_event, session) => {
			if (session?.access_token) {
				console.log('🔐 JobRealtime: Auth state changed, refreshing Realtime token');
				fluxbase.realtime.setAuth(session.access_token);
			}
		}).data.subscription.unsubscribe;
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): JobRealtimeService {
		if (!JobRealtimeService.instance) {
			JobRealtimeService.instance = new JobRealtimeService();
		}
		return JobRealtimeService.instance;
	}

	/**
	 * Subscribe to job updates with callbacks
	 * Returns an unsubscribe function
	 */
	subscribe(callbacks: JobRealtimeOptions): () => void {
		const id = Math.random().toString(36).substring(7);

		this.subscribers.set(id, { id, callbacks });
		console.log(`📝 JobRealtime: Subscriber ${id} added (${this.subscribers.size} total)`);

		// Auto-connect if not already connected or connecting
		if (!this.isConnected() && !this.isConnecting) {
			this.connect();
		}

		// Notify subscriber of current connection status
		if (callbacks.onConnectionStatusChange) {
			callbacks.onConnectionStatusChange(this.connectionStatus);
		}

		// Return unsubscribe function
		return () => {
			this.subscribers.delete(id);
			console.log(`📝 JobRealtime: Subscriber ${id} removed (${this.subscribers.size} remaining)`);

			// Disconnect if no more subscribers
			if (this.subscribers.size === 0) {
				console.log('📝 JobRealtime: No more subscribers, will remain connected for session');
				// Don't auto-disconnect - keep connection alive for session
			}
		};
	}

	/**
	 * Get current connection status
	 */
	getConnectionStatus(): 'connecting' | 'connected' | 'disconnected' | 'error' {
		return this.connectionStatus;
	}

	/**
	 * Set connection status and notify all subscribers
	 */
	private setConnectionStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error'): void {
		this.connectionStatus = status;
		this.subscribers.forEach(({ callbacks }) => {
			callbacks.onConnectionStatusChange?.(status);
		});
	}

	/**
	 * Notify all subscribers of a connection event
	 */
	private notifyConnected(): void {
		this.subscribers.forEach(({ callbacks }) => {
			callbacks.onConnected?.();
		});
	}

	/**
	 * Notify all subscribers of a disconnection event
	 */
	private notifyDisconnected(): void {
		this.subscribers.forEach(({ callbacks }) => {
			callbacks.onDisconnected?.();
		});
	}

	/**
	 * Notify all subscribers of an error
	 */
	private notifyError(error: string): void {
		this.subscribers.forEach(({ callbacks }) => {
			callbacks.onError?.(error);
		});
	}

	/**
	 * Notify all subscribers of a job update
	 */
	private notifyJobUpdate(job: JobUpdate): void {
		this.subscribers.forEach(({ callbacks }) => {
			callbacks.onJobUpdate?.(job);
		});
	}

	/**
	 * Notify all subscribers of a job completion
	 */
	private notifyJobCompleted(job: JobUpdate): void {
		this.subscribers.forEach(({ callbacks }) => {
			callbacks.onJobCompleted?.(job);
		});
	}

	async connect(): Promise<void> {
		if (this.isConnecting) {
			console.log('🔗 JobRealtime: Already connecting, skipping...');
			return;
		}

		this.isConnecting = true;
		this.connectionStartTime = Date.now();
		this.setConnectionStatus('connecting');

		try {
			// Get current user
			const {
				data: { session }
			} = await fluxbase.auth.getSession();

			if (!session?.user) {
				console.error('🔗 JobRealtime: No authenticated user');
				this.isConnecting = false;
				this.setConnectionStatus('error');
				return;
			}

			this.userId = session.user.id;

			// Set auth token for Realtime WebSocket connection
			// This is CRITICAL for RLS policies to work with postgres_changes
			// Without this, Realtime only uses the anon key and can't see user-specific events
			console.log('🔐 JobRealtime: Setting auth token for Realtime connection');
			fluxbase.realtime.setAuth(session.access_token);

			// Disconnect existing channel if any
			if (this.channel) {
				await this.disconnect();
			}

			// Log WebSocket URL for debugging (helpful for self-hosted instances)
			console.log('🔗 JobRealtime: Connecting to jobs channel for user:', this.userId);

			// Create channel name for this user's jobs
			const channelName = `jobs:${this.userId}`;
			console.log('🔗 JobRealtime: Channel name:', channelName);
			console.log('🔗 JobRealtime: Subscribing with filter: created_by=eq.' + this.userId);

			// Subscribe to jobs table changes for this user
			this.channel = fluxbase
				.channel(channelName)
				.on(
					'postgres_changes',
					{
						event: '*', // Listen to INSERT, UPDATE, DELETE
						schema: 'public',
						table: 'jobs',
						filter: `created_by=eq.${this.userId}`
					},
					(payload: RealtimePostgresChangesPayload<JobUpdate>) => {
						this.handleDatabaseChange(payload);
					}
				)
				.subscribe((status, err) => {
					const connectionTime = this.connectionStartTime
						? Date.now() - this.connectionStartTime
						: 0;

					if (status === 'SUBSCRIBED') {
						console.log(
							`✅ JobRealtime: Successfully subscribed to jobs channel (${connectionTime}ms)`
						);
						this.reconnectAttempts = 0; // Reset on successful connection
						this.isConnecting = false;
						this.connectionStartTime = null;
						this.setConnectionStatus('connected');
						this.notifyConnected();
					} else if (status === 'CHANNEL_ERROR') {
						console.error('❌ JobRealtime: Channel error:', err);
						console.error(`   Connection attempt failed after ${connectionTime}ms`);
						this.isConnecting = false;
						this.connectionStartTime = null;
						this.setConnectionStatus('error');

						// Check if it's a quota-related error
						const errorMsg = err?.message || String(err);
						if (errorMsg.includes('too_many')) {
							this.notifyError(`Quota exceeded: ${errorMsg}`);
						} else {
							this.notifyError('Channel subscription error');
						}
					} else if (status === 'TIMED_OUT') {
						console.error('❌ JobRealtime: Connection timed out');
						console.error(`   Timeout occurred after ${connectionTime}ms`);
						console.error(
							'   Check: 1) Network connectivity 2) Nginx ingress timeouts 3) Firewall rules'
						);
						this.isConnecting = false;
						this.connectionStartTime = null;
						this.setConnectionStatus('error');
						this.notifyError('Connection timed out');
						this.attemptReconnect();
					} else if (status === 'CLOSED') {
						console.log(`🔌 JobRealtime: Channel closed (was open for ${connectionTime}ms)`);
						this.isConnecting = false;
						this.connectionStartTime = null;
						this.setConnectionStatus('disconnected');
						this.notifyDisconnected();
					}
				});
		} catch (error) {
			console.error('❌ JobRealtime: Error connecting:', error);
			this.isConnecting = false;
			this.setConnectionStatus('error');
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			this.notifyError(errorMsg);
			this.attemptReconnect();
		}
	}

	private handleDatabaseChange(payload: RealtimePostgresChangesPayload<JobUpdate>): void {
		const { eventType, new: newRecord, old: oldRecord } = payload;

		// console.log('📨 JobRealtime: Database change received:', {
		// 	event: eventType,
		// 	jobId: (newRecord as JobUpdate)?.id || (oldRecord as Partial<JobUpdate>)?.id,
		// 	jobType: (newRecord as JobUpdate)?.type || (oldRecord as Partial<JobUpdate>)?.type,
		// 	status: (newRecord as JobUpdate)?.status,
		// 	progress: (newRecord as JobUpdate)?.progress,
		// 	oldStatus: (oldRecord as Partial<JobUpdate>)?.status,
		// 	oldProgress: (oldRecord as Partial<JobUpdate>)?.progress
		// });

		if (eventType === 'INSERT' || eventType === 'UPDATE') {
			const job = newRecord as JobUpdate;

			// Notify about the update
			this.notifyJobUpdate(job);

			// Check if job completed
			if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
				// Check if this is a status transition (not just an update to completed job)
				const oldJobRecord = oldRecord as Partial<JobUpdate>;
				const wasActive =
					oldJobRecord && (oldJobRecord.status === 'queued' || oldJobRecord.status === 'running');

				if (wasActive || eventType === 'INSERT') {
					this.notifyJobCompleted(job);
				}
			}
		} else if (eventType === 'DELETE' && oldRecord) {
			// Handle job deletion if needed
			const deletedJob = oldRecord as Partial<JobUpdate>;
			console.log('🗑️ JobRealtime: Job deleted:', deletedJob.id);
		}
	}

	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(
				`❌ JobRealtime: Max reconnection attempts (${this.maxReconnectAttempts}) reached`
			);
			this.notifyError('Max reconnection attempts reached. Please refresh the page.');
			return;
		}

		this.reconnectAttempts++;
		// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
		// This is more network-friendly than linear backoff
		const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

		console.log(
			`🔄 JobRealtime: Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
		);

		this.reconnectTimeout = setTimeout(() => {
			this.connect();
		}, delay);
	}

	async disconnect(): Promise<void> {
		console.log('🔌 JobRealtime: Disconnecting...');

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.channel) {
			// Now that Fluxbase rc.33 supports unsubscribe, use it for proper cleanup
			await this.channel.unsubscribe();
			this.channel = null;
		}

		// Cleanup auth state listener
		if (this.authUnsubscribe) {
			this.authUnsubscribe();
			this.authUnsubscribe = null;
		}

		this.isConnecting = false;
		this.reconnectAttempts = 0;
		this.setConnectionStatus('disconnected');
	}

	isConnected(): boolean {
		return this.channel !== null && !this.isConnecting;
	}
}
