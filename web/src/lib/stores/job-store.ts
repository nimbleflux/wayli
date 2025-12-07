/**
 * Job Store
 *
 * Provides real-time job monitoring using Fluxbase Realtime subscriptions
 */

import { writable, get, derived } from 'svelte/store';
import { fluxbase } from '$lib/fluxbase';
import type { RealtimeChannel } from '@fluxbase/sdk';

// HMR cleanup: Remove old channel when module is hot-reloaded
if (import.meta.hot) {
	import.meta.hot.dispose(async () => {
		const channel = (globalThis as any).__jobStoreChannel as RealtimeChannel | undefined;
		if (channel) {
			try {
				await fluxbase.realtime.removeChannel(channel);
			} catch (e) {
				// Ignore HMR cleanup errors
			}
		}
		(globalThis as any).__jobStoreChannel = null;
		(globalThis as any).__jobStoreUserId = null;
	});
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobStoreJob {
	id: string;
	job_name: string; // Changed from 'type' to match SDK
	namespace?: string;
	status: JobStatus;
	progress_percent?: number; // Changed from 'progress' to match SDK
	progress_message?: string;
	estimated_completion_at?: string;
	estimated_seconds_left?: number;
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

// Use globalThis to persist across HMR reloads
let realtimeChannel: RealtimeChannel | null = (globalThis as any).__jobStoreChannel ?? null;
let currentUserId: string | null = (globalThis as any).__jobStoreUserId ?? null;

// Reconnection state
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let isReconnecting = false; // Prevent multiple simultaneous reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000; // Start with 1 second, exponential backoff

// Store for realtime connection status
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
const connectionStatusStore = writable<ConnectionStatus>('disconnected');

// Store to signal when a reconnection has occurred (one-time event)
// Components can subscribe and show a toast, then reset it
export const reconnectedStore = writable<boolean>(false);

/**
 * Get the current connection status store (reactive)
 */
export { connectionStatusStore };

/**
 * Handle new job creation
 */
function handleJobInsert(job: JobStoreJob, currentJobs: Map<string, JobStoreJob>): Map<string, JobStoreJob> {
	const newJobs = new Map(currentJobs);
	newJobs.set(job.id, job);
	return newJobs;
}

/**
 * Handle job updates (progress, status changes)
 */
function handleJobUpdate(job: JobStoreJob, currentJobs: Map<string, JobStoreJob>): Map<string, JobStoreJob> {
	const newJobs = new Map(currentJobs);
	const existing = currentJobs.get(job.id);

	const updatedJob = existing
		? {
				...existing,
				...job,
				// Preserve fields that shouldn't be overwritten if new value is undefined
				payload: job.payload ?? existing.payload,
				result: job.result ?? existing.result
			}
		: job;

	newJobs.set(job.id, updatedJob);

	// Persist finished jobs to localStorage for refresh persistence
	if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
		persistFinishedJobs(updatedJob);
	}

	return newJobs;
}

/**
 * Handle job deletion/cleanup
 */
function handleJobDelete(jobId: string, currentJobs: Map<string, JobStoreJob>): Map<string, JobStoreJob> {
	const newJobs = new Map(currentJobs);
	newJobs.delete(jobId);
	return newJobs;
}

// Persistence constants
const FINISHED_JOBS_STORAGE_KEY = 'wayli_finished_jobs';
const FINISHED_JOB_TTL_MS = 60000; // 1 minute

/**
 * Load persisted finished jobs from localStorage
 */
function loadPersistedFinishedJobs(): JobStoreJob[] {
	if (typeof window === 'undefined') return [];

	try {
		const stored = localStorage.getItem(FINISHED_JOBS_STORAGE_KEY);
		if (!stored) return [];

		const { jobs, timestamp } = JSON.parse(stored) as { jobs: JobStoreJob[]; timestamp: number };

		// Filter out expired jobs (older than 1 minute from when they were stored)
		const now = Date.now();
		const validJobs = jobs.filter((job) => {
			const finishedAt = job.completed_at || job.updated_at;
			if (!finishedAt) return false;
			const elapsed = now - new Date(finishedAt).getTime();
			return elapsed < FINISHED_JOB_TTL_MS;
		});

		// Update storage if we filtered any out
		if (validJobs.length !== jobs.length) {
			if (validJobs.length > 0) {
				localStorage.setItem(FINISHED_JOBS_STORAGE_KEY, JSON.stringify({ jobs: validJobs, timestamp: now }));
			} else {
				localStorage.removeItem(FINISHED_JOBS_STORAGE_KEY);
			}
		}

		return validJobs;
	} catch {
		return [];
	}
}

/**
 * Persist finished jobs to localStorage
 */
function persistFinishedJobs(job: JobStoreJob) {
	if (typeof window === 'undefined') return;
	if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') return;

	try {
		const stored = localStorage.getItem(FINISHED_JOBS_STORAGE_KEY);
		let jobs: JobStoreJob[] = [];

		if (stored) {
			const parsed = JSON.parse(stored) as { jobs: JobStoreJob[] };
			jobs = parsed.jobs || [];
		}

		// Add or update the job
		const existingIndex = jobs.findIndex((j) => j.id === job.id);
		if (existingIndex >= 0) {
			jobs[existingIndex] = job;
		} else {
			jobs.push(job);
		}

		// Keep only jobs from the last minute
		const now = Date.now();
		jobs = jobs.filter((j) => {
			const finishedAt = j.completed_at || j.updated_at;
			if (!finishedAt) return false;
			return now - new Date(finishedAt).getTime() < FINISHED_JOB_TTL_MS;
		});

		localStorage.setItem(FINISHED_JOBS_STORAGE_KEY, JSON.stringify({ jobs, timestamp: now }));
	} catch {
		// Ignore storage errors
	}
}

/**
 * Remove a job from persisted storage (when dismissed)
 */
function removeFromPersistedJobs(jobId: string) {
	if (typeof window === 'undefined') return;

	try {
		const stored = localStorage.getItem(FINISHED_JOBS_STORAGE_KEY);
		if (!stored) return;

		const parsed = JSON.parse(stored) as { jobs: JobStoreJob[] };
		const jobs = (parsed.jobs || []).filter((j) => j.id !== jobId);

		if (jobs.length > 0) {
			localStorage.setItem(FINISHED_JOBS_STORAGE_KEY, JSON.stringify({ jobs, timestamp: Date.now() }));
		} else {
			localStorage.removeItem(FINISHED_JOBS_STORAGE_KEY);
		}
	} catch {
		// Ignore storage errors
	}
}

/**
 * Schedule automatic cleanup of completed/failed jobs after delay
 */
function scheduleJobCleanup(jobId: string, status: string, delay = FINISHED_JOB_TTL_MS) {
	// Don't auto-cleanup cancelled jobs - user must dismiss manually
	if (status === 'cancelled') return;

	if (status === 'completed' || status === 'failed') {
		setTimeout(() => {
			jobsStore.update((currentJobs) => {
				const newJobs = new Map(currentJobs);
				newJobs.delete(jobId);
				return newJobs;
			});
			removeFromPersistedJobs(jobId);
		}, delay);
	}
}

/**
 * Extract the record from a Fluxbase realtime message
 * Handles multiple possible message formats:
 * - Raw Fluxbase format: { type: "change", payload: { type: "UPDATE", record: {...} } }
 * - Unwrapped format: { record: {...}, old_record: {...} }
 * - Supabase-style format: { new: {...}, old: {...} }
 * - Direct record: { id: "...", job_name: "...", ... }
 */
function extractRecordFromMessage(message: any): Record<string, unknown> | null {
	if (!message) return null;

	// Raw Fluxbase format: message.payload.record
	if (message.payload?.record) {
		return message.payload.record;
	}

	// Unwrapped format: message.record
	if (message.record) {
		return message.record;
	}

	// Supabase-style format: message.new
	if (message.new) {
		return message.new;
	}

	// Direct record (has id and job_name fields)
	if (message.id && message.job_name) {
		return message;
	}

	return null;
}

/**
 * Calculate ETA based on progress and elapsed time
 */
function calculateETA(percent: number, startedAt: string | undefined): number | undefined {
	if (!percent || percent <= 0 || percent >= 100 || !startedAt) return undefined;

	const startTime = new Date(startedAt).getTime();
	const elapsed = (Date.now() - startTime) / 1000; // seconds

	if (elapsed <= 0) return undefined;

	// Calculate total estimated time based on current progress
	const totalEstimated = (elapsed / percent) * 100;
	const remaining = totalEstimated - elapsed;

	// Return remaining seconds (minimum 1 second if still running)
	return Math.max(1, Math.round(remaining));
}

/**
 * Normalize job data from API/Realtime response
 * Handles `progress` as either:
 * - JSON string (from REST API): '{"message": "...", "percent": 64, "eta_seconds": 120}'
 * - Object (from Realtime): {message: "...", percent: 64, eta_seconds: 120}
 */
function normalizeJob(job: Record<string, unknown>): JobStoreJob {
	const normalized = { ...job } as JobStoreJob;

	// Handle progress field - can be string (API) or object (Realtime)
	if (job.progress) {
		let progressData: {
			message?: string;
			percent?: number;
			eta_seconds?: number;
			estimated_seconds_left?: number;
		} | null = null;

		if (typeof job.progress === 'string') {
			// REST API returns JSON string
			try {
				progressData = JSON.parse(job.progress);
			} catch {
				// If parsing fails, leave as-is
			}
		} else if (typeof job.progress === 'object') {
			// Realtime returns object directly
			progressData = job.progress as typeof progressData;
		}

		if (progressData) {
			normalized.progress_percent = progressData.percent ?? (progressData as any).progress_percent;
			normalized.progress_message = progressData.message ?? (progressData as any).progress_message;
			// Handle ETA - could be eta_seconds or estimated_seconds_left
			normalized.estimated_seconds_left =
				progressData.eta_seconds ??
				progressData.estimated_seconds_left ??
				(progressData as any).eta_seconds ??
				normalized.estimated_seconds_left;
		}
	}

	// Also check for top-level ETA fields (in case they're not in progress object)
	if (job.estimated_seconds_left !== undefined) {
		normalized.estimated_seconds_left = job.estimated_seconds_left as number;
	}
	if (job.estimated_completion_at !== undefined) {
		normalized.estimated_completion_at = job.estimated_completion_at as string;
	}

	// Calculate ETA if not provided and we have progress + started_at
	if (
		normalized.estimated_seconds_left === undefined &&
		normalized.progress_percent &&
		normalized.progress_percent > 0 &&
		normalized.progress_percent < 100 &&
		normalized.started_at
	) {
		normalized.estimated_seconds_left = calculateETA(
			normalized.progress_percent,
			normalized.started_at
		);
	}

	return normalized;
}

/**
 * Safely extract array from jobs.list() response
 * Handles cases where data might be null, undefined, or wrapped differently
 */
function toJobArray(data: unknown): JobStoreJob[] {
	if (!data) return [];

	let jobs: unknown[] = [];

	if (Array.isArray(data)) {
		jobs = data;
	} else if (typeof data === 'object' && data !== null) {
		const obj = data as Record<string, unknown>;
		// Handle { jobs: [...] } or { data: [...] } response formats
		if (Array.isArray(obj.jobs)) jobs = obj.jobs;
		else if (Array.isArray(obj.data)) jobs = obj.data;
		// jobs: null means no jobs found - not an error
		else if (obj.jobs === null || obj.data === null) return [];
	}

	if (jobs.length === 0) {
		return [];
	}

	// Normalize each job to handle progress JSON string
	return jobs.map((job) => normalizeJob(job as Record<string, unknown>));
}

/**
 * Fetch existing active and recent jobs from the database
 * Called during initialization to populate the store with:
 * - pending/running jobs
 * - recently completed/failed/cancelled jobs (within the last minute)
 * - persisted finished jobs from localStorage
 */
async function fetchActiveJobs() {
	try {
		// Load persisted finished jobs from localStorage first
		const persistedJobs = loadPersistedFinishedJobs();

		// Fetch pending, running, and recently finished jobs in parallel
		const [pendingResult, runningResult, completedResult, failedResult, cancelledResult] = await Promise.all([
			fluxbase.jobs.list({ status: 'pending' }),
			fluxbase.jobs.list({ status: 'running' }),
			fluxbase.jobs.list({ status: 'completed', limit: 10 }),
			fluxbase.jobs.list({ status: 'failed', limit: 10 }),
			fluxbase.jobs.list({ status: 'cancelled', limit: 10 })
		]);

		if (pendingResult.error) {
			console.error('[JobStore] Error fetching pending jobs:', pendingResult.error);
		}
		if (runningResult.error) {
			console.error('[JobStore] Error fetching running jobs:', runningResult.error);
		}
		if (completedResult.error) {
			console.error('[JobStore] Error fetching completed jobs:', completedResult.error);
		}
		if (failedResult.error) {
			console.error('[JobStore] Error fetching failed jobs:', failedResult.error);
		}
		if (cancelledResult.error) {
			console.error('[JobStore] Error fetching cancelled jobs:', cancelledResult.error);
		}

		// Safely extract arrays from results
		const pendingJobs = toJobArray(pendingResult.data);
		const runningJobs = toJobArray(runningResult.data);
		const completedJobs = toJobArray(completedResult.data);
		const failedJobs = toJobArray(failedResult.data);
		const cancelledJobs = toJobArray(cancelledResult.data);

		// Filter recent finished jobs (within last minute)
		const oneMinuteAgo = new Date(Date.now() - FINISHED_JOB_TTL_MS).toISOString();
		const recentCompleted = completedJobs.filter(
			(job) => job.completed_at && job.completed_at > oneMinuteAgo
		);
		const recentFailed = failedJobs.filter(
			(job) => job.completed_at && job.completed_at > oneMinuteAgo
		);
		const recentCancelled = cancelledJobs.filter(
			(job) => (job.completed_at || job.updated_at) && (job.completed_at || job.updated_at)! > oneMinuteAgo
		);

		// Merge all jobs into the store (API jobs take precedence over persisted)
		const allJobs = [
			...persistedJobs,
			...pendingJobs,
			...runningJobs,
			...recentCompleted,
			...recentFailed,
			...recentCancelled
		];

		if (allJobs.length > 0) {
			jobsStore.update((current) => {
				const newJobs = new Map(current);
				for (const job of allJobs) {
					newJobs.set(job.id, job as JobStoreJob);
				}
				return newJobs;
			});

			// Schedule cleanup for recently completed/failed jobs (not cancelled - user must dismiss)
			for (const job of [...recentCompleted, ...recentFailed]) {
				// Calculate remaining time before cleanup (1 minute total from completion)
				const completedAt = new Date(job.completed_at!).getTime();
				const elapsed = Date.now() - completedAt;
				const remainingDelay = Math.max(0, FINISHED_JOB_TTL_MS - elapsed);
				scheduleJobCleanup(job.id, job.status, remainingDelay);
			}
		}
	} catch (error) {
		console.error('[JobStore] Error fetching jobs:', error);
	}
}

/**
 * Schedule a reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
	// Don't reconnect if already connected (might be stale callback from old channel)
	const currentStatus = get(connectionStatusStore);
	if (currentStatus === 'connected') {
		return;
	}

	// Don't reconnect if already reconnecting, no user, or at max attempts
	if (isReconnecting || !currentUserId) {
		return;
	}

	if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		connectionStatusStore.set('error');
		return;
	}

	// Clear any existing reconnect timeout
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}

	// Mark as reconnecting
	isReconnecting = true;

	// Calculate delay with exponential backoff (1s, 2s, 4s, 8s, 16s)
	const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
	reconnectAttempts++;

	reconnectTimeout = setTimeout(async () => {
		if (currentUserId) {
			try {
				await initializeRealtimeSubscription(currentUserId);
			} finally {
				isReconnecting = false;
			}
		} else {
			isReconnecting = false;
		}
	}, delay);
}

/**
 * Reset reconnection state (called on successful connection or cleanup)
 */
function resetReconnectState() {
	reconnectAttempts = 0;
	isReconnecting = false;
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}
}

// Track if initialization is in progress to prevent duplicate calls
let isInitializing = false;

/**
 * Initialize Realtime subscription for job updates
 */
async function initializeRealtimeSubscription(_userId: string) {
	// Prevent duplicate initialization
	if (isInitializing) {
		return;
	}

	isInitializing = true;

	try {
		// Set status to connecting
		connectionStatusStore.set('connecting');

		// Clean up existing channel if any
		if (realtimeChannel) {
			try {
				await fluxbase.realtime.removeChannel(realtimeChannel);
			} catch (e) {
				// Ignore cleanup errors
			}
			realtimeChannel = null;
			(globalThis as any).__jobStoreChannel = null;
		}

		// Note: currentUserId is already set by initializeJobStore() before this is called

		// Fetch existing active jobs before setting up realtime
		await fetchActiveJobs();

	// Note: If jobs were loaded successfully, the API connection is working
	// Realtime subscription may or may not work depending on Fluxbase configuration

	// Subscribe to Fluxbase job updates channel
	// Use table:jobs.queue channel format as per Fluxbase documentation
	// RLS automatically filters by authenticated user - no filter needed
	const channelName = 'table:jobs.queue';

	// Handler function for processing job changes
	const handlePostgresChange = (message: any) => {
		// Handle both raw format (payload.type) and Supabase-style format (eventType)
		const eventType = message?.eventType || message?.payload?.type || message?.type;
		// Handle both raw format (payload.record) and Supabase-style format (new)
		const record = message?.new || extractRecordFromMessage(message);

		if (!record) return;

		const job = normalizeJob(record);

		if (eventType === 'INSERT') {
			jobsStore.update(current => handleJobInsert(job, current));
		} else if (eventType === 'UPDATE') {
			jobsStore.update(current => handleJobUpdate(job, current));
			scheduleJobCleanup(job.id, job.status);
		} else if (eventType === 'DELETE') {
			jobsStore.update(current => handleJobDelete(job.id, current));
		}
	};

	const channel = fluxbase.realtime
		.channel(channelName)
		.on('postgres_changes', {
			event: '*',
			schema: 'jobs',
			table: 'queue'
		}, handlePostgresChange)
		.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				// Check if this was a reconnection (reconnectAttempts > 0 means we had failed before)
				const wasReconnection = reconnectAttempts > 0;
				connectionStatusStore.set('connected');
				// Reset reconnection state on successful connection
				resetReconnectState();
				// Signal reconnection to UI components
				if (wasReconnection) {
					console.log('✅ [JobStore] Realtime reconnected successfully');
					reconnectedStore.set(true);
				}
			} else if (status === 'CHANNEL_ERROR') {
				connectionStatusStore.set('error');
				// Attempt to reconnect
				scheduleReconnect();
			} else if (status === 'TIMED_OUT') {
				connectionStatusStore.set('error');
				scheduleReconnect();
			} else if (status === 'CLOSED') {
				connectionStatusStore.set('disconnected');
				scheduleReconnect();
			}
		});

	// Store channel reference (both locally and in globalThis for HMR)
	realtimeChannel = channel;
	(globalThis as any).__jobStoreChannel = channel;

	// Timeout: If not connected after 10 seconds, trigger reconnect
	setTimeout(() => {
		const currentStatus = get(connectionStatusStore);
		if (currentStatus === 'connecting') {
			connectionStatusStore.set('disconnected');
			scheduleReconnect();
		}
	}, 10000);
	} finally {
		isInitializing = false;
	}
}

/**
 * Subscribe to job updates
 *
 * Note: The job store is initialized by the session manager when the user signs in.
 * Use initializeJobStore(userId) to start the realtime subscription.
 *
 * @param callback - Function called when jobs change
 * @returns Unsubscribe function
 */
export function subscribe(callback: (jobs: Map<string, JobStoreJob>) => void) {
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
 * Remove job from store (for manual dismissal)
 */
export function removeJobFromStore(jobId: string) {
	jobsStore.update((jobs) => {
		const newJobs = new Map(jobs);
		newJobs.delete(jobId);
		return newJobs;
	});
	// Also remove from localStorage persistence
	removeFromPersistedJobs(jobId);
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
	// Cancel any pending reconnection
	resetReconnectState();

	if (realtimeChannel) {
		await fluxbase.realtime.removeChannel(realtimeChannel);
		realtimeChannel = null;
		currentUserId = null;
		(globalThis as any).__jobStoreChannel = null;
		(globalThis as any).__jobStoreUserId = null;
	}
	connectionStatusStore.set('disconnected');
}

/**
 * Initialize the job store for a specific user
 * Called from session manager when user signs in
 */
export function initializeJobStore(userId: string) {
	if (userId && userId !== currentUserId) {
		// Set currentUserId immediately to prevent duplicate initialization
		// (initializeRealtimeSubscription is async and could be called again before it completes)
		currentUserId = userId;
		(globalThis as any).__jobStoreUserId = userId;
		initializeRealtimeSubscription(userId);
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
