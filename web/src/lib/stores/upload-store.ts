/**
 * Upload Progress Store
 *
 * Tracks file upload progress before jobs are created
 */

import { writable, derived } from 'svelte/store';

export interface UploadProgress {
	id: string;
	fileName: string;
	loaded: number;
	total: number;
	percentage: number;
	status: 'uploading' | 'processing' | 'completed' | 'failed';
	error?: string;
}

// Store for active uploads
const uploadsStore = writable<Map<string, UploadProgress>>(new Map());

/**
 * Start tracking an upload
 */
export function startUpload(id: string, fileName: string, total: number): void {
	uploadsStore.update((uploads) => {
		const newUploads = new Map(uploads);
		newUploads.set(id, {
			id,
			fileName,
			loaded: 0,
			total,
			percentage: 0,
			status: 'uploading'
		});
		return newUploads;
	});
}

/**
 * Update upload progress
 */
export function updateUploadProgress(id: string, loaded: number, total: number, percentage: number): void {
	uploadsStore.update((uploads) => {
		const upload = uploads.get(id);
		if (upload) {
			const newUploads = new Map(uploads);
			newUploads.set(id, {
				...upload,
				loaded,
				total,
				percentage,
				status: 'uploading'
			});
			return newUploads;
		}
		return uploads;
	});
}

/**
 * Mark upload as processing (creating job)
 */
export function markUploadProcessing(id: string): void {
	uploadsStore.update((uploads) => {
		const upload = uploads.get(id);
		if (upload) {
			const newUploads = new Map(uploads);
			newUploads.set(id, {
				...upload,
				percentage: 100,
				status: 'processing'
			});
			return newUploads;
		}
		return uploads;
	});
}

/**
 * Mark upload as completed and remove after delay
 */
export function completeUpload(id: string, delay = 1000): void {
	uploadsStore.update((uploads) => {
		const upload = uploads.get(id);
		if (upload) {
			const newUploads = new Map(uploads);
			newUploads.set(id, {
				...upload,
				status: 'completed'
			});
			return newUploads;
		}
		return uploads;
	});

	// Remove after delay
	setTimeout(() => {
		uploadsStore.update((uploads) => {
			const newUploads = new Map(uploads);
			newUploads.delete(id);
			return newUploads;
		});
	}, delay);
}

/**
 * Mark upload as failed
 */
export function failUpload(id: string, error: string): void {
	uploadsStore.update((uploads) => {
		const upload = uploads.get(id);
		if (upload) {
			const newUploads = new Map(uploads);
			newUploads.set(id, {
				...upload,
				status: 'failed',
				error
			});
			return newUploads;
		}
		return uploads;
	});

	// Remove after 5 seconds
	setTimeout(() => {
		uploadsStore.update((uploads) => {
			const newUploads = new Map(uploads);
			newUploads.delete(id);
			return newUploads;
		});
	}, 5000);
}

/**
 * Remove an upload from tracking
 */
export function removeUpload(id: string): void {
	uploadsStore.update((uploads) => {
		const newUploads = new Map(uploads);
		newUploads.delete(id);
		return newUploads;
	});
}

/**
 * Get all active uploads as an array
 */
export const activeUploads = derived(uploadsStore, ($uploads) => Array.from($uploads.values()));

/**
 * Subscribe to uploads store
 */
export function subscribe(callback: (uploads: Map<string, UploadProgress>) => void) {
	return uploadsStore.subscribe(callback);
}
