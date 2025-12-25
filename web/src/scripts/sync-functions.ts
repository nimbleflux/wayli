/**
 * Fluxbase Function Sync Script
 *
 * Syncs edge functions to Fluxbase on Wayli startup.
 * Uses bundling to resolve imports and dependencies.
 * Runs in both development and production environments.
 */

import { config } from 'dotenv';
import { createClient } from '@fluxbase/sdk';
import { readFile, readdir } from 'fs/promises';
import { join, basename, extname } from 'path';

// Load environment variables from .env files
// Priority: existing env vars > .env.local > .env
// This allows Docker env vars to take precedence
config({ path: join(process.cwd(), '.env.local'), override: false });
config({ path: join(process.cwd(), '.env'), override: false });

interface FunctionConfig {
	name: string;
	filePath: string;
	enabled: boolean;
	allow_net?: boolean;
	allow_env?: boolean;
	allow_read?: boolean;
	allow_write?: boolean;
	allow_unauthenticated?: boolean;
	require_role?: string;
	timeout?: number;
}

/**
 * Parse JSDoc comments from function file to extract Fluxbase annotations
 * Supports:
 * - @fluxbase:allow-net
 * - @fluxbase:allow-env
 * - @fluxbase:allow-read
 * - @fluxbase:allow-write
 * - @fluxbase:allow-unauthenticated
 * - @fluxbase:disabled
 * - @fluxbase:require-role <role>
 * - @fluxbase:timeout <seconds>
 */
function parseFunctionAnnotations(code: string): {
	allow_net: boolean;
	allow_env: boolean;
	allow_read: boolean;
	allow_write: boolean;
	allow_unauthenticated: boolean;
	enabled: boolean;
	require_role?: string;
	timeout?: number;
} {
	const annotations: {
		allow_net: boolean;
		allow_env: boolean;
		allow_read: boolean;
		allow_write: boolean;
		allow_unauthenticated: boolean;
		enabled: boolean;
		require_role?: string;
		timeout?: number;
	} = {
		allow_net: false,
		allow_env: false,
		allow_read: false,
		allow_write: false,
		allow_unauthenticated: false,
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
	if (jsdoc.includes('@fluxbase:allow-unauthenticated')) annotations.allow_unauthenticated = true;
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
 * Auto-discover edge functions from the functions directory
 * Excludes: type definitions, config files, test files, README, etc.
 */
async function discoverFunctions(basePath: string): Promise<FunctionConfig[]> {
	const functionsDir = join(basePath, 'fluxbase/functions');

	// Files to exclude from auto-discovery
	const excludePatterns = [
		'types.d.ts',
		'deno.json',
		'deno.dev.json',
		'deno.lock',
		'README.md',
		'test-function.ts'
	];

	try {
		const files = await readdir(functionsDir);
		const functions: FunctionConfig[] = [];

		for (const file of files) {
			// Skip if not a .ts file
			if (extname(file) !== '.ts') continue;

			// Skip excluded files
			if (excludePatterns.includes(file)) continue;

			// Skip test files
			if (file.endsWith('.test.ts') || file.startsWith('test-')) continue;

			// Skip _shared directory (if it exists)
			if (file.startsWith('_')) continue;

			const functionName = basename(file, '.ts');
			const filePath = join(functionsDir, file);

			// Read file and parse annotations
			const code = await readFile(filePath, 'utf-8');
			const annotations = parseFunctionAnnotations(code);

			// Validate that function has handler export
			if (!code.includes('async function handler') && !code.includes('export default handler')) {
				console.warn(`⚠️  ${functionName}: Missing handler function - skipping`);
				continue;
			}

			functions.push({
				name: functionName,
				filePath: `fluxbase/functions/${file}`,
				enabled: annotations.enabled,
				allow_net: annotations.allow_net,
				allow_env: annotations.allow_env,
				allow_read: annotations.allow_read,
				allow_write: annotations.allow_write,
				allow_unauthenticated: annotations.allow_unauthenticated,
				require_role: annotations.require_role,
				timeout: annotations.timeout
			});

			const permissions: string[] = [];
			if (annotations.allow_net) permissions.push('net');
			if (annotations.allow_env) permissions.push('env');
			if (annotations.allow_read) permissions.push('read');
			if (annotations.allow_write) permissions.push('write');
			if (annotations.allow_unauthenticated) permissions.push('unauthenticated');
			if (annotations.require_role) permissions.push(`role=${annotations.require_role}`);
			if (annotations.timeout) permissions.push(`timeout=${annotations.timeout}s`);

			console.log(`📦 Discovered: ${functionName} [${permissions.join(', ') || 'no special permissions'}]`);
		}

		return functions.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.error(`❌ Failed to discover functions in ${functionsDir}:`, error);
		throw error;
	}
}

async function syncFunctions() {
	console.log('🔄 Starting Fluxbase function sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.FLUXBASE_PUBLIC_BASE_URL;
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_FUNCTIONS_NAMESPACE || 'wayli';
	const deleteMissing = process.env.FLUXBASE_FUNCTIONS_DELETE_MISSING !== 'false';

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
	console.log(`🗑️  Delete missing functions: ${deleteMissing}`);

	try {
		// Determine base path (different in dev vs production)
		// In dev: /workspace/ (repo root, fluxbase is at root level)
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : join(process.cwd(), '..');

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Auto-discovering edge functions...\n');

		// Auto-discover functions from the functions directory
		const discoveredFunctions = await discoverFunctions(basePath);

		if (discoveredFunctions.length === 0) {
			console.warn('⚠️  No functions discovered. Check the functions directory.');
			return;
		}

		console.log(`\n✅ Discovered ${discoveredFunctions.length} functions\n`);

		// Where node_modules live (for resolving npm packages)
		const webNodeModules = join(basePath, 'web/node_modules');

		// Read and prepare function code
		const functionsToSync = await Promise.all(
			discoveredFunctions.map(async (config: FunctionConfig) => {
				const filePath = join(basePath, config.filePath);
				console.log(`📖 Reading: ${config.name} from ${filePath}`);

				try {
					const code = await readFile(filePath, 'utf-8');
					console.log(`✅ Read ${config.name}: ${code.length} bytes`);

					return {
						name: config.name,
						code,
						// Source directory for resolving relative imports like "../jobs/types"
						sourceDir: join(basePath, 'fluxbase/functions'),
						// Additional node_modules paths for resolving npm packages
						nodePaths: [webNodeModules],
						enabled: config.enabled,
						allow_net: config.allow_net,
						allow_env: config.allow_env,
						allow_read: config.allow_read,
						allow_write: config.allow_write,
						allow_unauthenticated: config.allow_unauthenticated,
						require_role: config.require_role,
						timeout: config.timeout
					};
				} catch (error) {
					console.error(`❌ Failed to read ${config.name}:`, error);
					throw error;
				}
			})
		);

		console.log(`\n🚀 Preparing to sync ${functionsToSync.length} functions to namespace "${namespace}"...`);

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		console.log('\n📦 Syncing functions (SDK will handle bundling)...\n');

		// Sync functions - SDK handles bundling with proper Deno external handling
		const { data, error } = await client.admin.functions.syncWithBundling(
			{
				namespace,
				functions: functionsToSync,
				options: {
					delete_missing: deleteMissing
				}
			},
			{
				// No embedded defines needed for functions (unlike jobs which may need GeoJSON)
			}
		);

		if (error) {
			console.error('❌ Function sync failed:', error);
			process.exit(1);
		}

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));

			// Check for errors in the response
			const syncData = data as {
				summary?: { errors?: number; created?: number; updated?: number };
				errors?: Array<{ function: string; error: string; action: string }>;
			};

			if (syncData.summary?.errors && syncData.summary.errors > 0) {
				console.error(`\n❌ Function sync failed: ${syncData.summary.errors} function(s) had errors`);

				if (syncData.errors && syncData.errors.length > 0) {
					console.error('\n📋 Failed functions:');
					for (const err of syncData.errors) {
						console.error(`   • ${err.function}: ${err.error}`);
					}
				}

				process.exit(1);
			}

			const successCount = (syncData.summary?.created || 0) + (syncData.summary?.updated || 0);
			console.log(`\n✅ Function sync completed: ${successCount} function(s) synced successfully`);
		} else {
			console.log('✅ Function sync completed successfully!');
		}

		// Summary
		console.log('\n📋 Edge functions:');
		functionsToSync.forEach((fn: (typeof functionsToSync)[0]) => {
			const details: string[] = [];
			if (fn.allow_net) details.push('net');
			if (fn.allow_env) details.push('env');
			if (fn.allow_read) details.push('read');
			if (fn.allow_write) details.push('write');
			if (fn.allow_unauthenticated) details.push('unauthenticated');
			if (fn.require_role) details.push(`role=${fn.require_role}`);
			if (fn.timeout) details.push(`timeout=${fn.timeout}s`);

			console.log(
				`   • ${fn.name} (${fn.enabled ? 'enabled' : 'disabled'}) [${details.join(', ') || 'no special permissions'}]`
			);
		});

		console.log('\n✨ All functions are now deployed and ready!');
	} catch (error) {
		console.error('❌ Unexpected error during function sync:', error);
		process.exit(1);
	}
}

// Run the sync
syncFunctions().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});
