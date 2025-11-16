#!/usr/bin/env node

import { randomUUID } from 'crypto';

import { JobWorker } from './services/job-worker.service';

// 🚨 WORKER ENVIRONMENT ONLY - This code runs in background workers
// Do not import this in client or server code

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Get worker ID from command line arguments or generate one
const providedId = process.argv[2];
let workerId: string;

if (providedId && UUID_REGEX.test(providedId)) {
	// Use provided UUID if it's valid
	workerId = providedId;
	console.log(`🔑 Using provided worker ID: ${workerId}`);
} else {
	// Generate new UUID if no valid UUID provided
	workerId = randomUUID();
	if (providedId) {
		console.log(`⚠️  Invalid UUID provided: "${providedId}". Generating new UUID instead.`);
	}
	console.log(`🆔 Generated new worker ID: ${workerId}`);
}

console.log(`🚀 Starting standalone worker with ID: ${workerId}`);
console.log(`⚙️  Environment: Worker Process`);
console.log(`📁 Working directory: ${process.cwd()}`);

// Create and start the worker
const worker = new JobWorker(workerId);

// Handle graceful shutdown
process.on('SIGINT', async () => {
	console.log('\n🛑 Received SIGINT, shutting down worker gracefully...');
	try {
		await worker.stop(true); // Graceful shutdown
		console.log('✅ Worker shutdown completed successfully');
		process.exit(0);
	} catch (error) {
		console.error('❌ Error during worker shutdown:', error);
		process.exit(1);
	}
});

process.on('SIGTERM', async () => {
	console.log('\n🛑 Received SIGTERM (Kubernetes preStop), shutting down worker gracefully...');
	try {
		await worker.stop(true); // Graceful shutdown with 30s grace period
		console.log('✅ Worker shutdown completed successfully');
		process.exit(0);
	} catch (error) {
		console.error('❌ Error during worker shutdown:', error);
		process.exit(1);
	}
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
	console.error('❌ Uncaught exception:', error);

	// Check if this is a connection-related error
	if (error instanceof Error) {
		if (
			error.message.includes('Missing required environment variables') ||
			error.message.includes('Worker cannot connect to Fluxbase') ||
			error.message.includes('FLUXBASE_BASE_URL') ||
			error.message.includes('FLUXBASE_SERVICE_ROLE_KEY')
		) {
			console.error('🚨 Critical connection error detected in uncaught exception');
		}
	}

	await worker.stop();
	process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
	console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);

	// Check if this is a connection-related error
	if (reason instanceof Error) {
		if (
			reason.message.includes('Missing required environment variables') ||
			reason.message.includes('Worker cannot connect to Fluxbase') ||
			reason.message.includes('FLUXBASE_BASE_URL') ||
			reason.message.includes('FLUXBASE_SERVICE_ROLE_KEY')
		) {
			console.error('🚨 Critical connection error detected in unhandled rejection');
		}
	}

	await worker.stop();
	process.exit(1);
});

// Start the worker with retry mechanism
async function startWorkerWithRetry(maxRetries = 3, retryDelay = 2000) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(`🔄 Attempt ${attempt}/${maxRetries} to start worker...`);
			await worker.start();
			console.log('✅ Worker started successfully!');
			return;
		} catch (error) {
			console.error(`❌ Attempt ${attempt} failed:`, error);

			// Check if this is a connection error that should cause immediate exit
			if (error instanceof Error) {
				if (
					error.message.includes('Missing required environment variables') ||
					error.message.includes('Worker cannot connect to Fluxbase') ||
					error.message.includes('FLUXBASE_BASE_URL') ||
					error.message.includes('FLUXBASE_SERVICE_ROLE_KEY')
				) {
					console.error('🚨 Critical connection error detected - exiting immediately');
					await worker.stop();
					process.exit(1);
				}
			}

			if (attempt < maxRetries) {
				console.log(`⏳ Retrying in ${retryDelay}ms...`);
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				retryDelay *= 2; // Exponential backoff
			} else {
				console.error('❌ All attempts to start worker failed');
				await worker.stop();
				process.exit(1);
			}
		}
	}
}

startWorkerWithRetry();

console.log(`✅ Worker ${workerId} is running. Press Ctrl+C to stop.`);
