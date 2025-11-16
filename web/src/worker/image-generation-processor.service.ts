import { createWorkerClient } from './client';

import { getTripBannerImage } from '../lib/services/external/pexels.service';

import type { ImageGenerationJob } from '../lib/types/trip-generation.types';

export class ImageGenerationProcessorService {
	private fluxbase = createWorkerClient();
	private static readonly RATE_LIMIT_DELAY = 1000; // 1 second between requests

	/**
	 * Process pending image generation jobs with rate limiting
	 */
	async processPendingJobs(): Promise<void> {
		try {
			// Get pending jobs ordered by priority and creation time
			const { data: pendingJobs, error } = await this.fluxbase
				.from('image_generation_jobs')
				.select('*')
				.eq('status', 'queued')
				.order('priority', { ascending: false })
				.order('created_at', { ascending: true })
				.limit(10); // Process in batches

			if (error) {
				console.error('❌ Error fetching pending image generation jobs:', error);
				return;
			}

			if (!pendingJobs || pendingJobs.length === 0) {
				console.log('📷 No pending image generation jobs found');
				return;
			}

			console.log(`🖼️ Processing ${pendingJobs.length} image generation jobs`);

			// Process jobs sequentially with rate limiting
			for (const job of pendingJobs) {
				await this.processJob(job);

				// Rate limiting delay
				await this.delay(ImageGenerationProcessorService.RATE_LIMIT_DELAY);
			}
		} catch (error) {
			console.error('❌ Error processing image generation jobs:', error);
		}
	}

	/**
	 * Process a single image generation job
	 */
	private async processJob(job: ImageGenerationJob): Promise<void> {
		try {
			// Update job status to processing
			await this.updateJobStatus(job.id, 'processing');

			// Get user's Pexels API key
			const userApiKey = await this.getUserPexelsApiKey(job.user_id);

			// Generate image for the city
			// Worker doesn't have city dominance data, so default to country-focused search
			const imageUrl = await getTripBannerImage(job.cityName, userApiKey, undefined, false);

			if (imageUrl) {
				// Update suggested trip with image URL
				await this.updateSuggestedTripImage(job.suggested_trip_id, imageUrl);

				// Mark job as completed
				await this.updateJobStatus(job.id, 'completed', imageUrl);

				console.log(`✅ Image generated successfully for ${job.cityName}: ${imageUrl}`);
			} else {
				// Mark job as failed
				await this.updateJobStatus(job.id, 'failed', null, 'Failed to generate image');

				console.log(`❌ Failed to generate image for ${job.cityName}`);
			}
		} catch (error) {
			console.error(`❌ Error processing image generation job ${job.id}:`, error);

			// Increment attempt count
			const newAttempts = job.attempts + 1;

			if (newAttempts >= job.max_attempts) {
				// Mark job as failed after max attempts
				await this.updateJobStatus(
					job.id,
					'failed',
					null,
					`Failed after ${newAttempts} attempts: ${error}`
				);
			} else {
				// Reset job to queued for retry
				await this.updateJobStatus(job.id, 'queued', null, null, newAttempts);
			}
		}
	}

	/**
	 * Get user's Pexels API key from preferences
	 * Priority: User's personal key > Server key
	 */
	private async getUserPexelsApiKey(userId: string): Promise<string | undefined> {
		try {
			// First check if user has a personal API key
			const { data: preferences, error } = await this.fluxbase
				.from('user_preferences')
				.select('pexels_api_key')
				.eq('id', userId)
				.single();

			// Prioritize user's personal API key if configured
			if (!error && preferences?.pexels_api_key) {
				console.log('🔑 Using user personal Pexels API key');
				return preferences.pexels_api_key;
			}

			// Fall back to server-level API key from database
			const { data: serverSettings, error: settingsError } = await this.fluxbase
				.from('server_settings')
				.select('server_pexels_api_key')
				.single();

			if (!settingsError && serverSettings?.server_pexels_api_key) {
				console.log('🔑 Using server-level Pexels API key');
				return serverSettings.server_pexels_api_key;
			}

			console.log('⚠️ No Pexels API key available');
			return undefined;
		} catch (error) {
			console.error('❌ Error fetching user Pexels API key:', error);
			return undefined;
		}
	}

	/**
	 * Update job status
	 */
	private async updateJobStatus(
		jobId: string,
		status: 'queued' | 'processing' | 'completed' | 'failed',
		imageUrl?: string | null,
		error?: string | null,
		attempts?: number
	): Promise<void> {
		const updateData: Record<string, unknown> = {
			status,
			updated_at: new Date().toISOString()
		};

		if (status === 'completed') {
			updateData.completed_at = new Date().toISOString();
			updateData.image_url = imageUrl;
		} else if (status === 'failed') {
			updateData.error = error;
		}

		if (attempts !== undefined) {
			updateData.attempts = attempts;
		}

		const { error: updateError } = await this.fluxbase
			.from('image_generation_jobs')
			.update(updateData)
			.eq('id', jobId);

		if (updateError) {
			console.error('❌ Error updating job status:', updateError);
		}
	}

	/**
	 * Update suggested trip with generated image URL
	 */
	private async updateSuggestedTripImage(suggestedTripId: string, imageUrl: string): Promise<void> {
		const { error } = await this.fluxbase
			.from('trips')
			.update({ image_url: imageUrl })
			.eq('id', suggestedTripId)
			.eq('status', 'pending');

		if (error) {
			console.error('❌ Error updating suggested trip with image URL:', error);
		}
	}

	/**
	 * Clean up old completed/failed jobs
	 */
	async cleanupOldJobs(): Promise<void> {
		try {
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			const { error } = await this.fluxbase
				.from('image_generation_jobs')
				.delete()
				.in('status', ['completed', 'failed'])
				.lt('created_at', thirtyDaysAgo.toISOString());

			if (error) {
				console.error('❌ Error cleaning up old image generation jobs:', error);
			} else {
				console.log('🧹 Cleaned up old image generation jobs');
			}
		} catch (error) {
			console.error('❌ Error in cleanup:', error);
		}
	}

	/**
	 * Get job statistics
	 */
	async getJobStats(): Promise<{
		queued: number;
		processing: number;
		completed: number;
		failed: number;
	}> {
		try {
			const { data: stats, error } = await this.fluxbase
				.from('image_generation_jobs')
				.select('status');

			if (error) {
				console.error('❌ Error fetching job stats:', error);
				return { queued: 0, processing: 0, completed: 0, failed: 0 };
			}

			const counts = {
				queued: 0,
				processing: 0,
				completed: 0,
				failed: 0
			};

			stats?.forEach((job) => {
				counts[job.status as keyof typeof counts]++;
			});

			return counts;
		} catch (error) {
			console.error('❌ Error getting job stats:', error);
			return { queued: 0, processing: 0, completed: 0, failed: 0 };
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
