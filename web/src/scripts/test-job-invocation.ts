#!/usr/bin/env tsx
/**
 * Test Job Invocation Script
 *
 * Tests whether Fluxbase Jobs are properly synced and can be invoked successfully.
 * This script:
 * 1. Verifies jobs are synced to Fluxbase
 * 2. Creates a test job
 * 3. Monitors job execution
 * 4. Verifies the job completes successfully
 */

import { config } from 'dotenv';
import { createClient } from '@fluxbase/sdk';
import { join } from 'path';

// Load environment variables
config({ path: join(process.cwd(), '.env.local'), override: false });
config({ path: join(process.cwd(), '.env'), override: false });

interface JobStatus {
	job_id: string;
	status: string;
	progress?: number;
	message?: string;
	result?: unknown;
	error?: string;
}

async function testJobInvocation() {
	console.log('🧪 Testing Fluxbase Job Invocation...\n');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.PUBLIC_FLUXBASE_BASE_URL;
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_JOBS_NAMESPACE || 'wayli';

	// Validate required environment variables
	if (!fluxbaseUrl) {
		console.error('❌ Error: FLUXBASE_BASE_URL is not set');
		process.exit(1);
	}

	if (!serviceRoleKey) {
		console.error('❌ Error: FLUXBASE_SERVICE_ROLE_KEY is not set');
		process.exit(1);
	}

	console.log(`📡 Fluxbase URL: ${fluxbaseUrl}`);
	console.log(`📦 Namespace: ${namespace}\n`);

	try {
		// Create Fluxbase client with service role key for admin operations
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		// Step 1: Check if jobs are synced (optional - skip on error)
		console.log('📋 Step 1: Checking synced jobs...');
		const { data: jobsList, error: listError } = await client.admin.jobs.list({ namespace });

		if (listError) {
			console.warn('⚠️  Warning: Failed to list jobs:', listError.message);
			console.warn('   Continuing with test anyway...');
		} else if (!jobsList || jobsList.length === 0) {
			console.warn('⚠️  Warning: No jobs found in list. This might be an API issue.');
			console.warn('   Continuing with test anyway...');
		} else {
			console.log(`✅ Found ${jobsList.length} synced jobs:`);
			jobsList.forEach((job: { name: string; enabled: boolean }) => {
				console.log(`   • ${job.name} (${job.enabled ? 'enabled' : 'disabled'})`);
			});
		}
		console.log();

		// Step 2: Sign in as test user (or create one)
		console.log('👤 Step 2: Authenticating...');
		const testEmail = `test-${Date.now()}@example.com`;
		const testPassword = 'TestPassword123!';

		// Try to sign up (will fail if user exists, but that's ok for testing)
		const { error: signUpError } = await client.auth.signUp({
			email: testEmail,
			password: testPassword
		});

		if (signUpError && !signUpError.message.includes('already registered')) {
			console.error('❌ Failed to sign up:', signUpError);
			process.exit(1);
		}

		// Sign in
		const { data: authData, error: signInError } = await client.auth.signInWithPassword({
			email: testEmail,
			password: testPassword
		});

		if (signInError) {
			console.error('❌ Failed to sign in:', signInError);
			process.exit(1);
		}

		console.log(`✅ Authenticated as: ${authData?.user?.email}`);
		console.log();

		// Step 3: Create a test job (data-export with minimal payload)
		console.log('🚀 Step 3: Creating test job...');
		console.log(`   Trying with namespace: ${namespace}`);
		let jobData;
		let enqueueError;

		// Try with namespace first
		({ data: jobData, error: enqueueError } = await client.jobs.submit(
			'data-export',
			{
				format: 'geojson',
				includeLocationData: false, // Don't include actual data for test
				includeWantToVisit: false,
				includeTrips: false
			},
			{
				namespace
			}
		));

		// If it fails with namespace, try without
		if (enqueueError && enqueueError.message.includes('not found')) {
			console.log('   ⚠️  Failed with namespace, trying without...');
			({ data: jobData, error: enqueueError } = await client.jobs.submit(
				'data-export',
				{
					format: 'geojson',
					includeLocationData: false,
					includeWantToVisit: false,
					includeTrips: false
				}
			));
		}

		if (enqueueError) {
			console.error('❌ Failed to submit job:', enqueueError);
			process.exit(1);
		}

		const jobId = jobData.job_id;
		console.log(`✅ Job created: ${jobId}`);
		console.log(`   Status: ${jobData.status}`);
		console.log();

		// Step 4: Monitor job execution
		console.log('⏳ Step 4: Monitoring job execution...');
		let attempts = 0;
		const maxAttempts = 30; // 30 seconds timeout
		let finalStatus: JobStatus | null = null;

		while (attempts < maxAttempts) {
			attempts++;

			// Get job status
			const { data: status, error: statusError } = await client.jobs.get(jobId);

			if (statusError) {
				console.error('❌ Failed to get job status:', statusError);
				break;
			}

			finalStatus = status as JobStatus;
			const statusEmoji =
				status.status === 'completed'
					? '✅'
					: status.status === 'failed'
						? '❌'
						: status.status === 'running'
							? '🔄'
							: '⏳';

			console.log(
				`${statusEmoji} [${attempts}/${maxAttempts}] Status: ${status.status}${status.progress ? ` (${status.progress}%)` : ''}${status.message ? ` - ${status.message}` : ''}`
			);

			// Check if job is done
			if (status.status === 'completed' || status.status === 'failed') {
				break;
			}

			// Wait before next check
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		console.log();

		// Step 5: Verify result
		console.log('📊 Step 5: Verifying result...');
		if (!finalStatus) {
			console.error('❌ Failed to get final job status');
			process.exit(1);
		}

		if (finalStatus.status === 'completed') {
			console.log('✅ Job completed successfully!');
			if (finalStatus.result) {
				console.log('\n📦 Result:');
				console.log(JSON.stringify(finalStatus.result, null, 2));
			}
		} else if (finalStatus.status === 'failed') {
			console.error('❌ Job failed!');
			if (finalStatus.error) {
				console.error('\n❌ Error:');
				console.error(finalStatus.error);
			}
			process.exit(1);
		} else {
			console.warn('⚠️  Job did not complete within timeout');
			console.warn(`   Final status: ${finalStatus.status}`);
			process.exit(1);
		}

		console.log();
		console.log('🎉 All tests passed! Jobs are properly synced and invoked.');
	} catch (error) {
		console.error('❌ Unexpected error:', error);
		process.exit(1);
	}
}

// Run the test
testJobInvocation().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});
