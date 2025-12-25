/**
 * Fluxbase Job Sync Script
 *
 * Syncs job handlers to Fluxbase on Wayli startup.
 * Currently validates job files and prepares them for future Fluxbase Jobs platform.
 * Runs in both development and production environments.
 */

import { config } from 'dotenv';
import { createClient } from '@fluxbase/sdk';
import { readFile, readdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { gzipSync } from 'zlib';

// Load environment variables from .env files
// Priority: existing env vars > .env.local > .env
// This allows Docker env vars to take precedence
config({ path: join(process.cwd(), '.env.local'), override: false });
config({ path: join(process.cwd(), '.env'), override: false });

interface JobConfig {
	name: string;
	filePath: string;
	enabled: boolean;
	allow_net?: boolean;
	allow_env?: boolean;
	allow_read?: boolean;
	allow_write?: boolean;
	require_role?: string;
	timeout?: number;
}

/**
 * Parse JSDoc comments from job file to extract Fluxbase annotations
 * Supports:
 * - @fluxbase:allow-net
 * - @fluxbase:allow-env
 * - @fluxbase:allow-read
 * - @fluxbase:allow-write
 * - @fluxbase:disabled
 * - @fluxbase:require-role <role>
 * - @fluxbase:timeout <seconds>
 */
function parseJobAnnotations(code: string): {
	allow_net: boolean;
	allow_env: boolean;
	allow_read: boolean;
	allow_write: boolean;
	enabled: boolean;
	require_role?: string;
	timeout?: number;
} {
	const annotations: {
		allow_net: boolean;
		allow_env: boolean;
		allow_read: boolean;
		allow_write: boolean;
		enabled: boolean;
		require_role?: string;
		timeout?: number;
	} = {
		allow_net: false,
		allow_env: false,
		allow_read: false,
		allow_write: false,
		enabled: true
	};

	// Match JSDoc comment at the start of the file
	const jsdocMatch = code.match(/^\/\*\*[\s\S]*?\*\//);
	if (!jsdocMatch) {
		return annotations;
	}

	const jsdoc = jsdocMatch[0];

	// Parse @fluxbase annotations
	if (jsdoc.includes('@fluxbase:allow-net')) annotations.allow_net = true;
	if (jsdoc.includes('@fluxbase:allow-env')) annotations.allow_env = true;
	if (jsdoc.includes('@fluxbase:allow-read')) annotations.allow_read = true;
	if (jsdoc.includes('@fluxbase:allow-write')) annotations.allow_write = true;
	if (jsdoc.includes('@fluxbase:disabled')) annotations.enabled = false;

	// Parse require-role
	const requireRoleMatch = jsdoc.match(/@fluxbase:require-role\s+(\w+)/);
	if (requireRoleMatch) {
		annotations.require_role = requireRoleMatch[1];
	}

	// Parse timeout
	const timeoutMatch = jsdoc.match(/@fluxbase:timeout\s+(\d+)/);
	if (timeoutMatch) {
		annotations.timeout = parseInt(timeoutMatch[1], 10);
	}

	return annotations;
}

/**
 * Auto-discover job handlers from the jobs directory
 * Excludes: type definitions, config files, test files, README, etc.
 */
async function discoverJobs(basePath: string): Promise<JobConfig[]> {
	const jobsDir = join(basePath, 'fluxbase/jobs');

	// Files to exclude from auto-discovery
	const excludePatterns = [
		'types.d.ts', // Type definitions for Fluxbase global API
		'deno.json',
		'deno.dev.json',
		'deno.lock',
		'README.md',
		'ARCHITECTURE.md',
		'test-job.ts'
	];

	try {
		const files = await readdir(jobsDir);
		const jobs: JobConfig[] = [];

		for (const file of files) {
			// Skip if not a .ts file
			if (extname(file) !== '.ts') continue;

			// Skip excluded files
			if (excludePatterns.includes(file)) continue;

			// Skip test files
			if (file.endsWith('.test.ts') || file.startsWith('test-')) continue;

			// Skip _shared directory (if it exists)
			if (file.startsWith('_')) continue;

			const jobName = basename(file, '.ts');
			const filePath = join(jobsDir, file);

			// Read file and parse annotations
			const code = await readFile(filePath, 'utf-8');
			const annotations = parseJobAnnotations(code);

			// Validate that job has handler export
			if (!code.includes('export async function handler')) {
				console.warn(`⚠️  ${jobName}: Missing 'export async function handler' - skipping`);
				continue;
			}

			jobs.push({
				name: jobName,
				filePath: `fluxbase/jobs/${file}`,
				enabled: annotations.enabled,
				allow_net: annotations.allow_net,
				allow_env: annotations.allow_env,
				allow_read: annotations.allow_read,
				allow_write: annotations.allow_write,
				require_role: annotations.require_role,
				timeout: annotations.timeout
			});

			const permissions: string[] = [];
			if (annotations.allow_net) permissions.push('net');
			if (annotations.allow_env) permissions.push('env');
			if (annotations.allow_read) permissions.push('read');
			if (annotations.allow_write) permissions.push('write');
			if (annotations.require_role) permissions.push(`role=${annotations.require_role}`);
			if (annotations.timeout) permissions.push(`timeout=${annotations.timeout}s`);

			console.log(`📦 Discovered: ${jobName} [${permissions.join(', ') || 'no special permissions'}]`);
		}

		return jobs.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.error(`❌ Failed to discover jobs in ${jobsDir}:`, error);
		throw error;
	}
}

/**
 * Load and compress GeoJSON files for embedding in bundled code
 * Returns define values for esbuild
 */
async function loadEmbeddedGeoJSON(basePath: string): Promise<Record<string, string>> {
	const defines: Record<string, string> = {};

	const geoJsonFiles = [
		{ name: 'EMBEDDED_COUNTRIES_GEOJSON', path: 'web/src/lib/data/countries.geojson' },
		{ name: 'EMBEDDED_TIMEZONES_GEOJSON', path: 'web/src/lib/data/timezones.geojson' }
	];

	for (const file of geoJsonFiles) {
		const filePath = join(basePath, file.path);
		try {
			const content = await readFile(filePath, 'utf-8');
			// Compress with gzip and base64 encode
			const compressed = gzipSync(content);
			const base64 = compressed.toString('base64');
			defines[file.name] = JSON.stringify(base64);
			console.log(`📦 Embedded ${file.name}: ${(content.length / 1024).toFixed(1)}KB -> ${(base64.length / 1024).toFixed(1)}KB (compressed)`);
		} catch (error) {
			console.warn(`⚠️  Could not load ${file.path}: ${(error as Error).message}`);
		}
	}

	return defines;
}

async function syncJobs() {
	console.log('🔄 Starting Fluxbase job handler sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.FLUXBASE_PUBLIC_BASE_URL;
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_JOBS_NAMESPACE || 'wayli';
	const deleteMissing = process.env.FLUXBASE_JOBS_DELETE_MISSING !== 'false';

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
	console.log(`📦 Namespace: ${namespace}`);
	console.log(`🗑️  Delete missing jobs: ${deleteMissing}`);

	try {
		// Determine base path (different in dev vs production)
		// In dev: /workspace/ (repo root, fluxbase is at root level)
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : join(process.cwd(), '..');

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Auto-discovering job handlers...\n');

		// Auto-discover jobs from the jobs directory
		const discoveredJobs = await discoverJobs(basePath);

		if (discoveredJobs.length === 0) {
			console.warn('⚠️  No job handlers discovered. Check the jobs directory.');
			return;
		}

		console.log(`\n✅ Discovered ${discoveredJobs.length} job handlers\n`);

		// Load embedded GeoJSON data for country/timezone lookups
		console.log('📦 Loading embedded GeoJSON data...');
		const embeddedDefines = await loadEmbeddedGeoJSON(basePath);

		// Where node_modules live (for resolving npm packages like geojson, jszip, etc.)
		const webNodeModules = join(basePath, 'web/node_modules');

		// Read and prepare job code
		const jobsToSync = await Promise.all(
			discoveredJobs.map(async (config: JobConfig) => {
				const filePath = join(basePath, config.filePath);
				console.log(`📖 Reading: ${config.name} from ${filePath}`);

				try {
					const code = await readFile(filePath, 'utf-8');
					console.log(`✅ Read ${config.name}: ${code.length} bytes`);

					return {
						name: config.name,
						code,
						// Source directory for resolving relative imports like "../../web/src/..."
						sourceDir: join(basePath, 'fluxbase/jobs'),
						// Additional node_modules paths for resolving npm packages
						nodePaths: [webNodeModules],
						enabled: config.enabled,
						allow_net: config.allow_net,
						allow_env: config.allow_env,
						allow_read: config.allow_read,
						allow_write: config.allow_write,
						require_role: config.require_role,
						timeout: config.timeout
					};
				} catch (error) {
					console.error(`❌ Failed to read ${config.name}:`, error);
					throw error;
				}
			})
		);

		console.log(`\n🚀 Preparing to sync ${jobsToSync.length} job handlers to namespace "${namespace}"...`);

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		console.log('\n📦 Syncing jobs (SDK will handle bundling)...\n');

		// Sync jobs - SDK handles bundling with proper Deno external handling
		const { data, error } = await client.admin.jobs.syncWithBundling(
			{
				namespace,
				functions: jobsToSync,
				options: {
					delete_missing: deleteMissing
				}
			},
			{
				// Embed GeoJSON data as compile-time constants
				define: embeddedDefines
			}
		);

		if (error) {
			console.error('❌ Job sync failed:', error);
			process.exit(1);
		}

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));

			// Check for errors in the response
			const syncData = data as {
				summary?: { errors?: number; created?: number; updated?: number };
				errors?: Array<{ job: string; error: string; action: string }>;
			};

			if (syncData.summary?.errors && syncData.summary.errors > 0) {
				console.error(`\n❌ Job sync failed: ${syncData.summary.errors} job(s) had errors`);

				if (syncData.errors && syncData.errors.length > 0) {
					console.error('\n📋 Failed jobs:');
					for (const err of syncData.errors) {
						console.error(`   • ${err.job}: ${err.error}`);
					}
				}

				process.exit(1);
			}

			const successCount = (syncData.summary?.created || 0) + (syncData.summary?.updated || 0);
			console.log(`\n✅ Job sync completed: ${successCount} job(s) synced successfully`);
		} else {
			console.log('✅ Job sync completed successfully!');
		}

		// Summary
		console.log('\n📋 Job handlers:');
		jobsToSync.forEach((job: typeof jobsToSync[0]) => {
			const details: string[] = [];
			if (job.allow_net) details.push('net');
			if (job.allow_env) details.push('env');
			if (job.allow_read) details.push('read');
			if (job.allow_write) details.push('write');
			if (job.require_role) details.push(`role=${job.require_role}`);
			if (job.timeout) details.push(`timeout=${job.timeout}s`);

			console.log(
				`   • ${job.name} (${job.enabled ? 'enabled' : 'disabled'}) [${details.join(', ') || 'no special permissions'}]`
			);
		});

		console.log('\n✨ Sync complete!');
	} catch (error) {
		console.error('❌ Unexpected error during job sync:', error);
		process.exit(1);
	}
}

// Run the sync
syncJobs().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});
