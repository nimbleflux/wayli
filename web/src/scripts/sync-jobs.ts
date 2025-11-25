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
import * as esbuild from 'esbuild';

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
	require_role?: string;
	timeout?: number;
}

/**
 * Parse JSDoc comments from job file to extract Fluxbase annotations
 * Supports:
 * - @fluxbase:allow-net
 * - @fluxbase:allow-env
 * - @fluxbase:allow-read
 * - @fluxbase:disabled
 * - @fluxbase:require-role <role>
 * - @fluxbase:timeout <seconds>
 */
function parseJobAnnotations(code: string): {
	allow_net: boolean;
	allow_env: boolean;
	allow_read: boolean;
	enabled: boolean;
	require_role?: string;
	timeout?: number;
} {
	const annotations: {
		allow_net: boolean;
		allow_env: boolean;
		allow_read: boolean;
		enabled: boolean;
		require_role?: string;
		timeout?: number;
	} = {
		allow_net: false,
		allow_env: false,
		allow_read: false,
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
 * Prepare compressed and base64-encoded GeoJSON data for embedding
 */
async function prepareEmbeddedGeoJSON(basePath: string): Promise<{
	countries: string;
	timezones: string;
}> {
	console.log('📦 Preparing embedded GeoJSON data...');

	try {
		// Load countries.geojson
		const countriesPath = join(basePath, 'src/lib/data/countries.geojson');
		const countriesData = await readFile(countriesPath, 'utf-8');
		const countriesCompressed = gzipSync(countriesData);
		const countriesBase64 = countriesCompressed.toString('base64');
		const countriesSizeOriginal = (countriesData.length / 1024 / 1024).toFixed(2);
		const countriesSizeCompressed = (countriesBase64.length / 1024 / 1024).toFixed(2);
		console.log(
			`  ✅ countries.geojson: ${countriesSizeOriginal} MB → ${countriesSizeCompressed} MB (compressed)`
		);

		// Load timezones.geojson
		const timezonesPath = join(basePath, 'src/lib/data/timezones.geojson');
		const timezonesData = await readFile(timezonesPath, 'utf-8');
		const timezonesCompressed = gzipSync(timezonesData);
		const timezonesBase64 = timezonesCompressed.toString('base64');
		const timezonesSizeOriginal = (timezonesData.length / 1024 / 1024).toFixed(2);
		const timezonesSizeCompressed = (timezonesBase64.length / 1024 / 1024).toFixed(2);
		console.log(
			`  ✅ timezones.geojson: ${timezonesSizeOriginal} MB → ${timezonesSizeCompressed} MB (compressed)`
		);

		return {
			countries: countriesBase64,
			timezones: timezonesBase64
		};
	} catch (error) {
		console.error('❌ Failed to prepare embedded GeoJSON:', error);
		throw error;
	}
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
				require_role: annotations.require_role,
				timeout: annotations.timeout
			});

			const permissions: string[] = [];
			if (annotations.allow_net) permissions.push('net');
			if (annotations.allow_env) permissions.push('env');
			if (annotations.allow_read) permissions.push('read');
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

async function syncJobs() {
	console.log('🔄 Starting Fluxbase job handler sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.PUBLIC_FLUXBASE_BASE_URL;
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
		// In dev: /workspace/web/
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : process.cwd();

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Auto-discovering job handlers...\n');

		// Auto-discover jobs from the jobs directory
		const discoveredJobs = await discoverJobs(basePath);

		if (discoveredJobs.length === 0) {
			console.warn('⚠️  No job handlers discovered. Check the jobs directory.');
			return;
		}

		console.log(`\n✅ Discovered ${discoveredJobs.length} job handlers\n`);

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
						enabled: config.enabled,
						allow_net: config.allow_net,
						allow_env: config.allow_env,
						allow_read: config.allow_read,
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

		// Prepare embedded GeoJSON data
		const embeddedGeoJSON = await prepareEmbeddedGeoJSON(basePath);

		console.log('\n📦 Bundling jobs locally with esbuild...\n');

		// Bundle each job locally using esbuild
		const bundledJobs = await Promise.all(
			jobsToSync.map(async (job) => {
				console.log(`  📦 Bundling ${job.name}...`);

				try {
					const jobFilePath = join(basePath, `fluxbase/jobs/${job.name}.ts`);

					// Bundle with esbuild, injecting compressed GeoJSON data
					const result = await esbuild.build({
						entryPoints: [jobFilePath],
						bundle: true,
						write: false,
						platform: 'node',
						format: 'esm',
						target: 'es2022',
						external: ['@fluxbase/sdk'], // Provided by Fluxbase runtime
						minify: false,
						sourcemap: 'inline',
						keepNames: true,
						absWorkingDir: basePath,
						define: {
							// Inject compressed GeoJSON data as constants
							EMBEDDED_COUNTRIES_GEOJSON: JSON.stringify(embeddedGeoJSON.countries),
							EMBEDDED_TIMEZONES_GEOJSON: JSON.stringify(embeddedGeoJSON.timezones)
						}
					});

					const bundledCode = result.outputFiles[0].text;
					const sizeKB = (bundledCode.length / 1024).toFixed(2);
					console.log(`  ✅ ${job.name}: ${sizeKB} KB`);

					return {
						name: job.name,
						code: bundledCode,
						is_pre_bundled: true,
						original_code: job.code,
						enabled: job.enabled,
						allow_net: job.allow_net,
						allow_env: job.allow_env,
						allow_read: job.allow_read,
						require_role: job.require_role,
						timeout: job.timeout
					};
				} catch (error) {
					console.error(`  ❌ Failed to bundle ${job.name}:`, error);
					throw error;
				}
			})
		);

		console.log('\n✅ All jobs bundled successfully!\n');

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		// Sync pre-bundled jobs to Fluxbase platform
		const { data, error } = await client.admin.jobs.syncWithBundling({
			namespace,
			functions: bundledJobs,
			options: {
				delete_missing: deleteMissing
			}
		});

		if (error) {
			console.error('❌ Job sync failed:', error);
			process.exit(1);
		}

		console.log('✅ Job sync completed successfully!');

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));
		}

		// Summary
		console.log('\n📋 Synced job handlers:');
		jobsToSync.forEach((job: typeof jobsToSync[0]) => {
			const details: string[] = [];
			if (job.allow_net) details.push('net');
			if (job.allow_env) details.push('env');
			if (job.allow_read) details.push('read');
			if (job.require_role) details.push(`role=${job.require_role}`);
			if (job.timeout) details.push(`timeout=${job.timeout}s`);

			console.log(
				`   • ${job.name} (${job.enabled ? 'enabled' : 'disabled'}) [${details.join(', ') || 'no special permissions'}]`
			);
		});

		console.log('\n✨ All job handlers synced successfully!');
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
