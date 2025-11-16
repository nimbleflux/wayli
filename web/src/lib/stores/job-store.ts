// web/src/lib/stores/job-store.ts
import { JobRealtimeService, type JobUpdate } from '$lib/services/job-realtime.service';

// Simple variable for active jobs
let _activeJobs = new Map<string, JobUpdate>();

// Callback system to notify subscribers of changes
let _subscribers: Array<() => void> = [];

// Realtime service singleton
let _realtimeUnsubscribe: (() => void) | null = null;

function notifySubscribers() {
	_subscribers.forEach((callback) => callback());
}

export function subscribe(callback: () => void) {
	_subscribers.push(callback);
	return () => {
		_subscribers = _subscribers.filter((cb) => cb !== callback);
	};
}

// Getter function to access the current state
export function getActiveJobsMap(): Map<string, JobUpdate> {
	return _activeJobs;
}

// Helper functions to manage the store
export function addJobToStore(job: JobUpdate) {
	try {
		const newJobs = new Map(_activeJobs);
		newJobs.set(job.id, job);
		_activeJobs = newJobs;
		notifySubscribers();
	} catch (error) {
		console.error('❌ Store: Error in addJobToStore:', error);
	}
}

export function updateJobInStore(job: JobUpdate) {
	try {
		const newJobs = new Map(_activeJobs);
		newJobs.set(job.id, job);
		_activeJobs = newJobs;
		notifySubscribers();
	} catch (error) {
		console.error('❌ Store: Error in updateJobInStore:', error);
	}
}

export function removeJobFromStore(jobId: string) {
	try {
		const newJobs = new Map(_activeJobs);
		newJobs.delete(jobId);
		_activeJobs = newJobs;
		notifySubscribers();
	} catch (error) {
		console.error('❌ Store: Error in removeJobFromStore:', error);
	}
}

export function getJobFromStore(jobId: string): JobUpdate | undefined {
	return _activeJobs.get(jobId);
}

export function clearCompletedJobs() {
	try {
		const newJobs = new Map();
		const now = Date.now();

		for (const [jobId, job] of _activeJobs.entries()) {
			// Keep jobs that are still active or recently completed (within 30 seconds)
			if (
				job.status === 'queued' ||
				job.status === 'running' ||
				now - new Date(job.updated_at).getTime() < 30000
			) {
				newJobs.set(jobId, job);
			}
		}

		_activeJobs = newJobs;
		notifySubscribers();
	} catch (error) {
		console.error('❌ Store: Error in clearCompletedJobs:', error);
	}
}

// Fetch and populate jobs from the server
export async function fetchAndPopulateJobs() {
	try {
		const { fluxbase } = await import('$lib/fluxbase');
		const {
			data: { session }
		} = await fluxbase.auth.getSession();

		if (!session) {
			return;
		}

		// Get all active jobs (queued and running)
		const { data: activeJobs, error: activeError } = await fluxbase
			.from('jobs')
			.select('*')
			.eq('created_by', session.user.id)
			.in('status', ['queued', 'running'])
			.order('created_at', { ascending: false });

		if (activeError) {
			console.error('❌ Store: Error fetching active jobs:', activeError);
			return;
		}

		// Get recently completed jobs (within last 5 minutes)
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		const { data: recentCompletedJobs, error: completedError } = await fluxbase
			.from('jobs')
			.select('*')
			.eq('created_by', session.user.id)
			.in('status', ['completed', 'failed', 'cancelled'])
			.gte('updated_at', fiveMinutesAgo)
			.order('created_at', { ascending: false });

		if (completedError) {
			console.error('❌ Store: Error fetching completed jobs:', completedError);
			return;
		}

		// Combine all jobs
		const allJobs = [...(activeJobs || []), ...(recentCompletedJobs || [])];

		// Clear current store and populate with fetched jobs
		const newJobs = new Map();
		for (const job of allJobs) {
			// Convert to JobUpdate format
			const jobUpdate: JobUpdate = {
				id: job.id,
				type: job.type,
				status: job.status,
				progress: job.progress || 0,
				created_at: job.created_at,
				updated_at: job.updated_at,
				result: job.result,
				error: job.error
			};
			newJobs.set(job.id, jobUpdate);
		}

		_activeJobs = newJobs;
		notifySubscribers();
	} catch (error) {
		console.error('❌ Store: Error in fetchAndPopulateJobs:', error);
	}
}

/**
 * Start realtime job monitoring (singleton connection)
 * This should be called once when the user logs in
 */
export async function startJobRealtime() {
	if (_realtimeUnsubscribe) {
		console.log('🔗 Store: Realtime already started');
		return;
	}

	console.log('🔗 Store: Starting realtime job monitoring');

	// Fetch initial state before subscribing to realtime
	await fetchAndPopulateJobs();

	// Subscribe to realtime updates
	const service = JobRealtimeService.getInstance();
	_realtimeUnsubscribe = service.subscribe({
		onConnected: () => {
			console.log('✅ Store: Realtime connected');
		},
		onDisconnected: () => {
			console.log('🔌 Store: Realtime disconnected');
		},
		onError: (error) => {
			console.error('❌ Store: Realtime error:', error);
		},
		onJobUpdate: (job) => {
			// Automatically update store with all job updates
			updateJobInStore(job);
		},
		onJobCompleted: (job) => {
			// Update store with completed job
			updateJobInStore(job);

			// Auto-remove completed jobs after 30 seconds
			setTimeout(() => {
				if (_activeJobs.get(job.id)?.status === job.status) {
					removeJobFromStore(job.id);
				}
			}, 30000);
		}
	});
}

/**
 * Stop realtime job monitoring
 * This should be called when the user logs out
 */
export function stopJobRealtime() {
	if (_realtimeUnsubscribe) {
		console.log('🔌 Store: Stopping realtime job monitoring');
		_realtimeUnsubscribe();
		_realtimeUnsubscribe = null;
	}
}

/**
 * Get realtime connection status
 */
export function getRealtimeStatus(): 'connecting' | 'connected' | 'disconnected' | 'error' {
	return JobRealtimeService.getInstance().getConnectionStatus();
}
