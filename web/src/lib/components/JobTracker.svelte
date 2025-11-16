<!-- web/src/lib/components/JobTracker.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { JobRealtimeService, type JobUpdate } from '$lib/services/job-realtime.service';
	import { getActiveJobsMap, getRealtimeStatus } from '$lib/stores/job-store';

	// Helper function to get job type info for notifications
	function getJobTypeInfo(type: string) {
		switch (type) {
			case 'data_import':
				return { title: 'Data Import' };
			case 'data_export':
				return { title: 'Data Export' };
			case 'reverse_geocoding_missing':
				return { title: 'Reverse Geocoding' };
			case 'trip_generation':
				return { title: 'Trip Generation' };
			default:
				return { title: 'Background Job' };
		}
	}

	let {
		jobType = null,
		autoStart = true,
		showToasts = true,
		onJobUpdate = null as ((jobs: JobUpdate[]) => void) | null,
		onJobCompleted = null as ((jobs: JobUpdate[]) => void) | null
	} = $props();

	let unsubscribe: (() => void) | null = null;
	let completedJobIds = $state(new Set<string>()); // Track completed jobs to prevent duplicate toasts
	let connectionStatus = $state<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

	// Expose methods for parent components
	export async function startMonitoring() {
		console.log('🔗 JobTracker: Starting monitoring...');

		// Unsubscribe from any existing subscription
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}

		// Subscribe to singleton realtime service
		// The global store already handles connection and updates
		// We just need to add our component-specific callbacks
		const service = JobRealtimeService.getInstance();
		unsubscribe = service.subscribe({
			onConnectionStatusChange: (status) => {
				connectionStatus = status;
				console.log('🔗 JobTracker: Connection status changed to:', status);
			},
			onJobUpdate: (job: JobUpdate) => {
				// Filter by job type if specified
				if (jobType && job.type !== jobType) {
					return;
				}
				handleJobUpdate(job);
			},
			onJobCompleted: (job: JobUpdate) => {
				// Filter by job type if specified
				if (jobType && job.type !== jobType) {
					return;
				}
				handleJobCompleted(job);
			}
		});

		// Update initial connection status
		connectionStatus = getRealtimeStatus();
	}

	// Helper functions for handling job updates
	function handleJobUpdate(job: JobUpdate) {
		// Note: Global store subscription already updates the store
		// We only handle component-specific logic here

		// Show toast notifications for status changes
		const previousJob = getActiveJobsMap().get(job.id);
		if (previousJob && previousJob.status !== job.status) {
			if (showToasts) {
				const jobTypeInfo = getJobTypeInfo(job.type);
				if (job.status === 'completed') {
					toast.success(`${jobTypeInfo.title} completed successfully!`);
				} else if (job.status === 'failed') {
					toast.error(`${jobTypeInfo.title} failed`);
				} else if (job.status === 'cancelled') {
					toast.info(`${jobTypeInfo.title} was cancelled`);
				}
			}
		}

		// Notify parent component
		if (onJobUpdate) {
			try {
				onJobUpdate([job]);
			} catch (error) {
				console.error('❌ JobTracker: Error calling onJobUpdate callback:', error);
			}
		}
	}

	function handleJobCompleted(job: JobUpdate) {
		// Mark as completed in our tracking
		completedJobIds.add(job.id);

		// Note: Global store subscription already handles updates and removal

		// Notify parent component
		onJobCompleted?.([job]);
	}

	export async function stopMonitoring() {
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
	}

	export function getActiveJobs(): JobUpdate[] {
		return Array.from(getActiveJobsMap().values());
	}

	export function getJobUpdate(jobId: string): JobUpdate | undefined {
		return getActiveJobsMap().get(jobId);
	}

	export function getLatestJobUpdate(jobId: string): JobUpdate | undefined {
		return getActiveJobsMap().get(jobId);
	}

	export function isJobActive(jobId: string): boolean {
		return getActiveJobsMap().has(jobId);
	}

	export function addJob(job: JobUpdate): void {
		// Note: Global store subscription automatically handles all job updates
		// This function is kept for API compatibility but doesn't need to do anything
		if (jobType && job.type !== jobType) {
			return; // Skip if we're filtering by job type
		}
	}

	export function updateParentState(jobs: JobUpdate[]): void {
		if (onJobUpdate) {
			onJobUpdate(jobs);
		}
	}

	export function getConnectionStatus(): string {
		return connectionStatus;
	}

	export function isConnected(): boolean {
		return connectionStatus === 'connected';
	}

	// Auto-start monitoring if enabled
	onMount(() => {
		if (autoStart) {
			startMonitoring();
		}
	});

	onDestroy(() => {
		stopMonitoring();
		// Clear completed job tracking
		completedJobIds.clear();
	});
</script>

<!-- This component doesn't render anything visible, it just provides job tracking functionality -->
