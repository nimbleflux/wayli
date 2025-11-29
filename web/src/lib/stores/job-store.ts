/**
 * Job Store
 *
 * Provides real-time job monitoring using Fluxbase Realtime subscriptions
 */

import { writable, get, derived } from 'svelte/store';
import { fluxbase } from '$lib/fluxbase';
import type { RealtimeChannel } from '@fluxbase/sdk';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobStoreJob {
	id: string;
	job_name: string; // Changed from 'type' to match SDK
	namespace?: string;
	status: JobStatus;
	progress_percent?: number; // Changed from 'progress' to match SDK
	progress_message?: string;
	payload?: unknown;
	result?: unknown;
	error?: string;
	created_at: string;
	updated_at?: string;
	started_at?: string;
	completed_at?: string;
	created_by: string;
}

// Store for active jobs
const jobsStore = writable<Map<string, JobStoreJob>>(new Map());
let realtimeChannel: RealtimeChannel | null = null;
let currentUserId: string | null = null;

/**
 * Handle new job creation
 */
function handleJobInsert(job: JobStoreJob, currentJobs: Map<string, JobStoreJob>): Map<string, JobStoreJob> {
	console.log('[JobStore] New job created:', job.id, job.job_name);
	const newJobs = new Map(currentJobs);
	newJobs.set(job.id, job);
	return newJobs;
}

/**
 * Handle job updates (progress, status changes)
 */
function handleJobUpdate(job: JobStoreJob, currentJobs: Map<string, JobStoreJob>): Map<string, JobStoreJob> {
	console.log('[JobStore] Job updated:', job.id, `${job.progress_percent || 0}%`, job.status);

	const newJobs = new Map(currentJobs);
	const existing = currentJobs.get(job.id);

	if (existing) {
		// Merge updates while preserving data
		newJobs.set(job.id, {
			...existing,
			...job,
			// Preserve fields that shouldn't be overwritten if new value is undefined
			payload: job.payload ?? existing.payload,
			result: job.result ?? existing.result
		});
	} else {
		// Job not in store yet, add it
		newJobs.set(job.id, job);
	}

	return newJobs;
}

/**
 * Handle job deletion/cleanup
 */
function handleJobDelete(jobId: string, currentJobs: Map<string, JobStoreJob>): Map<string, JobStoreJob> {
	console.log('[JobStore] Job removed:', jobId);
	const newJobs = new Map(currentJobs);
	newJobs.delete(jobId);
	return newJobs;
}

/**
 * Schedule automatic cleanup of completed/failed jobs after delay
 */
function scheduleJobCleanup(jobId: string, status: string, delay = 30000) {
	if (status === 'completed' || status === 'failed' || status === 'cancelled') {
		setTimeout(() => {
			jobsStore.update((currentJobs) => {
				const newJobs = new Map(currentJobs);
				newJobs.delete(jobId);
				return newJobs;
			});
		}, delay);
	}
}

/**
 * Initialize Realtime subscription for job updates
 */
async function initializeRealtimeSubscription(userId: string) {
	// Clean up existing channel if any
	if (realtimeChannel) {
		await fluxbase.removeChannel(realtimeChannel);
		realtimeChannel = null;
	}

	currentUserId = userId;

	// Subscribe to Fluxbase's job queue table via realtime
	realtimeChannel = fluxbase
		.channel(`jobs-user-${userId}`)
		.on('postgres_changes', {
			event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
			schema: 'jobs',
			table: 'queue',
			filter: `created_by=eq.${userId}` // Only get jobs created by this user
		}, (payload: any) => {
			const eventType = payload.eventType;

			switch (eventType) {
				case 'INSERT': {
					const newJob = payload.new as JobStoreJob;
					jobsStore.update(current => handleJobInsert(newJob, current));
					break;
				}

				case 'UPDATE': {
					const updatedJob = payload.new as JobStoreJob;
					jobsStore.update(current => handleJobUpdate(updatedJob, current));

					// Auto-cleanup completed/failed/cancelled jobs after 5 seconds
					scheduleJobCleanup(updatedJob.id, updatedJob.status);
					break;
				}

				case 'DELETE': {
					const deletedJob = payload.old as JobStoreJob;
					jobsStore.update(current => handleJobDelete(deletedJob.id, current));
					break;
				}

				default:
					console.warn('[JobStore] Unknown event type:', eventType);
			}
		})
		.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				console.log('[JobStore] Realtime subscription active for user:', userId);
			} else if (status === 'CHANNEL_ERROR') {
				console.error('[JobStore] Realtime subscription error');
			} else if (status === 'TIMED_OUT') {
				console.error('[JobStore] Realtime subscription timed out');
			}
		});
}

/**
 * Subscribe to job updates
 *
 * @param callback - Function called when jobs change
 * @returns Unsubscribe function
 */
export function subscribe(callback: (jobs: Map<string, JobStoreJob>) => void) {
	// Get current user to initialize subscription
	const user = fluxbase.auth.getUser();

	if (user?.id && user.id !== currentUserId) {
		// User changed or first subscription, initialize realtime
		initializeRealtimeSubscription(user.id);
	}

	return jobsStore.subscribe(callback);
}

/**
 * Get active jobs map
 */
export function getActiveJobsMap(): Map<string, JobStoreJob> {
	return get(jobsStore);
}

/**
 * Add job to store manually (for optimistic updates)
 */
export function addJobToStore(job: JobStoreJob) {
	jobsStore.update((jobs) => {
		const newJobs = new Map(jobs);
		newJobs.set(job.id, job);
		return newJobs;
	});
}

/**
 * Subscribe to Fluxbase Realtime connection status
 */
export function subscribeToConnectionStatus(
	callback: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void
) {
	// Subscribe to Fluxbase Realtime connection status
	const subscription = fluxbase.realtime.onConnectionStateChange((state) => {
		callback(state as any);
	});

	// Return unsubscribe function
	return () => {
		if (subscription) {
			subscription.unsubscribe();
		}
	};
}

/**
 * Cleanup function to unsubscribe from Realtime
 */
export async function cleanup() {
	if (realtimeChannel) {
		await fluxbase.removeChannel(realtimeChannel);
		realtimeChannel = null;
		currentUserId = null;
	}
}

// ============================================================================
// Derived Stores - Pre-filtered by Job Type
// ============================================================================

/**
 * Export jobs (data-export)
 */
export const exportJobs = derived(jobsStore, ($jobs) =>
	Array.from($jobs.values()).filter((j) => j.job_name === 'data-export')
);

/**
 * Trip-related jobs (trip-generation, trip-detection)
 */
export const tripJobs = derived(jobsStore, ($jobs) =>
	Array.from($jobs.values()).filter(
		(j) => j.job_name === 'trip-generation' || j.job_name === 'trip-detection'
	)
);

/**
 * Import jobs (data-import-geojson, data-import-gpx, data-import-owntracks)
 */
export const importJobs = derived(jobsStore, ($jobs) =>
	Array.from($jobs.values()).filter((j) => j.job_name.startsWith('data-import'))
);

/**
 * Geocoding jobs (reverse-geocoding)
 */
export const geocodingJobs = derived(jobsStore, ($jobs) =>
	Array.from($jobs.values()).filter((j) => j.job_name === 'reverse-geocoding')
);

/**
 * Distance calculation jobs
 */
export const distanceJobs = derived(jobsStore, ($jobs) =>
	Array.from($jobs.values()).filter((j) => j.job_name === 'distance-calculation')
);

/**
 * All active jobs as an array (convenience store)
 */
export const allJobs = derived(jobsStore, ($jobs) => Array.from($jobs.values()));

/**
 * Helper to create a custom derived store for any job type
 * @param jobName - The job_name to filter by
 */
export function jobsByType(jobName: string) {
	return derived(jobsStore, ($jobs) =>
		Array.from($jobs.values()).filter((j) => j.job_name === jobName)
	);
}
