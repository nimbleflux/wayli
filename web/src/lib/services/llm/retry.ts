/**
 * Retry utility for LLM API calls with exponential backoff
 */

import type { LLMError } from '../../types/ai.types';

export interface RetryConfig {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR', '429', '500', '502', '503', '504']
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with jitter to prevent thundering herd
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
	const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
	const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
	// Add 10-30% jitter
	const jitter = cappedDelay * (0.1 + Math.random() * 0.2);
	return Math.floor(cappedDelay + jitter);
}

/**
 * Check if an error is retryable
 */
function isRetryable(error: unknown, config: RetryConfig): boolean {
	if (!error) return false;

	// Check if it's an LLMError with retryable flag
	if (typeof error === 'object' && 'retryable' in error) {
		return (error as LLMError).retryable === true;
	}

	// Check error code
	if (typeof error === 'object' && 'code' in error) {
		const code = String((error as { code: unknown }).code);
		return config.retryableErrors.some((rc) => code.includes(rc));
	}

	// Check error message for common patterns
	if (typeof error === 'object' && 'message' in error) {
		const message = String((error as { message: unknown }).message).toLowerCase();
		return (
			message.includes('rate limit') ||
			message.includes('timeout') ||
			message.includes('temporarily unavailable') ||
			message.includes('overloaded') ||
			message.includes('too many requests')
		);
	}

	return false;
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	config: Partial<RetryConfig> = {}
): Promise<T> {
	const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
	let lastError: unknown;

	for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry on last attempt or non-retryable errors
			if (attempt === fullConfig.maxRetries || !isRetryable(error, fullConfig)) {
				throw error;
			}

			const delay = calculateDelay(attempt, fullConfig);
			console.warn(
				`LLM request failed (attempt ${attempt + 1}/${fullConfig.maxRetries + 1}), ` +
					`retrying in ${delay}ms...`,
				error instanceof Error ? error.message : error
			);

			await sleep(delay);
		}
	}

	// Should never reach here, but TypeScript needs it
	throw lastError;
}

/**
 * Create a retryable version of an async function
 */
export function makeRetryable<TArgs extends unknown[], TResult>(
	fn: (...args: TArgs) => Promise<TResult>,
	config: Partial<RetryConfig> = {}
): (...args: TArgs) => Promise<TResult> {
	return (...args: TArgs) => withRetry(() => fn(...args), config);
}
