// Worker-specific Realtime service for job notifications
// This service listens for new jobs and notifies workers when work becomes available

import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@fluxbase/sdk';
import { fluxbase } from '../fluxbase';

export interface JobNotification {
	id: string;
	type: string;
	status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
	priority: string;
	created_at: string;
}

export interface WorkerRealtimeOptions {
	workerId: string;
	onConnected?: () => void;
	onDisconnected?: () => void;
	onError?: (error: string) => void;
	onJobAvailable?: (job: JobNotification) => void;
}

export class WorkerRealtimeService {
	private channel: RealtimeChannel | null = null;
	private options: WorkerRealtimeOptions;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private isConnecting = false;
	private connectionStartTime: number | null = null;
	private pendingChannelError: { error: any; time: number } | null = null;

	constructor(options: WorkerRealtimeOptions) {
		this.options = options;
	}

	async connect(): Promise<void> {
		if (this.isConnecting) {
			console.log(`🔗 Worker ${this.options.workerId}: Already connecting, skipping...`);
			return;
		}

		this.isConnecting = true;
		this.connectionStartTime = Date.now();

		try {
			// Disconnect existing channel if any
			if (this.channel) {
				await this.disconnect();
			}

			// Log connection details for debugging
			console.log(`🔗 Worker ${this.options.workerId}: Connecting to jobs channel`);

			// Create channel name for job notifications
			const channelName = `worker-jobs:${this.options.workerId}`;
			console.log(`🔗 Worker ${this.options.workerId}: Channel name:`, channelName);

			// Subscribe to INSERT events for queued jobs
			// This notifies workers when new work becomes available
			this.channel = fluxbase
				.channel(channelName)
				.on(
					'postgres_changes',
					{
						event: 'INSERT',
						schema: 'public',
						table: 'jobs',
						filter: 'status=eq.queued'
					},
					(payload: RealtimePostgresChangesPayload<JobNotification>) => {
						this.handleJobInsert(payload);
					}
				)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'jobs',
						filter: 'status=eq.queued'
					},
					(payload: RealtimePostgresChangesPayload<JobNotification>) => {
						// Handle jobs that were requeued (e.g., after retry)
						this.handleJobRequeued(payload);
					}
				)
				.subscribe((status, err) => {
					const connectionTime = this.connectionStartTime
						? Date.now() - this.connectionStartTime
						: 0;

					console.log(`🔔 Worker ${this.options.workerId}: Subscription status: ${status}`);
					if (err) {
						console.error(`   Error object:`, JSON.stringify(err, null, 2));
						console.error(`   Error type:`, typeof err);
						console.error(`   Error keys:`, Object.keys(err || {}));
					}

					if (status === 'SUBSCRIBED') {
						console.log(
							`✅ Worker ${this.options.workerId}: Successfully subscribed to jobs channel (${connectionTime}ms)`
						);
						this.reconnectAttempts = 0;
						this.isConnecting = false;
						this.connectionStartTime = null;
						// Clear any pending error since we successfully connected
						this.pendingChannelError = null;
						this.options.onConnected?.();
					} else if (status === 'CHANNEL_ERROR') {
						const errorMsg = err?.message || String(err);

						console.error(`❌ Worker ${this.options.workerId}: Channel error:`, err);
						console.error(`   Error message:`, errorMsg);
						console.error(`   Connection time: ${connectionTime}ms`);

						// Only handle critical errors immediately
						if (errorMsg.includes('too_many') || errorMsg.includes('403') || errorMsg.includes('401')) {
							console.error(`❌ Worker ${this.options.workerId}: Critical channel error:`, err);
							console.error(`   Connection attempt failed after ${connectionTime}ms`);
							this.isConnecting = false;
							this.connectionStartTime = null;
							this.handleError(`Channel subscription error: ${errorMsg}`);
						} else {
							// For non-critical errors, store them and wait to see if connection recovers
							// If no pending error yet, store this one with a timestamp
							if (!this.pendingChannelError) {
								this.pendingChannelError = { error: err, time: Date.now() };
							}
							// Don't log anything yet - wait to see if SUBSCRIBED or TIMED_OUT follows
						}
					} else if (status === 'TIMED_OUT') {
						console.error(`❌ Worker ${this.options.workerId}: Connection timed out`);
						console.error(`   Timeout occurred after ${connectionTime}ms`);

						// If there was a pending channel error, show it now since connection failed
						if (this.pendingChannelError) {
							console.error(`   Prior channel error:`, this.pendingChannelError.error);
							this.pendingChannelError = null;
						}

						this.isConnecting = false;
						this.connectionStartTime = null;
						this.handleError('Connection timed out');
						this.attemptReconnect();
					} else if (status === 'CLOSED') {
						console.log(
							`🔌 Worker ${this.options.workerId}: Channel closed (was open for ${connectionTime}ms)`
						);
						this.isConnecting = false;
						this.connectionStartTime = null;
						this.pendingChannelError = null;
						this.options.onDisconnected?.();
					}
				});
		} catch (error) {
			console.error(`❌ Worker ${this.options.workerId}: Error connecting:`, error);
			this.isConnecting = false;
			this.handleError(error instanceof Error ? error.message : 'Unknown error');
			this.attemptReconnect();
		}
	}

	private handleJobInsert(payload: RealtimePostgresChangesPayload<JobNotification>): void {
		const newJob = payload.new as JobNotification;

		if (newJob && newJob.status === 'queued') {
			console.log(
				`📨 Worker ${this.options.workerId}: New job available: ${newJob.id} (${newJob.type})`
			);
			this.options.onJobAvailable?.(newJob);
		}
	}

	private handleJobRequeued(payload: RealtimePostgresChangesPayload<JobNotification>): void {
		const newJob = payload.new as JobNotification;
		const oldJob = payload.old as Partial<JobNotification> | undefined;

		// Only notify if this is a transition TO queued status (e.g., retry)
		if (
			newJob &&
			newJob.status === 'queued' &&
			oldJob &&
			oldJob.status !== 'queued'
		) {
			console.log(
				`📨 Worker ${this.options.workerId}: Job requeued: ${newJob.id} (${newJob.type})`
			);
			this.options.onJobAvailable?.(newJob);
		}
	}

	private handleError(error: string): void {
		console.error(`❌ Worker ${this.options.workerId}: Error:`, error);
		this.options.onError?.(error);
	}

	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(
				`❌ Worker ${this.options.workerId}: Max reconnection attempts (${this.maxReconnectAttempts}) reached`
			);
			this.handleError('Max reconnection attempts reached. Worker will continue with degraded service.');
			return;
		}

		this.reconnectAttempts++;
		const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

		console.log(
			`🔄 Worker ${this.options.workerId}: Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
		);

		this.reconnectTimeout = setTimeout(() => {
			this.connect();
		}, delay);
	}

	async disconnect(): Promise<void> {
		console.log(`🔌 Worker ${this.options.workerId}: Disconnecting...`);

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.channel) {
			try {
				// Remove the entire channel to clean up the subscription
				// Note: The Fluxbase SDK may log "subscription_id is required for unsubscribe" error
				// during shutdown. This is a known SDK issue and is non-critical - the channel
				// cleanup completes successfully and the connection is closed.
				await fluxbase.removeChannel(this.channel);
			} catch (error) {
				// Suppress cleanup errors during shutdown - they're non-critical
				console.log(`🔕 Worker ${this.options.workerId}: Channel cleanup (${error instanceof Error ? error.message : 'cleanup error'})`);
			}
			this.channel = null;
		}

		this.isConnecting = false;
		this.reconnectAttempts = 0;
		this.pendingChannelError = null;
	}

	isConnected(): boolean {
		return this.channel !== null && !this.isConnecting;
	}
}
